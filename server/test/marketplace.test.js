import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { openDatabase,seedDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
async function fixture(t){
 const db=openDatabase(':memory:');seedDatabase(db);const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});db.close();});const base=`http://127.0.0.1:${server.address().port}`;
 async function request(path,body,cookie='',origin=base){const response=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('reviewer','Reviewer','reviewer@example.test','unused','customer',Date.now());
 db.prepare('INSERT INTO admin_users VALUES (?)').run('reviewer');
 const operatorToken=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(operatorToken).digest('hex'),'reviewer',Date.now()+60000);const operator='farmconnect_session='+operatorToken;
 async function register(email,accountType,businessName){
  const r=await request('/auth/register',{name:'Test User',email,password:'test only long password phrase'});assert.equal(r.status,201,JSON.stringify(r.body));
  if(accountType!=='consumer'){
   const application=await request('/access/application',{accountType,businessName,phone:'9876543210',location:'Pune farm location',evidence:'Test farm/business verified by an independent reviewer.'},r.cookie);assert.equal(application.status,200);
   let a=application.body.application;
   if(accountType==='farmer'){
    assert.equal((await request('/farmer/profile',{name:businessName,phone:'9876543210',pickup_address:'123 Test farm road',city:'Pune',pincode:'411001',evidence:'Test farm independently verified by reviewer.',revision:0},r.cookie)).status,200);
    a=(await request('/access/application',undefined,r.cookie)).body.application;
   }
   const approval=await request('/admin/applications/'+a.id+'/review',{action:'approve',revision:a.revision,verified:true,note:'Test contact and organisation connection independently checked.'},operator);assert.equal(approval.status,200);
   if(accountType==='bulk_buyer')assert.equal((await request('/access/redeem',{code:approval.body.invitationCode},r.cookie)).status,200);else assert.equal(approval.body.activated,true);
   r.body=(await request('/auth/me',undefined,r.cookie)).body;
  }
  return r;
 }
 const address={name:'Buyer Person',phone:'9876543210',line:'123 Sample Street',city:'Pune',pincode:db.prepare('SELECT pincode FROM delivery_areas WHERE active=1 LIMIT 1').get().pincode};
 const product={name:'Fresh farm tomatoes',category:'Vegetables',unit:'1 kg pack',pricePaise:6000,bulkPricePaise:4500,bulkMin:5,stock:100,image:'',photoCredit:'',active:1};
 return {db,request,register,address,product};
}
test('account roles persist across login; no role can claim admin or an existing farm',async t=>{
 const {db,request,register}=await fixture(t);
 const farmer=await register('farmer@example.test','farmer','Own Farm');
 assert.equal(farmer.body.user.accountType,'farmer');assert.ok(farmer.body.user.farmId);
 const login=await request('/auth/login',{email:'farmer@example.test',password:'test only long password phrase',accountType:'bulk_buyer'});
 assert.equal(login.body.user.accountType,'farmer');assert.equal(login.body.user.farmId,farmer.body.user.farmId);
 const consumer=await register('consumer@example.test','consumer','');
 assert.equal((await request('/farmer/products',undefined,consumer.cookie)).status,403);
 assert.equal((await request('/admin/products',undefined,farmer.cookie)).status,403);
 const invalid=await request('/auth/register',{name:'Test Admin',email:'admin@example.test',password:'test only long password phrase',accountType:'admin'});assert.equal(invalid.status,400);
 assert.equal(db.prepare('SELECT count(*) AS n FROM admin_users').get().n,1);
});
test('farmers create and edit only their products; listings enter the public catalog',async t=>{
 const {request,register,product}=await fixture(t);
 const a=await register('a@example.test','farmer','Farm A'),b=await register('b@example.test','farmer','Farm B');
 const created=await request('/farmer/products',{...product,farmId:b.body.user.farmId},a.cookie);assert.equal(created.status,201);
 const own=(await request('/farmer/products',undefined,a.cookie)).body.products;assert.equal(own.length,1);
 assert.equal((await request('/farmer/products',undefined,b.cookie)).body.products.length,0);
 const catalog=(await request('/catalog')).body.products.find(p=>p.id===created.body.product.id);assert.equal(catalog.farmName,'Farm A');
 assert.equal((await request('/farmer/products/'+catalog.id,{...product,revision:0},b.cookie)).status,404);
 assert.equal((await request('/farmer/products/'+catalog.id+'/restock',{amount:20,action:'remove',reason:'Damaged during sorting',revision:0},a.cookie)).status,200);
 assert.equal((await request('/farmer/products/'+catalog.id,{...product,stock:90,revision:0},a.cookie)).status,409);
 assert.equal((await request('/farmer/products',{...product,image:'javascript:alert(1)'},a.cookie)).status,400);
 assert.equal((await request('/farmer/products',product,a.cookie,'https://evil.example')).status,403);
});
test('multi-farm bulk orders isolate items and totals, apply bulk rates, and stop at courier handoff',async t=>{
 const {db,request,register,address,product}=await fixture(t);
 const a=await register('a@example.test','farmer','Farm A'),b=await register('b@example.test','farmer','Farm B'),buyer=await register('hotel@example.test','bulk_buyer','Test Hotel');
 const pa=(await request('/farmer/products',product,a.cookie)).body.product,pb=(await request('/farmer/products',{...product,name:'Other farm carrots'},b.cookie)).body.product;
 const payload={requestKey:randomUUID(),address,items:[{productId:pa.id,quantity:5},{productId:pb.id,quantity:1}],expectedSubtotalPaise:28500};
 const placed=await request('/orders',{...payload,purchaseKind:'consumer',businessName:'Spoofed'},buyer.cookie);assert.equal(placed.status,201,JSON.stringify(placed.body));const id=placed.body.order.id;
 assert.equal(placed.body.order.purchaseKind,'bulk_buyer');assert.equal(placed.body.order.businessName,'Test Hotel');assert.equal(placed.body.order.fulfillments.length,2);
 const aOrder=(await request('/farmer/orders',undefined,a.cookie)).body.orders[0],bOrder=(await request('/farmer/orders',undefined,b.cookie)).body.orders[0];
 assert.equal(aOrder.items.length,1);assert.equal(aOrder.items[0].productId,pa.id);assert.equal(aOrder.totalPaise,22500);assert.equal(bOrder.totalPaise,6000);
 assert.equal((await request('/orders/'+id,undefined,a.cookie)).status,404);
 const step=(cookie,expectedStatus,status)=>request('/farmer/orders/'+id+'/status',{expectedStatus,status},cookie);
 assert.equal((await step(a.cookie,'placed','delivered')).status,409);
 assert.equal((await step(a.cookie,'placed','confirmed')).status,200);
 assert.equal((await request('/orders/'+id+'/cancel',{expectedStatus:'confirmed'},buyer.cookie)).status,409);
 assert.equal((await step(a.cookie,'confirmed','packed')).status,200);assert.equal((await step(a.cookie,'packed','ready_for_pickup')).status,200);
 assert.equal(db.prepare('SELECT status FROM farm_fulfillments WHERE order_id=? AND farm_id=?').get(id,b.body.user.farmId).status,'placed');
 assert.equal(db.prepare('SELECT status,payment_status FROM orders WHERE id=?').get(id).status,'confirmed');
 assert.equal((await step(a.cookie,'ready_for_pickup','out_for_delivery')).status,409);
 await step(b.cookie,'placed','confirmed');await step(b.cookie,'confirmed','packed');
 assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(id).status,'packed');
 db.prepare('INSERT INTO admin_users VALUES (?)').run(a.body.user.id);
 assert.equal((await request('/admin/orders/'+id+'/status',{expectedStatus:'packed',status:'out_for_delivery'},a.cookie)).status,409);
 assert.equal(db.prepare('SELECT payment_status FROM orders WHERE id=?').get(id).payment_status,'pending');
});
test('cancelling an unaccepted mixed order cancels every farm and restores stock once',async t=>{
 const {db,request,register,address,product}=await fixture(t);
 const farmer=await register('farm@example.test','farmer','Own Farm'),buyer=await register('buyer@example.test','consumer','');
 const p=(await request('/farmer/products',product,farmer.cookie)).body.product;
 const id=(await request('/orders',{requestKey:randomUUID(),address,items:[{productId:p.id,quantity:1}],expectedSubtotalPaise:6000},buyer.cookie)).body.order.id;
 assert.equal((await request('/orders/'+id+'/cancel',{expectedStatus:'placed'},buyer.cookie)).status,200);
 assert.equal((await request('/orders/'+id+'/cancel',{expectedStatus:'placed'},buyer.cookie)).status,200);
 assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(p.id).stock,100);
 assert.equal((await request('/farmer/orders',undefined,farmer.cookie)).body.orders[0].status,'cancelled');
 assert.equal((await request('/farmer/orders/'+id+'/status',{expectedStatus:'placed',status:'confirmed'},farmer.cookie)).status,409);
});

