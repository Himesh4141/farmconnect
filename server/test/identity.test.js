import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomBytes,createHash} from 'node:crypto';
import {createApp} from '../src/app.js';
import {openDatabase,seedDatabase} from '../src/db.js';
import {readConfig} from '../src/config.js';
async function fixture(t,options={}) {
  const db=openDatabase(':memory:');seedDatabase(db);
  const identity={sub:'google-test-sub',email:'google@test.example',name:'Google Tester',verified:true};
  const google={clientId:'test.apps.googleusercontent.com',clientSecret:'test-only',redirectUri:'http://localhost:4000/api/auth/google/callback'};
  const provider={async exchange(code,nonce){assert.equal(code,'test-code');assert.ok(nonce.length>32);return {...identity};}};
  const server=createApp(db,{google,origin:'http://localhost:4000',googleProvider:provider,...options}).listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await new Promise(r=>{server.close(r);server.closeAllConnections();});db.close();});
  async function call(path,body,cookie='',origin=base){const r=await fetch(base+'/api/auth/'+path,{method:body?'POST':'GET',redirect:'manual',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:(r.headers.get('content-type')||'').includes('json')?await r.json():null,location:r.headers.get('location'),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  async function begin({portal='store',mobile=false,link=false,cookie=''}={}){
    const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
    const start=await call('google/prepare',{portal,mobile,link,challenge},cookie);assert.equal(start.status,200,JSON.stringify(start.body));
    const auth=new URL(start.body.url);assert.equal(auth.origin,'https://accounts.google.com');assert.equal(auth.searchParams.get('scope'),'openid email profile');
    const callback=await call('google/callback?state='+auth.searchParams.get('state')+'&code=test-code');
    return {verifier,callback,ticket:callback.location?new URL(callback.location).searchParams.get(mobile?'ticket':'oauth_ticket'):null,state:auth.searchParams.get('state')};
  }
  return {db,call,begin,identity,base};
}
test('Google creates only a shopping account; proof key, one-use completion and password fallback are protected',async t=>{
  const f=await fixture(t), flow=await f.begin();assert.equal(flow.callback.status,303);
  assert.equal((await f.call('google/complete',{ticket:flow.ticket,verifier:randomBytes(32).toString('base64url')})).status,400);
  const result=await f.call('google/complete',{ticket:flow.ticket,verifier:flow.verifier});assert.equal(result.status,200);assert.equal(result.body.user.accountType,'consumer');assert.match(result.cookie,/farmconnect_session=/);
  assert.equal((await f.call('google/complete',{ticket:flow.ticket,verifier:flow.verifier})).status,400);
  const security=await f.call('security',undefined,result.cookie);assert.equal(security.body.googleLinked,true);assert.equal(security.body.passwordEnabled,false);assert.equal(security.body.sessions[0].current,true);assert.equal(security.body.sessions[0].token_hash,undefined);
  assert.equal((await f.call('login',{email:f.identity.email,password:'invalid password'})).status,401);
  assert.equal((await f.call('password',{currentPassword:'anything',newPassword:'new password phrase'},result.cookie)).status,400);
});
test('Google never silently merges an existing account; explicit link requires its current session and same email',async t=>{
  const f=await fixture(t), account={name:'Existing member',email:f.identity.email,password:'original secure phrase!'};
  const registered=await f.call('register',account);assert.equal(registered.status,201);
  let flow=await f.begin();assert.equal((await f.call('google/complete',{ticket:flow.ticket,verifier:flow.verifier})).body.error.code,'LINK_REQUIRED');
  flow=await f.begin({link:true,cookie:registered.cookie});assert.equal((await f.call('google/complete',{ticket:flow.ticket,verifier:flow.verifier})).status,401);
  flow=await f.begin({link:true,cookie:registered.cookie});const linked=await f.call('google/complete',{ticket:flow.ticket,verifier:flow.verifier},registered.cookie);assert.equal(linked.status,200);assert.equal(linked.body.user.id,registered.body.user.id);
  flow=await f.begin();const signed=await f.call('google/complete',{ticket:flow.ticket,verifier:flow.verifier});assert.equal(signed.body.user.id,registered.body.user.id);assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,1);
});
test('Google cannot bypass farmer approval or create a delivery account and keeps portal cookies separate',async t=>{
  const f=await fixture(t);let flow=await f.begin({portal:'delivery'});assert.equal((await f.call('google/complete',{ticket:flow.ticket,verifier:flow.verifier})).status,403);
  const farmer=await f.call('farmer/register',{name:'Grower',email:f.identity.email,password:'farmer test password!',businessName:'Test Farm',phone:'9876543210'});assert.equal(farmer.status,201);
  flow=await f.begin({portal:'farmer',link:true,cookie:farmer.cookie});const linked=await f.call('google/complete',{ticket:flow.ticket,verifier:flow.verifier},farmer.cookie);assert.equal(linked.status,200);assert.match(linked.cookie,/farmconnect_farmer_session=/);assert.equal(linked.body.user.accessStatus,'pending');
  assert.equal((await f.call('me',undefined,linked.cookie)).body.user,null);
  assert.equal((await f.call('farmer/me',undefined,linked.cookie)).body.user.id,farmer.body.user.id);
  flow=await f.begin({portal:'store'});assert.equal((await f.call('google/complete',{ticket:flow.ticket,verifier:flow.verifier})).status,403);
});
test('OAuth state expiry, cross-origin requests, unverified identity and mobile ticket interception fail closed',async t=>{
  const f=await fixture(t);assert.equal((await f.call('google/prepare',{portal:'store',mobile:false,challenge:'a'.repeat(43)},'','https://evil.example')).status,403);
  assert.equal((await f.call('google/callback?state=unknown&code=test-code')).status,400);
  const flow=await f.begin({mobile:true});assert.match(flow.callback.location,/^farmconnect:\/\/oauth\?ticket=/);assert.ok(!flow.callback.location.includes(flow.verifier));
  assert.equal((await f.call('google/complete',{ticket:flow.ticket,verifier:'b'.repeat(43)})).status,400);
  f.db.prepare('UPDATE oauth_attempts SET expires_at=0').run();assert.equal((await f.call('google/complete',{ticket:flow.ticket,verifier:flow.verifier})).status,400);
  f.identity.verified=false;const bad=await f.begin();assert.match(bad.callback.location,/google_error=failed/);
});
test('Password changes verify current password and revoke every old session; owner can revoke other devices',async t=>{
  const f=await fixture(t),account={name:'Security Test',email:'security@example.test',password:'original secure password!'};
  const first=await f.call('register',account),second=await f.call('login',account);
  assert.equal((await f.call('security',undefined,first.cookie)).body.sessions.length,2);
  assert.equal((await f.call('revoke-others',{},first.cookie)).status,200);assert.equal((await f.call('me',undefined,second.cookie)).body.user,null);
  assert.equal((await f.call('password',{currentPassword:'wrong',newPassword:'changed secure password!'},first.cookie)).status,401);
  const changed=await f.call('password',{currentPassword:account.password,newPassword:'changed secure password!'},first.cookie);assert.equal(changed.status,200);
  assert.equal((await f.call('me',undefined,first.cookie)).body.user,null);assert.ok((await f.call('me',undefined,changed.cookie)).body.user);
  assert.equal((await f.call('login',account)).status,401);assert.equal((await f.call('login',{...account,password:'changed secure password!'})).status,200);
  assert.equal((await f.call('security')).status,401);
});
test('Google configuration rejects incomplete secrets or insecure origins and is unavailable without setup',async t=>{
  assert.throws(()=>readConfig({GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com'}));
  assert.throws(()=>readConfig({GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test',APP_ORIGIN:'http://192.168.1.2:4000'}));
  assert.ok(readConfig({GOOGLE_CLIENT_ID:'test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test',APP_ORIGIN:'http://localhost:4000'}).google);
  const f=await fixture(t,{google:null});assert.equal((await f.call('google/config')).body.enabled,false);assert.equal((await f.call('google/prepare',{portal:'store',mobile:false,challenge:'a'.repeat(43)})).status,503);
});
