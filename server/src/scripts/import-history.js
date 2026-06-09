// Import historical orders from Excel into local database
// Usage: node src/scripts/import-history.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const pool = require('../config/db');
const XLSX = require('xlsx');

async function main() {
  // Try Linux path first (production), then Windows (local dev)
  let excelPath = '/opt/label-printer/history_data.xlsx';
  const fs = require('fs');
  if (!fs.existsSync(excelPath)) {
    excelPath = process.env.USERPROFILE
      ? `${process.env.USERPROFILE}\\Desktop\\history_data.xlsx`
      : 'C:\\Users\\Honor\\Desktop\\history_data.xlsx';
  }
  const wb = XLSX.readFile(excelPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1); // skip header

  // ── Group rows into orders ──
  const orders = [];
  let current = null;
  for (const row of raw) {
    const orderNo = String(row[0] || '').trim();
    if (orderNo) {
      if (current) orders.push(current);
      current = {
        order_no: orderNo,
        gig_tracking: String(row[1] || '').trim(),
        gender: (String(row[2] || '')).trim().toLowerCase(),
        customer_name: String(row[3] || '').trim(),
        customer_phone: String(row[4] || '').trim(),
        customer_address: String(row[5] || '').trim(),
        streamer_name: String(row[6] || '').trim(),
        payment: String(row[7] || '').trim(),
        remark: String(row[12] || '').trim(),
        items: [],
      };
    }
    const code = String(row[8] || '').trim();
    const name = String(row[9] || '').trim();
    const price = parseInt(row[10]) || 0;
    if (code && name) {
      current.items.push({ code, name, price });
    }
  }
  if (current) orders.push(current);
  console.log(`Parsed ${orders.length} orders from Excel`);

  // ── Upsert streamers ──
  const streamerMap = {};
  for (const o of orders) {
    if (o.streamer_name && !streamerMap[o.streamer_name]) {
      const s = o.streamer_name;
      const [rows] = await pool.query('SELECT id FROM streamers WHERE name = ?', [s]);
      if (rows.length > 0) {
        streamerMap[s] = rows[0].id;
      } else {
        const [r] = await pool.query('INSERT INTO streamers (name, commission_rate) VALUES (?, ?)', [s, '1.00']);
        streamerMap[s] = r.insertId;
        console.log(`  Created streamer: ${s} (id=${r.insertId})`);
      }
    }
  }

  // ── Upsert products ──
  const productMap = {};
  const allItems = new Map();
  for (const o of orders) {
    for (const item of o.items) {
      const key = item.code;
      if (!allItems.has(key)) {
        allItems.set(key, { code: item.code, name: item.name, price: item.price });
      }
    }
  }
  for (const [code, info] of allItems) {
    const [rows] = await pool.query('SELECT id FROM products WHERE code = ?', [code]);
    if (rows.length > 0) {
      productMap[code] = rows[0].id;
    } else {
      const [r] = await pool.query(
        'INSERT INTO products (code, name, price, sort_order) VALUES (?, ?, ?, ?)',
        [code, info.name, info.price, 0]
      );
      productMap[code] = r.insertId;
      console.log(`  Created product: ${code} - ${info.name} (id=${r.insertId})`);
    }
  }

  // ── Map payment statuses ──
  const paymentMap = {};
  const [payRows] = await pool.query('SELECT id, name FROM payment_statuses');
  for (const p of payRows) {
    const norm = p.name.toUpperCase().replace(/\s+/g, ' ');
    paymentMap[norm] = p.id;
  }

  // ── Insert orders ──
  let inserted = 0;
  for (const o of orders) {
    // Determine payment_status_id
    let payName = o.payment.toUpperCase().replace(/\s+/g, ' ');
    if (payName === 'PAY ON DELIEVERY') payName = 'PAID ON DELIVERY'; // fix typo
    if (!payName) payName = 'PAID'; // default
    const paymentStatusId = paymentMap[payName] || paymentMap['PAID'];
    const streamerId = o.streamer_name ? (streamerMap[o.streamer_name] || null) : null;

    // Normalize phone
    let phone = o.customer_phone.replace(/\s/g, '');
    if (!phone.startsWith('0') && !phone.startsWith('234')) phone = '0' + phone;

    // Calculate total
    const totalAmount = o.items.reduce((sum, it) => sum + it.price, 0);

    const gender = o.gender === 'female' ? 'female' : 'male';

    try {
      const [r] = await pool.query(
        `INSERT INTO orders (order_no, customer_name, customer_gender, customer_phone, customer_address,
          streamer_id, streamer_name, commission_rate, payment_status_id, payment_status_name,
          total_amount, actual_amount, remark, order_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, '1.00', ?, ?, ?, ?, ?, NOW())`,
        [o.order_no, o.customer_name, gender, phone, o.customer_address,
         streamerId, o.streamer_name || null, paymentStatusId, payName,
         totalAmount, totalAmount, o.remark]
      );
      const orderId = r.insertId;

      // Insert order_items
      for (const item of o.items) {
        await pool.query(
          'INSERT INTO order_items (order_id, product_id, product_code, product_name, unit_price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, 1, ?)',
          [orderId, productMap[item.code], item.code, item.name, item.price, item.price]
        );
      }

      // ★ 遵循 orders.js 规则：每个订单必须创建 shipping 记录 ★
      const shipCode = 'SHP' + Math.random().toString(36).slice(2, 10).toUpperCase();
      if (o.gig_tracking) {
        await pool.query(
          `INSERT INTO shipping_records (order_id, shipping_code, status, delivery_method, gig_tracking, shipped_at)
           VALUES (?, ?, 'in_transit', 'gig', ?, NOW())`,
          [orderId, shipCode, o.gig_tracking]
        );
      } else {
        await pool.query(
          `INSERT INTO shipping_records (order_id, shipping_code, status) VALUES (?, ?, 'pending')`,
          [orderId, shipCode]
        );
      }

      inserted++;
      console.log(`  Imported ${o.order_no} | ${o.customer_name} | ${o.items.length} item(s) | ₦${totalAmount}`);
    } catch (err) {
      console.error(`  FAILED ${o.order_no}:`, err.message);
    }
  }

  console.log(`\nDone. Imported ${inserted}/${orders.length} orders.`);
  await pool.end();
}

main().catch(err => { console.error(err); pool.end(); process.exit(1); });
