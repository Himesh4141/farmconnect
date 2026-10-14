import { assertOrderPaid, queueRefund } from './payment-ledger.js';
import { ApiError } from './pricing.js';
import { requireSameOrigin, requireUser } from './auth.js';
import { serialize } from './orders.js';
import { paging,choice,audit,reasonFrom,transaction } from './admin-support.js';
export function isAdmin(db,id){return Boolean(db.prepare('SELECT 1 FROM admin_users WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM delivery_partners WHERE user_id=?)').get(id,id));}
export function changeOrder(db,id,userId,body,admin=false){
 const status=body?.status;
 if(typeof status!=='string'||typeof body?.expectedStatus!=='string')throw new ApiError(400,'INVALID_STATUS','Choose a valid order action.');
 db.exec('BEGIN IMMEDIATE');
 try{
  const row=admin?db.prepare('SELECT * FROM orders WHERE id=?').get(id):db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(id,userId);
  if(!row)throw new ApiError(404,'ORDER_NOT_FOUND','Order not found.');
  if(!admin&&status!=='cancelled')throw new ApiError(403,'NOT_ALLOWED','Customers can only cancel unconfirmed orders.');
  if(row.status===status){const order=serialize(db,row);db.exec('COMMIT');return order;}
  const reason=admin&&status==='cancelled'?reasonFrom(body):'';
  if(row.status!==body.expectedStatus)throw new ApiError(409,'STATUS_CHANGED','Order status changed. Refresh and try again.');
  if(admin&&status!=='cancelled'&&db.prepare("SELECT 1 FROM farm_fulfillments ff JOIN account_profiles ap ON ap.farm_id=ff.farm_id WHERE ff.order_id=? LIMIT 1").get(id))throw new ApiError(409,'FARMER_MANAGED','Preparation is managed by each farmer. Pickup and delivery require a courier integration.');
  const next={placed:'confirmed',confirmed:'packed',packed:'out_for_delivery',out_for_delivery:'delivered'};
  const cancellable=admin?['placed','confirmed','packed']:['placed'];
  if(status==='cancelled'?!cancellable.includes(row.status):!admin||next[row.status]!==status)throw new ApiError(409,'INVALID_TRANSITION','This action is no longer available. Refresh the order.');
  if(status!=='cancelled')assertOrderPaid(db,id);
  if(status==='delivered'&&body.cashCollected!==true)throw new ApiError(400,'CASH_CONFIRMATION_REQUIRED','Confirm that cash was collected before marking delivered.');
  if(status==='cancelled'){
   if(db.prepare('SELECT 1 FROM external_shipments WHERE order_id=?').get(id))throw new ApiError(409,'COURIER_ASSIGNED','A real courier shipment is assigned. Contact support to stop it before inventory or payment is changed.');
   if(db.prepare("SELECT 1 FROM demo_shipments WHERE order_id=? AND status IN ('picked_up','in_transit','out_for_delivery','delivered') LIMIT 1").get(id))throw new ApiError(409,'ALREADY_COLLECTED','A delivery partner has collected part of this order. Cancellation and automatic restocking are no longer available.');

   for(const item of db.prepare("SELECT product_id,quantity FROM order_items WHERE order_id=? AND farm_id NOT IN (SELECT farm_id FROM farm_fulfillments WHERE order_id=order_items.order_id AND status='cancelled')").all(id)){
    const result=db.prepare("UPDATE products SET stock=CASE WHEN sale_mode='pack' THEN stock+? ELSE stock END,stock_grams=CASE WHEN sale_mode='weight' THEN stock_grams+? ELSE stock_grams END, revision=revision+1 WHERE id=? AND CASE WHEN sale_mode='weight' THEN stock_grams+?<=1000000000 ELSE stock+?<=1000000 END").run(item.quantity,item.quantity,item.product_id,item.quantity,item.quantity);
    if(!result.changes)throw new ApiError(409,'STOCK_LIMIT','Restocking would exceed the stock limit. Ask the administrator to correct inventory first.');
   }
  }
  if(status==='cancelled')db.prepare("UPDATE farm_fulfillments SET status='cancelled',updated_at=? WHERE order_id=?").run(Date.now(),id);
  const payment=status==='delivered'?'paid':status==='cancelled'?'cancelled':row.payment_status;
  db.prepare('UPDATE orders SET status=?,payment_status=? WHERE id=?').run(status,payment,id);
  if(status==='cancelled')db.prepare("UPDATE order_payments SET state='expired',updated_at=? WHERE order_id=? AND state!='paid'").run(Date.now(),id);
  queueRefund(db,id);
  db.prepare('INSERT INTO order_events(order_id,actor_id,status,created_at) VALUES (?,?,?,?)').run(id,userId,status,Date.now());
  if(admin&&status==='cancelled')audit(db,userId,'order_cancellation_reason',id,reason);
  const order=serialize(db,db.prepare('SELECT * FROM orders WHERE id=?').get(id));db.exec('COMMIT');return order;
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function mountAdmin(app,db){
 const guard=[requireUser(db),(req,_res,next)=>{if(!isAdmin(db,req.user.id))throw new ApiError(403,'ADMIN_REQUIRED','Administrator access is required.');next();}];
 app.get('/api/admin/access',requireUser(db),(req,res)=>res.json({isAdmin:isAdmin(db,req.user.id)}));
 app.get('/api/admin/products',...guard,(_req,res)=>res.json({products:db.prepare('SELECT sale_mode AS saleMode,id,name,unit,price_paise AS pricePaise,bulk_price_paise AS bulkPricePaise,bulk_min AS bulkMin,stock,active,revision FROM products ORDER BY display_order,id').all()}));
 app.post('/api/admin/products/:id',requireSameOrigin,...guard,(req,res)=>{
  const mode=db.prepare('SELECT sale_mode,farm_id FROM products WHERE id=?').get(req.params.id);if(mode?.sale_mode==='weight'||(mode&&db.prepare('SELECT 1 FROM account_profiles WHERE farm_id=?').get(mode.farm_id)))throw new ApiError(400,'FARMER_EDITOR_REQUIRED','Farmers manage their own prices and stock. Use listing moderation here.');
  const b=req.body;
  if(!b||![b.pricePaise,b.bulkPricePaise,b.bulkMin,b.stock,b.revision].every(Number.isSafeInteger)||b.pricePaise<1||b.pricePaise>100000000||b.bulkPricePaise<1||b.bulkPricePaise>b.pricePaise||b.bulkMin<2||b.bulkMin>10000||b.stock<0||b.stock>1000000||![0,1].includes(b.active))throw new ApiError(400,'INVALID_PRODUCT','Check prices, bulk threshold, stock and availability.');
  transaction(db,()=>{
  const result=db.prepare("UPDATE products SET price_paise=?,bulk_price_paise=?,bulk_min=?,stock=?,active=?,published_once=MAX(published_once,?),revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND revision=? AND archived=0").run(b.pricePaise,b.bulkPricePaise,b.bulkMin,b.stock,b.active,b.active,req.params.id,b.revision);
  if(!result.changes)throw new ApiError(409,'PRODUCT_CHANGED','Product changed while you were editing. Refresh products and try again.');
  audit(db,req.user.id,'legacy_product_updated',req.params.id,'Store-owned pack listing updated');
  });
  res.json({ok:true});
 });
 app.get('/api/admin/orders',...guard,(req,res)=>{
  const p=paging(req.query),status=choice(req.query.status,['placed','confirmed','packed','out_for_delivery','delivered','cancelled']),kind=choice(req.query.kind,['consumer','bulk_buyer']),mode=choice(req.query.mode,['demo','unconnected']);
  const from=`FROM orders o JOIN users u ON u.id=o.user_id WHERE (?='' OR instr(lower(o.id||' '||o.address_json||' '||u.email||' '||o.business_name),lower(?))>0 OR EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=o.id AND instr(lower(i.farm_name||' '||i.name),lower(?))>0)) AND (?='' OR o.status=?) AND (?='' OR o.purchase_kind=?) AND (?='' OR o.delivery_mode=?)`;
  const args=[p.q,p.q,p.q,status,status,kind,kind,mode,mode];
  res.json({page:p.page,limit:p.limit,total:db.prepare('SELECT COUNT(*) n '+from).get(...args).n,orders:db.prepare('SELECT o.* '+from+' ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?').all(...args,p.limit,p.offset).map(row=>serialize(db,row))});
 });
 app.post('/api/admin/orders/:id/status',requireSameOrigin,...guard,(req,res)=>res.json({order:changeOrder(db,req.params.id,req.user.id,req.body,true)}));
 app.post('/api/orders/:id/cancel',requireSameOrigin,requireUser(db),(req,res)=>res.json({order:changeOrder(db,req.params.id,req.user.id,{...req.body,status:'cancelled'},false)}));
}

