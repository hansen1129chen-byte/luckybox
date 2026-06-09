// Termii WhatsApp messaging service
// Docs: https://developers.termii.com/messaging-api#send-message

const config = {
  apiKey: process.env.TERMII_API_KEY || '',
  baseUrl: process.env.TERMII_BASE_URL || 'https://api.termii.com',
  senderId: process.env.TERMII_SENDER_ID || 'LUCKYBOX',
};

/**
 * Send a WhatsApp message via Termii
 * @param {string} to - Phone number in international format (e.g., 2348161738091)
 * @param {string} message - Message text
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendWhatsApp(to, message) {
  if (!config.apiKey) {
    console.log('[Termii] Skipped — no API key configured');
    return { success: false, error: 'No API key' };
  }

  const payload = {
    to,
    from: config.senderId,
    sms: message,
    type: 'plain',
    channel: 'whatsapp',
    api_key: config.apiKey,
  };

  try {
    const resp = await fetch(`${config.baseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await resp.json();

    if (resp.ok && body.code === 'ok') {
      console.log(`[Termii] WhatsApp sent to ${to} — message_id: ${body.message_id}`);
      return { success: true, messageId: body.message_id };
    } else {
      console.error(`[Termii] Failed to send to ${to}:`, body.message || body);
      return { success: false, error: body.message || 'Unknown error' };
    }
  } catch (err) {
    console.error(`[Termii] Network error sending to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send order status WhatsApp notifications (fire-and-forget, won't block API response)
 */
function notifyCustomer(pool, shippingId, newStatus) {
  // Run async — don't block the HTTP response
  setImmediate(async () => {
    try {
      const [rows] = await pool.query(
        `SELECT o.order_no, o.customer_name, o.customer_gender, o.customer_phone, o.total_amount,
          sr.gig_tracking, sr.delivery_method, sr.delivery_staff_name
         FROM shipping_records sr
         JOIN orders o ON o.id = sr.order_id
         WHERE sr.id = ?`,
        [shippingId]
      );
      if (rows.length === 0) return;

      const order = rows[0];
      const phone = order.customer_phone.replace(/\D/g, '');
      // Normalize to international: if starts with 0, replace with 234
      const intlPhone = phone.startsWith('0') ? '234' + phone.slice(1) : phone;
      if (intlPhone.length < 10) {
        console.log(`[Termii] Skipped — invalid phone: ${order.customer_phone}`);
        return;
      }

      const trackUrl = 'https://parfco.vip/shipping_check';
      const title = order.customer_gender === 'female' ? 'Ms.' : 'Mr.';
      const name = order.customer_name;
      const orderNo = order.order_no;
      const amount = '₦' + Number(order.total_amount).toLocaleString();
      const tracking = order.gig_tracking || '';
      const staff = order.delivery_staff_name || '';
      const method = (order.delivery_method || '').toLowerCase();

      let message = '';

      if (newStatus === 'in_transit') {
        if (method === 'gig') {
          message =
            `Dear ${title} ${name}, your LUCKYBOX fragrance order *${orderNo}* (${amount}) ` +
            `has been shipped via GIG Logistics.\n` +
            `Tracking number: *${tracking}*\n` +
            `Track your delivery here: ${trackUrl}\n\n` +
            `Thank you for choosing LUCKYBOX 🕊️`;
        } else {
          message =
            `Dear ${title} ${name}, your LUCKYBOX fragrance order *${orderNo}* (${amount}) ` +
            `is on its way. Your delivery agent *${staff}* will bring it to you shortly.\n` +
            `For any inquiries, WhatsApp us at 0913 866 6675.\n\n` +
            `Thank you for choosing LUCKYBOX 🕊️`;
        }
      } else if (newStatus === 'delivered') {
        message =
          `Dear ${title} ${name}, your LUCKYBOX fragrance order *${orderNo}* (${amount}) ` +
          `has been delivered ✅\n\n` +
          `Should you have any questions, please call or WhatsApp us at 0913 866 6675.\n\n` +
          `Thank you for choosing LUCKYBOX 🕊️`;
      } else {
        return;
      }

      await sendWhatsApp(intlPhone, message);
    } catch (err) {
      console.error('[Termii] notifyCustomer error:', err.message);
    }
  });
}

module.exports = { sendWhatsApp, notifyCustomer };
