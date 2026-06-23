const crypto = require('crypto');
const CryptoJS = require('crypto-js');

const IS_PROD = process.env.SPEEDAF_PROD === '1';

const CONFIG = {
  appCode: IS_PROD ? 'NG000915' : '11111111',
  secretKey: IS_PROD ? 'csOqYsNL' : 'uYMGr8eU',
  customerCode: IS_PROD ? 'NG000915' : '11111111',
  platformSource: 'INTIME COSMETICS ENTERPRISE',
  baseUrl: IS_PROD
    ? 'https://apis.speedaf.com/open-api/express/order'
    : 'https://uat-api.speedaf.com/open-api/express/order',

  sender: {
    sendName: 'LUCKY BOX',
    sendMobile: '07079139062',
    sendAddress: 'Poly plaza Trade Fair Complex',
    sendCityName: 'LAGOS',
    sendCountryCode: 'NG',
    sendProvinceName: 'LAGOS',
    sendDistrictName: 'LAGOS',
  },
};

const DES_KEY = CryptoJS.enc.Utf8.parse(CONFIG.secretKey.slice(0, 8));
const DES_IV = CryptoJS.enc.Hex.parse('1234567890ABCDEF');

function encrypt(text) {
  const result = CryptoJS.DES.encrypt(text, DES_KEY, {
    iv: DES_IV,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return result.toString();
}

async function callApi(path, payload) {
  const timestamp = String(Date.now());
  const url = `${CONFIG.baseUrl}/${path}?appCode=${CONFIG.appCode}&timestamp=${timestamp}`;

  // data must be JSON string in wrapper AND in sign computation
  const dataStr = JSON.stringify(payload);
  const sign = crypto.createHash('md5').update(timestamp + CONFIG.secretKey + dataStr).digest('hex');

  // Build wrapper: {"data": "<json string>", "sign": "<md5>"}
  const wrapper = JSON.stringify({ data: dataStr, sign });
  const encrypted = encrypt(wrapper);

  console.log('[Speedaf] Sign:', sign);
  console.log('[Speedaf] Wrapper:', wrapper.substring(0, 200));

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: encrypted,
  });

  const raw = await resp.json();
  console.log('[Speedaf]', path, '→', JSON.stringify(raw).substring(0, 300));

  // Decrypt response data if present
  if (raw.data && typeof raw.data === 'string') {
    try {
      const decrypted = CryptoJS.DES.decrypt(raw.data, DES_KEY, {
        iv: DES_IV,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      });
      const decStr = decrypted.toString(CryptoJS.enc.Utf8);
      raw.data = JSON.parse(decStr);
    } catch (e) {
      console.log('[Speedaf] Response decrypt skipped:', e.message);
    }
  }
  return raw;
}

async function createOrder(order, orderItems) {
  const data = {
    customerCode: CONFIG.customerCode,
    platformSource: CONFIG.platformSource,
    parcelType: 'PT01',
    deliveryType: 'DE01',
    transportType: 'TT01',
    shipType: 'ST01',
    payMethod: 'PA01',
    pickUpAging: 0,
    taxMethod: 'DDP',
    ...CONFIG.sender,
    acceptName: order.customer_name || '',
    acceptMobile: (order.customer_phone || '').replace(/\D/g, '').slice(-10),
    acceptAddress: order.customer_address || '',
    acceptCityName: 'LAGOS',
    acceptProvinceName: 'LAGOS',
    acceptDistrictName: 'LAGOS',
    acceptCountryCode: 'NG',
    customOrderNo: order.order_no || '',
    piece: orderItems.length || 1,
    parcelWeight: 0.5,
    goodsQTY: orderItems.reduce((s, i) => s + (i.quantity || 1), 0),
    parcelValue: Number(order.total_amount) || 0,
    itemList: orderItems.map(item => ({
      sku: item.product_code || '',
      goodsName: (item.product_name || 'Cosmetics').replace(/[^a-zA-Z0-9 ]/g, ' ').substring(0, 50),
      goodsNameDialect: (item.product_name || 'Cosmetics').substring(0, 50),
      goodsQTY: item.quantity || 1,
      goodsValue: Number(item.unit_price) || 0,
      goodsType: 'IT01',
      blInsure: 0,
      battery: 0,
    })),
  };

  return callApi('createOrder', data);
}

async function trackQuery(billCode) {
  return callApi('trackQuery', { billCode, customerCode: CONFIG.customerCode });
}

async function trackSubscribe(billCode, callbackUrl) {
  return callApi('trackSubscribe', { billCode, customerCode: CONFIG.customerCode, callbackUrl });
}

module.exports = { createOrder, trackQuery, trackSubscribe, CONFIG };
