import { paging,choice } from './admin-support.js';
import { paymentSummary } from './payment-ledger.js';
import { progress } from './fulfillment.js';
import { profileFor } from './profiles.js';
import { createHash, randomUUID } from 'node:crypto';
import { ApiError, quoteCart } from './pricing.js';
import { requireUser, requireSameOrigin } from './auth.js';
export function addressFrom(body) {
 const source = body?.address;
 if (!source || typeof source !== 'object') throw new ApiError(400, 'INVALID_ADDRESS', 'Enter your delivery address.');
 const address = {};
 for (const [field, min, max] of [['name',2,80],['phone',10,10],['line',5,200],['city',2,80],['pincode',6,6]]) {
  const value = typeof source[field] === 'string' ? source[field].trim() : '';
  if (value.length < min || value.length > max) throw new ApiError(400,'INVALID_ADDRESS',`Check the delivery ${field}.`);
  address[field] = value;
 }
 if (!/^[6-9][0-9]{9}$/.test(address.phone)) throw new ApiError(400,'INVALID_PHONE','Enter a 10-digit Indian mobile number.');
 if (!/^[0-9]{6}$/.test(address.pincode)) throw new ApiError(400,'INVALID_PINCODE','Enter a six-digit pincode.');
 return address;
}
export function serialize(db, row) {
 const journey=progress(db,row.id);
 const payment=paymentSummary(db,row.id);
 const rejected=db.prepare("SELECT COALESCE(SUM(i.line_total_paise),0) AS amount FROM order_items i JOIN farm_fulfillments ff ON ff.order_id=i.order_id AND ff.farm_id=i.farm_id WHERE i.order_id=? AND ff.status='cancelled'").get(row.id).amount;
 return {
  id:row.id, farmerManaged:Boolean(db.prepare("SELECT 1 FROM farm_fulfillments ff JOIN account_profiles ap ON ap.farm_id=ff.farm_id WHERE ff.order_id=? LIMIT 1").get(row.id)), purchaseKind:row.purchase_kind, businessName:row.business_name, fulfillments:journey?.parts??db.prepare("SELECT ff.farm_id AS farmId, f.name AS farmName, ff.status, ff.rejection_reason AS rejectionReason FROM farm_fulfillments ff JOIN farms f ON f.id=ff.farm_id WHERE ff.order_id=?").all(row.id), address:JSON.parse(row.address_json), subtotalPaise:row.subtotal_paise,
  deliveryFeePaise:row.delivery_fee_paise, originalTotalPaise:row.subtotal_paise + row.delivery_fee_paise, cancelledPaise:rejected, totalPaise:row.status==="cancelled"?0:row.subtotal_paise-rejected+row.delivery_fee_paise,
  status:journey?.status??row.status,deliveryMode:row.delivery_mode, paymentMethod:payment?'razorpay':row.payment_method, paymentStatus:payment?.state==='paid'?'paid':row.payment_status, payment, createdAt:row.created_at,
  items:db.prepare('SELECT product_id AS productId, farm_id AS farmId, farm_name AS farmName, name, unit, quantity, sale_mode AS saleMode,line_total_paise AS lineTotalPaise,unit_price_paise AS unitPricePaise FROM order_items WHERE order_id = ? ORDER BY product_id').all(row.id),
 };
}
export function placeOrder(db, userId, body, deliveryMode='unconnected', paymentConfig=null) {
 if(profileFor(db,userId).accountType==='delivery')throw new ApiError(403,'BUYER_REQUIRED','Use a separate buyer account for purchases. This account is for delivery work.');
 const address = addressFrom(body);
 const method=body.paymentMethod??'cod';
 if(!['cod','razorpay'].includes(method))throw new ApiError(400,'INVALID_PAYMENT_METHOD','Choose an available payment method.');
 if(method==='razorpay'&&!paymentConfig)throw new ApiError(503,'PAYMENT_NOT_CONFIGURED','Online payments are not configured yet.');
 const key = body?.requestKey;
 if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(key)) throw new ApiError(400,'INVALID_REQUEST_KEY','Refresh checkout and try again.');
 if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) throw new ApiError(400,'INVALID_CART','Add between 1 and 50 products.');
 if (!Number.isSafeInteger(body.expectedSubtotalPaise) || body.expectedSubtotalPaise < 1) throw new ApiError(400,'INVALID_TOTAL','Refresh the basket prices.');
 // Only intentional checkout fields determine retry identity; client-supplied prices never set the charge.
 const normalized = {address, items:body.items.map(item => ({productId:item?.productId,quantity:item?.quantity})).sort((a,b)=>String(a.productId).localeCompare(String(b.productId))),expectedSubtotalPaise:body.expectedSubtotalPaise};
 if(method==='razorpay')normalized.paymentMethod=method;
 const hash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
 db.exec('BEGIN IMMEDIATE');
 try {
  const existing = db.prepare('SELECT * FROM orders WHERE user_id = ? AND request_key = ?').get(userId,key);
  if (existing) {
   if (existing.request_hash !== hash) throw new ApiError(409,'REQUEST_CHANGED','This checkout request was already used. Open a new checkout.');
   const order = serialize(db,existing); db.exec('COMMIT'); return {order,replayed:true};
  }
  if(method==='razorpay'&&db.prepare("SELECT COUNT(*) AS n FROM order_payments p JOIN orders o ON o.id=p.order_id WHERE o.user_id=? AND o.status!='cancelled' AND p.state IN ('creating','pending','review')").get(userId).n>=3)throw new ApiError(429,'PENDING_ORDER_LIMIT','Complete or cancel an unpaid order before starting another.');
  if(db.prepare('SELECT checkout_paused FROM store_controls WHERE id=1').get().checkout_paused)throw new ApiError(503,'CHECKOUT_UNAVAILABLE','Ordering is temporarily paused. Existing orders are still being handled.');
  if (!db.prepare('SELECT 1 FROM delivery_areas WHERE pincode = ? AND active = 1').get(address.pincode)) throw new ApiError(400,'AREA_UNAVAILABLE','Delivery is not available for this pincode. Choose a supported area.');
  const quote = quoteCart(db,body);
  if (quote.subtotalPaise !== body.expectedSubtotalPaise) throw new ApiError(409,'PRICE_CHANGED','Prices have changed. Return to your basket and refresh prices before placing the order.');
  const id = randomUUID();
  db.prepare("INSERT INTO orders(id,user_id,request_key,request_hash,address_json,subtotal_paise,delivery_fee_paise,status,payment_method,payment_status,created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 'placed', 'cod', 'pending', ?)").run(id,userId,key,hash,JSON.stringify(address),quote.subtotalPaise,Date.now());
  const buyer=profileFor(db,userId);
  db.prepare('UPDATE orders SET purchase_kind=?,business_name=?,delivery_mode=? WHERE id=?').run(buyer.accountType==='bulk_buyer'?'bulk_buyer':'consumer',buyer.businessName,deliveryMode,id);
  for (const item of quote.items) {
   const updated = db.prepare("UPDATE products SET stock = CASE WHEN sale_mode='pack' THEN stock - ? ELSE stock END,stock_grams=CASE WHEN sale_mode='weight' THEN stock_grams - ? ELSE stock_grams END, revision=revision+1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND active = 1 AND CASE WHEN sale_mode='weight' THEN stock_grams ELSE stock END >= ?").run(item.quantity,item.quantity,item.productId,item.quantity);
   if (!updated.changes) throw new ApiError(409,'INSUFFICIENT_STOCK','Stock has changed. Refresh your basket.');
   const farm=db.prepare('SELECT f.id,f.name FROM farms f JOIN products p ON p.farm_id=f.id WHERE p.id=?').get(item.productId);
   db.prepare('INSERT INTO order_items(order_id,product_id,name,unit,quantity,unit_price_paise,farm_id,farm_name,sale_mode,line_total_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id,item.productId,item.name,item.unit,item.quantity,item.unitPricePaise,farm.id,farm.name,item.saleMode,item.lineTotalPaise);
   db.prepare("INSERT INTO farm_fulfillments(order_id,farm_id,status,updated_at) VALUES (?,?,'placed',?) ON CONFLICT DO NOTHING").run(id,farm.id,Date.now());
  }
  if(method==='razorpay')db.prepare('INSERT INTO order_payments(order_id,amount_paise,expires_at,created_at,updated_at,is_test) VALUES (?,?,?,?,?,?)').run(id,quote.subtotalPaise,Date.now()+15*60000,Date.now(),Date.now(),paymentConfig.isTest?1:0);
  const order = serialize(db,db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
  db.exec('COMMIT'); return {order,replayed:false};
 } catch(error) {db.exec('ROLLBACK');throw error;}
}
export function mountOrders(app,db,{courierMode='disabled',payment=null,checkoutEnabled=true}={}) {
 app.get('/api/orders',requireUser(db),(req,res)=> {
  const p=paging(req.query),status=choice(req.query.status,['active','delivered','cancelled']);
  const where=`FROM orders o WHERE o.user_id=? AND (?='' OR (?='active' AND o.status NOT IN ('delivered','cancelled')) OR o.status=?) AND (?='' OR instr(lower(o.id),lower(?))>0 OR EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=o.id AND instr(lower(i.name||' '||i.farm_name),lower(?))>0))`;
  const args=[req.user.id,status,status,status,p.q,p.q,p.q];
  const rows=db.prepare('SELECT o.* '+where+' ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?').all(...args,p.limit,p.offset);
  res.json({orders:rows.map(row=>serialize(db,row)),total:db.prepare('SELECT count(*) n '+where).get(...args).n,page:p.page,limit:p.limit});
 });
 app.get('/api/orders/:id',requireUser(db),(req,res)=> {
  const row = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id,req.user.id);
  if(!row) throw new ApiError(404,'ORDER_NOT_FOUND','Order not found.');
  res.json({order:serialize(db,row)});
 });
 app.post('/api/orders',requireSameOrigin,requireUser(db),(req,res)=> {
  if(!checkoutEnabled)throw new ApiError(503,'CHECKOUT_UNAVAILABLE','Ordering is temporarily unavailable. Please check back soon.');
  const result = placeOrder(db,req.user.id,req.body,courierMode==='demo'?'demo':'unconnected',payment);
  res.status(result.replayed ? 200 : 201).json(result);
 });
}




