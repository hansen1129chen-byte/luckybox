const express = require('express');
const pool = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
router.use(authMiddleware);

// Payment image upload — single file, max 5MB, images only
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'payment');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const uploadPayment = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1E9) + path.extname(file.originalname)),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(['.jpg','.jpeg','.png','.gif','.webp'].includes(ext) ? null : new Error('Only image files'), true);
  },
});

function genOrderNo(date) {
  const d = date || new Date(Date.now() + 60 * 60 * 1000); // Nigeria UTC+1
  return `PF${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

// GET /api/orders
router.get('/', async (req, res) => {
  try {
    const { date_from, date_to, streamer_id, payment_status_id, product_names, page = 1, page_size = 20, sort_by, sort_dir, phone, order_no } = req.query;
    let where = '1=1';
    const params = [];
    if (date_from) { where += ' AND COALESCE(o.order_time, o.created_at) >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND COALESCE(o.order_time, o.created_at) <= ?'; params.push(date_to + ' 23:59:59'); }
    if (streamer_id) { where += ' AND o.streamer_id = ?'; params.push(streamer_id); }
    if (payment_status_id) { where += ' AND o.payment_status_id = ?'; params.push(payment_status_id); }
    if (product_names) {
      const names = product_names.split(',').filter(Boolean);
      if (names.length > 0) {
        where += ' AND ' + names.map(() => 'o.id IN (SELECT oi.order_id FROM order_items oi WHERE oi.product_name LIKE ?)').join(' AND ');
        names.forEach(n => params.push('%' + n.trim() + '%'));
      }
    }
    if (phone) { where += ' AND o.customer_phone LIKE ?'; params.push('%'+phone+'%'); }
    if (order_no) { where += ' AND o.order_no LIKE ?'; params.push('%'+order_no+'%'); }
    const allowedSort = { order_no: 'o.order_no', created_at: 'o.created_at', total_amount: 'o.total_amount', customer_name: 'o.customer_name' };
    const sort_col = allowedSort[sort_by] || 'o.created_at';
    const sort_dir_name = sort_dir === 'asc' ? 'ASC' : 'DESC';
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM orders o WHERE o.is_deleted = 0 AND ${where}`, params);
    const [rows] = await pool.query(
      `SELECT o.id, o.order_no, o.customer_name, o.customer_gender, o.customer_phone, o.customer_address,
        o.streamer_id, o.streamer_name, o.commission_rate, o.payment_status_id, o.payment_status_name,
        o.total_amount, o.actual_amount, o.remark, o.payment_image,
        DATE_FORMAT(o.order_time, \'%Y-%m-%d\') as order_time, o.created_at, o.updated_at,
        sr.status AS shipping_status, sr.shipping_code, sr.delivery_method, sr.gig_tracking,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS product_count
       FROM orders o
       LEFT JOIN shipping_records sr ON sr.order_id = o.id
       WHERE o.is_deleted = 0 AND ${where} ORDER BY ${sort_col} ${sort_dir_name} LIMIT ? OFFSET ?`,
      [...params, parseInt(page_size), (parseInt(page)-1)*parseInt(page_size)]
    );
    res.json({ list: rows, total: countRows[0].total, page: parseInt(page) });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// GET /api/orders/pdf?ids=1,2,3 - PDF labels (must be before /:id and /export)
router.get('/pdf', async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const { ids } = req.query;
    if (!ids) return res.status(400).json({ message: 'Select orders' });
    const idList = ids.split(',').filter(Boolean);

    // Fetch orders with items
    const placeholders = idList.map(() => '?').join(',');
    const [orders] = await pool.query(
      `SELECT * FROM orders WHERE id IN (${placeholders}) ORDER BY id`, idList
    );
    const [allItems] = await pool.query(
      `SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY order_id, id`, idList
    );

    // Group items by order
    const itemsByOrder = {};
    allItems.forEach(item => {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push(item);
    });

    const W = 142, H = 227; // 50mm x 80mm
    const M = 10;
    const IW = W - M * 2; // inner width 122pt
    const doc = new PDFDocument({ size: [W, H], margin: 0 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=labels.pdf');
    doc.pipe(res);

    const logoPath = require('path').join(__dirname, '..', '..', 'label.jpg');

    orders.forEach((order, oi) => {
      if (oi > 0) doc.addPage();
      const items = itemsByOrder[order.id] || [];

      // Background white
      doc.save();
      doc.rect(0, 0, W, H).fill('#fff');
      doc.restore();

      let y = M;

      // Logo image (replaces LUCKYBOX text + slogan)
      // Logo image (label.jpg)
      try {
        doc.image(logoPath, M, y, { width: IW });
        y += 32;
      } catch (e) {
        doc.font('Times-Roman').fontSize(12).fillColor('#111');
        doc.text('LUCKYBOX', M, y, { align: 'center', width: IW });
        y += 16;
      }

      // Body font
      const FONT_BODY = 'Helvetica';
      const FS_BODY = 4;
      const LH = 5; // line height

      // Name (left) + Order no (right), tight to above line
      doc.font(FONT_BODY).fontSize(FS_BODY).fillColor('#111');
      if (order.customer_name) doc.text(order.customer_name.toUpperCase(), M, y, { width: IW - 60 });
      doc.text(order.order_no, M, y, { width: IW, align: 'right' });
      y += LH + 1;

      // Table
      y += 1;
      doc.moveTo(M, y).lineTo(W - M, y).lineWidth(1).lineWidth(0.8).stroke('#000');

      const c0 = M;
      const c1 = M + 60;
      const c2 = c1 + 1;
      const c3 = c2 + 16;
      const c4 = W - M - 3;

      // Table header (bold)
      y += 3;
      doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor('#111');
      doc.text('Item', c0, y);
      doc.text('Price', c2, y, { width: c2 - c1 - 2, align: 'right' });
      doc.text('QTY', c3, y, { width: c3 - c2 - 2, align: 'right' });
      doc.text('Amount', c3, y, { width: c4 - c3, align: 'right' });
      y += 7;
      doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.8).stroke('#000');

      // Items (small body, tighter)
      const FS_ITEM = 3.5;
      const LH_ITEM = 4;
      doc.font(FONT_BODY).fontSize(FS_ITEM).fillColor('#111');
      let itemTotal = 0, totalQty = 0;
      items.forEach(item => {
        y += LH_ITEM;
        doc.text(item.product_name, c0, y, { width: c1 - c0 - 2 });
        doc.text('₦' + Number(item.unit_price).toLocaleString(), c2, y, { width: c2 - c1 - 2, align: 'right' });
        doc.text(String(item.quantity), c3, y, { width: c3 - c2 - 2, align: 'right' });
        doc.text('₦' + Number(item.subtotal).toLocaleString(), c3, y, { width: c4 - c3, align: 'right' });
        itemTotal += Number(item.subtotal);
        totalQty += item.quantity;
        y += LH_ITEM;
      });

      // Total row (bold)
      y += 1;
      doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.8).stroke('#000');
      y += 3;
      doc.font('Helvetica-Bold').fontSize(FS_BODY).fillColor('#111');
      doc.text('Total:', c1, y);
      doc.text(String(totalQty), c3, y, { width: c3 - c2 - 2, align: 'right' });
      doc.text('₦' + itemTotal.toLocaleString(), c3, y, { width: c4 - c3, align: 'right' });

      // Customer contact
      y += 8;
      doc.font(FONT_BODY).fontSize(FS_BODY).fillColor('#111');
      if (order.customer_phone) { doc.text('Phone No: ' + order.customer_phone, M, y); y += LH + 1; }
      if (order.customer_address) { doc.text('Address: ' + order.customer_address, M, y, { width: IW }); y += LH + 1; }

      // Footer (centered)
      y = doc.y + 10;
      doc.font(FONT_BODY).fontSize(FS_BODY).fillColor('#111');
      doc.text('Thank you for choosing LUCKYBOX!', M, y, { width: IW, align: 'center' }); y += 7;
      doc.text('For any questions about your purchase, contact', M, y, { width: IW, align: 'center' }); y += 6;
      doc.font('Helvetica-Bold').fontSize(FS_BODY);
      doc.text('us on WhatsApp at 0913 866 6675', M, y, { width: IW, align: 'center' });
      doc.font(FONT_BODY).fontSize(FS_BODY);
      y += 6;
      doc.text('Customer Service Hours: Mon–Fri, 10AM–5PM  ;  Sat, 10AM–2PM', M, y, { width: IW, align: 'center' }); y += 7;
      doc.text('Enjoy your fragrance!', M, y, { width: IW, align: 'center' });
    });

    doc.end();
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// GET /api/orders/export - XLSX with merged cells (must be before /:id)
router.get('/export', async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const { date_from, date_to, streamer_id, payment_status_id, product_names, ids } = req.query;
    let where = '1=1';
    const params = [];
    if (ids) { where += ' AND o.id IN (' + ids.split(',').map(()=>'?').join(',') + ')'; ids.split(',').forEach(id=>params.push(id)); }
    if (date_from) { where += ' AND COALESCE(o.order_time, o.created_at) >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND COALESCE(o.order_time, o.created_at) <= ?'; params.push(date_to + ' 23:59:59'); }
    if (streamer_id) { where += ' AND o.streamer_id = ?'; params.push(streamer_id); }
    if (payment_status_id) { where += ' AND o.payment_status_id = ?'; params.push(payment_status_id); }
    if (product_names) {
      const names = product_names.split(',').filter(Boolean);
      if (names.length > 0) {
        where += ' AND ' + names.map(() => 'o.id IN (SELECT oi.order_id FROM order_items oi WHERE oi.product_name LIKE ?)').join(' AND ');
        names.forEach(n => params.push('%' + n.trim() + '%'));
      }
    }
    const [rows] = await pool.query(
      "SELECT o.order_no,o.customer_name,o.customer_phone,o.customer_address,o.streamer_name,o.payment_status_name,o.total_amount,o.actual_amount,o.created_at,oi.product_code,oi.product_name,oi.unit_price,oi.quantity,oi.subtotal FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE "+where+" ORDER BY o.created_at DESC,oi.id", params
    );
    if (rows.length === 0) return res.status(400).json({ message: 'No data' });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Orders');
    const headers = ['Order No.','Customer','Phone','Address','Streamer','Payment','Total','Actual','Date','Product Code','Product Name','Unit Price','Quantity','Subtotal'];
    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    // Add data rows
    for (const r of rows) {
      ws.addRow([r.order_no,r.customer_name,r.customer_phone,r.customer_address,r.streamer_name,r.payment_status_name,r.total_amount,r.actual_amount,String(r.created_at||'').slice(0,10),r.product_code,r.product_name,r.unit_price,r.quantity,r.subtotal]);
    }

    // Merge cells by order group
    let row = 2; // data starts at row 2 (after header)
    while (row <= ws.rowCount) {
      const currentOrder = ws.getCell(row, 1).value;
      let endRow = row;
      while (endRow < ws.rowCount && ws.getCell(endRow + 1, 1).value === currentOrder) endRow++;
      if (endRow > row) {
        for (let col = 1; col <= 9; col++) {
          ws.mergeCells(row, col, endRow, col);
        }
      }
      row = endRow + 1;
    }

    // Style: center align merged cells
    ws.eachRow((r, rn) => {
      if (rn > 1) r.eachCell((c, cn) => {
        if (cn <= 9) c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });
    });

    // Column widths
    ws.columns.forEach((c, i) => {
      c.width = i < 9 ? 16 : (i < 11 ? 20 : 12);
    });

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename=orders_export.xlsx');
    res.send(buf);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// GET /api/orders/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT o.id, o.order_no, o.customer_name, o.customer_gender, o.customer_phone, o.customer_address, o.streamer_id, o.streamer_name, o.commission_rate, o.payment_status_id, o.payment_status_name, o.total_amount, o.actual_amount, o.remark, o.payment_image, DATE_FORMAT(o.order_time, \'%Y-%m-%d\') as order_time, o.created_at, o.updated_at, sr.status AS shipping_status, sr.shipping_code FROM orders o LEFT JOIN shipping_records sr ON sr.order_id=o.id WHERE o.id=? AND o.is_deleted = 0',[req.params.id]);
    if (rows.length===0) return res.status(404).json({ message: 'Not found' });
    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id=?',[rows[0].id]);
    rows[0].items = items;
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// POST /api/orders
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { customer_name, customer_gender, customer_phone, customer_address, order_time, streamer_id, payment_status_id, actual_amount, items } = req.body;
    if (!items || !Array.isArray(items) || items.length===0) return res.status(400).json({ message: 'Select at least one product' });
    const prefix = genOrderNo();
    const [lastRows] = await conn.query("SELECT order_no FROM orders WHERE order_no LIKE ? ORDER BY id DESC LIMIT 1",[prefix+'%']);
    let seq = 1; if (lastRows.length>0) { const ls = parseInt(lastRows[0].order_no.slice(-3)); if (!isNaN(ls)) seq = ls+1; }
    const orderNo = prefix + String(seq).padStart(3,'0');
    let totalAmount = 0;
    const orderItems = [];
    for (const item of items) {
      const [prodRows] = await conn.query('SELECT * FROM products WHERE id=?',[item.product_id]);
      if (prodRows.length===0) { conn.release(); return res.status(400).json({ message: 'Product not found' }); }
      const p = prodRows[0]; const qty = parseInt(item.quantity)||1;
      const subtotal = parseFloat(p.price)*qty; totalAmount += subtotal;
      orderItems.push({ product_id:p.id, product_code:p.code, product_name:p.name, unit_price:p.price, unit_cost:p.cost||0, quantity:qty, subtotal });
    }
    const actual = actual_amount!=null ? Math.min(parseFloat(actual_amount),totalAmount) : totalAmount;
    let sn='', psn='', cr=0;
    if (streamer_id) { const [sr]=await conn.query('SELECT name,commission_rate FROM streamers WHERE id=?',[streamer_id]); if (sr.length>0) { sn=sr[0].name; cr=sr[0].commission_rate; } }
    if (payment_status_id) { const [ps]=await conn.query('SELECT name FROM payment_statuses WHERE id=?',[payment_status_id]); if (ps.length>0) psn=ps[0].name; }
    // Pass date strings directly to MySQL — no Date conversion, no timezone corruption
    // Frontend provides Nigeria date string "YYYY-MM-DD" — pass through as-is
    const orderTime = order_time || null;
    const paymentImage = req.body.payment_image || '';
    const [orderResult] = await conn.query(
      'INSERT INTO orders (order_no,customer_name,customer_gender,customer_phone,customer_address,order_time,streamer_id,streamer_name,commission_rate,payment_status_id,payment_status_name,total_amount,actual_amount,payment_image) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [orderNo,customer_name||'',customer_gender||'',customer_phone||'',customer_address||'',orderTime,streamer_id||null,sn,cr,payment_status_id||null,psn,totalAmount,actual,paymentImage]
    );
    for (const oi of orderItems) {
      await conn.query('INSERT INTO order_items (order_id,product_id,product_code,product_name,unit_price,unit_cost,quantity,subtotal) VALUES (?,?,?,?,?,?,?,?)',
        [orderResult.insertId,oi.product_id,oi.product_code,oi.product_name,oi.unit_price,oi.unit_cost||0,oi.quantity,oi.subtotal]);
    }
    const shipCode = 'SHP'+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,6).toUpperCase();
    await conn.query("INSERT INTO shipping_records (order_id,shipping_code,status,delivery_method) VALUES (?,?,'pending','own')",[orderResult.insertId,shipCode]);
    conn.release();
    res.status(201).json({ id:orderResult.insertId, order_no:orderNo, total_amount:totalAmount });
  } catch (err) { conn.release(); console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// PUT /api/orders/:id
router.put('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { customer_name, customer_gender, customer_phone, customer_address, order_time, streamer_id, payment_status_id, actual_amount, payment_image, items } = req.body;
    const [orderRows] = await conn.query('SELECT total_amount FROM orders WHERE id=?',[req.params.id]);
    if (orderRows.length===0) { conn.release(); return res.status(404).json({ message: 'Not found' }); }

    // Recalculate total_amount from items if provided
    let total = orderRows[0].total_amount;
    if (items && Array.isArray(items) && items.length > 0) {
      total = 0;
      for (const item of items) {
        const [prodRows] = await conn.query('SELECT * FROM products WHERE id=?',[item.product_id]);
        if (prodRows.length===0) { conn.release(); return res.status(400).json({ message: 'Product not found' }); }
        const p = prodRows[0]; const qty = parseInt(item.quantity)||1;
        total += parseFloat(p.price)*qty;
      }
    }

    const actual = actual_amount!=null ? Math.min(parseFloat(actual_amount),total) : total;
    const updates = ['customer_name=?','customer_gender=?','customer_phone=?','customer_address=?','streamer_id=?','payment_status_id=?','actual_amount=?','total_amount=?'];
    const values = [customer_name,customer_gender,customer_phone,customer_address,streamer_id,payment_status_id,actual,total];
    if (order_time) { updates.push('order_time=?'); values.push(order_time); }
    if (payment_status_id) {
      const [ps] = await conn.query('SELECT name FROM payment_statuses WHERE id=?',[payment_status_id]);
      if (ps.length>0) { updates.push('payment_status_name=?'); values.push(ps[0].name); }
    }
    if (payment_image !== undefined) { updates.push('payment_image=?'); values.push(payment_image); }
    values.push(req.params.id);
    await conn.query('UPDATE orders SET '+updates.join(',')+' WHERE id=?', values);

    // Replace order items
    if (items && Array.isArray(items) && items.length > 0) {
      await conn.query('DELETE FROM order_items WHERE order_id=?',[req.params.id]);
      for (const item of items) {
        const [prodRows] = await conn.query('SELECT * FROM products WHERE id=?',[item.product_id]);
        if (prodRows.length===0) continue;
        const p = prodRows[0]; const qty = parseInt(item.quantity)||1;
        const subtotal = parseFloat(p.price)*qty;
        await conn.query('INSERT INTO order_items (order_id,product_id,product_code,product_name,unit_price,unit_cost,quantity,subtotal) VALUES (?,?,?,?,?,?,?,?)',
          [req.params.id,p.id,p.code,p.name,p.price,p.cost||0,qty,subtotal]);
      }
    }

    conn.release();
    res.json({ message: 'Updated' });
  } catch (err) { conn.release(); console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// DELETE /api/orders/:id - admin only
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    await pool.query("UPDATE shipping_records SET is_deleted = 1 WHERE order_id = ?",[req.params.id]);
    await pool.query("UPDATE orders SET is_deleted = 1 WHERE id = ?",[req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { console.error(err); res.status(500).json({ message: 'Server error' }); }
});

// POST /api/orders/upload-payment — upload payment screenshot
router.post('/upload-payment', uploadPayment.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const url = '/uploads/payment/' + req.file.filename;
  res.json({ url, filename: req.file.filename });
});

module.exports = router;
