const express = require('express');
const pool = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { notifyCustomer } = require('../services/whatsapp');
const router = express.Router();
router.use(authMiddleware);

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
    const { status, date_from, date_to, order_no, customer, page = 1, page_size = 20, sort_by, sort_dir, tracking, delivery_method } = req.query;
    let where = '1=1';
    const params = [];
    // Shipping 页签筛选：sr.status 已被 Step 4 从 tracking_events 精确同步
    // ENUM: pending | in_transit | delivered | cancelled | failed | voided
    // SSC→cancelled, DFA→failed, OKC/OKT→delivered, others→in_transit
    if (status) {
      where += ' AND sr.status = ?'; params.push(status);
    }
    if (order_no) { where += ' AND o.order_no LIKE ?'; params.push('%'+order_no+'%'); }
    if (customer) { where += ' AND (o.customer_name LIKE ? OR o.customer_phone LIKE ?)'; params.push('%'+customer+'%', '%'+customer+'%'); }
    if (tracking) { where += ' AND sr.gig_tracking LIKE ?'; params.push('%'+tracking+'%'); }
    if (delivery_method) { where += ' AND sr.delivery_method = ?'; params.push(delivery_method); }
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
      pending: ['confirm_ship', 'void', 'reset_method'],
      in_transit: ['deliver', 'reassign', 'void'],
      delivered: ['reassign', 'void'],
      cancelled: ['reassign', 'void'],
      failed: ['reassign', 'void'],
    };
    if (!validActions[rec.status] || !validActions[rec.status].includes(action)) {
      return res.status(400).json({ message: `Cannot ${action} in ${rec.status} status` });
    }

    let newStatus, setExtra = '';
    if (action === 'confirm_ship') {
      newStatus = 'in_transit'; setExtra = ', shipped_at = NOW()';
      if (delivery_method) {
        let dsName = '';
        if (delivery_method === 'own' && delivery_staff_id) {
          const [ds] = await pool.query('SELECT name FROM delivery_staff WHERE id=?', [delivery_staff_id]);
          if (ds.length > 0) dsName = ds[0].name;
        }
        await pool.query('UPDATE shipping_records SET delivery_method=?, gig_tracking=?, delivery_staff_id=?, delivery_staff_name=? WHERE id=?',
          [delivery_method, gig_tracking || '', delivery_method==='own' ? delivery_staff_id : null, dsName, rec.id]);

        // If GIG: check if GIGL already shows delivered → skip straight to delivered
        if (delivery_method === 'gig' && gig_tracking) {
          const [gs] = await pool.query('SELECT is_delivered FROM gigl_shipments WHERE waybill = ?', [gig_tracking]);
          if (gs.length > 0 && gs[0].is_delivered) {
            newStatus = 'delivered'; setExtra = ', shipped_at = NOW()';
          }
        }
      }
    }
    else if (action === 'deliver') newStatus = 'delivered';
    else if (action === 'return') { newStatus = 'returned'; setExtra = ', returned_at = NOW()'; }
    else if (action === 'reassign') {
      // Release the old waybill's matched_shipping_id BEFORE clearing tracking
      if (rec.gig_tracking) {
        await pool.query('UPDATE gigl_shipments SET matched_shipping_id = NULL WHERE waybill = ?', [rec.gig_tracking]);
      }
      newStatus = 'pending'; setExtra = ', gig_tracking = \'\', delivery_method = \'reassigned\', shipped_at = NULL';
    }
    else if (action === 'reset_method') {
      newStatus = 'pending'; setExtra = ', delivery_method = NULL';
    }
    else if (action === 'void') {
      const reason = req.body.reason || '';
      if (!reason.trim()) return res.status(400).json({ message: 'Reason is required to void an order' });
      newStatus = 'voided'; setExtra = ', gig_tracking = \'\', shipped_at = NULL';
    }

    await pool.query(`UPDATE shipping_records SET status = ?, updated_at = NOW(), updated_by = ? ${setExtra} WHERE id = ?`, [newStatus, operator || '', rec.id]);

    // Log
    let logDetail = '';
    if (action === 'confirm_ship' && delivery_method) { logDetail = 'Method: ' + delivery_method.toUpperCase(); }
    else if (action === 'void') { logDetail = 'Reason: ' + (req.body.reason || ''); }
    await logAction(rec.id, action, logDetail, operator);

    // OWN delivery tracking events — record timeline for OWN orders
    const finalMethod = delivery_method || rec.delivery_method;
    if (finalMethod === 'own') {
      const [orderRow] = await pool.query('SELECT customer_address FROM orders WHERE id = ?', [rec.order_id]);
      const custAddr = orderRow.length > 0 ? (orderRow[0].customer_address || 'LAGOS') : 'LAGOS';
      if (action === 'confirm_ship') {
        await pool.query(
          'INSERT INTO shipping_tracking_events (shipping_id, event_time, location, status_code, status_description, action, operator) VALUES (?, NOW(), ?, ?, ?, ?, ?)',
          [rec.id, 'LAGOS', 'CRT', 'SHIPMENT CREATED', 'confirm_ship', operator || '']
        );
      } else if (action === 'deliver') {
        await pool.query(
          'INSERT INTO shipping_tracking_events (shipping_id, event_time, location, status_code, status_description, action, operator) VALUES (?, NOW(), ?, ?, ?, ?, ?)',
          [rec.id, custAddr, 'OKC', 'DELIVERED TO CUSTOMER', 'deliver', operator || '']
        );
      } else if (action === 'return') {
        await pool.query(
          'INSERT INTO shipping_tracking_events (shipping_id, event_time, location, status_code, status_description, action, operator) VALUES (?, NOW(), ?, ?, ?, ?, ?)',
          [rec.id, custAddr, 'DFA', 'Delivery Unsuccessful', 'return', operator || '']
        );
      }
    }

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

// GET /api/shipping/:id/tracking — OWN delivery tracking timeline
router.get('/:id/tracking', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM shipping_tracking_events WHERE shipping_id = ? ORDER BY event_time ASC',
      [req.params.id]
    );
    res.json({ events: rows });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
