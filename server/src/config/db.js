const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '+08:00',
});

// Set MySQL session timezone on every new connection
// Without this, NOW()/CURRENT_TIMESTAMP use server timezone (UTC) → 8h offset vs mysql2 +08:00
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+08:00'", (err) => { if (err) console.error('TZ set failed:', err); });
});

module.exports = pool;
