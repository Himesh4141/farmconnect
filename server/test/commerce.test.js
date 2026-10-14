import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { openDatabase, seedDatabase } from '../src/db.js';
import { createProfile } from '../src/profiles.js';
import { createApp } from '../src/app.js';
import { reconcilePayments } from '../src/payments.js';
import { refreshExternal } from '../src/operations.js';
import { readConfig } from '../src/config.js';
import { razorpayProvider, delhiveryProvider, matchesSignature } from '../src/providers.js';

const config={keyId:'rzp_test_fixture',keySecret:'server-secret-fixture',webhookSecret:'webhook-secret-fixture-long',isTest:true};
async function fixture(t,options={}) {
  const db=openDatabase(':memory:');seedDatabase(db);const cookies={};
  for(const id of ['farmer','farmer2','buyer','other','admin','driver']){
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id,id+'@example.test','unused','customer',Date.now());
    createProfile(db,id,{accountType:id.startsWith('farmer')?'farmer':'consumer',businessName:'Farm '+id,phone:'9876543210'});
    if(id.startsWith('farmer')){
      db.prepare("UPDATE account_profiles SET access_status='approved' WHERE user_id=?").run(id);
      db.prepare("UPDATE farm_details SET pickup_address='123 Farm Road',city='Pune',pincode='411001',phone='9876543210' WHERE farm_id=(SELECT farm_id FROM account_profiles WHERE user_id=?)").run(id);
    }
    const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+600000);
    cookies[id]='farmconnect_session='+token;
  }
  db.prepare("INSERT INTO admin_users VALUES ('admin')").run();
  db.prepare("INSERT INTO delivery_partners VALUES ('driver','9876543210','approved',?)").run(Date.now());
  const captured=new Map();let creates=0,refunds=0,refundFailure=false;
  const provider={
    async createOrder(amount,receipt){creates++;return {id:'order_'+creates,amount,currency:'INR',receipt};},
    async fetchPayment(id){return [...captured.values()].find(p=>p.id===id);},
    async orderPayments(id){return {items:captured.has(id)?[captured.get(id)]:[]};},
    async refund(paymentId,amount,id){if(refundFailure)throw Error('offline');refunds++;return {id:'rfnd_'+id.replaceAll('-',''),payment_id:paymentId,amount,status:'processed'};},
    async fetchRefund(){throw Error('Unexpected polling');},
  };
  let trackingStatus='Manifested',reference='';
  const courier={async track(waybill){return {waybill,reference,status:trackingStatus,statusType:trackingStatus==='Delivered'?'DL':'UD'};}};
  const server=createApp(db,{courierMode:'demo',payment:config,paymentProvider:provider,...options,courierProvider:options.courierMode==='delhivery'?courier:null}).listen(0,'127.0.0.1');
  await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});db.close();});
  async function call(path,body,user='buyer',method=body?'POST':'GET',headers={}){
    const init={method,headers:{Origin:options.origin??base,...(options.production?{Host:new URL(options.origin).host,'X-Forwarded-Proto':'https'}:{}),Cookie:cookies[user]??'','Content-Type':'application/json',...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)};
    // Native HTTP preserves the proxy's public Host header; Node fetch replaces it.
    const response=options.production?await new Promise((resolve,reject)=>{
      const req=httpRequest(base+'/api'+path,init,res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});
      req.on('error',reject);req.end(init.body);
    }):await fetch(base+'/api'+path,init);
    return {status:response.status,body:await response.json(),headers:response.headers};
  }
  const product={name:'Test tomatoes',category:'Vegetables',unit:'kg',saleMode:'weight',presetId:'tomatoes',pricePaise:4000,bulkPricePaise:3500,bulkMin:5000,stock:10000,image:'',photoCredit:'',active:1};
  const products=[];
  for(const farmer of ['farmer','farmer2']){const result=await call('/farmer/products',product,farmer);assert.equal(result.status,201,JSON.stringify(result.body));products.push(result.body.product);}
  const address={name:'Test buyer',phone:'9876543210',line:'123 Test Road',city:'Pune',pincode:'411001'};
  const payload={requestKey:randomUUID(),address,items:[{productId:products[0].id,quantity:250}],expectedSubtotalPaise:1000,paymentMethod:'razorpay'};
  async function create(body=payload){const result=await call('/orders',body);assert.equal(result.status,201,JSON.stringify(result.body));return result.body.order;}
  async function capture(order){
    const setup=await call('/orders/'+order.id+'/payment',{});assert.equal(setup.status,200,JSON.stringify(setup.body));
    const actual={id:'pay_'+setup.body.providerOrderId.slice(6),order_id:setup.body.providerOrderId,amount:order.totalPaise,currency:'INR',status:'captured'};captured.set(actual.order_id,actual);
    const signature=createHmac('sha256',config.keySecret).update(actual.order_id+'|'+actual.id).digest('hex');
    return call('/orders/'+order.id+'/payment/verify',{razorpay_order_id:actual.order_id,razorpay_payment_id:actual.id,razorpay_signature:signature});
  }
  async function ready(orderId,farmer='farmer'){
    let expectedStatus='placed';for(const status of ['confirmed','packed','ready_for_pickup']){const r=await call('/farmer/orders/'+orderId+'/status',{status,expectedStatus},farmer);assert.equal(r.status,200,JSON.stringify(r.body));expectedStatus=status;}
  }
  return {db,call,payload,products,create,capture,ready,provider,courier,captured,getCreates:()=>creates,getRefunds:()=>refunds,
    failRefund:value=>{refundFailure=value;},setTracking:(status,ref)=>{trackingStatus=status;reference=ref;}};
}

test('online kg checkout reserves once, blocks unpaid preparation and completes through the existing delivery journey',async t=>{
  const f=await fixture(t);const order=await f.create();
  assert.equal(order.paymentMethod,'razorpay');assert.equal(order.payment.state,'creating');assert.equal(order.totalPaise,1000);
  assert.equal((await f.call('/orders',f.payload)).status,200);
  assert.equal(f.db.prepare('SELECT stock_grams FROM products WHERE id=?').get(f.products[0].id).stock_grams,9750);
  assert.equal((await f.call('/farmer/orders',undefined,'farmer')).body.orders.length,0);
  assert.equal((await f.call('/farmer/orders/'+order.id+'/status',{status:'confirmed',expectedStatus:'placed'},'farmer')).status,409);
  assert.equal((await f.call('/orders/'+order.id+'/payment',{},'other')).status,404);
  const verified=await f.capture(order);assert.equal(verified.status,200,JSON.stringify(verified.body));assert.equal(verified.body.order.payment.state,'paid');
  assert.equal((await f.call('/orders/'+order.id+'/payment',{})).body.paid,true);assert.equal(f.getCreates(),1);
  await f.ready(order.id);
  let shipment=(await f.call('/delivery/shipments',undefined,'driver')).body.shipments[0];assert.ok(shipment);
  assert.equal((await f.call('/delivery/shipments/'+shipment.id+'/claim',{revision:shipment.revision},'driver')).status,200);
  for(const status of ['picked_up','in_transit','out_for_delivery','delivered']){
    shipment=(await f.call('/delivery/shipments',undefined,'driver')).body.shipments[0];
    assert.equal((await f.call('/delivery/shipments/'+shipment.id+'/advance',{status,revision:shipment.revision},'driver')).status,200);
  }
  const delivered=(await f.call('/orders/'+order.id)).body.order;assert.equal(delivered.status,'delivered');assert.equal(delivered.payment.state,'paid');assert.equal(delivered.paymentStatus,'paid');
});

test('signed callbacks reject tampering and mismatched amounts; duplicate webhook delivery is harmless',async t=>{
  const f=await fixture(t);const order=await f.create();const setup=(await f.call('/orders/'+order.id+'/payment',{})).body;
  assert.equal((await f.call('/orders/'+order.id+'/payment/verify',{razorpay_order_id:setup.providerOrderId,razorpay_payment_id:'pay_fake',razorpay_signature:'0'.repeat(64)})).status,400);
  const actual={id:'pay_signed',order_id:setup.providerOrderId,amount:999,currency:'INR',status:'captured'};
  async function event(payment,id){const raw=JSON.stringify({event:'payment.captured',payload:{payment:{entity:payment}}});return f.call('/webhooks/razorpay',raw,'','POST',{'x-razorpay-event-id':id,'x-razorpay-signature':createHmac('sha256',config.webhookSecret).update(raw).digest('hex')});}
  assert.equal((await event(actual,'wrongamount')).status,409);
  assert.equal((await event({...actual,amount:1000},'correct')).status,200);assert.equal((await event({...actual,amount:1000},'correct')).status,200);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payment_events').get().n,1);
  assert.equal((await f.call('/orders/'+order.id)).body.order.payment.state,'paid');
  assert.equal((await f.call('/webhooks/razorpay','{}','','POST',{'x-razorpay-signature':'fake'})).status,400);
});

test('expired unpaid checkout restores stock once and late capture queues exactly one full refund',async t=>{
  const f=await fixture(t);const order=await f.create();await f.call('/orders/'+order.id+'/payment',{});
  f.db.prepare('UPDATE order_payments SET expires_at=? WHERE order_id=?').run(Date.now()-1,order.id);
  await reconcilePayments(f.db,f.provider);await reconcilePayments(f.db,f.provider);
  assert.equal((await f.call('/orders/'+order.id)).body.order.status,'cancelled');
  assert.equal(f.db.prepare('SELECT stock_grams FROM products WHERE id=?').get(f.products[0].id).stock_grams,10000);
  f.captured.set('order_1',{id:'pay_late',order_id:'order_1',amount:1000,currency:'INR',status:'captured'});
  await reconcilePayments(f.db,f.provider);await reconcilePayments(f.db,f.provider);
  assert.equal(f.getRefunds(),1);const updated=(await f.call('/orders/'+order.id)).body.order;
  assert.equal(updated.status,'cancelled');assert.equal(updated.payment.refundedPaise,1000);
});

test('multi-farm partial cancellation queues only that farm amount and failed refund remains retryable',async t=>{
  const f=await fixture(t);const order=await f.create({...f.payload,items:f.products.map(p=>({productId:p.id,quantity:250})),expectedSubtotalPaise:2000});await f.capture(order);
  assert.equal((await f.call('/farmer/orders/'+order.id+'/reject',{reason:'Produce quality below standard'},'farmer')).status,200);
  f.failRefund(true);await reconcilePayments(f.db,f.provider);
  let updated=(await f.call('/orders/'+order.id)).body.order;assert.equal(updated.totalPaise,1000);assert.equal(updated.payment.refundPaise,1000);assert.equal(updated.payment.refundedPaise,0);
  f.failRefund(false);await reconcilePayments(f.db,f.provider);await reconcilePayments(f.db,f.provider);
  updated=(await f.call('/orders/'+order.id)).body.order;assert.equal(updated.payment.refundedPaise,1000);assert.equal(f.getRefunds(),1);
  await f.ready(order.id,'farmer2');
});

test('saved addresses and operations are owner scoped; checkout pause and delivery areas are enforced',async t=>{
  const f=await fixture(t,{checkoutEnabled:false});
  const saved=await f.call('/addresses',{label:'Home',address:f.payload.address});assert.equal(saved.status,201);
  assert.equal((await f.call('/addresses',undefined,'other')).body.addresses.length,0);
  assert.equal((await f.call('/addresses/'+saved.body.id,undefined,'other','DELETE')).status,404);
  assert.equal((await f.call('/orders',f.payload)).status,503);
  assert.equal((await f.call('/admin/operations')).status,403);
  assert.equal((await f.call('/admin/delivery-areas',{pincode:'500001',active:true},'admin')).status,200);
  assert.equal((await f.call('/admin/delivery-areas',{pincode:'500001',active:false},'buyer')).status,403);
  const publicConfig=await f.call('/store/config');assert.equal(publicConfig.body.checkoutEnabled,false);assert.ok(!JSON.stringify(publicConfig.body).includes(config.keySecret));
});

test('unpaid reservation limit cannot be bypassed by retries and cancellation releases the reservation slot',async t=>{
  const f=await fixture(t);const first=await f.create();
  await f.create({...f.payload,requestKey:randomUUID()});await f.create({...f.payload,requestKey:randomUUID()});
  assert.equal((await f.call('/orders',{...f.payload,requestKey:randomUUID()})).status,429);
  assert.equal((await f.call('/orders',f.payload)).status,200);
  assert.equal((await f.call('/orders',{...f.payload,paymentMethod:'cod'})).status,409);
  assert.equal((await f.call('/orders/'+first.id+'/cancel',{expectedStatus:'placed'})).status,200);
  assert.equal(f.db.prepare('SELECT state FROM order_payments WHERE order_id=?').get(first.id).state,'expired');
  assert.equal((await f.call('/orders',{...f.payload,requestKey:randomUUID()})).status,201);
});

test('verified external courier updates reach the buyer and farmer; wrong references, regressions and unauthorized edits fail',async t=>{
  const f=await fixture(t,{courierMode:'delhivery'});const order=await f.create({...f.payload,paymentMethod:'cod'});await f.ready(order.id);
  const farmId=f.db.prepare("SELECT farm_id FROM account_profiles WHERE user_id='farmer'").get().farm_id;
  const body={orderId:order.id,farmId,waybill:'1234567890123'};
  assert.equal((await f.call('/admin/dispatch',body,'buyer')).status,403);
  f.setTracking('Manifested','wrong');assert.equal((await f.call('/admin/dispatch',body,'admin')).status,409);
  const reference=(await f.call('/admin/operations',undefined,'admin')).body.dispatch[0].reference;assert.match(reference,/^FC[a-f0-9]{30}$/);f.setTracking('Manifested',reference);assert.equal((await f.call('/admin/dispatch',body,'admin')).status,200);
  assert.equal((await f.call('/orders/'+order.id+'/cancel',{expectedStatus:'packed'})).status,409);
  const row=f.db.prepare('SELECT * FROM external_shipments').get();
  f.setTracking('In Transit',reference);await refreshExternal(f.db,f.courier,row.id);assert.equal((await f.call('/orders/'+order.id)).body.order.status,'in_transit');
  f.setTracking('Delivered',reference);await refreshExternal(f.db,f.courier,row.id);assert.equal((await f.call('/orders/'+order.id)).body.order.status,'delivered');
  assert.equal((await f.call('/farmer/orders',undefined,'farmer')).body.orders[0].status,'delivered');
  f.setTracking('In Transit',reference);await refreshExternal(f.db,f.courier,row.id);assert.equal((await f.call('/orders/'+order.id)).body.order.status,'delivered');
  const tracking=(await f.call('/orders/'+order.id+'/tracking')).body.shipments[0];assert.equal(tracking.isDemo,false);assert.equal(tracking.provider,'Delhivery');
  assert.equal((await f.call('/orders/'+order.id+'/tracking',undefined,'other')).status,404);
});

test('production configuration fails closed for unsafe origins, demo delivery and live keys in development',()=>{
  assert.throws(()=>readConfig({NODE_ENV:'production'}));
  assert.throws(()=>readConfig({NODE_ENV:'production',APP_ORIGIN:'https://example.test',COURIER_MODE:'demo'}));
  assert.throws(()=>readConfig({RAZORPAY_KEY_ID:'rzp_live_test',RAZORPAY_KEY_SECRET:'x',RAZORPAY_WEBHOOK_SECRET:'a'.repeat(24)}));
  assert.equal(readConfig({NODE_ENV:'production',APP_ORIGIN:'https://example.test'}).checkoutEnabled,false);
  assert.equal(readConfig({COURIER_MODE:'demo'}).checkoutEnabled,true);
});

test('hosted demo retains production security, rejects provider credentials and respects checkout pause',()=>{
  const env={NODE_ENV:'production',APP_MODE:'demo',APP_ORIGIN:'https://farmconnect.example.test',COURIER_MODE:'demo'};
  const value=readConfig(env);
  assert.equal(value.production,true);
  assert.equal(value.checkoutEnabled,true);
  assert.equal(value.payment,null);
  assert.equal(readConfig({...env,CHECKOUT_ENABLED:'false'}).checkoutEnabled,false);
  assert.throws(()=>readConfig({...env,APP_ORIGIN:'http://farmconnect.example.test'}));
  assert.throws(()=>readConfig({...env,COURIER_MODE:'delhivery',DELHIVERY_TOKEN:'fixture'}));
  assert.throws(()=>readConfig({...env,RAZORPAY_KEY_ID:'rzp_live_fixture'}));
  assert.throws(()=>readConfig({...env,APP_MODE:'typo'}));
});

test('public demo integrates secure signup, weight checkout, farmer preparation and private delivery tracking',async t=>{
  const settings=readConfig({NODE_ENV:'production',APP_MODE:'demo',APP_ORIGIN:'https://farmconnect.example.test',COURIER_MODE:'demo',TRUST_PROXY:'loopback'});
  const f=await fixture(t,settings);
  const publicConfig=await f.call('/store/config');
  assert.equal(publicConfig.body.appMode,'demo');
  assert.equal(publicConfig.body.onlinePayments,false);
  assert.ok(publicConfig.headers.get('strict-transport-security'));
  assert.ok(publicConfig.headers.get('content-security-policy'));
  assert.equal((await f.call('/store/config',undefined,'buyer','GET',{Origin:'https://untrusted.example.test'})).status,403);
  const registered=await f.call('/auth/register',{name:'Hosted demo user',email:'hosted@example.test',password:'Hosted fixture only 2026!'},'');
  assert.equal(registered.status,201);
  assert.match(registered.headers.get('set-cookie'),/HttpOnly/);
  assert.match(registered.headers.get('set-cookie'),/Secure/);
  assert.match(registered.headers.get('set-cookie'),/SameSite=Lax/);
  const order=await f.create({...f.payload,paymentMethod:'cod'});
  assert.equal(order.deliveryMode,'demo');
  assert.equal(order.totalPaise,1000);
  await f.ready(order.id);
  let shipment=(await f.call('/delivery/shipments',undefined,'driver')).body.shipments[0];
  assert.ok(shipment);
  assert.equal((await f.call('/delivery/shipments/'+shipment.id+'/claim',{revision:shipment.revision},'buyer')).status,403);
  assert.equal((await f.call('/delivery/shipments/'+shipment.id+'/claim',{revision:shipment.revision},'driver')).status,200);
  for(const status of ['picked_up','in_transit','out_for_delivery','delivered']){
    shipment=(await f.call('/delivery/shipments',undefined,'driver')).body.shipments[0];
    assert.equal((await f.call('/delivery/shipments/'+shipment.id+'/advance',{status,revision:shipment.revision},'driver')).status,200);
  }
  const delivered=(await f.call('/orders/'+order.id)).body.order;
  assert.equal(delivered.status,'delivered');
  assert.notEqual(delivered.paymentStatus,'paid');
  assert.equal((await f.call('/orders/'+order.id+'/tracking',undefined,'other')).status,404);
  assert.equal(f.db.prepare('SELECT stock_grams FROM products WHERE id=?').get(f.products[0].id).stock_grams,9750);
});

test('provider adapters use fixed HTTPS hosts, private headers, refund idempotency and exact waybill matching',async()=>{
  const calls=[];const rp=razorpayProvider(config,async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({id:'order_123'})};});
  await rp.createOrder(1000,'reference');await rp.refund('pay_123',500,'refund-id-12345');
  assert.equal(calls[0].url,'https://api.razorpay.com/v1/orders');assert.equal(JSON.parse(calls[0].options.body).amount,1000);assert.equal(calls[1].options.headers['X-Refund-Idempotency'],'refund-id-12345');
  const carrier=delhiveryProvider('private-token',async(url,options)=>{assert.ok(url.startsWith('https://track.delhivery.com/'));assert.equal(options.headers.Authorization,'Token private-token');return {ok:true,json:async()=>({ShipmentData:[{Shipment:{AWB:'12345678',ReferenceNo:'reference',Status:{Status:'Delivered',StatusType:'DL'}}}]})};});
  assert.equal((await carrier.track('12345678')).status,'Delivered');await assert.rejects(()=>carrier.track('99999999'));
  assert.equal(matchesSignature('body','bad','secret'),false);
});
