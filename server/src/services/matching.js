/**
 * Shared matching helpers for GIGL ↔ local order matching.
 * Used by both sync-gigl.js (auto-match) and routes/gigl.js (match-suggestions).
 */

/**
 * Extract last N digits from a phone number, stripping all non-digits.
 */
function lastDigits(phone, n = 4) {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-n);
}

/**
 * Extract last 10 digits — matches Nigerian core mobile number.
 * Handles both 0XXXXXXXXXX (11 digits) and 234XXXXXXXXXX (13 digits).
 */
function last10Digits(phone) {
  return lastDigits(phone, 10);
}

/**
 * Normalize a name: lowercase, trim, collapse whitespace.
 */
function normName(name) {
  return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Check if two names are a fuzzy match.
 */
function nameMatches(localName, giglName) {
  const a = normName(localName);
  const b = normName(giglName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  if (a.split(' ')[0] === b.split(' ')[0]) return true;
  return false;
}

/**
 * Score a candidate match between a local order row and a GIGL shipment.
 * Higher score = better match. Used for ranking multiple candidates.
 */
function scoreCandidate(localRow, giglShipment) {
  let score = 0;
  const localName = normName(localRow.customer_name || '');
  const giglName = normName(giglShipment.receiver_name || '');

  // Name quality
  if (giglName === localName) score += 10;
  else if (giglName.includes(localName) || localName.includes(giglName)) score += 7;
  else score += 5;

  // Phone match (assumed already verified by hard filter)
  score += 10;

  // Date proximity
  const giglDate = giglShipment.date_created ? new Date(giglShipment.date_created) : null;
  const localDate = localRow.order_created_at ? new Date(localRow.order_created_at) : null;
  if (giglDate && localDate) {
    const diffDays = Math.abs((giglDate - localDate) / (1000 * 60 * 60 * 24));
    if (diffDays <= 1) score += 10;
    else if (diffDays <= 2) score += 7;
    else if (diffDays <= 3) score += 4;
    else if (diffDays <= 7) score += 1;
  }

  // Amount proximity
  const giglAmt = Number(giglShipment.grand_total || 0);
  const localAmt = Number(localRow.actual_amount || localRow.total_amount || 0);
  if (giglAmt > 0 && localAmt > 0) {
    const ratio = Math.max(giglAmt, localAmt) / Math.min(giglAmt, localAmt);
    if (ratio <= 1.1) score += 5;
    else if (ratio <= 1.3) score += 3;
    else if (ratio <= 1.5) score += 1;
  }

  return score;
}

/**
 * ══════════════════ 判断签收 ══════════════════
 *
 * ★ 数据来源：GIGL API trackShipment 返回的 trackData（实时 API 响应）
 * ★ 不用 gigl_shipments.is_delivered 字段（不可信）
 *
 * 判断逻辑：
 *   1. 先检查 currentScanStatusDescription 是否包含 DELIVERED 或 DLV
 *   2. 再遍历 fullTrackHistory[] 每个事件，检查 scanStatusIncident 是否包含 DELIVERED 或状态码为 DLV
 *   3. 任一命中就返回 true
 *
 * 对应 GIGL 状态码：OKC（送达到客户）、OKT（终端自提）
 */
function isDelivered(trackData) {
  if (!trackData) return false;
  const desc = (trackData.currentScanStatusDescription || '').toUpperCase();
  if (desc.includes('DELIVERED') || desc.includes('DLV')) return true;
  const history = trackData.fullTrackHistory || [];
  return history.some(h => {
    const s = (h.status || '').toUpperCase();
    const d = (h.scanStatusIncident || '').toUpperCase();
    return s === 'DLV' || d.includes('DELIVERED');
  });
}

/**
 * ══════════════════ 判断取消 ══════════════════
 *
 * ★ 数据来源：GIGL API trackShipment 返回的 trackData（实时 API 响应）
 * ★ 不用 gigl_shipments.is_cancelled 字段（GIGL API 的 isCancelled 永远返回 false）
 *
 * 判断逻辑：
 *   1. 遍历 fullTrackHistory[] 每个事件
 *   2. 检查 scanStatusIncident 是否包含 CANCELLED 或状态码为 SSC
 *   3. 任一命中就返回 true
 *
 * 对应 GIGL 状态码：SSC（已取消）
 */
function isCancelled(trackData) {
  if (!trackData) return false;
  const history = trackData.fullTrackHistory || [];
  return history.some(h => {
    const s = (h.status || '').toUpperCase();
    const d = (h.scanStatusIncident || '').toUpperCase();
    return s === 'SSC' || d.includes('CANCELLED');
  });
}

module.exports = { lastDigits, last10Digits, normName, nameMatches, scoreCandidate, isDelivered, isCancelled };
