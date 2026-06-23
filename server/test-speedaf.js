// Speedaf API 独立调试脚本
// 用法: node test-speedaf.js

const CryptoJS = require('crypto-js');
const crypto = require('crypto');

// ===== 改这里测试不同接口 =====
const APP_CODE = 'NG000915';
const SECRET_KEY = 'csOqYsNL';
const CUSTOMER_CODE = 'NG000915';
const PLATFORM_SOURCE = 'INTIME COSMETICS ENTERPRISE';

// 选一个: createOrder | trackQuery | orderPrint | trackSubscribe
const API_PATH = 'createOrder';

// 刚创建的运单号
const BILL_CODE = 'NG021139671517';

const TRACK_DATA = { mailNoList: [BILL_CODE] };

const PRINT_DATA = { billCode: BILL_CODE, customerCode: CUSTOMER_CODE };

// 创建订单的 data
const ORDER_DATA = {
  customerCode: CUSTOMER_CODE,
  platformSource: PLATFORM_SOURCE,
  parcelType: 'PT01',
  deliveryType: 'DE01',
  transportType: 'TT01',
  shipType: 'ST01',
  payMethod: 'PA01',
  pickUpAging: 0,
  sendName: 'LUCKY BOX',
  sendMobile: '07079139062',
  sendAddress: 'Poly plaza Trade Fair Complex',
  sendCityName: 'LAGOS',
  sendProvinceName: 'LAGOS',
  sendDistrictName: 'LAGOS',
  sendCountryCode: 'NG',
  acceptName: 'Test Customer',
  acceptMobile: '08011111111',
  acceptAddress: 'Test Address Lagos',
  acceptCityName: 'LAGOS',
  acceptProvinceName: 'LAGOS',
  acceptDistrictName: 'LAGOS',
  acceptCountryCode: 'NG',
  piece: 1,
  parcelWeight: 0.5,
  goodsQTY: 1,
  parcelValue: 100,
  itemList: [{
    sku: 'TEST001',
    goodsName: 'Test Product',
    goodsQTY: 1,
    goodsValue: 100,
    goodsType: 'IT01',
    blInsure: 0,
    battery: 0,
  }],
};

// ===== 执行 =====
async function main() {
  const ts = String(Date.now());
  // 生产环境 + trackQuery 路径不同
  const endpoint = API_PATH === 'trackQuery'
    ? 'https://apis.speedaf.com/open-api/express/track/query'
    : `https://apis.speedaf.com/open-api/express/order/${API_PATH}`;
  const url = `${endpoint}?appCode=${APP_CODE}&timestamp=${ts}`;

  // Pick business data based on API
  const bizData = API_PATH === 'createOrder' ? ORDER_DATA
    : API_PATH === 'orderPrint' ? PRINT_DATA
    : TRACK_DATA;
  const dataStr = JSON.stringify(bizData);
  const sign = crypto.createHash('md5').update(ts + SECRET_KEY + dataStr).digest('hex');

  // createOrder: data as string. Others: data as object.
  const wrapper = API_PATH === 'createOrder'
    ? JSON.stringify({ data: dataStr, sign })
    : JSON.stringify({ data: bizData, sign });
  const key = CryptoJS.enc.Utf8.parse(SECRET_KEY.slice(0, 8));
  const iv = CryptoJS.enc.Hex.parse('1234567890ABCDEF');
  const encrypted = CryptoJS.DES.encrypt(wrapper, key, {
    iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
  }).toString();

  console.log('=== Speedaf API Debug ===');
  console.log('URL:', url);
  console.log('Sign:', sign);
  console.log('Encrypted body:', encrypted.substring(0, 80) + '...');
  console.log('');

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: encrypted,
    });
    const raw = await resp.json();
    console.log('Response:', JSON.stringify(raw, null, 2));

    if (raw.data && typeof raw.data === 'string') {
      const decrypted = CryptoJS.DES.decrypt(raw.data, key, {
        iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
      });
      console.log('Decrypted:', decrypted.toString(CryptoJS.enc.Utf8));
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
