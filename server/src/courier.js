import { externalTracking } from './operations.js';
import { randomUUID } from 'node:crypto';
import { requireSameOrigin, requireUser } from './auth.js';
import { ApiError } from './pricing.js';
import { syncOrder } from './fulfillment.js';

const nextStatus = { pickup_requested: 'picked_up', picked_up: 'in_transit', in_transit: 'out_for_delivery', out_for_delivery: 'delivered' };
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function fulfillment(db, orderId, farmId) {
  const row = db.prepare(`SELECT ff.*,o.status AS order_status,o.address_json,f.name AS farm_name
    FROM farm_fulfillments ff JOIN orders o ON o.id=ff.order_id JOIN farms f ON f.id=ff.farm_id
    WHERE ff.order_id=? AND ff.farm_id=?`).get(orderId, farmId);
  if (!row) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  return row;
}
function cancelled(part) { return part.status === 'cancelled' || part.order_status === 'cancelled'; }
export function ensureDemoPickup(db,orderId,farmId,actorId) {
  const part=fulfillment(db,orderId,farmId);
  if(cancelled(part)||part.status!=='ready_for_pickup')throw new ApiError(409,'NOT_READY','Mark this farm order ready for pickup first.');
  const existing=db.prepare('SELECT * FROM demo_shipments WHERE order_id=? AND farm_id=?').get(orderId,farmId);
  if(existing)return {shipment:serialize(db,existing,part),created:false};
  const pickup=db.prepare('SELECT phone,pickup_address,city,pincode FROM farm_details WHERE farm_id=?').get(farmId);
  if(!pickup?.phone||!pickup.pickup_address||!pickup.city||!pickup.pincode)throw new ApiError(409,'PICKUP_REQUIRED','Complete your pickup details in My farm first.');
  const id=randomUUID(),now=Date.now();
  db.prepare("INSERT INTO demo_shipments(id,order_id,farm_id,tracking_number,status,pickup_json,created_at,updated_at) VALUES (?,?,?,?,'pickup_requested',?,?,?)")
    .run(id,orderId,farmId,'DEMO-'+id.toUpperCase(),JSON.stringify(pickup),now,now);
  db.prepare("INSERT INTO demo_shipment_events(shipment_id,actor_id,status,created_at) VALUES (?,?,'pickup_requested',?)").run(id,actorId,now);
  db.prepare("UPDATE orders SET delivery_mode='demo' WHERE id=?").run(orderId);
  syncOrder(db,orderId);
  return {shipment:serialize(db,db.prepare('SELECT * FROM demo_shipments WHERE id=?').get(id),part),created:true};
}
function serialize(db, row, part) {
  return {
    id: row.id, orderId: row.order_id, farmId: row.farm_id, farmName: part.farm_name,
    trackingNumber: row.tracking_number, status: cancelled(part) ? 'cancelled' : row.status,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, isDemo: true,
    events: db.prepare('SELECT status,created_at AS createdAt FROM demo_shipment_events WHERE shipment_id=? ORDER BY id').all(row.id),
  };
}
export function mountCourier(app, db, mode = 'disabled') {
  if (!['disabled', 'demo', 'delhivery'].includes(mode)) throw new Error('COURIER_MODE must be disabled or demo.');
  if (mode === 'demo' && process.env.NODE_ENV === 'production') throw new Error('Courier demo is disabled in production.');
  const enabled = mode === 'demo';
  const requireDemo = (_req, _res, next) => {
    if (!enabled) throw new ApiError(503, 'COURIER_NOT_CONFIGURED', 'Courier booking is unavailable. No pickup was requested. Enable the local delivery demo to test.');
    next();
  };
  const farmer = [requireUser(db), (req, _res, next) => {
    if (req.user.requestedAccountType !== 'farmer' || !req.user.farmId || req.user.accessStatus !== 'approved')
      throw new ApiError(403, 'FARMER_REQUIRED', 'An approved farmer account is required.');
    next();
  }];
  const delivery = [requireUser(db), (req, _res, next) => {
    if (req.user.accountType !== 'delivery' || req.user.accessStatus !== 'approved') throw new ApiError(403, 'DELIVERY_REQUIRED', 'An approved delivery-partner account is required.');
    next();
  }];
  app.get('/api/farmer/shipments', ...farmer, (req, res) => {
    const rows = db.prepare(`SELECT ff.order_id FROM farm_fulfillments ff JOIN orders o ON o.id=ff.order_id
      WHERE ff.farm_id=? AND ((ff.status IN ('packed','ready_for_pickup') AND o.status!='cancelled')
      OR EXISTS(SELECT 1 FROM demo_shipments d WHERE d.order_id=ff.order_id AND d.farm_id=ff.farm_id))
      ORDER BY ff.updated_at DESC,ff.order_id LIMIT 100`).all(req.user.farmId);
    const shipments = rows.map(({ order_id }) => {
      const part = fulfillment(db, order_id, req.user.farmId);
      const address = JSON.parse(part.address_json);
      const demo = db.prepare('SELECT * FROM demo_shipments WHERE order_id=? AND farm_id=?').get(order_id, req.user.farmId);
      return { orderId: order_id, preparationStatus: cancelled(part) ? 'cancelled' : part.status, updatedAt: part.updated_at,
        destination: { city: address.city, pincode: address.pincode }, courierStatus: 'not_connected', trackingNumber: null,
        events: db.prepare('SELECT status,created_at AS createdAt FROM farm_events WHERE order_id=? AND farm_id=? ORDER BY created_at,id').all(order_id, req.user.farmId),
        external:externalTracking(db,order_id,req.user.farmId)[0]??null, demo: demo ? serialize(db, demo, part) : null };
    });
    res.json({ courierAvailable: mode==='delhivery', demoAvailable: enabled, shipments });
  });
  app.post('/api/farmer/shipments/:id/book', requireSameOrigin, ...farmer, (req, _res, next) => {
    fulfillment(db, req.params.id, req.user.farmId); next();
  }, requireDemo, (req, res) => {
    if (req.body?.confirmDemo !== true) throw new ApiError(400, 'DEMO_CONFIRMATION_REQUIRED', 'Confirm this is a test pickup. No courier will arrive.');
    const result = transaction(db, () => ensureDemoPickup(db,req.params.id,req.user.farmId,req.user.id));
    res.status(result.created ? 201 : 200).json(result);
  });
  app.get('/api/delivery/shipments', ...delivery, (req, res) => {
    const rows=db.prepare(`SELECT d.* FROM demo_shipments d JOIN orders o ON o.id=d.order_id JOIN farm_fulfillments ff ON ff.order_id=d.order_id AND ff.farm_id=d.farm_id
      WHERE d.assigned_to=? OR (d.assigned_to IS NULL AND d.status='pickup_requested' AND o.status!='cancelled' AND ff.status!='cancelled')
      ORDER BY d.updated_at DESC,d.id LIMIT 100`).all(req.user.id);
    const shipments=rows.map(row=>{
      const part=fulfillment(db,row.order_id,row.farm_id),address=JSON.parse(part.address_json);
      const assigned=row.assigned_to===req.user.id;
      return {...serialize(db,row,part),assigned,destination:assigned?address:{city:address.city,pincode:address.pincode},pickup:assigned?JSON.parse(row.pickup_json):null};
    });
    res.json({demoAvailable:enabled,shipments});
  });
  app.post('/api/delivery/shipments/:id/claim',requireSameOrigin,...delivery,requireDemo,(req,res)=>{
    const shipment=transaction(db,()=>{
      const row=db.prepare('SELECT * FROM demo_shipments WHERE id=?').get(req.params.id);
      if(!row)throw new ApiError(404,'SHIPMENT_NOT_FOUND','Pickup not found.');
      const part=fulfillment(db,row.order_id,row.farm_id);
      if(cancelled(part)||row.status!=='pickup_requested')throw new ApiError(409,'PICKUP_UNAVAILABLE','This pickup is no longer available.');
      if(row.assigned_to===req.user.id)return serialize(db,row,part);
      if(row.assigned_to||row.revision!==req.body?.revision)throw new ApiError(409,'PICKUP_CLAIMED','Another partner accepted this pickup or it changed. Refresh the list.');
      db.prepare('UPDATE demo_shipments SET assigned_to=?,revision=revision+1,updated_at=? WHERE id=?').run(req.user.id,Date.now(),row.id);
      db.prepare("INSERT INTO demo_shipment_events(shipment_id,actor_id,status,created_at) VALUES (?,?,'partner_assigned',?)").run(row.id,req.user.id,Date.now());
      return serialize(db,db.prepare('SELECT * FROM demo_shipments WHERE id=?').get(row.id),part);
    });res.json({shipment});
  });
  app.post('/api/delivery/shipments/:id/advance', requireSameOrigin, ...delivery, requireDemo, (req, res) => {
    const shipment = transaction(db, () => {
      const row = db.prepare('SELECT * FROM demo_shipments WHERE id=?').get(req.params.id);
      if (!row) throw new ApiError(404, 'SHIPMENT_NOT_FOUND', 'Test shipment not found.');
      if (row.assigned_to !== req.user.id) throw new ApiError(404, 'SHIPMENT_NOT_FOUND', 'This pickup is not assigned to you.');
      const part = fulfillment(db, row.order_id, row.farm_id);
      if (cancelled(part)) throw new ApiError(409, 'ORDER_CANCELLED', 'This order was cancelled. Delivery simulation is stopped.');
      if (row.revision !== req.body?.revision) throw new ApiError(409, 'SHIPMENT_CHANGED', 'Tracking changed. Refresh before continuing.');
      if (!nextStatus[row.status] || req.body?.status !== nextStatus[row.status]) throw new ApiError(409, 'INVALID_TRANSITION', 'Complete the next delivery step in order.');
      const now = Date.now();
      db.prepare('UPDATE demo_shipments SET status=?,revision=revision+1,updated_at=? WHERE id=?').run(req.body.status, now, row.id);
      db.prepare('INSERT INTO demo_shipment_events(shipment_id,actor_id,status,created_at) VALUES (?,?,?,?)').run(row.id, req.user.id, req.body.status, now);
      syncOrder(db,row.order_id);
      return serialize(db, db.prepare('SELECT * FROM demo_shipments WHERE id=?').get(row.id), part);
    });
    res.json({ shipment });
  });
  app.get('/api/orders/:id/tracking', requireUser(db), (req, res) => {
    if (!db.prepare('SELECT 1 FROM orders WHERE id=? AND user_id=?').get(req.params.id, req.user.id)) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    const shipments = db.prepare('SELECT * FROM demo_shipments WHERE order_id=? ORDER BY created_at,id').all(req.params.id)
      .map(row => serialize(db, row, fulfillment(db, row.order_id, row.farm_id)));
    res.json({ courierAvailable: mode==='delhivery', demoAvailable: enabled, shipments:[...shipments,...externalTracking(db,req.params.id)] });
  });
}
