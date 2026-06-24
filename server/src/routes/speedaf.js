const express = require('express');
const pool = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const speedaf = require('../services/speedaf');
const router = express.Router();
router.use(authMiddleware);

const WEBHOOK_URL = 'https://luckyelysian.vip/api/speedaf/webhook';

const STATUS_MAP = {
  '10': 'pending',
  '1': 'in_transit', '2': 'in_transit', '3': 'in_transit', '4': 'in_transit',
  '5': 'delivered',
  '-710': 'returning',
  '730': 'returned',
  '-10': 'cancelled',
};

// Upsert speedaf_shipments record
async function upsertShipment(waybill, data = {}) {
  await pool.query(
    `INSERT INTO speedaf_shipments (waybill, order_no, receiver_name, receiver_phone, destination, current_status, current_status_desc, matched_shipping_id, tracking_raw, last_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE current_status = VALUES(current_status), current_status_desc = VALUES(current_status_desc), tracking_raw = VALUES(tracking_raw), last_synced_at = NOW()`,
    [waybill, data.order_no || '', data.receiver_name || '', data.receiver_phone || '', data.destination || '', data.status || '', data.status_desc || '', data.shipping_id || null, data.tracking_raw || null]
  );
}

// Insert tracking events with dedup
async function insertTrackingEvents(tracksList) {
  if (!tracksList || tracksList.length === 0) return;
  for (const t of tracksList) {
    if (!t.waybill || !t.event_time) continue;
    try {
      await pool.query(
        `INSERT IGNORE INTO speedaf_tracking_events (waybill, event_time, location, status_code, status_description, operator_name)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [t.waybill, t.event_time, t.location || '', t.status_code || '', t.status_description || '', t.operator_name || '']
      );
    } catch (e) { /* skip duplicates */ }
  }
}

// ============ Routes ============

// POST /api/speedaf/create
router.post('/create', async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ message: 'order_id required' });

    const [orders] = await pool.query('SELECT * FROM orders WHERE id = ? AND is_deleted = 0', [order_id]);
    if (orders.length === 0) return res.status(404).json({ message: 'Order not found' });
    const order = orders[0];

    const [items] = await pool.query(
      'SELECT oi.*, p.name AS product_name FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?', [order_id]
    );

    const result = await speedaf.createOrder(order, items);
    if (!result.success || !result.data?.billCode) {
      return res.json({ success: false, message: result.error?.message || result.data?.message || 'Speedaf create failed' });
    }

    const billCode = result.data.billCode;

    // Store in shipping_records + speedaf_shipments
    await pool.query(
      "UPDATE shipping_records SET delivery_method = 'speedaf', gig_tracking = ? WHERE order_id = ?",
      [billCode, order_id]
    );

    const dest = [order.accept_district, order.accept_city, order.accept_province].filter(Boolean).join(', ') || 'LAGOS';
    await upsertShipment(billCode, {
      order_no: order.order_no || '',
      receiver_name: order.customer_name || '',
      receiver_phone: (order.customer_phone || '').replace(/\D/g, '').slice(-10),
      destination: dest,
      status: 'pending',
      status_desc: 'Order created, awaiting pickup',
      tracking_raw: JSON.stringify(result),
    });

    speedaf.trackSubscribe(billCode, WEBHOOK_URL).catch(() => {});
    res.json({ success: true, billCode });
  } catch (err) {
    console.error('[Speedaf create]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/speedaf/print/:billCode
router.post('/print/:billCode', async (req, res) => {
  try {
    const result = await speedaf.printLabel(req.params.billCode);
    const url = result.data?.urls?.[0] || result.data?.orderLabels?.[0]?.labelUrl || null;
    res.json({ success: !!url, url });
  } catch (err) { console.error('[Speedaf print]', err); res.status(500).json({ message: 'Server error' }); }
});

// GET /api/speedaf/track/:billCode — query + store events locally
router.get('/track/:billCode', async (req, res) => {
  try {
    const billCode = req.params.billCode;
    const result = await speedaf.trackQuery(billCode);

    const [rows] = await pool.query(
      'SELECT sr.status, o.order_no FROM shipping_records sr JOIN orders o ON o.id = sr.order_id WHERE sr.gig_tracking = ?', [billCode]
    );
    const localStatus = rows.length > 0 ? rows[0].status : null;

    let speedafStatus = 'pending', lastEvent = 'Order created, awaiting pickup';
    const tracks = result.data || [];

    if (tracks.length > 0) {
      const events = tracks.map(t => ({
        waybill: billCode,
        event_time: t.time || t.scanTime || '',
        location: t.location || '',
        status_code: String(t.action || t.scanStatus || ''),
        status_description: t.actionName || t.description || t.statusDescription || '',
        operator_name: t.operatorName || '',
      }));
      await insertTrackingEvents(events);

      const last = tracks[tracks.length - 1];
      const code = String(last.action || last.scanStatus || '');
      speedafStatus = STATUS_MAP[code] || 'pending';
      lastEvent = (last.actionName || last.description || '') + ' - ' + (last.location || '');

      await upsertShipment(billCode, { status: speedafStatus, status_desc: lastEvent, tracking_raw: JSON.stringify(tracks) });
    }

    res.json({ billCode, orderNo: rows.length > 0 ? rows[0].order_no : null, localStatus, speedafStatus, lastEvent, matched: localStatus === speedafStatus });
  } catch (err) { console.error('[Speedaf track]', err); res.status(500).json({ message: 'Server error' }); }
});

// POST /api/speedaf/sync — force sync
router.post('/sync', async (req, res) => {
  try {
    const { billCode } = req.body;
    if (!billCode) return res.status(400).json({ message: 'billCode required' });

    const result = await speedaf.trackQuery(billCode);
    const tracks = result.data || [];
    if (tracks.length === 0) return res.json({ success: false, message: 'No tracking data' });

    const events = tracks.map(t => ({
      waybill: billCode,
      event_time: t.time || t.scanTime || '',
      location: t.location || '',
      status_code: String(t.action || t.scanStatus || ''),
      status_description: t.actionName || t.description || t.statusDescription || '',
      operator_name: t.operatorName || '',
    }));
    await insertTrackingEvents(events);

    const last = tracks[tracks.length - 1];
    const code = String(last.action || last.scanStatus || '');
    const newStatus = STATUS_MAP[code];
    const lastEvent = (last.actionName || last.description || '') + ' - ' + (last.location || '');

    if (newStatus) {
      await pool.query(
        "UPDATE shipping_records SET status = ?, updated_at = NOW(), updated_by = 'SpeedafSync' WHERE gig_tracking = ?",
        [newStatus, billCode]
      );
    }
    await upsertShipment(billCode, { status: newStatus || code, status_desc: lastEvent, tracking_raw: JSON.stringify(tracks) });
    res.json({ success: !!newStatus, newStatus: newStatus || tracks[tracks.length-1]?.actionName || 'unknown' });
  } catch (err) { console.error('[Speedaf sync]', err); res.status(500).json({ message: 'Server error' }); }
});

// POST /api/speedaf/cancel
router.post('/cancel', async (req, res) => {
  try {
    const { billCode, reason } = req.body;
    if (!billCode) return res.status(400).json({ message: 'billCode required' });
    const result = await speedaf.cancelOrder(billCode, reason || 'Customer request');
    if (result.success) {
      const itemResult = result.data?.[0] || {};
      if (itemResult.success) {
        await pool.query(
          "UPDATE shipping_records SET status = 'cancelled', updated_at = NOW(), updated_by = ? WHERE gig_tracking = ?",
          [req.user?.username || 'admin', billCode]
        );
        await upsertShipment(billCode, { status: 'cancelled', status_desc: 'Cancelled: ' + (reason || 'Customer request') });
        return res.json({ success: true });
      }
      return res.json({ success: false, message: itemResult.message || 'Cancel rejected by Speedaf' });
    }
    res.json({ success: false, message: result.error?.message || 'Cancel failed' });
  } catch (err) { console.error('[Speedaf cancel]', err); res.status(500).json({ message: 'Server error' }); }
});

// ============ Webhook (PUBLIC) ============
const webhookRouter = express.Router();
webhookRouter.post('/webhook', async (req, res) => {
  try {
    const payload = Array.isArray(req.body) ? req.body : [req.body];
    for (const item of payload) {
      const { mailNo, action, scanStatus, scanTime, location, description, actionName, operatorName } = item;
      const statusCode = String(action || scanStatus || '');
      console.log('[Speedaf Webhook]', mailNo, statusCode, description || actionName);

      if (mailNo) {
        await insertTrackingEvents([{
          waybill: mailNo,
          event_time: scanTime || '',
          location: location || '',
          status_code: statusCode,
          status_description: actionName || description || '',
          operator_name: operatorName || '',
        }]);

        const newStatus = STATUS_MAP[statusCode];
        if (newStatus) {
          await pool.query(
            "UPDATE shipping_records SET status = ?, updated_at = NOW(), updated_by = 'Speedaf' WHERE gig_tracking = ?",
            [newStatus, mailNo]
          );
        }

        const desc = (actionName || description || '') + (location ? ' - ' + location : '');
        await upsertShipment(mailNo, { status: newStatus || statusCode, status_desc: desc });
      }
    }
    res.json({ data: '', error: { code: '', message: '' }, success: true });
  } catch (err) {
    console.error('[Speedaf Webhook]', err);
    res.status(500).json({ data: '', error: { code: '500', message: err.message }, success: false });
  }
});

module.exports = { router, webhookRouter };
