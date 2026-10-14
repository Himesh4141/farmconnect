import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase,seedDatabase,migrateDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { placeOrder } from '../src/orders.js';
async function fixture(t){
 const db=openDatabase(':memory:');seedDatabase(db);
 const cookies=['customer','other','admin'].map(id=>{db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id,id+'@example.test','unused','customer',Date.now());const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000);return 'farmconnect_session='+token;});
 db.prepare('INSERT INTO admin_users VALUES (?)').run('admin');
 const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});db.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 async function req(path,body,user=0,origin=base){const response=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:cookies[user]??'',Origin:origin},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};}
 const stock=db.prepare("SELECT stock,price_paise FROM products WHERE id='tomatoes'").get();
 const payload={requestKey:randomUUID(),address:{name:'Test Person',phone:'9876543210',line:'12 Test Street',city:'Pune',pincode:db.prepare('SELECT pincode FROM delivery_areas WHERE active=1 LIMIT 1').get().pincode},items:[{productId:'tomatoes',quantity:1}],expectedSubtotalPaise:stock.price_paise};
 const order=placeOrder(db,'customer',payload).order;
 return {db,req,stock,payload,order};
}
test('admin endpoints enforce permissions and CSRF; revocation takes effect on existing sessions',async t=>{
 const {db,req,order}=await fixture(t);
 assert.equal((await req('/admin/products',undefined,3)).status,401);
 assert.equal((await req('/admin/products')).status,403);
 assert.equal((await req('/admin/orders')).status,403);
 assert.equal((await req('/admin/access')).body.isAdmin,false);
 assert.equal((await req('/admin/access',undefined,2)).body.isAdmin,true);
 assert.equal((await req('/admin/orders/'+order.id+'/status',{status:'confirmed',expectedStatus:'placed'},0)).status,403);
 assert.equal((await req('/admin/orders/'+order.id+'/status',{status:'confirmed',expectedStatus:'placed'},2,'https://evil.example')).status,403);
 db.prepare('DELETE FROM admin_users WHERE user_id=?').run('admin');
 assert.equal((await req('/admin/orders',undefined,2)).status,403);
});
test('customer cancellation is private, restores stock once, and records one event',async t=>{
 const {db,req,stock,order}=await fixture(t);
 assert.equal((await req('/orders/'+order.id+'/cancel',{expectedStatus:'placed'},1)).status,404);
 const cancel=()=>req('/orders/'+order.id+'/cancel',{expectedStatus:'placed'});
 const results=await Promise.all([cancel(),cancel()]);assert.ok(results.every(r=>r.status===200));
 assert.equal(results[0].body.order.paymentStatus,'cancelled');
 assert.equal(db.prepare("SELECT stock FROM products WHERE id='tomatoes'").get().stock,stock.stock);
 assert.equal(db.prepare('SELECT count(*) AS n FROM order_events').get().n,1);
});
test('fulfillment follows valid transitions and requires cash confirmation; customers cannot cancel confirmed orders',async t=>{
 const {db,req,order}=await fixture(t);const path='/admin/orders/'+order.id+'/status';
 assert.equal((await req(path,{expectedStatus:'placed',status:'delivered',cashCollected:true},2)).status,409);
 assert.equal((await req(path,{expectedStatus:'placed',status:'confirmed'},2)).status,200);
 assert.equal((await req('/orders/'+order.id+'/cancel',{expectedStatus:'confirmed'})).status,409);
 assert.equal((await req(path,{expectedStatus:'placed',status:'packed'},2)).status,409);
 assert.equal((await req(path,{expectedStatus:'confirmed',status:'packed'},2)).status,200);
 assert.equal((await req(path,{expectedStatus:'packed',status:'out_for_delivery'},2)).status,200);
 assert.equal((await req(path,{expectedStatus:'out_for_delivery',status:'delivered'},2)).status,400);
 const delivered=await req(path,{expectedStatus:'out_for_delivery',status:'delivered',cashCollected:true},2);
 assert.equal(delivered.status,200);assert.equal(delivered.body.order.paymentStatus,'paid');
 assert.equal((await req(path,{expectedStatus:'delivered',status:'cancelled',reason:'Customer requested cancellation'},2)).status,409);
 assert.equal(db.prepare('SELECT count(*) AS n FROM order_events').get().n,4);
});
test('stock edits cannot overwrite a checkout, invalid prices fail, and admin can cancel a packed order',async t=>{
 const {db,req,payload,order}=await fixture(t);
 const product=(await req('/admin/products',undefined,2)).body.products.find(p=>p.id==='tomatoes');
 placeOrder(db,'other',{...payload,requestKey:randomUUID()});
 assert.equal((await req('/admin/products/tomatoes',{...product,stock:50},2)).status,409);
 const fresh=(await req('/admin/products',undefined,2)).body.products.find(p=>p.id==='tomatoes');
 assert.equal((await req('/admin/products/tomatoes',{...fresh,bulkPricePaise:fresh.pricePaise+1},2)).status,400);
 assert.equal((await req('/admin/products/tomatoes',{...fresh,stock:50,active:0},2)).status,200);
 assert.equal(db.prepare("SELECT active FROM products WHERE id='tomatoes'").get().active,0);
 const path='/admin/orders/'+order.id+'/status';
 await req(path,{expectedStatus:'placed',status:'confirmed'},2);await req(path,{expectedStatus:'confirmed',status:'packed'},2);
 assert.equal((await req(path,{expectedStatus:'packed',status:'cancelled',reason:'Customer requested cancellation'},2)).status,200);
 assert.equal(db.prepare("SELECT stock FROM products WHERE id='tomatoes'").get().stock,51);
});
test('migration 004 preserves existing orders, line items, accounts and stock with foreign keys enabled',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;');
 try{
  for(const name of ['001_catalog.sql','002_accounts.sql','003_orders.sql']){db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(name);}
  seedDatabase(db);db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('old-user','Old User','old@example.test','unchanged-hash','customer',1);
  db.prepare("INSERT INTO orders VALUES ('old-order','old-user','old-request','hash','{}',3500,0,'placed','cod','pending',1)").run();
  db.prepare("INSERT INTO order_items VALUES ('old-order','tomatoes','Original name','1 kg',1,3500)").run();
  db.prepare("UPDATE products SET stock=9 WHERE id='tomatoes'").run();migrateDatabase(db);
  assert.equal(db.prepare('SELECT name FROM order_items').get().name,'Original name');
  assert.equal(db.prepare('SELECT password_hash FROM users').get().password_hash,'unchanged-hash');
  assert.equal(db.prepare("SELECT stock FROM products WHERE id='tomatoes'").get().stock,9);
  assert.equal(db.prepare('SELECT status FROM orders').get().status,'placed');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n,20);
 }finally{db.close();}
});




