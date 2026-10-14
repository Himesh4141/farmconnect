import { randomUUID, createHash } from 'node:crypto';
import { requireSameOrigin, requireUser } from './auth.js';
import { isAdmin } from './admin.js';
import { assertOrderPaid } from './payment-ledger.js';
import { ApiError } from './pricing.js';
import { syncOrder } from './fulfillment.js';
import { audit,controls,transaction } from './admin-support.js';

export const shipmentReference=(orderId,farmId)=>'FC'+createHash('sha256').update(orderId+'|'+farmId).digest('hex').slice(0,30);

export function externalTracking(db, orderId, farmId) {
  const rows = db.prepare(`SELECT e.*,f.name AS farm_name FROM external_shipments e JOIN farms f ON f.id=e.farm_id
    WHERE e.order_id=? AND (? IS NULL OR e.farm_id=?)`).all(orderId, farmId ?? null, farmId ?? null);
  return rows.map(row => ({ id: row.id, orderId: row.order_id, farmId: row.farm_id, farmName: row.farm_name,
    trackingNumber: row.waybill, status: row.status, providerStatus: row.provider_status, revision: 0, isDemo: false,
    createdAt: row.updated_at, updatedAt: row.updated_at, provider: 'Delhivery',
    events: db.prepare('SELECT status,created_at AS createdAt FROM external_shipment_events WHERE shipment_id=? ORDER BY id').all(row.id) }));
}

export async function refreshExternal(db, provider, id) {
  const row = db.prepare('SELECT * FROM external_shipments WHERE id=?').get(id);
  if (!row || !provider) throw new ApiError(503, 'COURIER_NOT_CONFIGURED', 'Courier connection is unavailable.');
  const actual = await provider.track(row.waybill);
  if (actual.reference !== shipmentReference(row.order_id,row.farm_id)) throw new ApiError(409, 'WRONG_SHIPMENT', 'Courier reference does not match this farm order.');
  const mapping = { Manifested: 'pickup_requested', 'Not Picked': 'pickup_requested', 'In Transit': 'in_transit', Pending: 'in_transit', Dispatched: 'out_for_delivery', Delivered: 'delivered' };
  const mapped = actual.statusType==='RT' || actual.statusType==='RTO' ? undefined : actual.status==='Delivered' && actual.statusType!=='DL' ? undefined : mapping[actual.status];
  // Unknown/return/failure states are visible, but never silently treated as successful delivery.
  const rank = ['pickup_requested', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'];
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('SELECT * FROM external_shipments WHERE id=?').get(id);
    const status = mapped && rank.indexOf(mapped) >= rank.indexOf(current.status) ? mapped : current.status;
    db.prepare('UPDATE external_shipments SET status=?,provider_status=?,last_checked_at=?,updated_at=? WHERE id=?').run(status, actual.status.slice(0,100), Date.now(), Date.now(), id);
    db.prepare('INSERT INTO external_shipment_events(shipment_id,status,provider_status,created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING').run(id, status, actual.status.slice(0,100), Date.now());
    syncOrder(db, row.order_id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function mountOperations(app, db, config, provider) {
  const admin = [requireUser(db), (req, _res, next) => {
    if (!isAdmin(db, req.user.id)) throw new ApiError(403, 'ADMIN_REQUIRED', 'Administrator access is required.'); next();
  }];
  app.get('/api/admin/operations', ...admin, (_req, res) => {
    const dispatch = db.prepare(`SELECT ff.order_id AS orderId,ff.farm_id AS farmId,f.name AS farmName,o.address_json,
      d.pickup_address,d.city,d.pincode,d.phone,e.waybill,e.status,e.provider_status AS providerStatus,e.id AS shipmentId,e.last_checked_at AS checkedAt
      FROM farm_fulfillments ff JOIN orders o ON o.id=ff.order_id JOIN farms f ON f.id=ff.farm_id
      LEFT JOIN farm_details d ON d.farm_id=ff.farm_id LEFT JOIN external_shipments e ON e.order_id=ff.order_id AND e.farm_id=ff.farm_id
      WHERE ff.status='ready_for_pickup' AND o.status!='cancelled' AND o.delivery_mode!='demo'
      ORDER BY ff.updated_at DESC LIMIT 100`).all().map(row => ({ ...row, address_json: undefined, address: JSON.parse(row.address_json), reference: shipmentReference(row.orderId,row.farmId) }));
    res.json({ paymentConfigured: Boolean(config.payment), paymentIsTest: config.payment?.isTest ?? false,
      courierConfigured: Boolean(provider), courierMode: config.courierMode, checkoutEnabled: controls(db,config).checkoutEnabled,
      dispatch, areas: db.prepare('SELECT pincode,active FROM delivery_areas ORDER BY pincode').all(),
      payments: db.prepare(`SELECT p.order_id AS orderId,p.amount_paise AS amountPaise,p.state,p.is_test AS isTest,p.created_at AS createdAt,
        COALESCE((SELECT SUM(r.amount_paise) FROM payment_refunds r WHERE r.order_id=p.order_id),0) AS refundPaise
        FROM order_payments p ORDER BY p.created_at DESC LIMIT 100`).all(),
      refunds: db.prepare('SELECT id,order_id AS orderId,amount_paise AS amountPaise,state,last_error AS lastError FROM payment_refunds ORDER BY created_at DESC LIMIT 100').all(),
    });
  });
  app.post('/api/admin/delivery-areas', requireSameOrigin, ...admin, (req, res) => {
    if (!/^[1-9][0-9]{5}$/.test(req.body?.pincode ?? '') || typeof req.body.active !== 'boolean') throw new ApiError(400, 'INVALID_AREA', 'Choose a valid pincode and availability.');
    transaction(db,()=>{
      db.prepare('INSERT INTO delivery_areas(pincode,active) VALUES (?,?) ON CONFLICT(pincode) DO UPDATE SET active=excluded.active').run(req.body.pincode, req.body.active ? 1 : 0);
      audit(db,req.user.id,req.body.active?'delivery_area_enabled':'delivery_area_paused',req.body.pincode);
    });
    res.json({ ok: true });
  });
  app.post('/api/admin/dispatch', requireSameOrigin, ...admin, async (req, res) => {
    if (!provider) throw new ApiError(503, 'COURIER_NOT_CONFIGURED', 'Configure the business courier account first.');
    const { orderId, farmId, waybill } = req.body ?? {};
    if (![orderId, farmId, waybill].every(value => typeof value === 'string' && value.length <= 100)) throw new ApiError(400, 'INVALID_SHIPMENT', 'Check the farm order and tracking number.');
    const part = () => db.prepare(`SELECT ff.status,o.status AS overall,o.delivery_mode FROM farm_fulfillments ff JOIN orders o ON o.id=ff.order_id WHERE ff.order_id=? AND ff.farm_id=?`).get(orderId, farmId);
    const validate = () => {
      const row = part();
      if (!row || row.status !== 'ready_for_pickup' || row.overall === 'cancelled' || row.delivery_mode === 'demo') throw new ApiError(409, 'NOT_READY', 'Only a ready, non-demo farm order can be assigned a live courier.');
      assertOrderPaid(db, orderId);
    };
    validate();
    const actual = await provider.track(waybill);
    if (actual.reference !== shipmentReference(orderId,farmId)) throw new ApiError(409, 'WRONG_SHIPMENT', 'Use the exact Farmconnect reference when creating the courier shipment.');
    db.exec('BEGIN IMMEDIATE');
    let id;
    try {
      validate();
      const existing = db.prepare('SELECT * FROM external_shipments WHERE order_id=? AND farm_id=?').get(orderId, farmId);
      if (existing && existing.waybill !== waybill) throw new ApiError(409, 'SHIPMENT_EXISTS', 'This farm order already has a courier shipment.');
      if (db.prepare('SELECT 1 FROM external_shipments WHERE waybill=? AND (order_id!=? OR farm_id!=?)').get(waybill, orderId, farmId)) throw new ApiError(409, 'WAYBILL_USED', 'That waybill already belongs to another shipment.');
      id = existing?.id ?? randomUUID();
      if (!existing) db.prepare('INSERT INTO external_shipments(id,order_id,farm_id,provider,waybill,updated_at,created_by) VALUES (?,?,?,?,?,?,?)').run(id, orderId, farmId, 'delhivery', waybill, Date.now(), req.user.id);
      if (!existing) audit(db,req.user.id,'courier_connected',orderId+' / '+farmId,'Verified courier reference');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    await refreshExternal(db, provider, id);
    res.json({ ok: true });
  });
  app.post('/api/admin/dispatch/:id/refresh', requireSameOrigin, ...admin, async (req, res) => {
    await refreshExternal(db, provider, req.params.id); res.json({ ok: true });
  });
}
