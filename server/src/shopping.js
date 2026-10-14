import { randomUUID } from 'node:crypto';
import { requireUser,requireSameOrigin,currentUser } from './auth.js';
import { isAdmin } from './admin.js';
import { paging,choice,transaction,audit,reasonFrom } from './admin-support.js';
import { findProduct } from './catalog.js';
import { ApiError,quoteCart } from './pricing.js';
import { serialize } from './orders.js';
import { progress } from './fulfillment.js';

const messageFrom=body=>{
 const value=typeof body?.message==='string'?body.message.trim():'';
 if(value.length<10||value.length>1500)throw new ApiError(400,'INVALID_MESSAGE','Write a message using 10–1500 characters. Do not include passwords or payment details.');
 return value;
};
function ownerOrder(db,id,user){const row=db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(id,user);if(!row)throw new ApiError(404,'ORDER_NOT_FOUND','Order not found.');return row;}
function delivered(db,orderId,farmId){return progress(db,orderId)?.parts.some(part=>part.farmId===farmId&&part.status==='delivered');}
function reviewView(row){return {id:row.id,productId:row.product_id,orderId:row.order_id,rating:row.rating,comment:row.comment,isDemo:Boolean(row.is_demo),hidden:Boolean(row.hidden),revision:row.revision,updatedAt:row.updated_at};}
function helpView(db,row){const item=db.prepare('SELECT name,line_total_paise FROM order_items WHERE order_id=? AND product_id=?').get(row.order_id,row.product_id);const order=db.prepare('SELECT delivery_mode FROM orders WHERE id=?').get(row.order_id);const payment=db.prepare('SELECT state,is_test FROM order_payments WHERE order_id=?').get(row.order_id);return {
 id:row.id,orderId:row.order_id,productId:row.product_id,productName:item.name,lineTotalPaise:item.line_total_paise,category:row.category,status:row.status,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,
 isDemo:order.delivery_mode==='demo',canRefund:row.status==='open'&&payment?.state==='paid'&&delivered(db,row.order_id,row.farm_id),paymentIsTest:Boolean(payment?.is_test),refundPaise:row.refund_paise,
 refundState:row.refund_id?db.prepare('SELECT state FROM payment_refunds WHERE id=?').get(row.refund_id)?.state:null,
 messages:db.prepare('SELECT id,author_role AS role,message,created_at AS createdAt FROM help_messages WHERE case_id=? ORDER BY created_at,id').all(row.id)
};}
export function mountShopping(app,db,config){
 const admin=[requireUser(db),(req,_res,next)=>{if(!isAdmin(db,req.user.id))throw new ApiError(403,'ADMIN_REQUIRED','Administrator access is required.');next();}];
 const farmer=[requireUser(db),(req,_res,next)=>{if(req.user.requestedAccountType!=='farmer'||!req.user.farmId)throw new ApiError(403,'FARMER_REQUIRED','Use your farmer account.');next();}];
 app.get('/api/saved-products',requireUser(db),(req,res)=>res.json({items:db.prepare('SELECT product_id FROM saved_products WHERE user_id=? ORDER BY created_at DESC,product_id').all(req.user.id).map(row=>({id:row.product_id,product:findProduct(db,row.product_id)??null}))}));
 app.put('/api/saved-products/:id',requireSameOrigin,requireUser(db),(req,res)=>{
  if(!findProduct(db,req.params.id))throw new ApiError(404,'PRODUCT_UNAVAILABLE','This listing is no longer available.');
  transaction(db,()=>{if(db.prepare('SELECT count(*) n FROM saved_products WHERE user_id=?').get(req.user.id).n>=100&&!db.prepare('SELECT 1 FROM saved_products WHERE user_id=? AND product_id=?').get(req.user.id,req.params.id))throw new ApiError(409,'SAVE_LIMIT','You can save up to 100 products.');db.prepare('INSERT INTO saved_products VALUES (?,?,?) ON CONFLICT DO NOTHING').run(req.user.id,req.params.id,Date.now());});res.json({ok:true});
 });
 app.delete('/api/saved-products/:id',requireSameOrigin,requireUser(db),(req,res)=>{db.prepare('DELETE FROM saved_products WHERE user_id=? AND product_id=?').run(req.user.id,req.params.id);res.json({ok:true});});
 app.get('/api/orders/:id/reorder',requireUser(db),(req,res)=>{
  ownerOrder(db,req.params.id,req.user.id);const items=[],warnings=[];
  for(const old of db.prepare('SELECT * FROM order_items WHERE order_id=?').all(req.params.id)){
   const product=findProduct(db,old.product_id);
   if(!product||product.saleMode!==old.sale_mode){warnings.push(old.name+': unavailable or selling unit changed.');continue;}
   const step=product.saleMode==='weight'?50:1,quantity=Math.floor(Math.min(product.stock,old.quantity)/step)*step;
   if(quantity<step){warnings.push(old.name+': sold out.');continue;}
   if(quantity!==old.quantity)warnings.push(old.name+': quantity reduced to current available stock.');
   items.push({productId:product.id,quantity});
  }
  res.json({items,warnings,quote:items.length?quoteCart(db,{items}):null});
 });
 app.get('/api/orders/:id/summary',requireUser(db),(req,res)=>{
  const order=serialize(db,ownerOrder(db,req.params.id,req.user.id));
  const money=n=>'INR '+(n/100).toFixed(2);
  const lines=['FARMCONNECT - ORDER SUMMARY','Not a tax invoice',order.deliveryMode==='demo'?'DEMO ORDER - NO REAL PAYMENT OR DELIVERY':'',`Order: ${order.id}`,`Placed: ${new Date(order.createdAt).toISOString()}`,`Status: ${order.status}`,`Buyer type: ${order.purchaseKind}`,`Deliver to: ${order.address.name}`,`${order.address.line}, ${order.address.city} ${order.address.pincode}`,'',...order.items.map(i=>`${i.name} | ${i.farmName} | ${i.saleMode==='weight'?i.quantity/1000+' kg':i.quantity+' x '+i.unit} | ${money(i.lineTotalPaise)}`),'',`Original total: ${money(order.originalTotalPaise)}`,`Cancelled produce: ${money(order.cancelledPaise)}`,`Current order total: ${money(order.totalPaise)}`,`Payment: ${order.payment?order.payment.isTest?'Test online payment: '+order.payment.state:'Online payment: '+order.payment.state:order.deliveryMode==='demo'?'Demo (no money collected)':'COD: '+order.paymentStatus}`,`Provider-confirmed refunds: ${money(order.payment?.refundedPaise??0)}`,`Refunds requested: ${money(order.payment?.refundPaise??0)}`,'Prices and address reflect the saved order. Contact support from Your orders if anything is wrong.'];
  res.set('Content-Disposition',`attachment; filename="Farmconnect-${order.id}.txt"`).type('text/plain').send(lines.join('\n'));
 });
 app.get('/api/products/:id/reviews',(req,res)=>{
  if(!findProduct(db,req.params.id))throw new ApiError(404,'PRODUCT_UNAVAILABLE','This listing is no longer available.');
  const p=paging(req.query),user=currentUser(db,req),demo=config.courierMode==='demo'?1:0;
  const where='FROM product_reviews WHERE product_id=? AND hidden=0 AND (is_demo=0 OR ?=1)';
  res.json({total:db.prepare('SELECT COUNT(*) n '+where).get(req.params.id,demo).n,reviews:db.prepare('SELECT * '+where+' ORDER BY updated_at DESC,id LIMIT ? OFFSET ?').all(req.params.id,demo,p.limit,p.offset).map(r=>({id:r.id,rating:r.rating,comment:r.comment,isDemo:Boolean(r.is_demo),updatedAt:r.updated_at})),own:user?(()=>{const row=db.prepare('SELECT * FROM product_reviews WHERE product_id=? AND user_id=?').get(req.params.id,user.id);return row?reviewView(row):null;})():null});
 });
 app.get('/api/orders/:id/review',requireUser(db),(req,res)=>{
  const order=ownerOrder(db,req.params.id,req.user.id),id=typeof req.query.productId==='string'?req.query.productId:'';
  const item=db.prepare('SELECT farm_id FROM order_items WHERE order_id=? AND product_id=?').get(order.id,id);
  if(!item)throw new ApiError(404,'ITEM_NOT_FOUND','Choose produce from this order.');
  if(!delivered(db,order.id,item.farm_id))throw new ApiError(409,'DELIVERY_REQUIRED','You can review only produce delivered to you.');
  const own=db.prepare('SELECT * FROM product_reviews WHERE product_id=? AND user_id=?').get(id,req.user.id);
  res.json({own:own?reviewView(own):null});
 });
 app.post('/api/orders/:id/reviews',requireSameOrigin,requireUser(db),(req,res)=>{
  const order=ownerOrder(db,req.params.id,req.user.id),b=req.body??{};
  const item=db.prepare('SELECT * FROM order_items WHERE order_id=? AND product_id=?').get(order.id,typeof b.productId==='string'?b.productId:'');
  if(!item||!delivered(db,order.id,item.farm_id))throw new ApiError(409,'DELIVERY_REQUIRED','You can review only produce delivered to you.');
  if(req.user.farmId===item.farm_id)throw new ApiError(403,'OWN_FARM_REVIEW','Farmers cannot review their own produce.');
  if(!Number.isInteger(b.rating)||b.rating<1||b.rating>5)throw new ApiError(400,'INVALID_RATING','Choose a rating from 1 to 5.');
  const comment=messageFrom({message:b.comment});
  transaction(db,()=>{const old=db.prepare('SELECT * FROM product_reviews WHERE user_id=? AND product_id=?').get(req.user.id,item.product_id);
   if(old){if(old.revision!==b.revision)throw new ApiError(409,'REVIEW_CHANGED','Your review already exists or changed. Refresh the review before editing.');db.prepare('UPDATE product_reviews SET rating=?,comment=?,revision=revision+1,updated_at=? WHERE id=?').run(b.rating,comment,Date.now(),old.id);}
   else db.prepare('INSERT INTO product_reviews(id,user_id,product_id,order_id,rating,comment,is_demo,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),req.user.id,item.product_id,order.id,b.rating,comment,order.delivery_mode==='demo'?1:0,Date.now());
  });res.json({review:reviewView(db.prepare('SELECT * FROM product_reviews WHERE user_id=? AND product_id=?').get(req.user.id,item.product_id))});
 });
 app.get('/api/admin/product-reviews',...admin,(req,res)=>{const p=paging(req.query),hidden=choice(req.query.visibility,['visible','hidden']);const clause=`FROM product_reviews r JOIN products p ON p.id=r.product_id WHERE (?='' OR instr(lower(p.name||' '||r.comment),lower(?))>0) AND (?='' OR r.hidden=?)`;const args=[p.q,p.q,hidden,hidden==='hidden'?1:0];res.json({total:db.prepare('SELECT COUNT(*) n '+clause).get(...args).n,reviews:db.prepare('SELECT r.*,p.name '+clause+' ORDER BY r.updated_at DESC,r.id LIMIT ? OFFSET ?').all(...args,p.limit,p.offset).map(r=>({...reviewView(r),productName:r.name,reason:r.moderation_reason}))});});
 app.post('/api/admin/product-reviews/:id/moderate',requireSameOrigin,...admin,(req,res)=>{
  const reason=reasonFrom(req.body);if(typeof req.body.hidden!=='boolean')throw new ApiError(400,'INVALID_ACTION','Choose hide or restore.');
  transaction(db,()=>{const result=db.prepare('UPDATE product_reviews SET hidden=?,moderation_reason=?,revision=revision+1 WHERE id=? AND revision=?').run(req.body.hidden?1:0,reason,req.params.id,req.body.revision??-1);if(!result.changes)throw new ApiError(409,'REVIEW_CHANGED','Refresh reviews before moderating.');audit(db,req.user.id,req.body.hidden?'review_hidden':'review_restored',req.params.id,reason);});res.json({ok:true});
 });
 app.post('/api/orders/:id/help',requireSameOrigin,requireUser(db),(req,res)=>{
  ownerOrder(db,req.params.id,req.user.id);const b=req.body??{},message=messageFrom(b),category=choice(b.category,['quality','missing','wrong','delivery','other']);if(!category)throw new ApiError(400,'CATEGORY_REQUIRED','Choose an issue type.');
  const item=db.prepare('SELECT * FROM order_items WHERE order_id=? AND product_id=?').get(req.params.id,typeof b.productId==='string'?b.productId:'');if(!item)throw new ApiError(404,'ITEM_NOT_FOUND','Choose produce from this order.');
  let id;transaction(db,()=>{const old=db.prepare('SELECT id FROM order_help WHERE order_id=? AND product_id=?').get(req.params.id,item.product_id);if(old){id=old.id;return;}
   id=randomUUID();db.prepare('INSERT INTO order_help(id,order_id,product_id,user_id,farm_id,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,req.params.id,item.product_id,req.user.id,item.farm_id,category,Date.now(),Date.now());
   db.prepare('INSERT INTO help_messages VALUES (?,?,?,?,?,?,?)').run(randomUUID(),id,req.user.id,'buyer',message,Date.now(),'initial');
  });res.status(201).json({case:helpView(db,db.prepare('SELECT * FROM order_help WHERE id=?').get(id))});
 });
 const scopes=[['/api/help',requireUser(db),'buyer'],['/api/farmer/help',farmer,'farmer'],['/api/admin/help',admin,'admin']];
 for(const [base,guards,role] of scopes){
  const guard=Array.isArray(guards)?guards:[guards];
  function scoped(req,id){const row=db.prepare('SELECT * FROM order_help WHERE id=?').get(id);if(!row||(role==='buyer'&&row.user_id!==req.user.id)||(role==='farmer'&&row.farm_id!==req.user.farmId))throw new ApiError(404,'CASE_NOT_FOUND','Support request not found.');return row;}
  app.get(base,...guard,(req,res)=>{const p=paging(req.query),status=choice(req.query.status,['open','resolved','declined']),orderId=typeof req.query.orderId==='string'?req.query.orderId:'';if(orderId.length>80)throw new ApiError(400,'INVALID_ORDER','Invalid order.');
   const where=`FROM order_help c JOIN order_items i ON i.order_id=c.order_id AND i.product_id=c.product_id WHERE (?='admin' OR (?='buyer' AND c.user_id=?) OR (?='farmer' AND c.farm_id=?)) AND (?='' OR c.status=?) AND (?='' OR c.order_id=?) AND (?='' OR instr(lower(c.order_id||' '||i.name),lower(?))>0)`;
   const args=[role,role,req.user.id,role,req.user.farmId??'',status,status,orderId,orderId,p.q,p.q];res.json({total:db.prepare('SELECT COUNT(*) n '+where).get(...args).n,cases:db.prepare('SELECT c.* '+where+' ORDER BY c.updated_at DESC,c.id DESC LIMIT ? OFFSET ?').all(...args,p.limit,p.offset).map(r=>helpView(db,r))});
  });
  app.get(base+'/:id',...guard,(req,res)=>res.json({case:helpView(db,scoped(req,req.params.id))}));
  app.post(base+'/:id/messages',requireSameOrigin,...guard,(req,res)=>{
   const message=messageFrom(req.body),key=req.body?.requestKey;
   if(typeof key!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(key))throw new ApiError(400,'INVALID_REQUEST_KEY','Refresh the conversation and retry.');
   transaction(db,()=>{const row=scoped(req,req.params.id),old=db.prepare('SELECT message FROM help_messages WHERE case_id=? AND author_id=? AND request_key=?').get(row.id,req.user.id,key);if(old){if(old.message!==message)throw new ApiError(409,'MESSAGE_CHANGED','This message attempt already exists. Refresh the conversation.');return;}
    if(row.status!=='open')throw new ApiError(409,'CASE_CLOSED','This request is closed.');
    if(role==='farmer'&&req.user.accessStatus==='suspended')throw new ApiError(403,'SUSPENDED','Suspended partners cannot send replies.');
    if(db.prepare('SELECT count(*) n FROM help_messages WHERE case_id=?').get(row.id).n>=100)throw new ApiError(409,'MESSAGE_LIMIT','This conversation has reached its message limit. Contact the operator.');
    db.prepare('INSERT INTO help_messages VALUES (?,?,?,?,?,?,?)').run(randomUUID(),row.id,req.user.id,role,message,Date.now(),key);
    db.prepare('UPDATE order_help SET revision=revision+1,updated_at=? WHERE id=?').run(Date.now(),row.id);
   });res.json({case:helpView(db,scoped(req,req.params.id))});
  });
 }
 app.post('/api/admin/help/:id/resolve',requireSameOrigin,...admin,(req,res)=>{
  const b=req.body??{},message=messageFrom(b),action=choice(b.action,['resolved','declined','refund']);if(!action)throw new ApiError(400,'ACTION_REQUIRED','Choose a resolution.');
  transaction(db,()=>{const row=db.prepare('SELECT * FROM order_help WHERE id=?').get(req.params.id);if(!row)throw new ApiError(404,'CASE_NOT_FOUND','Support request not found.');
   if(row.revision!==b.revision||row.status!=='open')throw new ApiError(409,'CASE_CHANGED','This request changed or was resolved. Refresh before acting.');
   if(row.user_id===req.user.id||row.farm_id===req.user.farmId)throw new ApiError(403,'SELF_RESOLUTION','Another operator must resolve requests involving your own purchase or farm.');
   let refundId=null,amount=0;
   if(action==='refund'){
    const payment=db.prepare('SELECT * FROM order_payments WHERE order_id=?').get(row.order_id),item=db.prepare('SELECT line_total_paise FROM order_items WHERE order_id=? AND product_id=?').get(row.order_id,row.product_id);
    if(!payment?.provider_payment_id||payment.state!=='paid'||!delivered(db,row.order_id,row.farm_id))throw new ApiError(409,'REFUND_NOT_AVAILABLE','This action needs a delivered item and a captured online payment. Cash refunds need separate operator handling.');
    const queued=db.prepare('SELECT COALESCE(SUM(amount_paise),0) amount FROM payment_refunds WHERE order_id=?').get(row.order_id).amount;amount=b.refundPaise;
    if(!Number.isSafeInteger(amount)||amount<1||amount>item.line_total_paise||amount>payment.amount_paise-queued)throw new ApiError(400,'REFUND_LIMIT','Refund must fit the item value and the unrefunded captured payment.');
    refundId=randomUUID();db.prepare('INSERT INTO payment_refunds(id,order_id,amount_paise,created_at,updated_at) VALUES (?,?,?,?,?)').run(refundId,row.order_id,amount,Date.now(),Date.now());
   }
   db.prepare('UPDATE order_help SET status=?,refund_id=?,refund_paise=?,revision=revision+1,updated_at=? WHERE id=?').run(action==='declined'?'declined':'resolved',refundId,amount,Date.now(),row.id);
   db.prepare('INSERT INTO help_messages VALUES (?,?,?,?,?,?,?)').run(randomUUID(),row.id,req.user.id,'admin',message,Date.now(),'resolution');
   audit(db,req.user.id,'order_help_'+action,row.id,message.slice(0,500));
  });res.json({case:helpView(db,db.prepare('SELECT * FROM order_help WHERE id=?').get(req.params.id))});
 });
}
