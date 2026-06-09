/**
 * GIGL API Client
 *
 * Handles: login, token caching, query shipments, track waybill
 */
const https = require('https');

const BASE = process.env.GIGL_BASE_URL || 'https://thirdpartynode.theagilitysystems.com';
const TRACK = process.env.GIGL_TRACK_URL || 'https://prod-giggo-app-revamp-api.theagilitysystems.com';

let cachedToken = null;
let tokenExpiry = 0; // epoch ms

// ── helpers ──────────────────────────────────────────────────────────

function httpRequest(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const headerList = { 'Content-Type': 'application/json', ...headers };
    if (data) headerList['Content-Length'] = Buffer.byteLength(data);
    const opts = {
      hostname: u.hostname, port: 443,
      path: method === 'GET' ? u.pathname + u.search : u.pathname,
      method, headers: headerList, timeout: 30000,
    };
    const req = https.request(opts, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('GIGL parse error: ' + buf.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('GIGL timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

function httpGet(url, headers) { return httpRequest('GET', url, null, headers); }
function httpPost(url, body, headers) { return httpRequest('POST', url, body, headers); }

// ── auth ─────────────────────────────────────────────────────────────

async function login() {
  const email = process.env.GIGL_EMAIL;
  const password = process.env.GIGL_PASSWORD;
  if (!email || !password) throw new Error('GIGL_EMAIL / GIGL_PASSWORD not configured');

  const res = await httpPost(`${BASE}/login`, { email, password });
  if (res.status !== 200 || !res.data || !res.data['access-token']) {
    throw new Error('GIGL login failed: ' + JSON.stringify(res));
  }
  cachedToken = res.data['access-token'];
  // Token lifetime ~10 min; refresh 2 min early
  tokenExpiry = Date.now() + 8 * 60 * 1000;
  console.log('[GIGL] Logged in, token expires in ~8 min');
  return cachedToken;
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  return login();
}

// ── queries ──────────────────────────────────────────────────────────

/**
 * Fetch shipments for a customer within a date range.
 * Handles pagination automatically (max 100 per page).
 * Returns all waybills for the period.
 */
async function getShipments(startDate, endDate) {
  const token = await getToken();
  const customerCode = process.env.GIGL_CUSTOMER_CODE;
  if (!customerCode) throw new Error('GIGL_CUSTOMER_CODE not configured');

  const all = [];
  let skip = 0;
  const limit = 100;

  while (true) {
    const url = `${TRACK}/shipments?customerCode=${customerCode}&startDate=${startDate}&endDate=${endDate}&limit=${limit}&skip=${skip}`;
    console.log(`[GIGL] Fetching shipments: ${startDate} ~ ${endDate} skip=${skip}`);
    const res = await httpGet(url, { 'access-token': token });

    if (res.status !== 200 || !res.data) {
      // Token might have expired; retry once with fresh token
      if (res.status === 401) {
        console.log('[GIGL] Token expired, re-login...');
        await login();
        continue;
      }
      throw new Error('GIGL shipments query failed: ' + JSON.stringify(res));
    }

    const batch = res.data.data || [];
    all.push(...batch);

    if (batch.length < limit) break;
    skip += limit;
  }

  console.log(`[GIGL] Fetched ${all.length} shipments total`);
  return all;
}

/**
 * Track a single waybill — returns full tracking data.
 *
 * ★ 这个接口返回的是实时数据，不受日期窗口限制 ★
 *
 * 返回值结构：
 *   {
 *     fullTrackHistory: [                    ← 完整物流轨迹数组
 *       {
 *         scanStatusIncident: "OKC",         ← 状态码（用于判断签收/取消）
 *         scanStatusIncidentDescription: "DELIVERED TO CUSTOMER",
 *         scanStatusIncidentDateTime: "...",
 *         location: "...",
 *         scanStatusReason: "...",
 *         operatorName: "..."
 *       }, ...
 *     ],
 *     currentScanStatusDescription: "...",   ← 可能不更新，取 fullTrackHistory 最后一条
 *     receiverPhoneNumber: "...",            ← 完整手机号（列表API脱敏，这里不脱敏）
 *     destination: "...",
 *     senderPhoneNumber: "..."
 *   }
 */
async function trackShipment(waybill) {
  const token = await getToken();
  const url = `${TRACK}/trackShipment?waybill=${waybill}`;
  const res = await httpGet(url, { 'access-token': token });

  if (res.status === 401) {
    await login();
    return trackShipment(waybill);
  }

  if (res.status !== 200 || !res.data) {
    console.error(`[GIGL] Track ${waybill} failed:`, res);
    return null;
  }
  return res.data;
}

module.exports = { login, getToken, getShipments, trackShipment };
