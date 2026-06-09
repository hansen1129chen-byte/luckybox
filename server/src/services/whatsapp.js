// Meta Cloud API — WhatsApp messaging
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

const config = {
  phoneId: process.env.META_WHATSAPP_PHONE_ID || '',
  accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN || '',
  apiVersion: 'v22.0',
};

/**
 * Send a WhatsApp template message via Meta Cloud API
 */
async function sendTemplate(to, templateName, bodyParams) {
  if (!config.phoneId || !config.accessToken) {
    console.log('[WhatsApp] Skipped — missing META_WHATSAPP_PHONE_ID or ACCESS_TOKEN');
    return { success: false, error: 'Not configured' };
  }

  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: Object.entries(bodyParams).map(([key, value]) => ({
            type: 'text',
            parameter_name: key,
            text: String(value),
          })),
        },
      ],
    },
  };

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await resp.json();

    if (resp.ok && body.messages) {
      console.log(`[WhatsApp] Template "${templateName}" sent to ${to} — id: ${body.messages[0].id}`);
      return { success: true, messageId: body.messages[0].id };
    } else {
      console.error(`[WhatsApp] Failed to send to ${to}:`, JSON.stringify(body));
      return { success: false, error: body.error?.message || 'Unknown error' };
    }
  } catch (err) {
    console.error(`[WhatsApp] Network error sending to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Fire-and-forget order notification
 * Templates required in Meta Business Suite (with named variables, not numbered):
 *   - order_shipped_gig:  {{customer_name}} {{order_no}} {{amount}} {{tracking}} {{track_url}}
 *   - order_shipped_own: {{customer_name}} {{order_no}} {{amount}} {{staff}}
 *   - order_delivered:    {{customer_name}} {{order_no}} {{amount}}
 */
function notifyCustomer(pool, shippingId, newStatus) {
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
      const intlPhone = phone.startsWith('0') ? '234' + phone.slice(1) : phone;
      if (intlPhone.length < 10) return;

      const name = order.customer_name;
      const orderNo = order.order_no;
      const amount = '₦' + Number(order.total_amount).toLocaleString();
      const tracking = order.gig_tracking || '';
      const staff = order.delivery_staff_name || '';
      const method = (order.delivery_method || '').toLowerCase();
      const trackUrl = 'https://parfco.vip/shipping_check';

      if (newStatus === 'in_transit') {
        if (method === 'gig') {
          await sendTemplate(intlPhone, 'order_shipped_gig', {
            customer_name: name, order_no: orderNo, amount, tracking, track_url: trackUrl
          });
        } else {
          await sendTemplate(intlPhone, 'order_shipped_own', {
            customer_name: name, order_no: orderNo, amount, staff
          });
        }
      } else if (newStatus === 'delivered') {
        await sendTemplate(intlPhone, 'order_delivered', {
          customer_name: name, order_no: orderNo, amount
        });
      }
    } catch (err) {
      console.error('[WhatsApp] notifyCustomer error:', err.message);
    }
  });
}

module.exports = { sendTemplate, notifyCustomer };
