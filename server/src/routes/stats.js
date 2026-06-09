const express = require('express');
const pool = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

// GET /api/stats/sales?date_from=&date_to=
router.get('/sales', async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    let where = '1=1';
    const params = [];
    if (date_from) { where += ' AND o.created_at >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND o.created_at <= ?'; params.push(date_to + ' 23:59:59'); }

    const [summary] = await pool.query(
      `SELECT COUNT(*) AS total_orders, SUM(o.total_amount) AS total_sales, SUM(o.actual_amount) AS total_actual,
        COALESCE(SUM((SELECT SUM(oi2.quantity * COALESCE(oi2.unit_cost,0)) FROM order_items oi2 WHERE oi2.order_id=o.id)), 0) AS total_cost
       FROM orders o WHERE o.is_deleted = 0 AND ${where}`, params
    );
    const s = summary[0];
    s.gross_profit = (s.total_sales || 0) - (s.total_cost || 0);
    res.json(s);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// GET /api/stats/commission?date_from=&date_to=
router.get('/commission', async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    let where = '1=1';
    const params = [];
    if (date_from) { where += ' AND o.created_at >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND o.created_at <= ?'; params.push(date_to + ' 23:59:59'); }

    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.commission_rate,
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.total_amount), 0) AS total_sales,
        COALESCE(SUM(o.total_amount * COALESCE(NULLIF(o.commission_rate, 0), s.commission_rate) / 100), 0) AS commission
       FROM streamers s
       LEFT JOIN orders o ON o.streamer_id = s.id AND o.is_deleted = 0 AND ${where}
       GROUP BY s.id ORDER BY total_sales DESC`, params
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// GET /api/stats/products?date_from=&date_to=
router.get('/products', async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    let where = '1=1';
    const params = [];
    if (date_from) { where += ' AND o.created_at >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND o.created_at <= ?'; params.push(date_to + ' 23:59:59'); }

    const [rows] = await pool.query(
      `SELECT oi.product_name, oi.product_code,
        COUNT(oi.id) AS order_count,
        COALESCE(SUM(oi.quantity), 0) AS total_qty,
        COALESCE(SUM(oi.subtotal), 0) AS total_sales,
        COALESCE(SUM(oi.quantity * COALESCE(oi.unit_cost, 0)), 0) AS total_cost
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.is_deleted = 0
       WHERE ${where} GROUP BY oi.product_code, oi.product_name ORDER BY total_sales DESC`, params
    );
    rows.forEach(r => { r.gross_profit = (r.total_sales || 0) - (r.total_cost || 0); });
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
