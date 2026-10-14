import { OAuth2Client } from 'google-auth-library';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { ApiError } from './pricing.js';
import { currentUser, publicUser, startSession, requireSameOrigin, digest, securityEvent } from './auth.js';
import { createProfile } from './profiles.js';

const home=portal=>portal==='store'?'/':'/'+portal;
export function googleProvider(config) {
  const client=new OAuth2Client(config.clientId,config.clientSecret,config.redirectUri);
  return { async exchange(code,nonce) {
    const {tokens}=await client.getToken({code,redirect_uri:config.redirectUri});
    if(!tokens.id_token)throw new Error('Missing identity');
    const ticket=await client.verifyIdToken({idToken:tokens.id_token,audience:config.clientId});
    const payload=ticket.getPayload();
    if(!payload||payload.nonce!==nonce||!payload.email_verified||!payload.sub||!payload.email)throw new Error('Invalid identity');
    return {sub:payload.sub,email:payload.email.toLowerCase(),name:payload.name||'Farmconnect member',verified:true};
  }};
}
export function mountGoogleAuth(app,db,config,provider=config.google?googleProvider(config.google):null) {
  app.get('/api/auth/google/config',(_req,res)=>res.json({enabled:Boolean(config.google)}));
  app.post('/api/auth/google/prepare',requireSameOrigin,(req,res)=>{
    if(!config.google)throw new ApiError(503,'GOOGLE_NOT_CONFIGURED','Google sign-in is not enabled yet. Use email and password.');
    const {portal,challenge,mobile,link}=req.body||{};
    if(!['store','farmer','delivery'].includes(portal)||typeof challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(challenge)||typeof mobile!=='boolean')throw new ApiError(400,'INVALID_SIGN_IN','Please start sign-in again.');
    const now=Date.now();db.prepare('DELETE FROM oauth_attempts WHERE expires_at<=?').run(now);
    // Bound both per-IP initiation and total outstanding work, without retaining raw IPs.
    const rateKey=digest('google:'+req.ip),limit=15*60*1000;
    db.prepare('DELETE FROM auth_attempts WHERE started_at<=?').run(now-limit);
    db.prepare('INSERT INTO auth_attempts VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count=count+1').run(rateKey,now);
    if(db.prepare('SELECT count FROM auth_attempts WHERE key=?').get(rateKey).count>20||db.prepare('SELECT count(*) n FROM oauth_attempts').get().n>5000)throw new ApiError(429,'TOO_MANY_ATTEMPTS','Please wait before trying Google sign-in again.');
    const user=currentUser(db,req,portal==='store'?undefined:portal);
    if(link&&!user)throw new ApiError(401,'SIGN_IN_REQUIRED','Sign in with your password before connecting Google.');
    const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO oauth_attempts(state_hash,nonce,challenge,portal,mobile,link_user_id,expires_at) VALUES (?,?,?,?,?,?,?)').run(digest(state),nonce,challenge,portal,mobile?1:0,link?user.id:null,now+600000);
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for(const [key,value] of Object.entries({client_id:config.google.clientId,redirect_uri:config.google.redirectUri,response_type:'code',scope:'openid email profile',state,nonce,prompt:'select_account'}))url.searchParams.set(key,value);
    res.json({url:url.href});
  });
  app.get('/api/auth/google/callback',async(req,res)=>{
    const state=typeof req.query.state==='string'?req.query.state:'';
    const pending=db.prepare('SELECT * FROM oauth_attempts WHERE state_hash=? AND expires_at>? AND ticket_hash IS NULL').get(digest(state),Date.now());
    if(!pending)throw new ApiError(400,'SIGN_IN_EXPIRED','Sign-in expired or was already used. Open Farmconnect and try again.');
    function fail(){db.prepare('DELETE FROM oauth_attempts WHERE state_hash=?').run(pending.state_hash);return res.redirect(303,config.origin+home(pending.portal)+'?google_error=failed');}
    if(req.query.error||typeof req.query.code!=='string'||req.query.code.length>4096)return fail();
    try {
      const identity=await provider.exchange(req.query.code,pending.nonce);
      if(!identity.verified||typeof identity.sub!=='string'||identity.sub.length>255||typeof identity.email!=='string'||identity.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email))return fail();
      const ticket=randomBytes(32).toString('base64url');
      const changed=db.prepare('UPDATE oauth_attempts SET ticket_hash=?,identity_json=?,expires_at=? WHERE state_hash=? AND ticket_hash IS NULL AND expires_at>?').run(digest(ticket),JSON.stringify(identity),Date.now()+120000,pending.state_hash,Date.now());
      if(!changed.changes)return fail();
      res.set('Referrer-Policy','no-referrer');
      const destination=pending.mobile?'farmconnect://oauth?ticket='+ticket+'&portal='+pending.portal:config.origin+home(pending.portal)+'?oauth_ticket='+ticket;
      return res.redirect(303,destination);
    } catch {return fail();}
  });
  app.post('/api/auth/google/complete',requireSameOrigin,(req,res)=>{
    const {ticket,verifier}=req.body||{};
    if(typeof ticket!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(ticket)||typeof verifier!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(verifier))throw new ApiError(400,'INVALID_SIGN_IN','Start Google sign-in again on this device.');
    const pending=db.prepare('SELECT * FROM oauth_attempts WHERE ticket_hash=? AND expires_at>?').get(digest(ticket),Date.now());
    if(!pending||pending.challenge!==createHash('sha256').update(verifier).digest('base64url'))throw new ApiError(400,'INVALID_SIGN_IN','Sign-in expired or belongs to another device. Please try again.');
    const identity=JSON.parse(pending.identity_json);
    db.exec('BEGIN IMMEDIATE');
    let user;
    try {
      // Consume once in the same transaction as linking/account creation.
      db.prepare('DELETE FROM oauth_attempts WHERE state_hash=?').run(pending.state_hash);
      const existing=db.prepare('SELECT u.* FROM google_identities g JOIN users u ON u.id=g.user_id WHERE subject=?').get(identity.sub);
      if(pending.link_user_id){
        const signed=currentUser(db,req,pending.portal==='store'?undefined:pending.portal);
        if(!signed||signed.id!==pending.link_user_id)throw new ApiError(401,'LINK_SIGN_IN_REQUIRED','Sign in again before connecting Google.');
        if(signed.email!==identity.email||(existing&&existing.id!==signed.id))throw new ApiError(409,'GOOGLE_MISMATCH','Choose the Google account with the same email as your Farmconnect account.');
        const linked=db.prepare('SELECT subject FROM google_identities WHERE user_id=?').get(signed.id);
        if(linked&&linked.subject!==identity.sub)throw new ApiError(409,'ALREADY_LINKED','A different Google identity is already connected.');
        db.prepare('INSERT OR IGNORE INTO google_identities VALUES (?,?,?)').run(identity.sub,signed.id,Date.now());
        securityEvent(db,signed.id,'Google sign-in connected');user=signed;
      } else if(existing){user=publicUser(db,existing);}
      else {
        if(db.prepare('SELECT 1 FROM users WHERE email=?').get(identity.email))throw new ApiError(409,'LINK_REQUIRED','This email already has an account. Sign in with your password, then connect Google in Account security.');
        if(pending.portal!=='store')throw new ApiError(403,'PARTNER_REGISTRATION_REQUIRED','Register your partner account first, then connect Google in Account security. Verification is still required.');
        const id=randomUUID(),name=String(identity.name).trim().slice(0,80)||'Farmconnect member';
        db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,name,identity.email,'google-only','customer',Date.now());
        createProfile(db,id,{accountType:'consumer',businessName:'',phone:''});
        db.prepare('INSERT INTO auth_settings VALUES (?,0)').run(id);
        db.prepare('INSERT INTO google_identities VALUES (?,?,?)').run(identity.sub,id,Date.now());
        user=publicUser(db,db.prepare('SELECT * FROM users WHERE id=?').get(id));
      }
      if(pending.portal==='farmer'&&user.requestedAccountType!=='farmer'||pending.portal==='delivery'&&user.accountType!=='delivery'||pending.portal==='store'&&['farmer','delivery'].includes(user.requestedAccountType))throw new ApiError(403,'WRONG_WORKSPACE','Use the sign-in screen for your account: Shop, Farmer or Delivery.');
      db.exec('COMMIT');
    } catch(error){db.exec('ROLLBACK');db.prepare('DELETE FROM oauth_attempts WHERE state_hash=?').run(pending.state_hash);throw error;}
    startSession(db,req,res,user,pending.portal,config.production);res.json({user,path:home(pending.portal)});
  });
}
