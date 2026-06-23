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
      "UPDATE shipping_records SET delivery_method = 'speedaf', gig_tracking = ?, status = 'in_transit', shipped_at = NOW() WHERE order_id = ?",
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

// GET /api/speedaf/track/:billCode — query tracking status
router.get('/track/:billCode', async (req, res) => {
  try {
    const result = await speedaf.trackQuery(req.params.billCode);
    res.json(result);
  } catch (err) {
    console.error('[Speedaf track]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/speedaf/print/:billCode — get print label
router.post('/print/:billCode', async (req, res) => {
  try {
    const result = await speedaf.printLabel(req.params.billCode);
    res.json(result);
  } catch (err) {
    console.error('[Speedaf print]', err);
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
      // Update shipping status based on scanStatus
      // Common statuses: picked_up, in_transit, out_for_delivery, delivered, failed
      let newStatus = null;
      if (scanStatus === 'delivered' || description?.toLowerCase().includes('delivered')) newStatus = 'delivered';
      else if (scanStatus === 'failed' || description?.toLowerCase().includes('failed')) newStatus = 'voided';

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
