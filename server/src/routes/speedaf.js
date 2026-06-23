const express = require('express');
const pool = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const speedaf = require('../services/speedaf');
const router = express.Router();
router.use(authMiddleware);

const WEBHOOK_URL = 'https://luckyelysian.vip/api/speedaf/webhook';

// POST /api/speedaf/create — create Speedaf order + auto-subscribe
router.post('/create', async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ message: 'order_id required' });

    const [orders] = await pool.query('SELECT * FROM orders WHERE id = ? AND is_deleted = 0', [order_id]);
    if (orders.length === 0) return res.status(404).json({ message: 'Order not found' });

    const [items] = await pool.query(
      'SELECT oi.*, p.name AS product_name FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?',
      [order_id]
    );

    const result = await speedaf.createOrder(orders[0], items);
    if (!result.success || !result.data?.billCode) {
      return res.json({ success: false, message: result.error?.message || result.data?.message || 'Speedaf create failed' });
    }

    const billCode = result.data.billCode;

    // Store in shipping_records
    await pool.query(
      "UPDATE shipping_records SET delivery_method = 'speedaf', gig_tracking = ? WHERE order_id = ?",
      [billCode, order_id]
    );

    // Auto-subscribe to tracking updates
    speedaf.trackSubscribe(billCode, WEBHOOK_URL).catch(() => {});

    res.json({ success: true, billCode });
  } catch (err) {
    console.error('[Speedaf create]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/speedaf/track/:billCode — query tracking status + compare with local
router.get('/track/:billCode', async (req, res) => {
  try {
    const billCode = req.params.billCode;
    const result = await speedaf.trackQuery(billCode);

    // Get local shipping record
    const [rows] = await pool.query('SELECT sr.status, o.order_no FROM shipping_records sr JOIN orders o ON o.id = sr.order_id WHERE sr.gig_tracking = ?', [billCode]);
    const localStatus = rows.length > 0 ? rows[0].status : null;
    const orderNo = rows.length > 0 ? rows[0].order_no : null;

    // Map Speedaf status
    const STATUS_MAP = {
      '10': 'pending', '1': 'in_transit', '2': 'in_transit', '3': 'in_transit', '4': 'in_transit',
      '5': 'delivered', '-710': 'returning', '730': 'returned', '-10': 'cancelled',
    };
    let speedafStatus = 'pending', lastEvent = 'Order created, awaiting pickup';
    const tracks = result.data || [];
    if (tracks.length > 0) {
      const last = tracks[tracks.length - 1];
      const code = String(last.scanStatus || last.statusCode || '');
      speedafStatus = STATUS_MAP[code] || 'pending';
      lastEvent = (last.description || last.statusDescription || '') + ' - ' + (last.location || '');
    }

    res.json({
      billCode, orderNo, localStatus, speedafStatus, lastEvent,
      matched: localStatus === speedafStatus,
    });
  } catch (err) {
    console.error('[Speedaf track]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/speedaf/sync — force sync local status from Speedaf
router.post('/sync', async (req, res) => {
  try {
    const { billCode } = req.body;
    if (!billCode) return res.status(400).json({ message: 'billCode required' });
    const result = await speedaf.trackQuery(billCode);
    const tracks = result.data || [];
    if (tracks.length === 0) return res.json({ success: false, message: 'No tracking data' });

    const last = tracks[tracks.length - 1];
    const code = String(last.scanStatus || last.statusCode || '');
    const STATUS_MAP = {
      '10': 'pending', '1': 'in_transit', '2': 'in_transit', '3': 'in_transit', '4': 'in_transit',
      '5': 'delivered', '-710': 'returning', '730': 'returned', '-10': 'cancelled',
    };
    const newStatus = STATUS_MAP[code];
    if (newStatus) {
      await pool.query(
        "UPDATE shipping_records SET status = ?, updated_at = NOW(), updated_by = 'TrackSync' WHERE gig_tracking = ?",
        [newStatus, billCode]
      );
      return res.json({ success: true, newStatus });
    }
    res.json({ success: false, message: 'Unknown status: ' + code });
  } catch (err) {
    console.error('[Speedaf sync]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/speedaf/print/:billCode — get print label URL
router.post('/print/:billCode', async (req, res) => {
  try {
    const result = await speedaf.printLabel(req.params.billCode);
    const url = result.data?.urls?.[0] || result.data?.orderLabels?.[0]?.labelUrl || null;
    res.json({ success: !!url, url });
  } catch (err) {
    console.error('[Speedaf print]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/speedaf/cancel — cancel Speedaf order
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
        return res.json({ success: true, message: 'Cancelled' });
      }
      return res.json({ success: false, message: itemResult.message || 'Cancel rejected by Speedaf' });
    }
    res.json({ success: false, message: result.error?.message || 'Cancel failed' });
  } catch (err) {
    console.error('[Speedaf cancel]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/speedaf/webhook — Speedaf tracking callback (PUBLIC, no auth)
const webhookRouter = express.Router();
webhookRouter.post('/webhook', async (req, res) => {
  try {
    const { mailNo, scanStatus, scanTime, location, description } = req.body;
    console.log('[Speedaf Webhook]', mailNo, scanStatus, description);

    if (mailNo) {
      const STATUS_MAP = {
        '10': 'pending',
        '1': 'in_transit', '2': 'in_transit', '3': 'in_transit', '4': 'in_transit',
        '5': 'delivered',
        '-710': 'returning',
        '730': 'returned',
        '-10': 'cancelled',
      };
      const newStatus = STATUS_MAP[String(scanStatus)];
      if (newStatus) {
        await pool.query(
          "UPDATE shipping_records SET status = ?, updated_at = NOW(), updated_by = 'Speedaf' WHERE gig_tracking = ?",
          [newStatus, mailNo]
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[Speedaf Webhook]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = { router, webhookRouter };
