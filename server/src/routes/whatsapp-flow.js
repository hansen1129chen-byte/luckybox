const express = require('express');
const router = express.Router();

// POST /api/whatsapp-flow/track — called by WhatsApp Flow data exchange
router.post('/track', async (req, res) => {
  try {
    const pool = require('../config/db');
    const { screen, data } = req.body;

    // Only handle SEARCH → RESULT transition
    if (screen !== 'SEARCH' || !data) {
      return res.json({
        version: '5.0',
        screen: 'SEARCH',
        data: { error: { type: 'string', string_type: 'text' } },
      });
    }

    const orderNo = (data.order_no || '').trim();
    const phone = (data.phone || '').trim();

    if (!orderNo || !phone) {
      return res.json({
        version: '5.0',
        screen: 'SEARCH',
        data: {},
      });
    }

    // Normalize Nigerian phone
    let phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.startsWith('234') && phoneDigits.length >= 10) phoneDigits = phoneDigits.slice(3);
    if (phoneDigits.startsWith('0')) phoneDigits = phoneDigits.slice(1);
    const phoneLast4 = phoneDigits.slice(-4);

    if (phoneLast4.length < 4) {
      return res.json({
        version: '5.0',
        screen: 'SEARCH',
        data: {},
      });
    }

    const [rows] = await pool.query(
      `SELECT o.order_no, o.customer_name,
        CONCAT(REPEAT('*', GREATEST(0, CHAR_LENGTH(o.customer_phone)-4)), RIGHT(o.customer_phone,4)) AS masked_phone,
        o.total_amount,
        sr.status AS shipping_status, sr.delivery_method,
        sr.gig_tracking,
        COALESCE(gs.is_delivered,0) AS gigl_delivered,
        COALESCE(gs.is_cancelled,0) AS gigl_cancelled,
        COALESCE(gs.current_scan_status,'') AS current_scan_status,
        COALESCE(gs.destination,'') AS destination
       FROM orders o
       LEFT JOIN shipping_records sr ON sr.order_id = o.id
       LEFT JOIN gigl_shipments gs ON sr.gig_tracking = gs.waybill
       WHERE o.order_no LIKE ? AND RIGHT(REPLACE(o.customer_phone, '+', ''), 4) = ?
       ORDER BY o.created_at DESC LIMIT 1`,
      ['%' + orderNo + '%', phoneLast4]
    );

    if (rows.length === 0) {
      return res.json({
        version: '5.0',
        screen: 'SEARCH',
        data: {},
      });
    }

    const order = rows[0];

    // Fetch tracking events
    let trackingSummary = '';
    if (order.delivery_method === 'gig' && order.gig_tracking) {
      const [events] = await pool.query(
        'SELECT event_time, location, status_description FROM gigl_tracking_events WHERE waybill = ? ORDER BY event_time ASC',
        [order.gig_tracking]
      );
      if (events.length > 0) {
        trackingSummary = events.map(e =>
          `${e.status_description} - ${e.location} (${new Date(e.event_time).toLocaleDateString('en-GB', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})})`
        ).join('\n');
      }
    }

    if (!trackingSummary) {
      trackingSummary = 'Your order is being processed and packed. Please check back later.';
    }

    const statusLabel = {
      pending: 'Processing', in_transit: 'In Transit', delivered: 'Delivered',
      returned: 'Returned', cancelled: 'Cancelled'
    }[order.shipping_status] || 'Processing';

    return res.json({
      version: '5.0',
      screen: 'RESULT',
      data: {
        order_no: order.order_no,
        status: statusLabel,
        customer_name: order.customer_name,
        masked_phone: order.masked_phone,
        amount: '₦' + Number(order.total_amount).toLocaleString(),
        delivery_method: (order.delivery_method || 'N/A').toUpperCase(),
        destination: order.destination || 'N/A',
        tracking_summary: trackingSummary,
      },
    });
  } catch (err) {
    console.error('[WhatsApp Flow] Error:', err);
    return res.json({
      version: '5.0',
      screen: 'SEARCH',
      data: {},
    });
  }
});

module.exports = router;
