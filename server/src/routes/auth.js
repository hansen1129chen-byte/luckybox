const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Username and password required' });
    const [rows] = await pool.query('SELECT id, username, role, password_hash FROM accounts WHERE username = ? AND status = 1', [username]);
    if (rows.length === 0) return res.status(401).json({ message: 'Invalid username or password' });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ message: 'Invalid username or password' });
    const token = jwt.sign({ id: rows[0].id, username: rows[0].username, role: rows[0].role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: rows[0].id, username: rows[0].username, role: rows[0].role } });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, username, role, created_at FROM accounts WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Account not found' });
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password || new_password.length < 6) return res.status(400).json({ message: 'Invalid password' });
    const [rows] = await pool.query('SELECT password_hash FROM accounts WHERE id = ?', [req.user.id]);
    const valid = await bcrypt.compare(old_password, rows[0].password_hash);
    if (!valid) return res.status(400).json({ message: 'Old password incorrect' });
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE accounts SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    res.json({ message: 'Password changed' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

module.exports = router;
