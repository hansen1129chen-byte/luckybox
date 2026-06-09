require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const app = require('./app');
const pool = require('./config/db');
const bcrypt = require('bcryptjs');

async function seedAdmin() {
  const [rows] = await pool.query("SELECT id FROM accounts WHERE role = 'admin'");
  if (rows.length > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = await bcrypt.hash(password, 10);
  await pool.query("INSERT INTO accounts (username, password_hash, role) VALUES (?, ?, 'admin')", [username, hash]);
  console.log(`Admin created: ${username}`);
}

async function start() {
  try {
    await seedAdmin();
    const port = process.env.PORT || 3003;
    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  } catch (err) { console.error('Failed to start:', err); process.exit(1); }
}
start();
