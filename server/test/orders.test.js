import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { openDatabase, seedDatabase } from '../src/db.js';
async function fixture(t) {
 const db=openDatabase(':memory:');seedDatabase(db);
 const cookies=['alice','bob'].map(id=>{
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(id,id,id+'@example.test','unused','customer',Date.now());
  const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000);
  return 'farmconnect_session='+token;
 });
 const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});db.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(path='',body,user=0,origin=base)=>{
  const response=await fetch(base+'/api/orders'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:cookies[user]??'',Origin:origin},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};
 };
 const stock=db.prepare("SELECT stock,price_paise FROM products WHERE id='tomatoes'").get();
 const payload={requestKey:randomUUID(),address:{name:'Test Customer',phone:'9876543210',line:'123 Test Street',city:'Pune',pincode:db.prepare('SELECT pincode FROM delivery_areas WHERE active=1 LIMIT 1').get().pincode},items:[{productId:'tomatoes',quantity:1}],expectedSubtotalPaise:stock.price_paise};
 return {db,request,payload,stock};
}
test('checkout snapshots server prices, reduces stock once and safely replays duplicate submissions',async t=>{
 const {db,request,payload,stock}=await fixture(t);
 const responses=await Promise.all([request('',{...payload,totalPaise:1}),request('',payload)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
 assert.equal(responses[0].body.order.id,responses[1].body.order.id);
 const order=responses[0].body.order;assert.equal(order.totalPaise,stock.price_paise);assert.equal(order.paymentStatus,'pending');assert.equal(order.paymentMethod,'cod');
 assert.equal(db.prepare("SELECT stock FROM products WHERE id='tomatoes'").get().stock,stock.stock-1);
 assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n,1);
 assert.equal((await request('',{...payload,address:{...payload.address,line:'Different Street'}})).status,409);
 db.prepare("UPDATE products SET price_paise=price_paise+1000, name='Renamed product' WHERE id='tomatoes'").run();
 const history=await request();assert.equal(history.body.orders[0].items[0].unitPricePaise,stock.price_paise);assert.notEqual(history.body.orders[0].items[0].name,'Renamed product');
 assert.equal((await request('/'+order.id,undefined,1)).status,404);
 assert.deepEqual((await request('',undefined,1)).body.orders,[]);
});
test('anonymous and foreign-origin requests are rejected; price changes require reconfirmation',async t=>{
 const {db,request,payload,stock}=await fixture(t);
 assert.equal((await request('',payload,2)).status,401);
 assert.equal((await request('',undefined,2)).status,401);
 assert.equal((await request('',payload,0,'https://attacker.example')).status,403);
 assert.equal((await request('',{...payload,expectedSubtotalPaise:1})).status,409);
 assert.equal((await request('',{...payload,address:{...payload.address,pincode:'000000'}})).status,400);
 assert.equal((await request('',{...payload,items:[{productId:'tomatoes',quantity:-1}]})).status,400);
 assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n,0);
 assert.equal(db.prepare("SELECT stock FROM products WHERE id='tomatoes'").get().stock,stock.stock);
});
test('two buyers competing for the last pack cannot oversell',async t=>{
 const {db,request,payload}=await fixture(t);db.prepare("UPDATE products SET stock=1 WHERE id='tomatoes'").run();
 const responses=await Promise.all([request('',payload),request('',{...payload,requestKey:randomUUID()},1)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
 assert.equal(db.prepare("SELECT stock FROM products WHERE id='tomatoes'").get().stock,0);
 assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n,1);
});
test('a failure during order saving rolls back stock, order and item writes together',async t=>{
 const {db,request,payload,stock}=await fixture(t);
 const expectedErrorLog=t.mock.method(console,'error',()=>{});
 db.exec("CREATE TRIGGER fail_order_item BEFORE INSERT ON order_items BEGIN SELECT RAISE(ABORT, 'Simulated write failure'); END;");
 assert.equal((await request('',payload)).status,500);
 assert.equal(expectedErrorLog.mock.callCount(),1);
 assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n,0);
 assert.equal(db.prepare('SELECT count(*) AS n FROM order_items').get().n,0);
 assert.equal(db.prepare("SELECT stock FROM products WHERE id='tomatoes'").get().stock,stock.stock);
 db.exec('DROP TRIGGER fail_order_item');
 assert.equal((await request('',payload)).status,201);
});

