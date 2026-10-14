import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { openDatabase, seedDatabase } from '../src/db.js';
async function fixture(t) {
 const db = openDatabase(':memory:'); seedDatabase(db);
 const server = createApp(db).listen(0, '127.0.0.1'); await once(server, 'listening');
 t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); db.close(); });
 const base = `http://127.0.0.1:${server.address().port}`;
 async function call(path, body, cookie = '', origin = base) {
  const res = await fetch(base + '/api/auth/' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type':'application/json', Origin:origin, Cookie:cookie }, body:body ? JSON.stringify(body) : undefined });
  return { status:res.status, cookie:res.headers.get('set-cookie'), data:await res.json() };
 }
 return { db, call };
}
const account = { name:'Test Customer', email:'Customer@example.com', password:'fresh produce test phrase', role:'admin' };
test('account lifecycle, secure storage, session rotation, expiry and logout', async t => {
 const {db,call} = await fixture(t);
 assert.equal((await call('me')).data.user, null);
 const registered = await call('register', account);
 assert.equal(registered.status,201); assert.equal(registered.data.user.role,'customer'); assert.equal(registered.data.user.email,'customer@example.com');
 assert.equal(registered.data.user.password_hash,undefined);
 assert.match(registered.cookie,/HttpOnly/); assert.match(registered.cookie,/SameSite=Lax/);
 const firstCookie = registered.cookie.split(';')[0];
 const row = db.prepare('SELECT * FROM users').get();
 assert.match(row.password_hash,/^[a-f0-9]{32}:[a-f0-9]{64}$/);
 assert.notEqual(db.prepare('SELECT token_hash FROM sessions').get().token_hash,firstCookie.split('=')[1]);
 assert.equal((await call('me',undefined,firstCookie)).data.user.id,row.id);
 assert.equal((await call('register',account)).status,409);
 assert.equal((await call('login',{...account,password:'incorrect phrase'})).status,401);
 assert.equal((await call('login',{...account,email:'missing@example.com'})).status,401);
 const login = await call('login',account,firstCookie); assert.equal(login.status,200);
 const cookie = login.cookie.split(';')[0]; assert.notEqual(cookie,firstCookie);
 assert.equal((await call('me',undefined,firstCookie)).data.user,null);
 assert.equal((await call('me',undefined,cookie)).data.user.id,row.id);
 assert.equal((await call('logout',{},cookie)).status,200);
 assert.equal((await call('me',undefined,cookie)).data.user,null);
 const again = await call('login',account); db.prepare('UPDATE sessions SET expires_at = 0').run();
 assert.equal((await call('me',undefined,again.cookie.split(';')[0])).data.user,null);
});
test('origin protection, validation and attempt limits', async t => {
 const {db,call} = await fixture(t);
 assert.equal((await call('register',account,'','https://attacker.example')).status,403);
 assert.equal((await call('register',account,'','null')).status,403);
 assert.equal((await call('register',{...account,password:'short'})).status,400);
 assert.equal((await call('register',{...account,email:'invalid'})).status,400);
 assert.equal((await call('register',{...account,name:'A'})).status,400);
 for(let n=0;n<10;n++) assert.equal((await call('login',{email:'rate@example.com',password:''})).status,400);
 assert.equal((await call('login',{email:'rate@example.com',password:''})).status,429);
 assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n,0);
});
