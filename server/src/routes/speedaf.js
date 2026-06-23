const express = require('express');
const pool = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const speedaf = require('../services/speedaf');
const router = express.Router();
router.use(authMiddleware);

// POST /api/speedaf/create — create Speedaf order for an existing order
router.post('/create', async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ message: 'order_id required' });

    // Get order + items
    const [orders] = await pool.query('SELECT * FROM orders WHERE id = ? AND is_deleted = 0', [order_id]);
    if (orders.length === 0) return res.status(404).json({ message: 'Order not found' });
    const order = orders[0];

    const [items] = await pool.query(
      'SELECT oi.*, p.name AS product_name FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?',
      [order_id]
    );

    // Call Speedaf
    const result = await speedaf.createOrder(order, items);
    if (result.success && result.data?.billCode) {
      // Store billCode in shipping_records
      await pool.query(
        "UPDATE shipping_records SET delivery_method = 'speedaf', gig_tracking = ?, status = 'in_transit', shipped_at = NOW() WHERE order_id = ?",
        [result.data.billCode, order_id]
      );
      return res.json({ success: true, billCode: result.data.billCode });
    }
    res.json({ success: false, message: result.data?.message || result.message || 'Speedaf create failed' });
  } catch (err) {
    console.error('[Speedaf create]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/speedaf/track/:billCode
router.get('/track/:billCode', async (req, res) => {
  try {
    const result = await speedaf.trackQuery(req.params.billCode);
    res.json(result);
  } catch (err) {
    console.error('[Speedaf track]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/speedaf/webhook — Speedaf tracking callback (NO auth)
const webhookRouter = express.Router();
webhookRouter.post('/webhook', (req, res) => {
  try {
    const { billCode, scanStatus, scanTime, location, description } = req.body;
    console.log('[Speedaf Webhook]', billCode, scanStatus, description);
    // Store tracking event
    res.json({ success: true });
  } catch (err) {
    console.error('[Speedaf Webhook]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = { router, webhookRouter };
