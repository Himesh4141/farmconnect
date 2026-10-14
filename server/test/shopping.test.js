import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {openDatabase,seedDatabase} from '../src/db.js';
import {createProfile} from '../src/profiles.js';
import {createApp} from '../src/app.js';
import {placeOrder} from '../src/orders.js';
import {reconcilePayments} from '../src/payments.js';
import {progress,syncOrder} from '../src/fulfillment.js';
const address={name:'Test Buyer',phone:'9876543210',line:'123 Test Road',city:'Pune',pincode:'411001'};
async function fixture(t,options={}){
 const db=openDatabase(':memory:');seedDatabase(db);const cookies={},farms={};
 for(const id of ['buyer','other','farmer','farmer2','admin','business']){
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id,id+'@example.test','unused','customer',Date.now());
  createProfile(db,id,{accountType:id.startsWith('farmer')?'farmer':id==='business'?'bulk_buyer':'consumer',businessName:'Test '+id,phone:'9876543210'});
  if(id.startsWith('farmer')||id==='business')db.prepare("UPDATE account_profiles SET access_status='approved' WHERE user_id=?").run(id);
  farms[id]=db.prepare('SELECT farm_id FROM account_profiles WHERE user_id=?').get(id).farm_id;
  const token=randomBytes(32).toString('hex');cookies[id]='farmconnect_session='+token;
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+600000);
 }
 db.prepare("INSERT INTO admin_users VALUES ('admin')").run();
 const server=createApp(db,options).listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});db.close();});
 async function call(path,body,method=body?'POST':'GET',user='buyer',origin=base){const response=await fetch(base+'/api'+path,{method,headers:{Origin:origin,Cookie:cookies[user]??'','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();return{status:response.status,body:response.headers.get('content-type')?.includes('json')?JSON.parse(text):text,headers:response.headers};}
 const products=[];
 for(const farmer of ['farmer','farmer2']){const result=await call('/farmer/products',{name:'Test tomatoes '+farmer,category:'Vegetables',unit:'kg',saleMode:'weight',presetId:'tomatoes',pricePaise:4000,bulkPricePaise:3500,bulkMin:5000,stock:10000,image:'',photoCredit:'',active:1},'POST',farmer);assert.equal(result.status,201,JSON.stringify(result.body));products.push(result.body.product);}
 function order({user='buyer',both=false,paid=false,mode='unconnected',quantity=250}={}){const items=(both?products:[products[0]]).map(p=>({productId:p.id,quantity}));const subtotal=(both?2:1)*Math.round((quantity>=5000?3500:4000)*quantity/1000);const row=placeOrder(db,user,{requestKey:randomUUID(),address,items,expectedSubtotalPaise:subtotal,paymentMethod:paid?'razorpay':'cod'},mode,paid?{isTest:true}:null).order;if(paid)db.prepare("UPDATE order_payments SET state='paid',provider_order_id=?,provider_payment_id=? WHERE order_id=?").run('order_'+row.id.replaceAll('-',''),'pay_'+row.id.replaceAll('-',''),row.id);return row;}
 function deliver(row,farm=farms.farmer){db.prepare("INSERT INTO external_shipments(id,order_id,farm_id,provider,waybill,status,provider_status,updated_at,created_by) VALUES (?,?,?,'delhivery',?,'delivered','Delivered',?,'admin')").run(randomUUID(),row.id,farm,randomUUID(),Date.now());syncOrder(db,row.id);}
 async function help(row,user='buyer',product=products[0]){const result=await call('/orders/'+row.id+'/help',{productId:product.id,category:'quality',message:'The produce arrived damaged; please review.'},'POST',user);assert.equal(result.status,201,JSON.stringify(result.body));return result.body.case;}
 return{db,call,products,farms,order,deliver,help};
}
test('saved products are private, idempotent, bounded and do not disclose moderated listings',async t=>{
 const f=await fixture(t),path='/saved-products/'+f.products[0].id;
 assert.equal((await f.call(path,undefined,'PUT','none')).status,401);
 assert.equal((await f.call(path,undefined,'PUT','buyer','https://evil.test')).status,403);
 assert.equal((await f.call(path,undefined,'PUT')).status,200);await f.call(path,undefined,'PUT');
 assert.equal((await f.call('/saved-products')).body.items.length,1);assert.equal((await f.call('/saved-products',undefined,'GET','other')).body.items.length,0);
 f.db.prepare('INSERT INTO listing_moderation(product_id,blocked,reason,updated_at) VALUES (?,1,?,?)').run(f.products[0].id,'Moderated fixture listing',Date.now());
 assert.equal((await f.call('/saved-products')).body.items[0].product,null);assert.equal((await f.call(path,undefined,'PUT')).status,404);
 await f.call(path,undefined,'DELETE');assert.equal((await f.call('/saved-products')).body.items.length,0);
 for(let i=0;i<100;i++){const id='saved-fixture-'+i;f.db.prepare("INSERT INTO products(id,farm_id,name,category,unit,price_paise,bulk_price_paise,bulk_min,stock,image,photo_credit,display_order) VALUES (?,?,'Fixture','Vegetables','kg',1000,1000,2,10,'','',0)").run(id,f.farms.farmer);f.db.prepare('INSERT INTO saved_products VALUES (?,?,?)').run('buyer',id,Date.now());}
 assert.equal((await f.call('/saved-products/'+f.products[1].id,undefined,'PUT')).status,409);
});
test('repeat-order plans use current kg stock/prices and never place another order',async t=>{
 const f=await fixture(t),old=f.order({quantity:1000});
 f.db.prepare('UPDATE products SET price_paise=6000,bulk_price_paise=5500,stock_grams=550 WHERE id=?').run(f.products[0].id);
 const result=await f.call('/orders/'+old.id+'/reorder');assert.equal(result.status,200);assert.equal(result.body.items[0].quantity,550);assert.equal(result.body.quote.subtotalPaise,3300);assert.equal(result.body.warnings.length,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM orders').get().n,1);assert.equal(f.db.prepare('SELECT stock_grams n FROM products WHERE id=?').get(f.products[0].id).n,550);
 assert.equal((await f.call('/orders/'+old.id+'/reorder',undefined,'GET','other')).status,404);
 f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(f.products[0].id);assert.equal((await f.call('/orders/'+old.id+'/reorder')).body.quote,null);
});
test('buyer history searches/paginates all own orders; summaries preserve snapshots and payment truth',async t=>{
 const f=await fixture(t);let old;for(let i=0;i<23;i++)old=f.order();f.order({user:'other'});
 const page=await f.call('/orders?page=2');assert.equal(page.body.orders.length,3);assert.equal(page.body.total,23);
 assert.equal((await f.call('/orders?q='+old.id)).body.total,1);assert.equal((await f.call('/orders?status=delivered')).body.total,0);assert.equal((await f.call('/orders?page=-1')).status,400);
 const summary=await f.call('/orders/'+old.id+'/summary');assert.equal(summary.status,200);assert.match(summary.body,/Not a tax invoice/);assert.match(summary.body,/INR 10.00/);assert.match(summary.headers.get('content-disposition'),/attachment/);assert.equal((await f.call('/orders/'+old.id+'/summary',undefined,'GET','other')).status,404);
});
test('reviews require delivered ownership, resist duplicates, and moderation survives edits',async t=>{
 const f=await fixture(t),row=f.order();const payload={productId:f.products[0].id,rating:5,comment:'The tomatoes were fresh and well packed.'};
 assert.equal((await f.call('/orders/'+row.id+'/reviews',payload)).status,409);f.deliver(row);
 assert.equal((await f.call('/orders/'+row.id+'/reviews',payload,'POST','other')).status,404);
 const saved=await f.call('/orders/'+row.id+'/reviews',payload);assert.equal(saved.status,200);assert.equal((await f.call('/orders/'+row.id+'/reviews',payload)).status,409);
 const publicReview=(await f.call('/products/'+f.products[0].id+'/reviews',undefined,'GET','none')).body.reviews[0];assert.equal(publicReview.orderId,undefined);assert.equal(publicReview.userId,undefined);
 const review=saved.body.review;assert.equal((await f.call('/admin/product-reviews/'+review.id+'/moderate',{hidden:true,reason:'Contains an example to moderate',revision:review.revision},'POST','admin')).status,200);
 assert.equal((await f.call('/products/'+f.products[0].id+'/reviews')).body.reviews.length,0);
 const edit=await f.call('/orders/'+row.id+'/reviews',{...payload,comment:'Updated description after the first purchase.',revision:1});assert.equal(edit.status,200);assert.equal(edit.body.review.hidden,true);
 const privatePath='/orders/'+row.id+'/review?productId='+payload.productId;
 f.db.prepare('UPDATE products SET active=0 WHERE id=?').run(payload.productId);
 assert.equal((await f.call('/products/'+payload.productId+'/reviews')).status,404);
 assert.equal((await f.call(privatePath)).body.own.id,review.id);
 assert.equal((await f.call(privatePath,undefined,'GET','other')).status,404);
 assert.equal((await f.call('/orders/'+row.id+'/review?productId=unrelated')).status,404);
 f.db.prepare('UPDATE products SET active=1 WHERE id=?').run(payload.productId);
 const own=f.order({user:'farmer'});f.deliver(own);assert.equal((await f.call('/orders/'+own.id+'/reviews',payload,'POST','farmer')).status,403);
});
test('demo reviews remain labeled and cannot inflate public verified ratings',async t=>{
 const f=await fixture(t,{courierMode:'demo'}),row=f.order({mode:'demo'});f.deliver(row);
 await f.call('/orders/'+row.id+'/reviews',{productId:f.products[0].id,rating:5,comment:'A review of disposable demo produce.'});
 const reviews=await f.call('/products/'+f.products[0].id+'/reviews');assert.equal(reviews.body.reviews[0].isDemo,true);
 assert.equal((await f.call('/products/'+f.products[0].id)).body.product.reviewCount,0);
});
test('support conversations connect only owner, relevant farmer and admin; retries are idempotent',async t=>{
 const f=await fixture(t),row=f.order(),c=await f.help(row);assert.equal((await f.help(row)).id,c.id);
 assert.equal((await f.call('/help/'+c.id,undefined,'GET','other')).status,404);assert.equal((await f.call('/farmer/help/'+c.id,undefined,'GET','farmer2')).status,404);
 assert.equal((await f.call('/farmer/help',undefined,'GET','buyer')).status,403);assert.equal((await f.call('/admin/help',undefined,'GET','buyer')).status,403);
 const message={message:'We are checking the packing record now.',requestKey:randomUUID()};
 assert.equal((await f.call('/farmer/help/'+c.id+'/messages',message,'POST','farmer')).status,200);assert.equal((await f.call('/farmer/help/'+c.id+'/messages',message,'POST','farmer')).body.case.messages.length,2);
 assert.equal((await f.call('/farmer/help/'+c.id+'/messages',{...message,message:'A different attempted replay message'},'POST','farmer')).status,409);
 const conversation=(await f.call('/help/'+c.id)).body.case;assert.equal(conversation.messages[1].role,'farmer');assert.equal(conversation.messages[1].authorId,undefined);
 const stale=await f.call('/admin/help/'+c.id+'/resolve',{action:'resolved',message:'The buyer and farmer have agreed a resolution.',revision:0},'POST','admin');assert.equal(stale.status,409);
 const result=await f.call('/admin/help/'+c.id+'/resolve',{action:'resolved',message:'The buyer and farmer have agreed a resolution.',revision:conversation.revision},'POST','admin');assert.equal(result.body.case.status,'resolved');
 assert.equal((await f.call('/help/'+c.id+'/messages',{message:'Another follow-up after the closure.',requestKey:randomUUID()})).status,409);
});
test('support refunds are bounded, atomic, audited, once-only, and never restock delivered food',async t=>{
 const f=await fixture(t),row=f.order({paid:true});f.deliver(row);const c=await f.help(row),stock=f.db.prepare('SELECT stock_grams FROM products WHERE id=?').get(f.products[0].id).stock_grams;
 const payload={action:'refund',refundPaise:500,message:'Verified damaged produce; partial refund approved.',revision:c.revision};
 assert.equal((await f.call('/admin/help/'+c.id+'/resolve',{...payload,refundPaise:1001},'POST','admin')).status,400);
 f.db.exec("CREATE TRIGGER fail_help_audit BEFORE INSERT ON admin_events WHEN NEW.action='order_help_refund' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END;");
 assert.equal((await f.call('/admin/help/'+c.id+'/resolve',payload,'POST','admin')).status,500);assert.equal(f.db.prepare('SELECT count(*) n FROM payment_refunds').get().n,0);assert.equal((await f.call('/help/'+c.id)).body.case.status,'open');f.db.exec('DROP TRIGGER fail_help_audit');
 const approved=await f.call('/admin/help/'+c.id+'/resolve',payload,'POST','admin');assert.equal(approved.status,200);assert.equal(approved.body.case.refundState,'queued');assert.equal((await f.call('/admin/help/'+c.id+'/resolve',payload,'POST','admin')).status,409);
 let sent=0;await reconcilePayments(f.db,{refund:async(payment,amount)=>{sent++;return{id:'rfnd_fixture',payment_id:payment,amount,status:'processed'};}});assert.equal(sent,1);assert.equal((await f.call('/help/'+c.id)).body.case.refundState,'processed');
 assert.equal(f.db.prepare('SELECT stock_grams FROM products WHERE id=?').get(f.products[0].id).stock_grams,stock);assert.equal(f.db.prepare("SELECT count(*) n FROM admin_events WHERE action='order_help_refund'").get().n,1);
});
test('partial delivery refund plus cancellation of another farm never misses or duplicates a refund',async t=>{
 const f=await fixture(t),row=f.order({both:true,paid:true});f.deliver(row);assert.equal(progress(f.db,row.id).status,'partially_delivered');
 const c=await f.help(row);assert.equal((await f.call('/admin/help/'+c.id+'/resolve',{action:'refund',refundPaise:500,message:'Verified partial damage on delivered produce.',revision:c.revision},'POST','admin')).status,200);
 assert.equal((await f.call('/farmer/orders/'+row.id+'/reject',{reason:'Produce unavailable for collection.'},'POST','farmer2')).status,200);
 assert.equal(f.db.prepare('SELECT SUM(amount_paise) amount FROM payment_refunds WHERE order_id=?').get(row.id).amount,1500);
 assert.equal((await f.call('/farmer/orders/'+row.id+'/reject',{reason:'Produce unavailable for collection.'},'POST','farmer2')).status,200);
 assert.equal(f.db.prepare('SELECT SUM(amount_paise) amount FROM payment_refunds WHERE order_id=?').get(row.id).amount,1500);
});
test('cash orders cannot claim automatic refunds; admin cannot resolve own purchases; bulk buyers share help flow',async t=>{
 const f=await fixture(t),cash=f.order();f.deliver(cash);const c=await f.help(cash),body={action:'refund',refundPaise:500,message:'Requesting a refund for this order.',revision:0};
 assert.equal((await f.call('/admin/help/'+c.id+'/resolve',body,'POST','admin')).status,409);
 const own=f.order({user:'admin',paid:true});f.deliver(own);const self=await f.help(own,'admin');assert.equal((await f.call('/admin/help/'+self.id+'/resolve',{...body,action:'resolved'},'POST','admin')).status,403);
 const bulk=f.order({user:'business',quantity:5000});assert.equal(bulk.purchaseKind,'bulk_buyer');assert.equal(bulk.totalPaise,17500);const ticket=await f.help(bulk,'business');assert.equal((await f.call('/help/'+ticket.id,undefined,'GET','business')).status,200);
});
