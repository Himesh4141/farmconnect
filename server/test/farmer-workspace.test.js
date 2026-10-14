import { readFileSync } from 'node:fs';
import { cleanJpeg } from '../src/photos.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes,createHash,randomUUID,scryptSync } from 'node:crypto';
import { openDatabase,seedDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createProfile } from '../src/profiles.js';
async function fixture(t,options={}){
 const db=openDatabase(':memory:');seedDatabase(db);
 const cookies={};
 for(const id of ['a','b','buyer','reviewer','driver','otherdriver','pendingdriver']){
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,'Test '+id,id+'@example.test','unused','customer',Date.now());
  createProfile(db,id,{accountType:['a','b'].includes(id)?'farmer':'consumer',businessName:'Farm '+id,phone:'9876543210'});
  const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000);cookies[id]='farmconnect_session='+token;
 }
 for(const id of ['driver','otherdriver','pendingdriver'])db.prepare('INSERT INTO delivery_partners VALUES (?,?,?,?)').run(id,'9876543210',id==='pendingdriver'?'pending':'approved',Date.now());
 db.prepare('INSERT INTO admin_users VALUES (?)').run('reviewer');
 const server=createApp(db,options).listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});db.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 async function call(path,body,user='a',method=body?'POST':'GET',origin=base){const response=await fetch(base+'/api'+path,{method,headers:{Origin:origin,Cookie:cookies[user]??'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};}
 const profile={name:'Test Farm',phone:'9876543210',pickup_address:'123 Farm road',city:'Pune',pincode:'411001',evidence:'Independent FPO reference and farm contact verified by reviewer.',revision:0};
 async function approve(user='a'){
  assert.equal((await call('/farmer/profile',profile,user)).status,200);
  const a=(await call('/access/application',undefined,user)).body.application;
  const result=await call('/admin/applications/'+a.id+'/review',{action:'approve',revision:a.revision,verified:true,note:'Contact and farm connection independently checked.'},'reviewer');
  assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.activated,true);assert.equal(result.body.invitationCode,undefined);
 }
 const product={name:'Test tomatoes',category:'Vegetables',unit:'1 kg pack',pricePaise:6000,bulkPricePaise:4500,bulkMin:5,stock:100,image:'',photoCredit:'',active:0};
 async function order(){
  await approve('a');await approve('b');
  const pa=(await call('/farmer/products',{...product,active:1},'a')).body.product;
  const pb=(await call('/farmer/products',{...product,active:1},'b')).body.product;
  const address={name:'Test Buyer',phone:'9876543210',line:'123 Example road',city:'Pune',pincode:'411001'};
  const placed=await call('/orders',{requestKey:randomUUID(),address,items:[{productId:pa.id,quantity:2},{productId:pb.id,quantity:1}],expectedSubtotalPaise:18000},'buyer');assert.equal(placed.status,201,JSON.stringify(placed.body));
  return {pa,pb,id:placed.body.order.id};
 }
 return {db,call,approve,product,profile,order,base,cookies};
}
async function readyForPickup(call,id,user='a') {
 let expectedStatus='placed';
 for(const status of ['confirmed','packed','ready_for_pickup']) {
  const result=await call('/farmer/orders/'+id+'/status',{status,expectedStatus},user);
  assert.equal(result.status,200,JSON.stringify(result.body)); expectedStatus=status;
 }
}
test('farmer, buyer and delivery logins coexist in one browser; logout and wrong-role login stay isolated',async t=>{
 const {db,call,cookies}=await fixture(t,{courierMode:'demo'});
 const password='Independent portal sessions 2026!';const salt=randomBytes(16).toString('hex');
 const hash=scryptSync(password,salt,32,{N:131072,r:8,p:1,maxmem:192*1024*1024}).toString('hex');
 db.prepare('UPDATE users SET password_hash=?').run(salt+':'+hash);
 let jar='';
 for(const [scope,email] of [['farmer/','a'],['','buyer'],['delivery/','driver']]){
  cookies.browser=jar;
  const login=await call('/auth/'+scope+'login',{email:email+'@example.test',password},'browser');
  assert.equal(login.status,200,JSON.stringify(login.body));jar+=(jar?'; ':'')+login.cookie.split(';')[0];
 }
 cookies.browser=jar;
 for(const [scope,id] of [['farmer/','a'],['','buyer'],['delivery/','driver']])assert.equal((await call('/auth/'+scope+'me',undefined,'browser')).body.user.id,id);
 assert.equal((await call('/auth/farmer/login',{email:'buyer@example.test',password},'browser')).status,403);
 assert.equal((await call('/auth/farmer/me',undefined,'browser')).body.user.id,'a');
 assert.equal((await call('/auth/delivery/logout',{},'browser','POST','https://bad.example')).status,403);
 assert.equal((await call('/auth/delivery/logout',{},'browser')).status,200);
 assert.equal((await call('/auth/delivery/me',undefined,'browser')).body.user,null);
 assert.equal((await call('/auth/farmer/me',undefined,'browser')).body.user.id,'a');
 assert.equal((await call('/auth/me',undefined,'browser')).body.user.id,'buyer');
});
test('integrated kg order: catalogue to checkout, automatic pickup, partner delivery and consistent buyer/farmer totals',async t=>{
 const {db,call,approve,product}=await fixture(t,{courierMode:'demo'});await approve();
 const created=await call('/farmer/products',{...product,name:'Integration tomatoes',active:1,saleMode:'weight',unit:'kg',stock:10000,bulkMin:5000,pricePaise:4000,bulkPricePaise:3500,presetId:'tomatoes'});
 assert.equal(created.status,201,JSON.stringify(created.body));const p=created.body.product;
 assert.ok((await call('/catalog',undefined,'buyer')).body.products.some(item=>item.id===p.id));
 const body={requestKey:randomUUID(),address:{name:'Test Buyer',phone:'9876543210',line:'123 Buyer road',city:'Pune',pincode:'411001'},items:[{productId:p.id,quantity:250}],expectedSubtotalPaise:1000};
 const placed=await call('/orders',body,'buyer');assert.equal(placed.status,201,JSON.stringify(placed.body));const id=placed.body.order.id;
 assert.equal(placed.body.order.deliveryMode,'demo');assert.equal(placed.body.order.totalPaise,1000);
 assert.equal((await call('/orders',body,'buyer')).body.order.id,id);
 assert.equal(db.prepare('SELECT stock_grams FROM products WHERE id=?').get(p.id).stock_grams,9750);
 await readyForPickup(call,id);
 const pickup=(await call('/delivery/shipments',undefined,'driver')).body.shipments.find(s=>s.orderId===id);assert.ok(pickup,'Ready must enqueue pickup without a separate book action');
 assert.equal((await call('/farmer/shipments/'+id+'/book',{confirmDemo:true})).status,200);
 await call('/delivery/shipments/'+pickup.id+'/claim',{revision:0},'driver');
 let revision=1;
 for(const [status,expected] of [['picked_up','in_transit'],['in_transit','in_transit'],['out_for_delivery','out_for_delivery'],['delivered','delivered']]){
  assert.equal((await call('/delivery/shipments/'+pickup.id+'/advance',{revision,status},'driver')).status,200);
  const buyer=(await call('/orders/'+id,undefined,'buyer')).body.order;
  assert.equal(buyer.status,expected);assert.equal(buyer.totalPaise,1000);assert.equal(buyer.paymentStatus,'pending');
  const farmer=(await call('/farmer/orders?status='+expected)).body.orders.find(o=>o.id===id);assert.ok(farmer);assert.equal(farmer.status,expected);
  assert.equal((await call('/orders/'+id+'/tracking',undefined,'buyer')).body.shipments[0].status,status);
  assert.equal((await call('/admin/orders/'+id+'/status',{status:'cancelled',reason:'Customer requested cancellation',expectedStatus:buyer.status},'reviewer')).status,409);
  revision++;
 }
 assert.equal(db.prepare('SELECT stock_grams FROM products WHERE id=?').get(p.id).stock_grams,9750);
 assert.equal((await call('/farmer/orders')).body.counts.delivered,1);
});
test('partial delivery never advances another farm; remaining farm can pack or reject safely',async t=>{
 const {call,order}=await fixture(t,{courierMode:'demo'});const {id}=await order();await readyForPickup(call,id,'a');
 const s=(await call('/delivery/shipments',undefined,'driver')).body.shipments[0];await call('/delivery/shipments/'+s.id+'/claim',{revision:0},'driver');
 let revision=1;for(const status of ['picked_up','in_transit','out_for_delivery','delivered'])assert.equal((await call('/delivery/shipments/'+s.id+'/advance',{revision:revision++,status},'driver')).status,200);
 assert.equal((await call('/orders/'+id,undefined,'buyer')).body.order.status,'partially_delivered');
 assert.equal((await call('/farmer/orders',undefined,'b')).body.orders[0].status,'placed');
 await readyForPickup(call,id,'b');
 const b=(await call('/delivery/shipments',undefined,'driver')).body.shipments.find(row=>row.id!==s.id);assert.ok(b);
 await call('/delivery/shipments/'+b.id+'/claim',{revision:0},'driver');revision=1;
 for(const status of ['picked_up','in_transit','out_for_delivery','delivered'])assert.equal((await call('/delivery/shipments/'+b.id+'/advance',{revision:revision++,status},'driver')).status,200);
 assert.equal((await call('/orders/'+id,undefined,'buyer')).body.order.status,'delivered');
});
test('approved bulk buyer uses the same integrated delivery flow and per-kg bulk price',async t=>{
 const {db,call,approve,product}=await fixture(t,{courierMode:'demo'});await approve();
 db.prepare("UPDATE account_profiles SET account_type='bulk_buyer',business_name='Test Cafe',access_status='approved' WHERE user_id='buyer'").run();
 const p=(await call('/farmer/products',{...product,active:1,saleMode:'weight',unit:'kg',stock:20000,bulkMin:5000,pricePaise:4000,bulkPricePaise:3500})).body.product;
 const order=await call('/orders',{requestKey:randomUUID(),address:{name:'Test Cafe',phone:'9876543210',line:'123 Cafe Road',city:'Pune',pincode:'411001'},items:[{productId:p.id,quantity:5000}],expectedSubtotalPaise:17500},'buyer');
 assert.equal(order.status,201,JSON.stringify(order.body));const id=order.body.order.id;
 assert.equal(order.body.order.purchaseKind,'bulk_buyer');assert.equal(order.body.order.totalPaise,17500);
 assert.equal((await call('/farmer/orders?kind=bulk_buyer')).body.orders[0].businessName,'Test Cafe');
 await readyForPickup(call,id);const shipment=(await call('/delivery/shipments',undefined,'driver')).body.shipments[0];
 await call('/delivery/shipments/'+shipment.id+'/claim',{revision:0},'driver');let revision=1;
 for(const status of ['picked_up','in_transit','out_for_delivery','delivered'])assert.equal((await call('/delivery/shipments/'+shipment.id+'/advance',{revision:revision++,status},'driver')).status,200);
 const final=(await call('/orders/'+id,undefined,'buyer')).body.order;
 assert.equal(final.status,'delivered');assert.equal(final.totalPaise,17500);
 assert.equal(db.prepare('SELECT stock_grams FROM products WHERE id=?').get(p.id).stock_grams,15000);
});
test('delivery signup is pending, ignores claimed privileges and cannot use buyer, farm, business or admin actions',async t=>{
 const {db,call,base,cookies}=await fixture(t,{courierMode:'demo'});
 const input={name:'Test Courier',email:'courier@example.test',password:'unique delivery test password',phone:'9876543210',accountType:'admin',accessStatus:'approved'};
 const registered=await call('/auth/delivery-register',input,'');assert.equal(registered.status,201,JSON.stringify(registered.body));
 assert.equal(registered.body.user.accountType,'delivery');assert.equal(registered.body.user.accessStatus,'pending');
 cookies.newdriver=registered.cookie.split(';')[0];
 assert.equal((await call('/delivery/shipments',undefined,'newdriver')).status,403);
 assert.equal((await call('/orders',{},'driver')).status,403);
 assert.equal((await call('/farmer/orders',undefined,'driver')).status,403);
 assert.equal((await call('/business/catalog',undefined,'driver')).status,403);
 assert.equal((await call('/access/application',{accountType:'farmer'},'driver')).status,403);
 assert.equal((await call('/access/redeem',{code:'anything'},'driver')).status,403);
 db.prepare('INSERT INTO admin_users VALUES (?)').run('driver');
 assert.equal((await call('/admin/access',undefined,'driver')).body.isAdmin,false);
 assert.equal((await call('/admin/products',undefined,'driver')).status,403);
 const login=await call('/auth/login',{email:input.email,password:input.password},'');assert.equal(login.body.user.accountType,'delivery');
 const invalid=await call('/auth/register',{...input,email:'other@example.test',accountType:'delivery'},'');assert.equal(invalid.status,400);
 assert.ok(base);assert.equal((await call('/auth/me',undefined,'buyer')).body.user.accountType,'consumer');
});
test('test pickup is idempotent and private; buyers and admins cannot access delivery controls',async t=>{
 const {db,call,order}=await fixture(t,{courierMode:'demo'});const {id}=await order();const book='/farmer/shipments/'+id+'/book';
 assert.equal((await call(book,{confirmDemo:true})).status,409);await readyForPickup(call,id);
 assert.equal((await call(book,{})).status,400);assert.equal((await call(book,{confirmDemo:true},'a','POST','https://bad.example')).status,403);
 const first=await call(book,{confirmDemo:true});assert.equal(first.status,200);
 assert.equal((await call(book,{confirmDemo:true})).body.shipment.id,first.body.shipment.id);
 assert.equal(db.prepare('SELECT count(*) AS n FROM demo_shipment_events').get().n,1);
 for(const user of ['a','buyer','reviewer','pendingdriver']) {
  assert.equal((await call('/delivery/shipments',undefined,user)).status,403);
  assert.equal((await call('/delivery/shipments/'+first.body.shipment.id+'/claim',{revision:0},user)).status,403);
 }
 assert.equal((await call('/delivery/shipments',undefined,'')).status,401);
 assert.equal((await call('/admin/courier-demo',undefined,'reviewer')).status,404);
 assert.equal((await call('/admin/courier-demo/'+first.body.shipment.id+'/advance',{status:'picked_up',revision:0},'reviewer')).status,404);
 const tracking=await call('/orders/'+id+'/tracking',undefined,'buyer');assert.equal(tracking.status,200);
 assert.match(tracking.body.shipments[0].trackingNumber,/^DEMO-/);assert.ok(!JSON.stringify(tracking.body).includes('123 Farm road'));
 assert.equal((await call('/orders/'+id+'/tracking',undefined,'driver')).status,404);
 db.prepare("UPDATE account_profiles SET access_status='suspended' WHERE user_id='a'").run();assert.equal((await call(book,{confirmDemo:true})).status,403);
});
test('pickup assignment hides addresses until accepted and only one approved partner can claim',async t=>{
 const {db,call,order}=await fixture(t,{courierMode:'demo'});const {id}=await order();await readyForPickup(call,id);
 const shipment=(await call('/farmer/shipments/'+id+'/book',{confirmDemo:true})).body.shipment;
 const claim='/delivery/shipments/'+shipment.id+'/claim';
 const available=(await call('/delivery/shipments',undefined,'driver')).body.shipments[0];
 assert.equal(available.pickup,null);assert.equal(available.destination.line,undefined);assert.equal(available.destination.phone,undefined);
 assert.equal((await call(claim,{revision:0},'driver','POST','https://bad.example')).status,403);
 const results=await Promise.all([call(claim,{revision:0},'driver'),call(claim,{revision:0},'otherdriver')]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const owner=results[0].status===200?'driver':'otherdriver',other=owner==='driver'?'otherdriver':'driver';
 assert.equal((await call(claim,{revision:0},owner)).status,200);
 const assigned=(await call('/delivery/shipments',undefined,owner)).body.shipments[0];
 assert.equal(assigned.pickup.pickup_address,'123 Farm road');assert.equal(assigned.destination.line,'123 Example road');
 assert.equal((await call('/delivery/shipments',undefined,other)).body.shipments.length,0);
 assert.equal((await call('/delivery/shipments/'+shipment.id+'/advance',{revision:1,status:'picked_up'},other)).status,404);
 db.prepare("UPDATE delivery_partners SET status='suspended' WHERE user_id=?").run(owner);
 assert.equal((await call('/delivery/shipments',undefined,owner)).status,403);
 assert.equal((await call('/delivery/shipments/'+shipment.id+'/advance',{revision:1,status:'picked_up'},owner)).status,403);
});
test('only assigned delivery partner advances ordered steps; demo never changes real stock or payment',async t=>{
 const {db,call,order}=await fixture(t,{courierMode:'demo'});const {id,pa}=await order();await readyForPickup(call,id);
 const shipment=(await call('/farmer/shipments/'+id+'/book',{confirmDemo:true})).body.shipment;
 const path='/delivery/shipments/'+shipment.id+'/advance';
 assert.equal((await call(path,{revision:0,status:'picked_up'},'driver')).status,404);
 await call('/delivery/shipments/'+shipment.id+'/claim',{revision:0},'driver');
 assert.equal((await call(path,{revision:1,status:'delivered'},'driver')).status,409);
 assert.equal((await call(path,{revision:1,status:'picked_up'},'driver','POST','https://bad.example')).status,403);
 const before=db.prepare('SELECT status,payment_status FROM orders WHERE id=?').get(id),stock=db.prepare('SELECT stock FROM products WHERE id=?').get(pa.id).stock;
 let revision=1;
 for(const status of ['picked_up','in_transit','out_for_delivery','delivered']) {
  assert.equal((await call(path,{status,revision},'driver')).status,200);assert.equal((await call(path,{status,revision},'driver')).status,409);revision++;
 }
 assert.equal((await call(path,{status:'delivered',revision},'driver')).status,409);
 assert.equal((await call('/orders/'+id+'/tracking',undefined,'buyer')).body.shipments[0].events.length,6);
 assert.equal(db.prepare('SELECT payment_status FROM orders WHERE id=?').get(id).payment_status,before.payment_status);
 assert.equal((await call('/orders/'+id,undefined,'buyer')).body.order.status,'partially_delivered');
 assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(pa.id).stock,stock);
 assert.equal((await call('/farmer/orders/'+id+'/status',{status:'delivered',expectedStatus:'ready_for_pickup'})).status,409);
});
test('multi-farm test pickups stay separate and cancellation stops partner actions',async t=>{
 const {call,order}=await fixture(t,{courierMode:'demo'});const {id}=await order();await readyForPickup(call,id,'a');await readyForPickup(call,id,'b');
 const a=(await call('/farmer/shipments/'+id+'/book',{confirmDemo:true},'a')).body.shipment;
 const b=(await call('/farmer/shipments/'+id+'/book',{confirmDemo:true},'b')).body.shipment;assert.notEqual(a.id,b.id);
 assert.equal((await call('/orders/'+id+'/tracking',undefined,'buyer')).body.shipments.length,2);
 await call('/delivery/shipments/'+a.id+'/claim',{revision:0},'driver');
 assert.equal((await call('/admin/orders/'+id+'/status',{expectedStatus:'packed',status:'cancelled',reason:'Customer requested cancellation'},'reviewer')).status,200);
 assert.equal((await call('/delivery/shipments/'+a.id+'/advance',{revision:1,status:'picked_up'},'driver')).status,409);
 assert.equal((await call('/delivery/shipments/'+b.id+'/claim',{revision:0},'otherdriver')).status,409);
 assert.equal((await call('/delivery/shipments',undefined,'otherdriver')).body.shipments.length,0);
 assert.equal((await call('/delivery/shipments',undefined,'driver')).body.shipments[0].status,'cancelled');
 assert.equal((await call('/orders/'+id+'/tracking',undefined,'buyer')).body.shipments.every(s=>s.status==='cancelled'),true);
});
test('delivery demo rejects invalid configuration and production use',async()=>{
 const db=openDatabase(':memory:');const old=process.env.NODE_ENV;
 try {
  assert.throws(()=>createApp(db,{courierMode:'pretend-live'}),/COURIER_MODE/);
  process.env.NODE_ENV='production';assert.throws(()=>createApp(db,{courierMode:'demo'}),/disabled in production/);
  assert.ok(createApp(db,{courierMode:'disabled'}));
 } finally {if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;db.close();}
});
test('dedicated signup creates pending farm, ignores claimed approval/ownership, blocks publishing and approval by self',async t=>{
 const {db,call,product}=await fixture(t);
 const input={name:'New Grower',email:'new@example.test',password:'farm account test password',businessName:'New farm',phone:'9876543210',accountType:'admin',accessStatus:'approved',farmId:'a'};
 const r=await call('/auth/farmer-register',input,'');assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.user.requestedAccountType,'farmer');assert.equal(r.body.user.accessStatus,'pending');assert.notEqual(r.body.user.farmId,'a');assert.match(r.cookie,/HttpOnly/);
 assert.equal((await call('/auth/farmer-register',input,'')).status,409);
 assert.equal((await call('/farmer/products',product,'buyer')).status,403);
 assert.equal((await call('/farmer/orders')).status,403);
 assert.equal((await call('/farmer/products',{...product,active:1})).status,403);
 const a=(await call('/access/application')).body.application;
 const review={action:'approve',revision:a.revision,verified:true,note:'Independent connection verified.'};
 assert.equal((await call('/admin/applications/'+a.id+'/review',review,'reviewer')).status,400);
 db.prepare('INSERT INTO admin_users VALUES (?)').run('a');assert.equal((await call('/admin/applications/'+a.id+'/review',review)).status,403);
});
test('pending draft CRUD is private, revision-safe, and hard deletion is forbidden once published',async t=>{
 const {call,product,approve}=await fixture(t);
 const created=await call('/farmer/products',product);assert.equal(created.status,201);const p=created.body.product;
 assert.ok(!(await call('/catalog',undefined,'')).body.products.some(row=>row.id===p.id));
 assert.equal((await call('/farmer/products/'+p.id,{...product,revision:0},'b')).status,404);
 assert.equal((await call('/farmer/products/'+p.id,{revision:0},'b','DELETE')).status,404);
 assert.equal((await call('/farmer/products/'+p.id,{...product,name:'Updated tomatoes',revision:0})).status,200);
 assert.equal((await call('/farmer/products/'+p.id,{revision:0},'a','DELETE')).status,409);
 assert.equal((await call('/farmer/products/'+p.id,{revision:1},'a','DELETE')).status,200);
 await approve();const live=(await call('/farmer/products',{...product,active:1})).body.product;
 assert.ok((await call('/catalog',undefined,'')).body.products.some(row=>row.id===live.id));
 assert.equal((await call('/farmer/products/'+live.id,{...product,revision:0})).status,200);
 assert.equal((await call('/farmer/products/'+live.id,{revision:1},'a','DELETE')).status,409);
 assert.equal((await call('/farmer/products/'+live.id+'/archive',{revision:1})).status,200);
 assert.equal((await call('/farmer/products/'+live.id,{...product,active:1,revision:2})).status,409);
 assert.ok(!(await call('/catalog',undefined,'')).body.products.some(row=>row.id===live.id));
});
test('verified identity changes require re-review and immediately hide selling; profiles remain private',async t=>{
 const {call,approve,profile,product}=await fixture(t);await approve();const p=(await call('/farmer/products',{...product,active:1})).body.product;
 assert.equal((await call('/farmer/profile',undefined,'buyer')).status,403);
 const changed={...profile,name:'Another farm',revision:1};assert.equal((await call('/farmer/profile',changed)).status,409);
 assert.equal((await call('/farmer/profile',{...changed,confirmReverification:true})).status,200);
 assert.equal((await call('/auth/me')).body.user.accessStatus,'pending');assert.equal((await call('/farmer/orders')).status,403);
 assert.ok(!(await call('/catalog',undefined,'')).body.products.some(row=>row.id===p.id));
 assert.equal((await call('/farmer/profile',{...changed,confirmReverification:true})).status,409);
});
test('farm rejection affects own stock and COD payable only, is idempotent, and cancellation never double-restocks',async t=>{
 const {db,call,order}=await fixture(t);const {id,pa,pb}=await order();
 const action='/farmer/orders/'+id+'/reject';
 assert.equal((await call(action,{reason:'Cannot harvest this batch'},'buyer')).status,403);
 assert.equal((await call(action,{reason:'Cannot harvest this batch'},'a','POST','https://foreign.example')).status,403);
 assert.equal((await call(action,{reason:'Cannot harvest this batch'})).status,200);
 assert.equal((await call(action,{reason:'Cannot harvest this batch'})).status,200);
 assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(pa.id).stock,100);
 assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(pb.id).stock,99);
 const latest=(await call('/orders/'+id,undefined,'buyer')).body.order;
 assert.equal(latest.totalPaise,6000);assert.equal(latest.originalTotalPaise,18000);assert.equal(latest.cancelledPaise,12000);assert.match(latest.fulfillments.find(f=>f.farmId===db.prepare('SELECT farm_id FROM account_profiles WHERE user_id=?').get('a').farm_id).rejectionReason,/Cannot harvest/);
 assert.equal((await call('/orders/'+id+'/cancel',{expectedStatus:'placed'},'buyer')).status,200);
 assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(pa.id).stock,100);assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(pb.id).stock,100);
 assert.equal((await call('/orders/'+id,undefined,'buyer')).body.order.totalPaise,0);
});
test('accepted orders cannot be rejected; packed orders expose actual prep events without fabricated courier status',async t=>{
 const {call,order}=await fixture(t);const {id}=await order();
 const step=(from,to)=>call('/farmer/orders/'+id+'/status',{expectedStatus:from,status:to});
 assert.equal((await step('placed','confirmed')).status,200);
 assert.equal((await call('/farmer/orders/'+id+'/reject',{reason:'Changed my mind now'})).status,409);
 assert.equal((await step('confirmed','packed')).status,200);assert.equal((await step('packed','ready_for_pickup')).status,200);
 const shipments=(await call('/farmer/shipments')).body;assert.equal(shipments.courierAvailable,false);assert.equal(shipments.shipments[0].trackingNumber,null);assert.deepEqual(shipments.shipments[0].events.map(e=>e.status),['confirmed','packed','ready_for_pickup']);
 assert.equal((await step('ready_for_pickup','delivered')).status,409);
 assert.equal((await call('/farmer/shipments/'+id+'/book',{})).status,503);
 assert.equal((await call('/farmer/shipments/not-an-order/book',{})).status,404);
});
test('all farms rejecting cancels payment; admin cancellation after a partial rejection restores only remaining stock',async t=>{
 const {db,call,order}=await fixture(t);const {id,pa,pb}=await order();
 await call('/farmer/orders/'+id+'/reject',{reason:'Produce unavailable today'});
 await call('/admin/orders/'+id+'/status',{expectedStatus:'placed',status:'cancelled',reason:'Customer requested cancellation'},'reviewer');
 assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(pa.id).stock,100);assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(pb.id).stock,100);
 const address={name:'Test Buyer',phone:'9876543210',line:'123 Example road',city:'Pune',pincode:'411001'};
 const placed=await call('/orders',{requestKey:randomUUID(),address,items:[{productId:pa.id,quantity:1}],expectedSubtotalPaise:6000},'buyer');const one=placed.body.order.id;
 await call('/farmer/orders/'+one+'/reject',{reason:'Produce unavailable today'});
 const result=(await call('/orders/'+one,undefined,'buyer')).body.order;assert.equal(result.status,'cancelled');assert.equal(result.paymentStatus,'cancelled');assert.equal(result.totalPaise,0);
});

test('produce templates and details persist, old edits preserve metadata, catalog shows city but never pickup street',async t=>{
 const {db,call,approve,product}=await fixture(t);
 const draft={...product,image:'/produce/tomatoes.svg',variety:'Cherry',qualityNotes:'Firm and ripe, sorted by hand.',harvestDate:'2025-01-10'};
 const created=await call('/farmer/products',draft);assert.equal(created.status,201,JSON.stringify(created.body));const p=created.body.product;
 assert.equal(p.variety,'Cherry');assert.equal(p.harvestDate,'2025-01-10');assert.equal(p.qualityNotes,draft.qualityNotes);
 assert.equal((await call('/farmer/products/'+p.id,{...product,image:draft.image,revision:0})).status,200);
 const own=(await call('/farmer/products')).body.products.find(row=>row.id===p.id);assert.equal(own.qualityNotes,draft.qualityNotes);
 await approve();assert.equal((await call('/farmer/products/'+p.id,{...draft,active:1,revision:1})).status,200);
 const publicProduct=(await call('/catalog',undefined,'')).body.products.find(row=>row.id===p.id);
 assert.equal(publicProduct.image,draft.image);assert.equal(publicProduct.variety,'Cherry');assert.equal(publicProduct.farmCity,'Pune');assert.equal(publicProduct.qualityNotes,draft.qualityNotes);
 assert.ok(!JSON.stringify(publicProduct).includes('123 Farm road'));assert.equal(publicProduct.phone,undefined);assert.equal(publicProduct.pincode,undefined);
 assert.equal(db.prepare('SELECT harvest_date FROM products WHERE id=?').get(p.id).harvest_date,'2025-01-10');
});
test('new produce fields reject impossible/future dates, oversized descriptions and untrusted local image paths',async t=>{
 const {call,product}=await fixture(t);
 for(const harvestDate of ['2025-02-30','9999-12-31','1999-01-01','not-a-date',123])assert.equal((await call('/farmer/products',{...product,harvestDate})).status,400);
 for(const extra of [{variety:'x'.repeat(81)},{qualityNotes:'x'.repeat(501)},{qualityNotes:{bad:'value'}},{image:'/produce/../../secret.svg'},{image:'/produce/unknown.svg'},{image:'data:image/svg+xml,bad'}])assert.equal((await call('/farmer/products',{...product,...extra})).status,400);
 const today=new Date(Date.now()+330*60*1000).toISOString().slice(0,10);
 assert.equal((await call('/farmer/products',{...product,image:'/produce/spinach.svg',harvestDate:today})).status,201);
 assert.equal((await call('/farmer/products',{...product,image:'/produce/mangoes.svg'})).status,201);
});


test('photo uploads enforce farmer access, origin, content limits, ownership and private drafts',async t=>{
 const {db,call,approve,product,base,cookies}=await fixture(t);
 const bytes=readFileSync(new URL('./fixtures/photo.jpg',import.meta.url));
 const upload=(user='a',body=bytes,origin=base,type='image/jpeg')=>fetch(base+'/api/farmer/photos',{method:'POST',headers:{Cookie:cookies[user]??'',Origin:origin,'Content-Type':type},body});
 assert.equal((await upload('')).status,401);
 assert.equal((await upload('buyer')).status,403);
 assert.equal((await upload('a',bytes,'https://outside.test')).status,403);
 assert.equal((await upload('a',Buffer.from('<svg/>'))).status,400);
 assert.equal((await upload('a',bytes,base,'image/svg+xml')).status,415);
 assert.equal((await upload('a',Buffer.alloc(1024*1024+1))).status,413);
 const response=await upload();assert.equal(response.status,201);const {image}=await response.json();
 assert.equal((await fetch(base+image)).status,404);
 assert.equal((await fetch(base+image,{headers:{Cookie:cookies.b}})).status,404);
 const own=await fetch(base+image,{headers:{Cookie:cookies.a}});assert.equal(own.status,200);assert.equal(own.headers.get('content-type'),'image/jpeg');assert.match(own.headers.get('content-security-policy'),/sandbox/);
 assert.equal((await call('/farmer/products',{...product,image},'b')).status,400);
 const draft=await call('/farmer/products',{...product,image});assert.equal(draft.status,201);
 await approve();assert.equal((await call('/farmer/products/'+draft.body.product.id,{...product,image,active:1,revision:0})).status,200);
 assert.equal((await fetch(base+image)).status,200);
 db.prepare("UPDATE account_profiles SET access_status='suspended' WHERE user_id='a'").run();
 assert.equal((await fetch(base+image)).status,404);assert.equal((await upload()).status,403);
 db.prepare("UPDATE account_profiles SET access_status='approved' WHERE user_id='a'").run();
 const farmId=db.prepare("SELECT farm_id FROM account_profiles WHERE user_id='a'").get().farm_id;
 for(let i=0;i<19;i++)db.prepare('INSERT INTO product_photos VALUES (?,?,?,?)').run('quota-'+i,farmId,bytes,Date.now());
 assert.equal((await upload()).status,429);
});
test('photo sanitizing strips EXIF and rejects oversized dimensions',()=>{
 const bytes=readFileSync(new URL('./fixtures/photo.jpg',import.meta.url));
 const secret=Buffer.from('GPS-private-location');const header=Buffer.alloc(4);header[0]=255;header[1]=225;header.writeUInt16BE(secret.length+2,2);
 const cleaned=cleanJpeg(Buffer.concat([bytes.subarray(0,2),header,secret,bytes.subarray(2)]));assert.equal(cleaned.includes(secret),false);
 const huge=Buffer.from(cleaned);let pos=2;while(pos<huge.length){const marker=huge[pos+1];if([0xc0,0xc1,0xc2].includes(marker)){huge.writeUInt16BE(2000,pos+5);break;}pos+=2+huge.readUInt16BE(pos+2);}
 assert.throws(()=>cleanJpeg(huge));
});


test('farmer order search paginates beyond 100 and isolates product searches and counts',async t=>{
 const {db,call,order}=await fixture(t);const {id,pa,pb}=await order();
 const farmA=db.prepare('SELECT farm_id FROM products WHERE id=?').get(pa.id).farm_id;
 const farmB=db.prepare('SELECT farm_id FROM products WHERE id=?').get(pb.id).farm_id;
 const original=db.prepare('SELECT * FROM orders WHERE id=?').get(id);
 const insert=db.prepare('INSERT INTO orders('+Object.keys(original).join(',')+') VALUES ('+Object.keys(original).map(()=>'?').join(',')+')');
 for(let i=0;i<105;i++){
  const row={...original,id:'page-'+String(i).padStart(3,'0'),request_key:randomUUID(),created_at:original.created_at+i+1,purchase_kind:i%2?'bulk_buyer':'consumer',business_name:i%2?'Harvest Cafe':''};
  insert.run(...Object.values(row));
  db.prepare('INSERT INTO farm_fulfillments(order_id,farm_id,status,updated_at) VALUES (?,?,?,?)').run(row.id,farmA,'placed',Date.now());
 }
 const first=(await call('/farmer/orders?limit=20')).body;
 assert.equal(first.total,106);assert.equal(first.orders.length,20);assert.equal(first.counts.placed,106);
 const last=(await call('/farmer/orders?limit=20&page=6')).body;assert.equal(last.orders.length,6);
 const ids=new Set();for(let page=1;page<=6;page++)for(const row of (await call('/farmer/orders?limit=20&page='+page)).body.orders){assert.ok(!ids.has(row.id));ids.add(row.id);}assert.equal(ids.size,106);
 const bulk=(await call('/farmer/orders?kind=bulk_buyer&search=harvest')).body;assert.equal(bulk.total,52);assert.ok(bulk.orders.every(row=>row.purchaseKind==='bulk_buyer'));
 assert.equal((await call('/farmer/orders?search=page-104')).body.total,1);
 assert.equal((await call('/farmer/orders?search=%25')).body.total,0);
 db.prepare("UPDATE order_items SET name='OtherFarmSecretCrop' WHERE order_id=? AND farm_id=?").run(id,farmB);
 assert.equal((await call('/farmer/orders?search=OtherFarmSecretCrop')).body.total,0);
 const other=(await call('/farmer/orders',undefined,'b')).body;assert.equal(other.total,1);assert.equal(other.counts.placed,1);
 db.prepare("UPDATE orders SET status='delivered' WHERE id=?").run(id);
 assert.equal((await call('/farmer/orders?status=delivered')).body.total,1);
 assert.equal((await call('/farmer/orders?status=placed')).body.total,105);
 for(const query of ['page=0','limit=101','status=fake','kind=farmer','search='+('x'.repeat(101))])assert.equal((await call('/farmer/orders?'+query)).status,400);
 assert.equal((await call('/farmer/orders?search=page',undefined,'buyer')).status,403);
});


test('shared kg inventory prices mixed weights, handles bulk and restores grams once',async t=>{
 const {db,call,approve,product}=await fixture(t);await approve();
 const weight={...product,unit:'kg',saleMode:'weight',presetId:'tomatoes',pricePaise:4000,bulkPricePaise:3500,bulkMin:10000,stock:2000000,active:1};
 const created=await call('/farmer/products',weight);assert.equal(created.status,201,JSON.stringify(created.body));const p=created.body.product;
 assert.equal(p.stock,2000000);assert.equal(p.saleMode,'weight');
 const cat=(await call('/catalog',undefined,'buyer')).body.products.find(row=>row.id===p.id);assert.equal(cat.stock,2000000);assert.equal(cat.pricePaise,4000);
 for(const [quantity,total] of [[250,1000],[500,2000],[1000,4000],[10000,35000]]){
  const quote=await call('/cart/quote',{items:[{productId:p.id,quantity}]},'buyer');assert.equal(quote.status,200);assert.equal(quote.body.subtotalPaise,total);
 }
 assert.equal((await call('/cart/quote',{items:[{productId:p.id,quantity:251}]},'buyer')).status,400);
 assert.equal((await call('/farmer/products',{...weight,category:'Fruits'})).status,400);
 assert.equal((await call('/farmer/products/'+p.id+'/restock',{revision:0,amount:1900000,action:'remove',reason:'Correct initial demo stock'})).status,200);
 const address={name:'Test buyer',phone:'9876543210',line:'123 Farm road',city:'Pune',pincode:'411001'};
 const place=quantity=>call('/orders',{requestKey:randomUUID(),address,items:[{productId:p.id,quantity}],expectedSubtotalPaise:Math.round(quantity*4000/1000)},'buyer');
 const first=await place(250);assert.equal(first.status,201,JSON.stringify(first.body));assert.equal(first.body.order.items[0].lineTotalPaise,1000);assert.equal(first.body.order.items[0].saleMode,'weight');
 const second=await place(500);assert.equal(second.status,201);assert.equal(db.prepare('SELECT stock_grams FROM products WHERE id=?').get(p.id).stock_grams,99250);
 const farmerOrder=(await call('/farmer/orders')).body.orders.find(row=>row.id===first.body.order.id);assert.equal(farmerOrder.totalPaise,1000);
 assert.equal((await call('/farmer/orders/'+first.body.order.id+'/reject',{reason:'Demo unavailable harvest'})).status,200);
 assert.equal((await call('/farmer/orders/'+first.body.order.id+'/reject',{reason:'Demo unavailable harvest'})).status,200);
 assert.equal(db.prepare('SELECT stock_grams FROM products WHERE id=?').get(p.id).stock_grams,99500);
 const rejected=(await call('/orders/'+first.body.order.id,undefined,'buyer')).body.order;assert.equal(rejected.cancelledPaise,1000);assert.equal(rejected.totalPaise,0);
 const cancelled=await call('/orders/'+second.body.order.id+'/cancel',{expectedStatus:'placed'},'buyer');assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));
 assert.equal(db.prepare('SELECT stock_grams FROM products WHERE id=?').get(p.id).stock_grams,100000);
 assert.equal((await call('/farmer/products/'+p.id,{...weight,saleMode:'pack',revision:5})).status,400);
});
test('weight checkout rounds at line level and cannot oversell the last shared grams',async t=>{
 const {db,call,approve,product}=await fixture(t);await approve();
 const p=(await call('/farmer/products',{...product,unit:'kg',saleMode:'weight',stock:250,pricePaise:3999,bulkPricePaise:3999,bulkMin:10000,active:1})).body.product;
 const body={requestKey:randomUUID(),address:{name:'Test buyer',phone:'9876543210',line:'123 Farm road',city:'Pune',pincode:'411001'},items:[{productId:p.id,quantity:250}],expectedSubtotalPaise:1000};
 const result=await Promise.all([call('/orders',body,'buyer'),call('/orders',{...body,requestKey:randomUUID()},'reviewer')]);assert.deepEqual(result.map(r=>r.status).sort(),[201,409]);
 assert.equal(db.prepare('SELECT stock_grams FROM products WHERE id=?').get(p.id).stock_grams,0);
 const saved=result.find(r=>r.status===201).body.order;assert.equal(saved.items[0].lineTotalPaise,1000);
});


test('quick restock adds shared grams once, preserves listing and enforces ownership/revisions',async t=>{
 const {db,call,product}=await fixture(t);
 const p=(await call('/farmer/products',{...product,unit:'kg',saleMode:'weight',stock:99250,bulkMin:10000})).body.product;
 const route='/farmer/products/'+p.id+'/restock';
 assert.equal((await call(route,{amount:25500,revision:0},'b')).status,404);
 assert.equal((await call(route,{amount:25500,revision:0},'buyer')).status,403);
 assert.equal((await call(route,{amount:25500,revision:0},'a','POST','https://outside.example')).status,403);
 for(const amount of [0,-1,0.5,1000000000])assert.equal((await call(route,{amount,revision:0})).status,400);
 const results=await Promise.all([call(route,{amount:25500,revision:0}),call(route,{amount:25500,revision:0})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const updated=results.find(r=>r.status===200).body.product;assert.equal(updated.stock,124750);assert.equal(updated.pricePaise,p.pricePaise);assert.equal(updated.active,0);
 db.prepare('UPDATE products SET stock_grams=stock_grams-250,revision=revision+1 WHERE id=?').run(p.id);
 assert.equal((await call(route,{amount:1000,revision:1})).status,409);
 assert.equal((await call(route,{amount:1000,revision:2})).body.product.stock,125500);
 db.prepare('UPDATE products SET archived=1 WHERE id=?').run(p.id);assert.equal((await call(route,{amount:1000,revision:3})).status,409);
 const pack=(await call('/farmer/products',product)).body.product;
 assert.equal((await call('/farmer/products/'+pack.id+'/restock',{amount:20,revision:0})).body.product.stock,120);
});


test('listing edits cannot change stock; reductions require a reason and persist an audit',async t=>{
 const {db,call,product}=await fixture(t);const p=(await call('/farmer/products',product)).body.product;
 assert.equal((await call('/farmer/products/'+p.id,{...product,stock:25,revision:0})).status,400);
 const {stock,...details}=product;assert.equal((await call('/farmer/products/'+p.id,{...details,name:'Updated tomatoes',revision:0})).status,200);
 assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(p.id).stock,100);
 const route='/farmer/products/'+p.id+'/restock';
 assert.equal((await call(route,{amount:10,action:'remove',revision:1})).status,400);
 assert.equal((await call(route,{amount:101,action:'remove',reason:'Spoiled during storage',revision:1})).status,400);
 const body={amount:10,action:'remove',reason:'Spoiled during storage',revision:1};assert.equal((await call(route,body)).body.product.stock,90);
 assert.equal((await call(route,body)).status,409);
 const audit=db.prepare('SELECT * FROM inventory_adjustments WHERE product_id=?').all(p.id);assert.equal(audit.length,1);assert.equal(audit[0].quantity_change,-10);assert.equal(audit[0].previous_stock,100);assert.equal(audit[0].new_stock,90);assert.equal(audit[0].reason,body.reason);
});


test('stock history is private, cursor paginated and exposes only adjustment fields',async t=>{
 const {db,call,product}=await fixture(t);const p=(await call('/farmer/products',product)).body.product;
 const route='/farmer/products/'+p.id+'/stock-history';
 assert.equal((await call(route,undefined,'b')).status,404);assert.equal((await call(route,undefined,'buyer')).status,403);
 assert.deepEqual((await call(route)).body,{adjustments:[],nextCursor:null});
 for(let i=0;i<23;i++)db.prepare('INSERT INTO inventory_adjustments(product_id,actor_id,sale_mode,quantity_change,previous_stock,new_stock,reason,created_at) VALUES (?,?,?,?,?,?,?,?)').run(p.id,'a','pack',1,100+i,101+i,'Test harvest addition',Date.now());
 const first=(await call(route)).body;assert.equal(first.adjustments.length,20);assert.ok(first.nextCursor);assert.equal(first.adjustments[0].newStock,123);assert.equal(first.adjustments[0].actor_id,undefined);
 const second=(await call(route+'?before='+first.nextCursor)).body;assert.equal(second.adjustments.length,3);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.adjustments,...second.adjustments].map(row=>row.id)).size,23);
 assert.equal((await call(route+'?before=wrong')).status,400);
 db.prepare("UPDATE account_profiles SET access_status='suspended' WHERE user_id='a'").run();assert.equal((await call(route)).status,403);
});
