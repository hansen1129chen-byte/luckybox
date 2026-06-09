// One-time full GIGL sync — pulls all shipments from May 15 2026
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const gigl = require('../services/gigl');
const p = require('../config/db');

function toMySQL(d) {
  if (!d) return null;
  const s = typeof d === 'string' ? d : new Date(d).toISOString();
  return s.replace('T', ' ').replace('Z', '').slice(0, 19);
}

(async () => {
  const startDate = '2026-05-15';
  const endDate = new Date().toISOString().slice(0, 10);
  console.log('[Sync] Pulling', startDate, '~', endDate);

  const shipments = await gigl.getShipments(startDate, endDate);
  console.log('[Sync] Got', shipments.length, 'shipments');

  for (const s of shipments) {
    await p.query(
      `INSERT INTO gigl_shipments (waybill, receiver_name, receiver_phone, grand_total, payment_status,
        shipment_scan_status, current_scan_status, is_cancelled, is_delivered, date_created, destination)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
       receiver_name=VALUES(receiver_name), receiver_phone=VALUES(receiver_phone),
       current_scan_status=VALUES(current_scan_status), is_delivered=VALUES(is_delivered),
       is_cancelled=VALUES(is_cancelled), destination=VALUES(destination)`,
      [s.waybill, s.receiverName, s.receiverPhone, s.grandTotal, s.paymentStatus,
       s.shipmentScanStatus, s.currentScanStatus, s.isCancelled ? 1 : 0, s.isDelivered ? 1 : 0,
       toMySQL(s.dateCreated), s.destination]
    );

    try {
      const track = await gigl.trackShipment(s.waybill);
      const history = track?.fullTrackHistory || [];
      if (history.length > 0) {
        for (const e of history) {
          await p.query(
            `INSERT IGNORE INTO gigl_tracking_events (waybill, event_time, location, status_code, status_description, status_reason, operator_name)
             VALUES (?,?,?,?,?,?,?)`,
            [s.waybill, toMySQL(e.scanStatusIncidentDateTime), e.location || '',
             e.scanStatusIncident || '', e.scanStatusIncidentDescription || '',
             e.scanStatusReason || '', e.operatorName || '']
          );
        }
        const codes = [...new Set(history.map(e => e.scanStatusIncident))].join(',');
        console.log('  ' + s.waybill + ' - ' + history.length + ' events [' + codes + ']');
      }
    } catch (e) {
      console.log('  ' + s.waybill + ' - track error: ' + e.message);
    }
  }

  // Update shipping status from tracking_events
  const [dd] = await p.query(
    "UPDATE shipping_records sr JOIN gigl_shipments gs ON gs.waybill = sr.gig_tracking SET sr.status = 'delivered' WHERE EXISTS (SELECT 1 FROM gigl_tracking_events te WHERE te.waybill = gs.waybill AND te.status_code IN ('OKC','OKT')) AND sr.status != 'delivered'"
  );
  console.log('[Sync] Status -> delivered: ' + dd.affectedRows);

  const [rt] = await p.query(
    "UPDATE shipping_records sr JOIN gigl_shipments gs ON gs.waybill = sr.gig_tracking SET sr.status = 'returned' WHERE EXISTS (SELECT 1 FROM gigl_tracking_events te WHERE te.waybill = gs.waybill AND te.status_code IN ('SSC','DFA')) AND sr.status NOT IN ('delivered','returned')"
  );
  console.log('[Sync] Status -> returned: ' + rt.affectedRows);

  const [s] = await p.query('SELECT status, COUNT(*) c FROM shipping_records GROUP BY status');
  console.log('[Sync] Final status: ' + JSON.stringify(s));

  console.log('[Sync] === Done ===');
  await p.end();
  process.exit(0);
})().catch(e => { console.error(e); p.end(); process.exit(1); });
