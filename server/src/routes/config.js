const express = require('express');
const pool = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

const tables = {
  streamers: { table: 'streamers', cols: ['name', 'commission_rate'], adminOnly: true },
  payment_statuses: { table: 'payment_statuses', cols: ['name', 'color'], adminOnly: true },
  delivery_staff: { table: 'delivery_staff', cols: ['name'], adminOnly: true },
  alert: { table: 'alert_config', cols: ['alert_status', 'hours'], adminOnly: true },
};

Object.entries(tables).forEach(([key, cfg]) => {
  // GET - all logged-in users can read
  router.get(`/${key}`, async (req, res) => {
    try {
      const [rows] = await pool.query(`SELECT * FROM ${cfg.table} ORDER BY id`);
      res.json(rows);
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
  });

  // POST - admin only
  router.post(`/${key}`, cfg.adminOnly ? adminOnly : (r, r2, n) => n(), async (req, res) => {
    try {
      const vals = cfg.cols.map(c => req.body[c]);
      if (vals.some(v => v === undefined)) return res.status(400).json({ message: 'Missing fields' });
      const placeholders = cfg.cols.map(() => '?').join(',');
      const [r] = await pool.query(`INSERT INTO ${cfg.table} (${cfg.cols.join(',')}) VALUES (${placeholders})`, vals);
      res.status(201).json({ id: r.insertId });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
  });

  // PUT - admin only
  router.put(`/${key}/:id`, cfg.adminOnly ? adminOnly : (r, r2, n) => n(), async (req, res) => {
    try {
      const sets = cfg.cols.map(c => `${c}=?`).join(',');
      const vals = cfg.cols.map(c => req.body[c]);
      vals.push(req.params.id);
      await pool.query(`UPDATE ${cfg.table} SET ${sets} WHERE id=?`, vals);
      res.json({ message: 'Updated' });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
  });

  // DELETE - admin only
  router.delete(`/${key}/:id`, cfg.adminOnly ? adminOnly : (r, r2, n) => n(), async (req, res) => {
    try {
      await pool.query(`DELETE FROM ${cfg.table} WHERE id=?`, [req.params.id]);
      res.json({ message: 'Deleted' });
    } catch (err) { res.status(500).json({ message: 'Server error' }); }
  });
});

module.exports = router;
