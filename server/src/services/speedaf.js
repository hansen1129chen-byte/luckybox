const crypto = require('crypto');
const CryptoJS = require('crypto-js');

const CONFIG = {
  appCode: 'NG000915',
  secretKey: 'csOqYsNL',
  customerCode: 'NG000915',
  platformSource: 'INTIME COSMETICS ENTERPRISE',

  sender: {
    sendName: 'LUCKY BOX',
    sendMobile: '08123356789',
    sendAddress: 'Trade Fair Complex, Lagos-Badagry Expressway',
    sendProvinceName: 'LAGOS',
    sendCityName: 'AMUWO-ODOFIN',
    sendDistrictName: 'SATELLITE TOWN',
    sendCountryCode: 'NG',
  },

  baseUrl: 'https://apis.speedaf.com/open-api/express',
};

const DES_KEY = CryptoJS.enc.Utf8.parse(CONFIG.secretKey.slice(0, 8));
const DES_IV = CryptoJS.enc.Hex.parse('1234567890ABCDEF');

function encrypt(text) {
  return CryptoJS.DES.encrypt(text, DES_KEY, { iv: DES_IV, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString();
}

function decrypt(base64Str) {
  return CryptoJS.DES.decrypt(base64Str, DES_KEY, { iv: DES_IV, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }).toString(CryptoJS.enc.Utf8);
}

/**
 * Call Speedaf — dataAsObject=false means sign over string, wrapper has string.
 */
async function call(path, bizData, { dataAsObject = false } = {}) {
  const timestamp = String(Date.now());
  const url = `${CONFIG.baseUrl}${path}?appCode=${CONFIG.appCode}&timestamp=${timestamp}`;
  const dataStr = JSON.stringify(bizData);
  const sign = crypto.createHash('md5').update(timestamp + CONFIG.secretKey + dataStr).digest('hex');
  const wrapper = JSON.stringify({ data: dataAsObject ? bizData : dataStr, sign });
  const encrypted = encrypt(wrapper);

  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: encrypted });
  const raw = await resp.json();
  console.log('[Speedaf]', path, '→', JSON.stringify(raw).substring(0, 200));

  if (raw.data && typeof raw.data === 'string') {
    try { raw.data = JSON.parse(decrypt(raw.data)); } catch (e) { /* keep raw */ }
  }
  return raw;
}

// ============ Public API ============

/** 1. Create order → get billCode */
async function createOrder(order, orderItems) {
  const data = {
    customerCode: CONFIG.customerCode,
    platformSource: CONFIG.platformSource,
    parcelType: 'PT01', deliveryType: 'DE01', transportType: 'TT01', shipType: 'ST01',
    payMethod: 'PA02', pickUpAging: 0,
    ...CONFIG.sender,
    acceptName: order.customer_name || '',
    acceptMobile: (order.customer_phone || '').replace(/\D/g, '').slice(-10),
    acceptPhone: (order.customer_phone2 || '').replace(/\D/g, '').slice(-10) || undefined,
    acceptAddress: order.customer_address || '',
    acceptProvinceName: order.accept_province || 'LAGOS',
    acceptCityName: order.accept_city || '',
    acceptDistrictName: order.accept_district || '',
    acceptCountryCode: 'NG',
    customOrderNo: order.order_no || '',
    piece: orderItems.length || 1,
    parcelWeight: orderItems.reduce((s, i) => s + (i.quantity || 1) * 0.4, 0), // 400g per bottle
    goodsQTY: orderItems.reduce((s, i) => s + (i.quantity || 1), 0),
    parcelValue: Number(order.total_amount) || 0,
    itemList: orderItems.map(item => ({
      sku: item.product_code || '',
      goodsName: (item.product_name || 'Cosmetics').replace(/[^a-zA-Z0-9 ]/g, ' ').substring(0, 50),
      goodsNameDialect: (item.product_name || 'Cosmetics').substring(0, 50),
      goodsQTY: item.quantity || 1, goodsValue: Number(item.unit_price) || 0,
      goodsType: 'IT01', blInsure: 0, battery: 0,
    })),
  };
  return call('/order/createOrder', data);
}

/** 2. Print label */
async function printLabel(billCode) {
  return call('/order/print', { waybillNoList: [billCode], labelType: 2, withLogo: true });
}

/** 3. Track query */
async function trackQuery(billCode) {
  return call('/track/query', { mailNoList: [billCode] }, { dataAsObject: true });
}

/** 4. Track subscribe (webhook callback) */
async function trackSubscribe(billCode, notifyUrl) {
  return call('/track/subscribe', { mailNo: billCode, customerCode: CONFIG.customerCode, notifyUrl }, { dataAsObject: true });
}

/** 5. Cancel order */
async function cancelOrder(billCode, cancelReason) {
  return call('/order/cancelOrder', [{ billCode, customerCode: CONFIG.customerCode, cancelReason: cancelReason || 'Customer request' }]);
}

module.exports = { createOrder, printLabel, trackQuery, trackSubscribe, cancelOrder, CONFIG };
