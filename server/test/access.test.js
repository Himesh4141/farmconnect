import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash,randomBytes } from 'node:crypto';
import { openDatabase,seedDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
async function fixture(t){
 const db=openDatabase(':memory:');seedDatabase(db);
 const cookies=['applicant','other','reviewer'].map(id=>{db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id,id+'@example.test','unused','customer',Date.now());db.prepare("INSERT INTO account_profiles(user_id,account_type) VALUES (?,'consumer')").run(id);const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000);return 'farmconnect_session='+token;});db.prepare('INSERT INTO admin_users VALUES (?)').run('reviewer');
 const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});db.close();});const base=`http://127.0.0.1:${server.address().port}`;
 async function call(path,body,user=0,origin=base){const res=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:cookies[user]??'',Origin:origin},body:body?JSON.stringify(body):undefined});return {status:res.status,body:await res.json()};}
 const input={accountType:'farmer',businessName:'Applicant Farm',phone:'9876543210',location:'Pune district test farm',evidence:'The contact and the farm affiliation can be checked with our FPO.'};
 async function submit(type='bulk_buyer',user=0){return (await call('/access/application',{...input,accountType:type},user)).body.application;}
 async function review(a,action='approve',extra={}){return call('/admin/applications/'+a.id+'/review',{action,revision:a.revision,verified:true,note:'Contact and connection checked independently for this test.',...extra},2);}
 return {db,call,submit,review,input};
}
test('signup cannot grant partner roles; applications and admin reviews remain private',async t=>{
 const {call,submit}=await fixture(t);
 const reg=await call('/auth/register',{name:'New Person',email:'new@example.test',password:'a long test password phrase',accountType:'farmer',businessName:'Fake Farm'});assert.equal(reg.status,403);
 await submit();assert.equal((await call('/farmer/products')).status,403);assert.equal((await call('/business/catalog')).status,403);
 assert.equal((await call('/admin/applications')).status,403);assert.equal((await call('/access/application',undefined,1)).body.application,null);
 assert.equal((await call('/access/application',undefined,3)).status,401);
});
test('review requires verification, matching revision and independent administrator; codes are hashed and single-use',async t=>{
 const {db,call,submit,review}=await fixture(t);const a=await submit();
 assert.equal((await review(a,'approve',{verified:false})).status,400);
 assert.equal((await review(a,'approve',{revision:999})).status,409);
 const own=await submit('bulk_buyer',2);assert.equal((await review(own)).status,403);
 const invite=await review(a);assert.equal(invite.status,200);const code=invite.body.invitationCode;
 assert.notEqual(db.prepare('SELECT token_hash FROM access_invitations').get().token_hash,code);
 assert.equal((await call('/access/redeem',{code},1)).status,403);
 assert.equal((await call('/access/redeem',{code},0,'https://evil.example')).status,403);
 assert.equal((await call('/access/redeem',{code})).status,200);
 assert.equal((await call('/auth/me')).body.user.accountType,'bulk_buyer');
 assert.equal((await call('/access/redeem',{code})).status,403);
 assert.equal(db.prepare('SELECT count(*) AS n FROM access_invitations').get().n,0);
});
test('expired and reissued invitations cannot activate access; rejection revokes invitations',async t=>{
 const {db,call,submit,review}=await fixture(t);const a=await submit();const first=await review(a);
 db.prepare('UPDATE access_invitations SET expires_at=0').run();assert.equal((await call('/access/redeem',{code:first.body.invitationCode})).status,403);
 let current=(await call('/access/application')).body.application;const second=await review(current);assert.equal(second.status,200);
 assert.equal((await call('/access/redeem',{code:first.body.invitationCode})).status,403);
 current=(await call('/access/application')).body.application;assert.equal((await review(current,'reject')).status,200);
 assert.equal((await call('/access/redeem',{code:second.body.invitationCode})).status,403);
 const resubmitted=await submit();assert.equal(resubmitted.status,'pending');
});
test('suspension blocks an existing farmer session, hides listings and stops quoting; restoring requires prior approval',async t=>{
 const {call,submit,review}=await fixture(t);await submit('farmer');
 await call('/farmer/profile',{name:'Applicant Farm',phone:'9876543210',pickup_address:'123 Test farm road',city:'Pune',pincode:'411001',evidence:'Test farm connection independently checked by reviewer.',revision:0});
 const a=(await call('/access/application')).body.application;assert.equal((await review(a)).status,200);
 const created=await call('/farmer/products',{name:'Approved tomatoes',category:'Vegetables',unit:'1 kg',pricePaise:5000,bulkPricePaise:4000,bulkMin:5,stock:100,active:1});assert.equal(created.status,201);const id=created.body.product.id;
 assert.equal((await call('/admin/members/applicant/access',{status:'suspended',expectedStatus:'approved',note:'Suspended while reviewing a reported issue.'},2)).status,200);
 assert.equal((await call('/farmer/products')).status,403);
 assert.equal((await call('/auth/me')).body.user.accessStatus,'suspended');
 assert.ok(!(await call('/catalog')).body.products.some(p=>p.id===id));
 assert.equal((await call('/cart/quote',{items:[{productId:id,quantity:1}]})).status,404);
 assert.equal((await call('/admin/members/applicant/access',{status:'approved',expectedStatus:'suspended',note:'Issue reviewed and resolved with supporting evidence.'},2)).status,200);
 assert.equal((await call('/farmer/products')).status,200);
});
test('bulk-buyer portal requires an approved account and loses access on suspension',async t=>{
 const {call,submit,review}=await fixture(t);const a=await submit('bulk_buyer');assert.equal((await call('/business/catalog')).status,403);
 const invite=await review(a);await call('/access/redeem',{code:invite.body.invitationCode});assert.equal((await call('/business/catalog')).status,200);
 await call('/admin/members/applicant/access',{status:'suspended',expectedStatus:'approved',note:'Review of business eligibility is in progress.'},2);assert.equal((await call('/business/catalog')).status,403);
});

test('invitation guesses are rate limited',async t=>{
 const {call}=await fixture(t);
 for(let n=0;n<10;n++)assert.equal((await call('/access/redeem',{code:'a'.repeat(64)})).status,403);
 assert.equal((await call('/access/redeem',{code:'a'.repeat(64)})).status,429);
});
