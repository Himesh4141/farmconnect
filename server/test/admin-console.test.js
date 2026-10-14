import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { randomBytes,createHash,randomUUID } from 'node:crypto';
import { openDatabase,seedDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createProfile } from '../src/profiles.js';
import { placeOrder } from '../src/orders.js';
import { ensureDemoPickup } from '../src/courier.js';

async function fixture(t,options={}) {
  const db=openDatabase(':memory:');seedDatabase(db);const cookies={};
  for(const id of ['buyer','farmer','driver','admin']){
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id,id+'@example.test','unused','customer',Date.now());
    createProfile(db,id,{accountType:id==='farmer'?'farmer':'consumer',businessName:'Test farm',phone:'9876543210'});
    const token=randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+600000);
    cookies[id]=['farmconnect_session','farmconnect_farmer_session','farmconnect_delivery_session'].map(k=>k+'='+token).join('; ');
  }
  db.prepare("INSERT INTO admin_users VALUES ('admin')").run();
  db.prepare("INSERT INTO delivery_partners VALUES ('driver','9876543210','pending',?)").run(Date.now());
  const farmId=db.prepare("SELECT farm_id FROM account_profiles WHERE user_id='farmer'").get().farm_id;
  db.prepare("UPDATE account_profiles SET access_status='approved' WHERE user_id='farmer'").run();
  db.prepare("UPDATE farm_details SET pickup_address='123 Farm Road',city='Pune',pincode='411001' WHERE farm_id=?").run(farmId);
  db.prepare("UPDATE products SET farm_id=?,sale_mode='weight',unit='kg',stock_grams=10000,bulk_min_grams=5000,price_paise=4000,bulk_price_paise=3500 WHERE id='tomatoes'").run(farmId);
  const server=createApp(db,{courierMode:'demo',...options}).listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});db.close();});
  async function req(path,body,user='admin',origin=base){const response=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:cookies[user]??'',Origin:origin},body:body?JSON.stringify(body):undefined});return {status:response.status,body:response.headers.get('content-type')?.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer())};}
  const payload=()=>({requestKey:randomUUID(),address:{name:'Test Buyer',phone:'9876543210',line:'123 Test Road',city:'Pune',pincode:'411001'},items:[{productId:'tomatoes',quantity:250}],expectedSubtotalPaise:1000});
  return {db,req,farmId,payload};
}
const reason='Verified by the test operator';
test('admin can review unpublished farmer photos without exposing them to buyers or delivery accounts',async t=>{
  const {db,req,farmId}=await fixture(t),id=randomUUID()+'.jpg',bytes=readFileSync(new URL('./fixtures/photo.jpg',import.meta.url));
  db.prepare('INSERT INTO product_photos VALUES (?,?,?,?)').run(id,farmId,bytes,Date.now());
  assert.equal((await req('/photos/'+id,undefined,'buyer')).status,404);
  assert.equal((await req('/photos/'+id,undefined,'driver')).status,404);
  assert.equal((await req('/photos/'+id,undefined,'farmer')).status,200);
  const photo=await req('/photos/'+id);assert.equal(photo.status,200);assert.deepEqual(photo.body,bytes);
  db.prepare("DELETE FROM admin_users WHERE user_id='admin'").run();
  assert.equal((await req('/photos/'+id)).status,404);
});
test('console reads and mutations enforce admin access, CSRF and reason validation',async t=>{
  const {req,db}=await fixture(t);
  for(const path of ['/summary','/catalog','/directory','/delivery-partners','/activity','/shipments']){
    assert.equal((await req('/admin'+path,undefined,'buyer')).status,403);
    assert.equal((await req('/admin'+path,undefined,'missing')).status,401);
    assert.equal((await req('/admin'+path)).status,200);
  }
  assert.equal((await req('/admin/controls',{paused:true,revision:0,reason},'admin','https://evil.example')).status,403);
  assert.equal((await req('/admin/controls',{paused:true,revision:0,reason:'tiny'})).status,400);
  assert.equal((await req('/admin/catalog?page=-1')).status,400);
  assert.equal((await req('/admin/directory?role=owner')).status,400);
  db.prepare("DELETE FROM admin_users WHERE user_id='admin'").run();
  assert.equal((await req('/admin/summary')).status,403);
});
test('listing moderation blocks catalog and checkout, survives farmer editing, preserves past orders and supports safe restore',async t=>{
  const {db,req,payload}=await fixture(t);
  const order=placeOrder(db,'buyer',payload(),'demo').order;
  assert.equal((await req('/admin/catalog/tomatoes/moderation',{blocked:true,revision:0,reason})).status,200);
  assert.equal((await req('/catalog',undefined,'buyer')).body.products.some(p=>p.id==='tomatoes'),false);
  assert.equal((await req('/orders',payload(),'buyer')).status,404);
  const product=(await req('/farmer/products',undefined,'farmer')).body.products.find(p=>p.id==='tomatoes');
  assert.equal(product.moderationBlocked,1);
  assert.equal((await req('/farmer/products/tomatoes',{...product,active:1,name:'Updated tomatoes'},'farmer')).status,200);
  assert.equal((await req('/products/tomatoes',undefined,'buyer')).status,404);
  assert.equal((await req('/orders/'+order.id,undefined,'buyer')).body.order.totalPaise,1000);
  assert.equal(db.prepare("SELECT stock_grams FROM products WHERE id='tomatoes'").get().stock_grams,9750);
  assert.equal((await req('/admin/catalog/tomatoes/moderation',{blocked:false,revision:0,reason})).status,409);
  assert.equal((await req('/admin/catalog/tomatoes/moderation',{blocked:false,revision:1,reason})).status,200);
  assert.equal((await req('/orders',payload(),'buyer')).status,201);
  const events=(await req('/admin/activity?q=listing_')).body.events;
  assert.deepEqual(new Set(events.map(e=>e.action)),new Set(['listing_hidden','listing_restored']));
});
test('ordering pause preserves retry identity and existing order cancellation; stale updates fail',async t=>{
  const {db,req,payload}=await fixture(t);const body=payload();const created=placeOrder(db,'buyer',body,'demo').order;
  assert.equal((await req('/admin/controls',{paused:true,revision:0,reason})).status,200);
  assert.equal((await req('/store/config')).body.checkoutEnabled,false);
  assert.equal((await req('/orders',payload(),'buyer')).status,503);
  const replay=await req('/orders',body,'buyer');assert.equal(replay.status,200);assert.equal(replay.body.order.id,created.id);
  assert.equal((await req('/orders/'+created.id+'/cancel',{expectedStatus:'placed'},'buyer')).status,200);
  assert.equal(db.prepare("SELECT stock_grams FROM products WHERE id='tomatoes'").get().stock_grams,10000);
  assert.equal((await req('/admin/controls',{paused:false,revision:0,reason})).status,409);
  assert.equal((await req('/admin/controls',{paused:false,revision:1,reason})).status,200);
  assert.equal((await req('/orders',payload(),'buyer')).status,201);
});
test('admin cannot override deployment-disabled ordering; mutations roll back if the audit write fails',async t=>{
  const {db,req,payload}=await fixture(t,{checkoutEnabled:false});
  assert.equal((await req('/admin/controls',{paused:false,revision:0,reason})).status,200);
  assert.equal((await req('/store/config')).body.checkoutEnabled,false);
  assert.equal((await req('/orders',payload(),'buyer')).status,503);
  db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON admin_events BEGIN SELECT RAISE(ABORT,'audit failure'); END");
  assert.equal((await req('/admin/catalog/tomatoes/moderation',{blocked:true,revision:0,reason})).status,500);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM listing_moderation').get().n,0);
});
test('delivery verification and suspension preserve custody and revoke current-session operations',async t=>{
  const {db,req,payload,farmId}=await fixture(t);
  assert.equal((await req('/admin/delivery-partners/driver/access',{status:'approved',expectedStatus:'pending',reason})).status,400);
  assert.equal((await req('/admin/delivery-partners/driver/access',{status:'approved',expectedStatus:'pending',verified:true,reason})).status,200);
  assert.equal((await req('/admin/access',undefined,'driver')).body.isAdmin,false);
  const shipments=[];
  for(let n=0;n<2;n++){
    const order=placeOrder(db,'buyer',payload(),'demo').order;
    db.prepare("UPDATE farm_fulfillments SET status='ready_for_pickup' WHERE order_id=?").run(order.id);
    const shipment=ensureDemoPickup(db,order.id,farmId,'farmer').shipment;
    const claim=await req('/delivery/shipments/'+shipment.id+'/claim',{revision:shipment.revision},'driver');assert.equal(claim.status,200);
    shipments.push(claim.body.shipment);
  }
  const picked=await req('/delivery/shipments/'+shipments[1].id+'/advance',{revision:shipments[1].revision,status:'picked_up'},'driver');assert.equal(picked.status,200);
  assert.equal((await req('/admin/delivery-partners/driver/access',{status:'suspended',expectedStatus:'approved',reason})).status,200);
  assert.equal(db.prepare('SELECT assigned_to FROM demo_shipments WHERE id=?').get(shipments[0].id).assigned_to,null);
  assert.equal(db.prepare('SELECT assigned_to FROM demo_shipments WHERE id=?').get(shipments[1].id).assigned_to,'driver');
  assert.equal((await req('/delivery/shipments',undefined,'driver')).status,403);
  assert.equal((await req('/admin/summary')).body.counts.deliveryExceptions,1);
  const oversight=(await req('/admin/shipments?status=picked_up&mode=demo')).body;assert.equal(oversight.total,1);assert.equal(oversight.shipments[0].partnerStatus,'suspended');
  assert.equal((await req('/admin/shipments?q=Unassigned')).body.total,1);
  assert.equal((await req('/admin/delivery-partners/driver/access',{status:'approved',expectedStatus:'approved',verified:true,reason})).status,409);
});
test('account directory exposes no credentials; revocation signs out the target without changing roles',async t=>{
  const {req,db}=await fixture(t);
  const data=await req('/admin/directory?q=buyer&role=consumer');assert.equal(data.body.total,1);
  assert.equal(JSON.stringify(data.body).includes('password_hash'),false);assert.equal(JSON.stringify(data.body).includes('token_hash'),false);
  assert.equal((await req('/admin/directory/admin/revoke-sessions',{reason})).status,403);
  assert.equal((await req('/admin/directory/buyer/revoke-sessions',{reason})).status,200);
  assert.equal((await req('/orders',undefined,'buyer')).status,401);
  assert.equal(db.prepare("SELECT account_type FROM account_profiles WHERE user_id='buyer'").get().account_type,'consumer');
  assert.equal((await req('/admin/activity?q=sessions_revoked')).body.total,1);
});
test('orders and applications paginate beyond old caps and cancellation records the reason once',async t=>{
  const {req,db,payload}=await fixture(t);
  db.prepare("UPDATE products SET stock_grams=100000 WHERE id='tomatoes'").run();
  for(let n=0;n<105;n++)placeOrder(db,'buyer',payload(),'demo');
  const page=await req('/admin/orders?q=tomatoes&mode=demo&page=6');assert.equal(page.status,200);assert.equal(page.body.total,105);assert.equal(page.body.orders.length,5);
  const order=page.body.orders[0];
  assert.equal((await req('/admin/orders/'+order.id+'/status',{status:'cancelled',expectedStatus:'placed'})).status,400);
  const cancel={status:'cancelled',expectedStatus:'placed',reason};
  assert.equal((await req('/admin/orders/'+order.id+'/status',cancel)).status,200);
  assert.equal((await req('/admin/orders/'+order.id+'/status',cancel)).status,200);
  assert.equal((await req('/admin/activity?q=order_cancellation_reason')).body.total,1);
  assert.equal((await req('/admin/orders?status=cancelled')).body.total,1);
  assert.equal((await req('/admin/applications?q=farmer&view=applications')).body.applicationTotal,1);
  assert.equal((await req('/admin/applications?view=members&status=approved')).body.memberTotal,1);
});
