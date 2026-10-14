// One calculation is shared by the customer, farmer and courier workflows.
export const farmStatusSql = `CASE WHEN ff.status='cancelled' OR o.status='cancelled' THEN 'cancelled'
 WHEN EXISTS(SELECT 1 FROM external_shipments e WHERE e.order_id=o.id AND e.farm_id=ff.farm_id) THEN COALESCE((SELECT CASE WHEN e.status IN ('picked_up','in_transit') THEN 'in_transit' WHEN e.status IN ('out_for_delivery','delivered') THEN e.status ELSE ff.status END FROM external_shipments e WHERE e.order_id=o.id AND e.farm_id=ff.farm_id),ff.status)
 WHEN o.delivery_mode!='demo' AND NOT EXISTS(SELECT 1 FROM external_shipments e WHERE e.order_id=o.id) AND o.status IN ('out_for_delivery','delivered') THEN o.status
 WHEN d.status='delivered' THEN 'delivered' WHEN d.status='out_for_delivery' THEN 'out_for_delivery'
 WHEN d.status IN ('picked_up','in_transit') THEN 'in_transit' ELSE ff.status END`;
export function progress(db, orderId) {
  const parts = db.prepare(`SELECT ff.farm_id AS farmId,f.name AS farmName,ff.status AS preparationStatus,
    ff.rejection_reason AS rejectionReason,${farmStatusSql} AS status,d.status AS courierStatus,d.tracking_number AS trackingNumber
    FROM farm_fulfillments ff JOIN orders o ON o.id=ff.order_id JOIN farms f ON f.id=ff.farm_id
    LEFT JOIN demo_shipments d ON d.order_id=ff.order_id AND d.farm_id=ff.farm_id WHERE ff.order_id=?`).all(orderId);
  const active=parts.filter(part=>part.status!=='cancelled');
  const statuses=active.map(part=>part.status);
  const status=!active.length?'cancelled':statuses.every(s=>s==='delivered')?'delivered'
    :statuses.some(s=>s==='delivered')?'partially_delivered'
    :statuses.some(s=>s==='out_for_delivery')?'out_for_delivery'
    :statuses.some(s=>s==='in_transit')?'in_transit'
    :statuses.every(s=>['packed','ready_for_pickup'].includes(s))?'packed'
    :statuses.some(s=>s!=='placed')?'confirmed':'placed';
  return {status,parts};
}
export function syncOrder(db, orderId) {
  const row=db.prepare('SELECT status,payment_status FROM orders WHERE id=?').get(orderId);
  if(!row||row.status==='cancelled')return;
  const {status}=progress(db,orderId);
  const stored=['in_transit','partially_delivered'].includes(status)?'out_for_delivery':status;
  // Delivery test events never record a real COD payment.
  db.prepare('UPDATE orders SET status=?,payment_status=? WHERE id=?').run(stored,stored==='cancelled'?'cancelled':row.payment_status,orderId);
}
