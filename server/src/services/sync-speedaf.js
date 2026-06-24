const pool = require('../config/db');
const speedaf = require('./speedaf');

let timer = null;
let isRunning = false;

async function syncActiveShipments() {
  if (isRunning) return;
  isRunning = true;

  try {
    const [rows] = await pool.query(
      "SELECT sr.gig_tracking AS waybill FROM shipping_records sr WHERE sr.delivery_method = 'speedaf' AND sr.status IN ('pending','in_transit','returning') AND sr.gig_tracking != ''"
    );

    if (rows.length === 0) { console.log('[Speedaf Sync] No active shipments'); return; }

    console.log(`[Speedaf Sync] Syncing ${rows.length} active shipment(s)...`);
    let updated = 0;

    for (const row of rows) {
      try {
        const result = await speedaf.trackQuery(row.waybill);
        const tracks = result.data || [];
        if (tracks.length === 0) continue;

        for (const t of tracks) {
          const eventTime = t.time || t.scanTime || '';
          const statusCode = String(t.action || t.scanStatus || '');
          if (!eventTime) continue;
          await pool.query(
            `INSERT IGNORE INTO speedaf_tracking_events (waybill, event_time, location, status_code, status_description, operator_name) VALUES (?, ?, ?, ?, ?, ?)`,
            [row.waybill, eventTime, t.location || '', statusCode, (t.actionName || t.description || ''), (t.operatorName || '')]
          ).catch(() => {});
        }

        const last = tracks[tracks.length - 1];
        const code = String(last.action || last.scanStatus || '');
        const STATUS_MAP = { '10': 'pending', '1': 'in_transit', '2': 'in_transit', '3': 'in_transit', '4': 'in_transit', '5': 'delivered', '-710': 'returning', '730': 'returned', '-10': 'cancelled' };
        const newStatus = STATUS_MAP[code];
        const desc = (last.actionName || last.description || '') + (last.location ? ' - ' + last.location : '');

        if (newStatus) {
          await pool.query(
            "UPDATE shipping_records SET status = ?, updated_at = NOW(), updated_by = 'SpeedafSync' WHERE gig_tracking = ?",
            [newStatus, row.waybill]
          );
        }

        await pool.query(
          `INSERT INTO speedaf_shipments (waybill, current_status, current_status_desc, tracking_raw, last_synced_at) VALUES (?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE current_status = VALUES(current_status), current_status_desc = VALUES(current_status_desc), tracking_raw = VALUES(tracking_raw), last_synced_at = NOW()`,
          [row.waybill, newStatus || code, desc, JSON.stringify(tracks)]
        );

        updated++;
        await new Promise(r => setTimeout(r, 500));
      } catch (e) { console.error(`[Speedaf Sync] ${row.waybill}:`, e.message); }
    }

    console.log(`[Speedaf Sync] Done — ${updated}/${rows.length} updated`);
  } catch (err) { console.error('[Speedaf Sync] Error:', err.message); }
  finally { isRunning = false; }
}

function isBusinessHours() {
  // Nigeria (UTC+1) 9:00–23:00 → UTC 8:00–22:00 → China (UTC+8) 16:00–06:00(+1)
  const now = new Date();
  const chinaHour = now.getHours();
  return chinaHour >= 16 || chinaHour < 6;
}

function startSyncScheduler() {
  if (timer) return;
  const TWO_HOURS = 2 * 60 * 60 * 1000;

  function scheduleNext() {
    timer = setTimeout(() => {
      if (isBusinessHours()) { syncActiveShipments(); }
      scheduleNext();
    }, TWO_HOURS);
  }

  // First run: if in business hours, run in 2min; otherwise wait until next slot
  const firstDelay = isBusinessHours() ? 2 * 60 * 1000 : TWO_HOURS;
  timer = setTimeout(() => {
    if (isBusinessHours()) syncActiveShipments();
    scheduleNext();
  }, firstDelay);
  console.log('[Speedaf Sync] Scheduler started — every 2h, 9am–11pm Nigeria time');
}

function stopSyncScheduler() { if (timer) { clearTimeout(timer); clearInterval(timer); timer = null; } }

module.exports = { syncActiveShipments, startSyncScheduler, stopSyncScheduler };
