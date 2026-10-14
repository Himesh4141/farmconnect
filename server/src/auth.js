import { registrationProfile, createProfile, profileFor } from './profiles.js';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError } from './pricing.js';
const derive = promisify(scrypt);
const COOKIE = 'farmconnect_session';
export function cookieName(req) {
  const scope = req.path.match(/^\/api\/(?:auth\/)?(farmer|delivery)\//)?.[1];
  return scope ? `farmconnect_${scope}_session` : COOKIE;
}
const WEEK = 7 * 24 * 60 * 60 * 1000;
export const digest = value => createHash('sha256').update(value).digest('hex');
let hashing = 0;
export async function hash(password, salt) {
  if (hashing >= 2) throw new ApiError(503, 'BUSY', 'Please try again in a moment.');
  hashing++;
  try { return await derive(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }); }
  finally { hashing--; }
}
export function token(req, name = cookieName(req)) {
  const value = (req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(name + '='))?.slice(name.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function publicUser(db, row) { return row ? { id: row.id, name: row.name, email: row.email, role: row.role, ...profileFor(db,row.id) } : null; }
export function securityEvent(db,userId,event) {
  db.prepare('INSERT INTO security_events(user_id,event,created_at) VALUES (?,?,?)').run(userId,event,Date.now());
  db.prepare('DELETE FROM security_events WHERE user_id=? AND id NOT IN (SELECT id FROM security_events WHERE user_id=? ORDER BY id DESC LIMIT 100)').run(userId,userId);
}
export function startSession(db,req,res,user,portal,production=process.env.NODE_ENV==='production') {
  const name=portal ? portal==='store' ? COOKIE : `farmconnect_${portal}_session` : cookieName(req);
  const previous=token(req,name), value=randomBytes(32).toString('hex'), now=Date.now();
  const ua=req.get('user-agent')||'';
  const device=ua.includes('FarmconnectAndroid/')?'Farmconnect Android':/Android|iPhone|iPad/.test(ua)?'Mobile browser':'Web browser';
  db.exec('BEGIN IMMEDIATE');
  try {
    if(previous)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(previous));
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(value),user.id,now+WEEK);
    db.prepare('INSERT INTO session_details VALUES (?,?,?,?)').run(digest(value),randomUUID(),device,now);
    securityEvent(db,user.id,'Signed in');
    db.exec('COMMIT');
  } catch(error){db.exec('ROLLBACK');throw error;}
  res.cookie(name,value,{httpOnly:true,sameSite:'lax',secure:production,path:'/',maxAge:WEEK});
}
export function currentUser(db, req, portal) {
  // Old API clients may still use the shared cookie. New portal auth never falls back.
  const value = token(req, portal ? `farmconnect_${portal}_session` : cookieName(req)) ?? (!req.path.startsWith('/api/auth/') ? token(req, COOKIE) : null);
  return value ? publicUser(db, db.prepare('SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?').get(digest(value), Date.now())) : null;
}
export function requireUser(db) {
  return (req, _res, next) => {
    req.user = currentUser(db, req);
    if (!req.user) throw new ApiError(401, 'SIGN_IN_REQUIRED', 'Please sign in to continue.');
    next();
  };
}
export function mountAuth(app, db, config={}) {
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.production??process.env.NODE_ENV === 'production', path: '/' };
  function revoke(req) { const value = token(req); if (value) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(value)); }
  function rateLimit(req, _res, next) {
    const now = Date.now(), window = 15 * 60 * 1000;
    db.prepare('DELETE FROM auth_attempts WHERE started_at <= ?').run(now - window);
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
    for (const [key, max] of [[digest('ip:' + req.ip), 30], [digest('email:' + email), 10]]) {
      db.prepare('INSERT INTO auth_attempts VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count = count + 1').run(key, now);
      if (db.prepare('SELECT count FROM auth_attempts WHERE key = ?').get(key).count > max) throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Please wait 15 minutes.');
    }
    next();
  }
  function fields(body, registering) {
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body?.password;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
    if (typeof password !== 'string' || password.length > 128 || password.length < (registering ? 12 : 1)) throw new ApiError(400, 'INVALID_PASSWORD', 'Use a password between 12 and 128 characters.');
    if (registering && (name.length < 2 || name.length > 80)) throw new ApiError(400, 'INVALID_NAME', 'Enter a name between 2 and 80 characters.');
    return { email, password, name };
  }
  const paths = action => ['/api/auth/'+action,'/api/auth/farmer/'+action,'/api/auth/delivery/'+action];
  app.get(paths('me'), (req, res) => res.json({ user: currentUser(db, req) }));
  app.post([...paths('register'),'/api/auth/farmer-register','/api/auth/delivery-register'], requireSameOrigin, rateLimit, async (req, res) => {
    const { name, email, password } = fields(req.body, true);
    const deliverySignup=['/api/auth/delivery-register','/api/auth/delivery/register'].includes(req.path);
    const phone=typeof req.body?.phone==='string'?req.body.phone.trim():'';
    if(deliverySignup&&!/^[6-9][0-9]{9}$/.test(phone))throw new ApiError(400,'INVALID_PHONE','Enter a 10-digit Indian mobile number.');
    const profile = registrationProfile(deliverySignup?{accountType:'consumer'}:req.body,['/api/auth/farmer-register','/api/auth/farmer/register'].includes(req.path));
    const salt = randomBytes(16).toString('hex');
    const encoded = salt + ':' + (await hash(password, salt)).toString('hex');
    const user = { id: randomUUID(), name, email, role: 'customer', ...profile };
    db.exec('BEGIN IMMEDIATE');
    try {
      const result=db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING').run(user.id,name,email,encoded,user.role,Date.now());
      if(!result.changes)throw new ApiError(409,'ACCOUNT_EXISTS','An account already uses this email. Please sign in.');
      createProfile(db,user.id,profile);
      if(deliverySignup)db.prepare("INSERT INTO delivery_partners(user_id,phone,status,created_at) VALUES (?,?,'pending',?)").run(user.id,phone,Date.now());
      Object.assign(user,profileFor(db,user.id));
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK'); throw error; }
    startSession(db, req, res, user,undefined,cookieOptions.secure);
    res.status(201).json({ user });
  });
  app.post(paths('login'), requireSameOrigin, rateLimit, async (req, res) => {
    const { email, password } = fields(req.body, false);
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const enabled=row && db.prepare('SELECT password_enabled FROM auth_settings WHERE user_id=?').get(row.id)?.password_enabled!==0;
    const [salt, expected] = enabled && /^[a-f0-9]{32}:[a-f0-9]{64}$/.test(row.password_hash) ? row.password_hash.split(':') : ['00000000000000000000000000000000', '0'.repeat(64)];
    const candidate = await hash(password, salt);
    if (!timingSafeEqual(candidate, Buffer.from(expected, 'hex')) || !enabled) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    const user = publicUser(db, row);
    if(req.path.includes('/farmer/')&&user.requestedAccountType!=='farmer')throw new ApiError(403,'WRONG_WORKSPACE','Use your farmer account here. Your shopping and delivery logins stay separate.');
    if(req.path.includes('/delivery/')&&user.accountType!=='delivery')throw new ApiError(403,'WRONG_WORKSPACE','Use your approved delivery-partner account here.');
    startSession(db, req, res, user,undefined,cookieOptions.secure);
    res.json({ user });
  });
  app.post(paths('logout'), requireSameOrigin, (req, res) => {
    revoke(req);
    res.clearCookie(cookieName(req), cookieOptions);
    res.json({ user: null });
  });
  app.get(paths('security'),requireUser(db),(req,res)=>{
    const current=digest(token(req)||'');
    const sessions=db.prepare('SELECT d.id,d.device,d.created_at AS createdAt,s.expires_at AS expiresAt,s.token_hash FROM sessions s LEFT JOIN session_details d ON d.token_hash=s.token_hash WHERE s.user_id=? AND s.expires_at>? ORDER BY d.created_at DESC LIMIT 30').all(req.user.id,Date.now()).map(s=>({id:s.id,device:s.device||'Earlier session',createdAt:s.createdAt,expiresAt:s.expiresAt,current:s.token_hash===current}));
    res.json({sessions,googleLinked:Boolean(db.prepare('SELECT 1 FROM google_identities WHERE user_id=?').get(req.user.id)),passwordEnabled:db.prepare('SELECT password_enabled FROM auth_settings WHERE user_id=?').get(req.user.id)?.password_enabled!==0,events:db.prepare('SELECT event,created_at AS createdAt FROM security_events WHERE user_id=? ORDER BY id DESC LIMIT 12').all(req.user.id)});
  });
  app.post(paths('revoke-others'),requireSameOrigin,requireUser(db),(req,res)=>{
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(req.user.id,digest(token(req)||''));
    securityEvent(db,req.user.id,'Other sessions signed out');res.json({ok:true});
  });
  app.post(paths('password'),requireSameOrigin,requireUser(db),rateLimit,async(req,res)=>{
    const row=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if(db.prepare('SELECT password_enabled FROM auth_settings WHERE user_id=?').get(row.id)?.password_enabled===0)throw new ApiError(400,'GOOGLE_ACCOUNT','Manage your Google password through your Google account.');
    const old=req.body.currentPassword, next=req.body.newPassword;
    if(typeof old!=='string'||old.length>128||typeof next!=='string'||next.length<12||next.length>128||old===next)throw new ApiError(400,'INVALID_PASSWORD','Enter your current password and a different new password of 12–128 characters.');
    const [salt,expected]=row.password_hash.split(':');
    if(!timingSafeEqual(await hash(old,salt),Buffer.from(expected,'hex')))throw new ApiError(401,'INVALID_CREDENTIALS','Current password is incorrect.');
    const newSalt=randomBytes(16).toString('hex'), encoded=newSalt+':'+(await hash(next,newSalt)).toString('hex');
    db.exec('BEGIN IMMEDIATE');
    try {if(db.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').run(encoded,row.id,row.password_hash).changes!==1)throw new ApiError(409,'RETRY','Your account changed. Sign in again.');db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);securityEvent(db,row.id,'Password changed; all previous sessions revoked');db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    startSession(db,req,res,req.user,undefined,cookieOptions.secure);res.json({ok:true});
  });
}

export function requireSameOrigin(req, _res, next) {
    let valid = false;
    try { const url = new URL(req.get('origin')); valid = ['http:', 'https:'].includes(url.protocol) && url.host === req.get('host'); } catch {}
    if (!valid) throw new ApiError(403, 'ORIGIN_REJECTED', 'Open Farmconnect in your browser and try again.');
    next();
  }



