const express = require('express');
const pool = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { notifyCustomer } = require('../services/whatsapp');
const router = express.Router();
router.use(authMiddleware);

async function attachOvertime(rows) {
  try {
    const [alerts] = await pool.query('SELECT alert_status, hours FROM alert_config');
    const thresholds = {};
    alerts.forEach(a => { thresholds[a.alert_status] = a.hours; });
    for (const row of rows) {
      const s = row.status;
      const start = s === 'pending' ? row.updated_at : (s === 'in_transit' ? row.shipped_at : null);
      if (start && thresholds[s]) {
        const elapsed = (Date.now() - new Date(start).getTime()) / 3600000;
        row.overtime_hours = Math.round(elapsed * 10) / 10;
        row.is_overtime = elapsed > thresholds[s];
      } else { row.overtime_hours = null; row.is_overtime = false; }
    }
  } catch (e) { /* ignore */ }
}

function genShippingCode() {
  return 'SHP' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

// Log an action
async function logAction(shippingId, action, detail, operator) {
  await pool.query('INSERT INTO shipping_logs (shipping_id, action, detail, operator) VALUES (?,?,?,?)',
    [shippingId, action, detail, operator || '']);
}

// GET /api/shipping
router.get('/', async (req, res) => {
  try {
    const { status, date_from, date_to, order_no, customer, page = 1, page_size = 20, sort_by, sort_dir, tracking, delivery_staff_id } = req.query;
    let where = '1=1';
    const params = [];
    // Shipping 页签筛选：sr.status 已被 Step 4 从 tracking_events 精确同步
    // ENUM: pending | in_transit | delivered | cancelled | failed | voided
    // SSC→cancelled, DFA→failed, OKC/OKT→delivered, others→in_transit
    if (status === 'unassigned') {
      where += " AND sr.status = 'unassigned'";
    } else if (status) {
      where += ' AND sr.status = ?'; params.push(status);
    }
    if (order_no) { where += ' AND o.order_no LIKE ?'; params.push('%'+order_no+'%'); }
    if (customer) { where += ' AND (o.customer_name LIKE ? OR o.customer_phone LIKE ?)'; params.push('%'+customer+'%', '%'+customer+'%'); }
    if (tracking) { where += ' AND sr.gig_tracking LIKE ?'; params.push('%'+tracking+'%'); }
    if (delivery_staff_id) { where += ' AND sr.delivery_staff_id = ?'; params.push(delivery_staff_id); }
    if (date_from) { where += ' AND COALESCE(o.order_time, o.created_at) >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND COALESCE(o.order_time, o.created_at) <= ?'; params.push(date_to + ' 23:59:59'); }

    const allowedSort = { order_no: 'o.order_no', created_at: 'o.created_at', order_time: 'o.order_time', status: 'sr.status' };
    const sortCol = allowedSort[sort_by] || 'COALESCE(sr.initiated_at, o.created_at)';
    const sortDir = sort_dir === 'asc' ? 'ASC' : 'DESC';

    const [rows] = await pool.query(
      `SELECT sr.id, sr.order_id, sr.shipping_code, sr.delivery_method, sr.gig_tracking,
        sr.delivery_staff_id, sr.status, sr.initiated_at, sr.updated_at,
        sr.shipped_at, sr.returned_at, sr.updated_by,
        ds.name AS delivery_staff_name,
        (SELECT MAX(ste.event_time) FROM speedaf_tracking_events ste WHERE ste.waybill = sr.gig_tracking) AS last_track_time,
        o.order_no, o.order_time, o.created_at AS order_created_at,
        o.customer_name, o.customer_phone, o.customer_address, o.total_amount,
        o.streamer_id
       FROM orders o
       LEFT JOIN shipping_records sr ON sr.order_id = o.id
       LEFT JOIN delivery_staff ds ON sr.delivery_staff_id = ds.id
       WHERE o.is_deleted = 0 AND ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
      [...params, parseInt(page_size), (parseInt(page) - 1) * parseInt(page_size)]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM orders o LEFT JOIN shipping_records sr ON sr.order_id = o.id WHERE o.is_deleted = 0 AND ${where}`, params);
    await attachOvertime(rows);
    res.json({ list: rows, total: countRows[0].total, page: parseInt(page) });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// POST /api/shipping — create shipping record
router.post('/', async (req, res) => {
  try {
    const { order_id, delivery_method, gig_tracking, delivery_staff_id } = req.body;
    if (!order_id || !delivery_method) return res.status(400).json({ message: 'Missing fields' });
    const [existing] = await pool.query('SELECT id FROM shipping_records WHERE order_id = ? AND status != ?', [order_id, 'returned']);
    if (existing.length > 0) return res.status(400).json({ message: 'Already has active shipping' });
    const code = genShippingCode();
    let staffName = '';
    if (delivery_method === 'own' && delivery_staff_id) {
      const [ds] = await pool.query('SELECT name FROM delivery_staff WHERE id = ?', [delivery_staff_id]);
      if (ds.length > 0) staffName = ds[0].name;
    }
    await pool.query(
      'INSERT INTO shipping_records (order_id, shipping_code, delivery_method, gig_tracking, delivery_staff_id, delivery_staff_name) VALUES (?,?,?,?,?,?)',
      [order_id, code, delivery_method, gig_tracking || '', delivery_method === 'own' ? delivery_staff_id : null, staffName]
    );
    res.status(201).json({ code });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// PUT /api/shipping/:id — edit tracking/staff
router.put('/:id', async (req, res) => {
  try {
    const { gig_tracking, delivery_staff_id, operator } = req.body;
    const [rows] = await pool.query('SELECT * FROM shipping_records WHERE id=?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Not found' });
    let staffName = rows[0].delivery_staff_name || '';
    let detail = '';
    if (gig_tracking !== undefined) {
      await pool.query('UPDATE shipping_records SET gig_tracking=?, updated_by=? WHERE id=?', [gig_tracking, operator, rows[0].id]);
      detail = 'Tracking: ' + gig_tracking;
    }
    if (delivery_staff_id) {
      const [ds] = await pool.query('SELECT name FROM delivery_staff WHERE id=?', [delivery_staff_id]);
      if (ds.length > 0) staffName = ds[0].name;
      await pool.query('UPDATE shipping_records SET delivery_staff_id=?, delivery_staff_name=?, updated_by=? WHERE id=?', [delivery_staff_id, staffName, operator, rows[0].id]);
      detail = 'Staff: ' + staffName;
    }
    await logAction(rows[0].id, 'modify', detail, operator);
    res.json({ message: 'Updated' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// POST /api/shipping/:id/action — update status
router.post('/:id/action', async (req, res) => {
  try {
    const { action, delivery_method, gig_tracking, delivery_staff_id, operator } = req.body;
    const [rows] = await pool.query('SELECT * FROM shipping_records WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Not found' });
    const rec = rows[0];

    const validActions = {
      unassigned: [],
      pending: ['cancel'],
      in_transit: ['deliver'],
      delivered: [],
      returning: [],
      returned: [],
      cancelled: [],
      voided: [],
    };

    // Void — admin only, other method only
    if (action === 'void') {
      if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Only admin can void' });
      if (rec.delivery_method !== 'other') return res.status(400).json({ message: 'Void only for other logistics' });
      const reason = req.body.reason || '';
      if (!reason.trim()) return res.status(400).json({ message: 'Reason is required to void an order' });
      await pool.query("UPDATE shipping_records SET status='voided', updated_at=NOW(), updated_by=? WHERE id=?", [operator || '', rec.id]);
      await logAction(rec.id, 'void', 'Reason: ' + reason, operator);
      return res.json({ message: 'Voided', status: 'voided' });
    }

    // Ship from unassigned or pending → pending + other method
    if (action === 'confirm_ship') {
      if (rec.delivery_method !== null && rec.delivery_method !== '') {
      return res.status(400).json({ message: 'Already has delivery method' });
    }
      let dsName = '';
      if (delivery_staff_id) {
        const [ds] = await pool.query('SELECT name FROM delivery_staff WHERE id=?', [delivery_staff_id]);
        if (ds.length > 0) dsName = ds[0].name;
      }
      await pool.query("UPDATE shipping_records SET delivery_method='other', delivery_staff_id=?, delivery_staff_name=?, status='in_transit', shipped_at=NOW(), updated_at=NOW(), updated_by=? WHERE id=?",
        [delivery_staff_id || null, dsName, operator || '', rec.id]);
      await logAction(rec.id, 'confirm_ship', 'Method: OTHER ' + dsName, operator);
      return res.json({ message: 'Shipped', status: 'in_transit' });
    }

    // Cancel pending → back to unassigned
    if (action === 'cancel') {
      if (!['pending', 'in_transit'].includes(rec.status)) return res.status(400).json({ message: 'Cancel only from pending or in_transit' });
    if (rec.status === 'in_transit' && rec.delivery_method !== 'other') return res.status(400).json({ message: 'Speedaf in_transit cannot be cancelled manually' });
      if (rec.delivery_method === 'speedaf' && rec.gig_tracking) {
        try {
          const speedaf = require('../services/speedaf');
          await speedaf.cancelOrder(rec.gig_tracking, 'Customer request');
        } catch (e) { /* log but proceed */ }
      }
      await pool.query("UPDATE shipping_records SET delivery_method=NULL, gig_tracking='', delivery_staff_id=NULL, delivery_staff_name='', status='unassigned', updated_at=NOW(), updated_by=? WHERE id=?",
        [operator || '', rec.id]);
      await logAction(rec.id, 'cancel', 'Cancelled to unassigned', operator);
      return res.json({ message: 'Cancelled', status: 'unassigned' });
    }

    // Deliver (other only)
    if (action === 'deliver') {
      if (rec.status !== 'in_transit') return res.status(400).json({ message: 'Deliver only from in_transit' });
      if (rec.delivery_method !== 'other') return res.status(400).json({ message: 'Deliver only for other logistics' });
      await pool.query("UPDATE shipping_records SET status='delivered', updated_at=NOW(), updated_by=? WHERE id=?", [operator || '', rec.id]);
      await logAction(rec.id, 'deliver', '', operator);
      return res.json({ message: 'Delivered', status: 'delivered' });
    }

    if (!validActions[rec.status] || !validActions[rec.status].includes(action)) {
      return res.status(400).json({ message: `Cannot ${action} in ${rec.status} status` });
    }

    await pool.query(`UPDATE shipping_records SET status = ?, updated_at = NOW(), updated_by = ? ${setExtra} WHERE id = ?`, [newStatus, operator || '', rec.id]);

    // Log
    let logDetail = '';
    if (action === 'confirm_ship' && delivery_method) { logDetail = 'Method: ' + delivery_method.toUpperCase(); }
    else if (action === 'void') { logDetail = 'Reason: ' + (req.body.reason || ''); }
    await logAction(rec.id, action, logDetail, operator);

    // WhatsApp notification (Meta Cloud API — fire-and-forget)
    if (newStatus === 'in_transit' || newStatus === 'delivered') {
      notifyCustomer(pool, rec.id, newStatus);
    }

    res.json({ message: 'Status updated', status: newStatus });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// GET /api/shipping/:id/logs
router.get('/:id/logs', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM shipping_logs WHERE shipping_id=? ORDER BY created_at DESC', [req.params.id]);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
