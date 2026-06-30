const express = require('express');
const pool = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_PUBLIC = process.env.PAYSTACK_PUBLIC_KEY || '';

// ==================== PUBLIC ROUTES ====================

// GET /api/lucky-draw/paystack-key — return public key for frontend
router.get('/paystack-key', (req, res) => {
  res.json({ key: PAYSTACK_PUBLIC });
});

// POST /api/lucky-draw/initiate — create queue record, return Paystack payment URL
router.post('/initiate', async (req, res) => {
  try {
    const { customer_name, customer_phone, accept_province, customer_address, blind_box_type } = req.body;
    if (!customer_name || !customer_phone || !customer_address || !blind_box_type) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const amount = blind_box_type === '50k' ? 50000 : 20000;
    const paystackRef = 'LD_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    const [result] = await pool.query(
      `INSERT INTO lucky_draw_queue (customer_name, customer_phone, accept_province, customer_address, blind_box_type, amount, paystack_reference, payment_status, queue_position)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', (SELECT IFNULL(MAX(queue_position), 0) + 1 FROM lucky_draw_queue q WHERE q.status = 'waiting'))`,
      [customer_name, customer_phone, accept_province || '', customer_address, blind_box_type, amount, paystackRef]
    );

    // Build Paystack payment URL directly
    const callbackUrl = 'https://luckyelysian.vip/lucky_draw?paid=1&ref=' + paystackRef;
    const paystackUrl = 'https://checkout.paystack.com/' + paystackRef;

    res.json({
      success: true,
      id: result.insertId,
      reference: paystackRef,
      amount,
      paystackUrl: 'https://api.paystack.co/transaction/initialize',
      paystackKey: PAYSTACK_PUBLIC,
      email: customer_phone.replace(/\D/g, '') + '@luckybox.ng',
      callbackUrl
    });
  } catch (err) {
    console.error('[Lucky Draw] Initiate:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/lucky-draw/verify — verify payment and update status
router.post('/verify', async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ message: 'Reference required' });

    // Verify with Paystack API
    const resp = await fetch('https://api.paystack.co/transaction/verify/' + reference, {
      headers: { Authorization: 'Bearer ' + PAYSTACK_SECRET }
    });
    const data = await resp.json();

    if (data.status && data.data?.status === 'success') {
      await pool.query(
        "UPDATE lucky_draw_queue SET payment_status = 'paid', paystack_reference = ? WHERE paystack_reference = ? AND payment_status = 'pending'",
        [reference, reference]
      );
      res.json({ success: true, message: 'Payment confirmed' });
    } else {
      await pool.query(
        "UPDATE lucky_draw_queue SET payment_status = 'failed' WHERE paystack_reference = ? AND payment_status = 'pending'",
        [reference]
      );
      res.json({ success: false, message: data.data?.gateway_response || 'Payment failed' });
    }
  } catch (err) {
    console.error('[Lucky Draw] Verify:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/lucky-draw/display — public queue display
router.get('/display', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, customer_name, SUBSTRING(customer_phone, 1, 4) AS masked_phone, blind_box_type, queue_position, created_at
       FROM lucky_draw_queue WHERE status = 'waiting' ORDER BY queue_position ASC LIMIT 50`
    );
    res.json({ list: rows });
  } catch (err) {
    console.error('[Lucky Draw] Display:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ==================== ADMIN ROUTES (auth required) ====================
router.use(authMiddleware);

// GET /api/lucky-draw/queue — admin queue list
router.get('/queue', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM lucky_draw_queue
       WHERE payment_status = 'paid' AND status = 'waiting'
       ORDER BY queue_position ASC`
    );
    res.json({ list: rows });
  } catch (err) {
    console.error('[Lucky Draw] Queue:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/lucky-draw/queue/reorder — drag reorder
router.put('/queue/reorder', async (req, res) => {
  try {
    const { items } = req.body; // [{ id, queue_position }]
    if (!items || !Array.isArray(items)) return res.status(400).json({ message: 'items array required' });
    for (const item of items) {
      await pool.query('UPDATE lucky_draw_queue SET queue_position = ? WHERE id = ?', [item.queue_position, item.id]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[Lucky Draw] Reorder:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/lucky-draw/queue/last-streamer/:phone — get last streamer for phone
router.get('/queue/last-streamer/:phone', async (req, res) => {
  try {
    // Check lucky_draw_queue first, then orders
    const [rows] = await pool.query(
      `SELECT streamer_name FROM lucky_draw_queue WHERE customer_phone = ? AND streamer_name != '' ORDER BY id DESC LIMIT 1`,
      [req.params.phone]
    );
    if (rows.length > 0) return res.json({ streamer_name: rows[0].streamer_name });
    // Fallback: check orders
    const [ords] = await pool.query(
      `SELECT streamer_name FROM orders WHERE customer_phone = ? AND streamer_name IS NOT NULL AND streamer_name != '' ORDER BY id DESC LIMIT 1`,
      [req.params.phone]
    );
    res.json({ streamer_name: ords.length > 0 ? ords[0].streamer_name : '' });
  } catch (err) {
    console.error('[Lucky Draw] Last streamer:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/lucky-draw/queue/:id/order — place order from queue
router.post('/queue/:id/order', async (req, res) => {
  try {
    const { streamer_id, streamer_name, commission_rate } = req.body;
    if (!streamer_name) return res.status(400).json({ message: 'Streamer name required' });

    const [rows] = await pool.query('SELECT * FROM lucky_draw_queue WHERE id = ? AND status = ?', [req.params.id, 'waiting']);
    if (rows.length === 0) return res.status(404).json({ message: 'Queue record not found' });
    const q = rows[0];

    // Generate order number
    const today = new Date();
    const prefix = 'LB' + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
    const [lastOrd] = await pool.query("SELECT order_no FROM orders WHERE order_no LIKE ? ORDER BY id DESC LIMIT 1", [prefix + '%']);
    let seq = 1;
    if (lastOrd.length > 0) seq = parseInt(lastOrd[0].order_no.slice(-4)) + 1;
    const orderNo = prefix + String(seq).padStart(4, '0');

    const paymentStatusId = 1; // PAID
    const paymentStatusName = 'PAID';

    const [orderResult] = await pool.query(
      `INSERT INTO orders (order_no, customer_name, customer_gender, customer_phone, customer_phone2, customer_address,
        accept_province, accept_city, accept_district, order_time, streamer_id, streamer_name, commission_rate,
        payment_status_id, payment_status_name, total_amount, actual_amount) VALUES
        (?,?,?,?,?,?,?,?,?,NOW(),?,?,?,?,?,?,?)`,
      [orderNo, q.customer_name, '', q.customer_phone, '', q.customer_address,
        q.accept_province || 'LAGOS', '', '', streamer_id || null, streamer_name, commission_rate || 0,
        paymentStatusId, paymentStatusName, q.amount, q.amount]
    );
    const orderId = orderResult.insertId;

    // Create shipping record
    await pool.query(
      "INSERT INTO shipping_records (order_id, status, initiated_at) VALUES (?, 'unassigned', NOW())",
      [orderId]
    );

    // Update queue record
    await pool.query(
      'UPDATE lucky_draw_queue SET status = ?, order_id = ?, streamer_id = ?, streamer_name = ? WHERE id = ?',
      ['ordered', orderId, streamer_id || null, streamer_name, q.id]
    );

    res.json({ success: true, order_id: orderId, order_no: orderNo });
  } catch (err) {
    console.error('[Lucky Draw] Order:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
