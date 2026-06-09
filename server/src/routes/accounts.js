const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, username, role, status, created_at FROM accounts ORDER BY created_at');
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

router.post('/', adminOnly, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || !role) return res.status(400).json({ message: 'Missing fields' });
    const [dup] = await pool.query('SELECT id FROM accounts WHERE username = ?', [username]);
    if (dup.length > 0) return res.status(400).json({ message: 'Username already exists' });
    const hash = await bcrypt.hash(password, 10);
    const [r] = await pool.query('INSERT INTO accounts (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, role]);
    res.status(201).json({ id: r.insertId, username, role });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE accounts SET username=?, password_hash=?, role=? WHERE id=?', [username, hash, role, req.params.id]);
    } else {
      await pool.query('UPDATE accounts SET username=?, role=? WHERE id=?', [username, role, req.params.id]);
    }
    res.json({ message: 'Updated' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

router.delete('/:id', adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM accounts WHERE id = ? AND role != ?', [req.params.id, 'admin']);
    res.json({ message: 'Deleted' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
