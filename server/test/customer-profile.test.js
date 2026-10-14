import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes,createHash,randomUUID } from 'node:crypto';
import { openDatabase,seedDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createProfile } from '../src/profiles.js';
import { placeOrder } from '../src/orders.js';
import { geoapifyProvider } from '../src/location.js';
async function fixture(t,options={}){
 const db=openDatabase(':memory:');seedDatabase(db);const tokens={};
 for(const id of ['buyer','other','farmer']){
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id,id+'@example.test','unused','customer',Date.now());
  createProfile(db,id,{accountType:id==='farmer'?'farmer':'consumer',businessName:'Test Farm',phone:'9876543210'});
  const value=randomBytes(32).toString('hex');tokens[id]=value;
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(value).digest('hex'),id,Date.now()+600000);
 }
 const server=createApp(db,options).listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});db.close();});
 async function call(path,body,method=body?'POST':'GET',user='buyer',origin=base){const response=await fetch(base+'/api'+path,{method,headers:{Origin:origin,Cookie:tokens[user]?'farmconnect_session='+tokens[user]:'','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json(),headers:response.headers};}
 return {db,call};
}
const address={name:'Test Buyer',phone:'9876543210',line:'123 Test Road',city:'Pune',pincode:'411001'};
test('profile ownership, validation, optimistic editing and protected identity',async t=>{
 const {call,db}=await fixture(t);
 assert.equal((await call('/profile',undefined,'GET','none')).status,401);
 const result=await call('/profile',{name:'Updated Buyer',phone:'9876543210',revision:0,email:'attacker@example.test',role:'admin',accessStatus:'approved'},'PATCH');
 assert.equal(result.status,200);assert.equal(result.body.profile.name,'Updated Buyer');assert.equal(result.body.profile.email,'buyer@example.test');
 assert.equal((await call('/profile',undefined,'GET','other')).body.profile.name,'other');
 assert.equal(db.prepare('SELECT count(*) n FROM admin_users WHERE user_id=?').get('buyer').n,0);
 assert.equal((await call('/profile',{name:'Overwrite',phone:'',revision:0},'PATCH')).status,409);
 assert.equal((await call('/profile',{name:'Another',phone:'123',revision:1},'PATCH')).status,400);
 assert.equal((await call('/profile',{name:'Another',phone:'',revision:1},'PATCH','buyer','https://evil.test')).status,403);
 assert.equal((await call('/profile',undefined,'GET')).headers.get('permissions-policy'),'camera=(), microphone=(), geolocation=(self)');
});
test('address CRUD/default is private, versioned, bounded, and preserves order history',async t=>{
 const {call,db}=await fixture(t);
 const first=await call('/addresses',{label:'Home',address});assert.equal(first.status,201);assert.equal(first.body.addresses[0].isDefault,true);assert.equal(first.body.addresses[0].serviceable,true);
 const id=first.body.id;
 for(const [path,method,body] of [['/addresses/'+id,'PATCH',{label:'Work',address,revision:0}],['/addresses/'+id+'/default','POST',{}],['/addresses/'+id,'DELETE',undefined]])assert.equal((await call(path,body,method,'other')).status,404);
 const duplicate=await call('/addresses',{label:'Duplicate',address});assert.equal(duplicate.body.id,id);assert.equal(duplicate.body.addresses.length,1);
 const order=placeOrder(db,'buyer',{requestKey:randomUUID(),address,items:[{productId:'tomatoes',quantity:1}],expectedSubtotalPaise:db.prepare("SELECT price_paise FROM products WHERE id='tomatoes'").get().price_paise},'demo').order;
 const updated=await call('/addresses/'+id,{label:'Work',address:{...address,line:'456 Office Road'},revision:0},'PATCH');assert.equal(updated.status,200);assert.equal(updated.body.addresses[0].revision,1);
 assert.equal((await call('/addresses/'+id,{label:'Old',address,revision:0},'PATCH')).status,409);
 assert.equal(JSON.parse(db.prepare('SELECT address_json FROM orders WHERE id=?').get(order.id).address_json).line,'123 Test Road');
 const second=await call('/addresses',{label:'Other',address:{...address,pincode:'999999'}});assert.equal(second.body.addresses.find(a=>a.id===second.body.id).serviceable,false);
 assert.equal((await call('/addresses/'+second.body.id+'/default',{})).body.addresses[0].id,second.body.id);
 const removed=await call('/addresses/'+second.body.id,undefined,'DELETE');assert.equal(removed.body.addresses.some(a=>a.isDefault),false);
 assert.equal((await call('/addresses',undefined,'GET','other')).body.addresses.length,0);
 for(let i=0;i<9;i++)assert.equal((await call('/addresses',{label:'Place '+i,address:{...address,line:'House '+i+' Test Road'}})).status,201);
 assert.equal((await call('/addresses',{label:'Extra',address:{...address,line:'Extra Test Road'}})).status,409);
});
test('reverse lookup is validated, origin checked, throttled and serviceability comes from database',async t=>{
 let calls=0;const {db,call}=await fixture(t,{geocodingProvider:async()=>{calls++;return {country:'in',line:'Test Street',city:'Pune',pincode:'411001'};}});
 assert.equal((await call('/location/config')).body.addressLookup,true);
 const point={latitude:18.52,longitude:73.85};
 for(const body of [{latitude:'18',longitude:73},{latitude:91,longitude:0},{latitude:0,longitude:181},{}])assert.equal((await call('/location/reverse',body)).status,400);
 assert.equal((await call('/location/reverse',point,'POST','buyer','https://evil.test')).status,403);assert.equal(calls,0);
 let result=await call('/location/reverse',point);assert.equal(result.status,200);assert.equal(result.body.serviceable,true);assert.deepEqual(Object.keys(result.body).sort(),['address','serviceable']);
 db.prepare("UPDATE delivery_areas SET active=0 WHERE pincode='411001'").run();result=await call('/location/reverse',point);assert.equal(result.body.serviceable,false);
 for(let i=0;i<4;i++)await call('/location/reverse',point);
 assert.equal((await call('/location/reverse',point)).status,429);assert.equal(calls,6);
});
test('lookup configuration and outages provide usable manual fallback without secret leakage',async t=>{
 const missing=await fixture(t);assert.equal((await missing.call('/location/config')).body.addressLookup,false);assert.equal((await missing.call('/location/reverse',{latitude:0,longitude:0})).body.error.code,'LOCATION_NOT_CONFIGURED');
 const outage=await fixture(t,{geocodingProvider:async()=>{throw Error('secret-url-apiKey-private');}});const result=await outage.call('/location/reverse',{latitude:18,longitude:73});assert.equal(result.status,503);assert.ok(!JSON.stringify(result.body).includes('private'));
 const outside=await fixture(t,{geocodingProvider:async()=>({country:'us'})});assert.equal((await outside.call('/location/reverse',{latitude:18,longitude:73})).status,422);
});
test('provider adapter handles incomplete and empty results and keeps key server-side',async()=>{
 const provider=geoapifyProvider('private-key',async(url,options)=>{assert.equal(url.origin,'https://api.geoapify.com');assert.equal(url.searchParams.get('lat'),'18');assert.equal(options.redirect,'error');return {ok:true,json:async()=>({results:[{country_code:'in',village:'Test Village',postcode:'411001'}]})};});
 assert.deepEqual(await provider({latitude:18,longitude:73}),{country:'in',line:'',city:'Test Village',pincode:'411001'});
 assert.equal(await geoapifyProvider('key',async()=>({ok:true,json:async()=>({results:[]})}))({latitude:0,longitude:0}),null);
});
test('farmer pickup edits continue to require acknowledgement and a new approval',async t=>{
 const {db,call}=await fixture(t);
 db.prepare("UPDATE account_profiles SET access_status='approved' WHERE user_id='farmer'").run();
 db.prepare("UPDATE farm_details SET pickup_address='Original Farm Road',city='Pune',pincode='411001',evidence='A reference for manual farm verification' WHERE farm_id=(SELECT farm_id FROM account_profiles WHERE user_id='farmer')").run();
 const profile=(await call('/farmer/profile',undefined,'GET','farmer')).body;
 const body={...profile.farm,pickup_address:'New Farm Road 12'};
 assert.equal((await call('/farmer/profile',body,'POST','buyer')).status,403);
 assert.equal((await call('/farmer/profile',body,'POST','farmer')).body.error.code,'REVIEW_REQUIRED');
 assert.equal((await call('/farmer/profile',{...body,confirmReverification:true},'POST','farmer')).status,200);
 assert.equal((await call('/farmer/profile',undefined,'GET','farmer')).body.accessStatus,'pending');
});
