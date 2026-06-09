require('dotenv').config();
const m = require('mysql2/promise');
(async () => {
  const c = await m.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  try { await c.query("ALTER TABLE shipping_records ADD COLUMN updated_by VARCHAR(50) DEFAULT ''"); } catch { console.log('updated_by exists'); }
  try { await c.query("CREATE TABLE IF NOT EXISTS shipping_logs (id BIGINT AUTO_INCREMENT PRIMARY KEY, shipping_id BIGINT NOT NULL, action VARCHAR(50) NOT NULL, detail VARCHAR(200) DEFAULT '', operator VARCHAR(50) DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (shipping_id) REFERENCES shipping_records(id) ON DELETE CASCADE) ENGINE=InnoDB"); } catch (e) { console.log('table exists'); }
  console.log('DONE');
  await c.end();
})();
