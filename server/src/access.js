import { paging,choice } from './admin-support.js';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { ApiError } from './pricing.js';
import { requireUser,requireSameOrigin } from './auth.js';
import { isAdmin } from './admin.js';
import { getCatalog } from './catalog.js';
const digest=value=>createHash('sha256').update(value).digest('hex');
const selectApplication='SELECT a.*,u.email,u.name FROM access_applications a JOIN users u ON u.id=a.user_id';
function event(db,application,actor,target,action,note){db.prepare('INSERT INTO access_events(application_id,actor_id,target_user_id,action,note,created_at) VALUES (?,?,?,?,?,?)').run(application,actor,target,action,note,Date.now());}
function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
function text(body,key,min,max){const value=typeof body?.[key]==='string'?body[key].trim():'';if(value.length<min||value.length>max)throw new ApiError(400,'INVALID_APPLICATION',`Enter ${key} using ${min}–${max} characters.`);return value;}
export function mountAccess(app,db){
 const admin=[requireUser(db),(req,_res,next)=>{if(!isAdmin(db,req.user.id))throw new ApiError(403,'ADMIN_REQUIRED','Administrator access is required.');next();}];
 app.get('/api/access/application',requireUser(db),(req,res)=>res.json({application:db.prepare('SELECT * FROM access_applications WHERE user_id=?').get(req.user.id)??null}));
 app.post('/api/access/application',requireSameOrigin,requireUser(db),(req,res)=>{
  if(req.user.accountType==='delivery')throw new ApiError(403,'DELIVERY_ACCOUNT','Delivery accounts cannot apply for seller or business access.');
  const type=req.body?.accountType;if(!['farmer','bulk_buyer'].includes(type))throw new ApiError(400,'INVALID_TYPE','Choose farmer or bulk buyer.');
  const business=text(req.body,'businessName',2,120),phone=text(req.body,'phone',10,10),location=text(req.body,'location',5,200),evidence=text(req.body,'evidence',20,1500);
  if(!/^[6-9][0-9]{9}$/.test(phone))throw new ApiError(400,'INVALID_PHONE','Enter a 10-digit Indian mobile number.');
  const result=transaction(db,()=>{
   const profile=db.prepare('SELECT * FROM account_profiles WHERE user_id=?').get(req.user.id);
   if(profile&&profile.account_type!=='consumer'&&(profile.access_status!=='pending'||profile.account_type!==type))throw new ApiError(409,'ACCESS_EXISTS','This account already has an assigned role. Contact the administrator.');
   const old=db.prepare('SELECT * FROM access_applications WHERE user_id=?').get(req.user.id);
   if(old&&['invited','approved'].includes(old.status))throw new ApiError(409,'APPLICATION_LOCKED','Redeem your invitation or contact the administrator.');
   if(type==='farmer'&&!profile?.farm_id){
    const farmId=randomUUID();db.prepare('INSERT INTO farms VALUES (?,?)').run(farmId,business);
    db.prepare("INSERT INTO account_profiles(user_id,account_type,business_name,farm_id,access_status) VALUES (?,'farmer',?,?,'pending') ON CONFLICT(user_id) DO UPDATE SET account_type='farmer',business_name=excluded.business_name,farm_id=excluded.farm_id,access_status='pending'").run(req.user.id,business,farmId);
    db.prepare('INSERT INTO farm_details(farm_id,phone,pickup_address,evidence) VALUES (?,?,?,?)').run(farmId,phone,location,evidence);
   }
   const id=old?.id??randomUUID();
   if(old)db.prepare("UPDATE access_applications SET account_type=?,business_name=?,phone=?,location=?,evidence=?,status='pending',review_note='',revision=revision+1,updated_at=? WHERE id=?").run(type,business,phone,location,evidence,Date.now(),id);
   else db.prepare("INSERT INTO access_applications(id,user_id,account_type,business_name,phone,location,evidence,status,updated_at) VALUES (?,?,?,?,?,?,?,'pending',?)").run(id,req.user.id,type,business,phone,location,evidence,Date.now());
   event(db,id,req.user.id,req.user.id,'submitted','Application submitted for manual verification.');
   return db.prepare('SELECT * FROM access_applications WHERE id=?').get(id);
  });res.json({application:result});
 });
 app.get('/api/admin/applications',...admin,(req,res)=>{
  const p=paging(req.query),view=choice(req.query.view,['applications','members'])||'applications';
  const status=choice(req.query.status,view==='members'?['approved','pending','suspended']:['pending','needs_information','rejected','invited','approved']);
  const appWhere=" WHERE (?='' OR instr(lower(a.business_name||' '||u.email||' '||u.name),lower(?))>0) AND (?='' OR a.status=?)";
  const memberFrom=" FROM account_profiles p JOIN users u ON u.id=p.user_id WHERE p.account_type!='consumer' AND (?='' OR instr(lower(p.business_name||' '||u.email||' '||u.name),lower(?))>0) AND (?='' OR p.access_status=?)";
  const appArgs=[p.q,p.q,view==='applications'?status:'',view==='applications'?status:''],memberArgs=[p.q,p.q,view==='members'?status:'',view==='members'?status:''];
  res.json({page:p.page,limit:p.limit,applicationTotal:db.prepare('SELECT COUNT(*) n FROM access_applications a JOIN users u ON u.id=a.user_id'+appWhere).get(...appArgs).n,memberTotal:db.prepare('SELECT COUNT(*) n'+memberFrom).get(...memberArgs).n,
   applications:db.prepare(selectApplication+appWhere+' ORDER BY a.updated_at DESC,a.id LIMIT ? OFFSET ?').all(...appArgs,p.limit,p.offset),
   members:db.prepare('SELECT p.user_id,u.name,u.email,p.account_type,p.business_name,p.access_status'+memberFrom+' ORDER BY u.email LIMIT ? OFFSET ?').all(...memberArgs,p.limit,p.offset)});
 });
 app.post('/api/admin/applications/:id/review',requireSameOrigin,...admin,(req,res)=>{
  const action=req.body?.action;if(!['approve','reject','request_information'].includes(action))throw new ApiError(400,'INVALID_ACTION','Choose a review action.');
  const note=text(req.body,'note',10,1000);
  if(action==='approve'&&req.body?.verified!==true)throw new ApiError(400,'VERIFICATION_REQUIRED','Confirm that you checked the applicant’s contact and farm/business connection.');
  const result=transaction(db,()=>{
   const row=db.prepare(selectApplication+' WHERE a.id=?').get(req.params.id);
   if(!row)throw new ApiError(404,'NOT_FOUND','Application not found.');
   if(row.user_id===req.user.id)throw new ApiError(403,'SELF_REVIEW','You cannot review your own application.');
   if(row.revision!==req.body?.revision||row.status==='approved')throw new ApiError(409,'APPLICATION_CHANGED','Refresh the application before reviewing.');
   db.prepare('DELETE FROM access_invitations WHERE application_id=?').run(row.id);
   const directFarmer=action==='approve'&&row.account_type==='farmer';
   if(directFarmer){
    const profile=db.prepare('SELECT * FROM account_profiles WHERE user_id=?').get(row.user_id);
    if(profile?.access_status==='suspended')throw new ApiError(409,'SUSPENDED','Use the access review process to restore this suspended partner.');
    const farmId=profile?.farm_id??randomUUID();
    const details=db.prepare('SELECT * FROM farm_details WHERE farm_id=?').get(farmId);
    if(!details||!details.pickup_address||!details.city||!/^[0-9]{6}$/.test(details.pincode)||row.evidence.length<20)throw new ApiError(400,'PROFILE_INCOMPLETE','Farmer must complete pickup address, city, pincode and verification information before approval.');
    db.prepare("UPDATE account_profiles SET access_status='approved' WHERE user_id=? AND account_type='farmer'").run(row.user_id);
    db.prepare("UPDATE access_applications SET status='approved',review_note=?,revision=revision+1,updated_at=? WHERE id=?").run(note,Date.now(),row.id);
    event(db,row.id,req.user.id,row.user_id,'farmer_approved',note);
    return {status:'approved',activated:true};
   }
   const status=action==='approve'?'invited':action==='reject'?'rejected':'needs_information';
   db.prepare('UPDATE access_applications SET status=?,review_note=?,revision=revision+1,updated_at=? WHERE id=?').run(status,note,Date.now(),row.id);
   event(db,row.id,req.user.id,row.user_id,action,note);
   if(action!=='approve')return {status};
   const code=randomBytes(32).toString('hex'),expiresAt=Date.now()+24*60*60*1000;
   db.prepare('INSERT INTO access_invitations VALUES (?,?,?,?,?)').run(digest(code),row.id,row.user_id,row.email,expiresAt);
   return {status,invitationCode:code,expiresAt,email:row.email};
  });res.json(result);
 });
 app.post('/api/access/redeem',requireSameOrigin,requireUser(db),(req,res)=>{
  if(req.user.accountType==='delivery')throw new ApiError(403,'DELIVERY_ACCOUNT','Delivery accounts cannot redeem seller or business invitations.');
  const now=Date.now(),key=digest('invitation:'+req.user.id);
  db.prepare('DELETE FROM auth_attempts WHERE started_at<=?').run(now-15*60*1000);
  db.prepare('INSERT INTO auth_attempts VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now);
  if(db.prepare('SELECT count FROM auth_attempts WHERE key=?').get(key).count>10)throw new ApiError(429,'TOO_MANY_ATTEMPTS','Wait 15 minutes before trying another invitation.');
  const code=typeof req.body?.code==='string'?req.body.code.trim():'';
  if(!/^[a-f0-9]{64}$/.test(code))throw new ApiError(400,'INVALID_INVITATION','Enter the full invitation code.');
  transaction(db,()=>{
   const invite=db.prepare('SELECT * FROM access_invitations WHERE token_hash=? AND user_id=? AND email=? AND expires_at>?').get(digest(code),req.user.id,req.user.email,now);
   if(!invite)throw new ApiError(403,'INVALID_INVITATION','Invitation is invalid, expired, already used, or belongs to another account.');
   const row=db.prepare("SELECT * FROM access_applications WHERE id=? AND status='invited'").get(invite.application_id);
   if(!row)throw new ApiError(403,'INVALID_INVITATION','Invitation is no longer active.');
   const existing=db.prepare('SELECT * FROM account_profiles WHERE user_id=?').get(req.user.id);
   if(existing?.access_status==='suspended')throw new ApiError(403,'SUSPENDED','Contact the administrator about your suspended access.');
   const farmId=row.account_type==='farmer'?(existing?.farm_id??randomUUID()):null;
   if(farmId){db.prepare('INSERT INTO farms(id,name) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(farmId,row.business_name);}
   db.prepare("INSERT INTO account_profiles(user_id,account_type,business_name,farm_id,access_status) VALUES (?,?,?,?,'approved') ON CONFLICT(user_id) DO UPDATE SET account_type=excluded.account_type,business_name=excluded.business_name,farm_id=excluded.farm_id,access_status='approved'").run(req.user.id,row.account_type,row.business_name,farmId);
   db.prepare("UPDATE access_applications SET status='approved',revision=revision+1,updated_at=? WHERE id=?").run(now,row.id);
   db.prepare('DELETE FROM access_invitations WHERE token_hash=?').run(digest(code));
   event(db,row.id,req.user.id,req.user.id,'invitation_redeemed','Approved access activated by bound account.');
  });res.json({ok:true});
 });
 app.post('/api/admin/members/:id/access',requireSameOrigin,...admin,(req,res)=>{
  const status=req.body?.status;if(!['approved','suspended'].includes(status))throw new ApiError(400,'INVALID_STATUS','Choose suspend or restore.');
  const note=text(req.body,'note',10,1000);
  transaction(db,()=>{
   const row=db.prepare("SELECT * FROM account_profiles WHERE user_id=? AND account_type!='consumer'").get(req.params.id);
   if(!row)throw new ApiError(404,'NOT_FOUND','Partner account not found.');
   if(req.params.id===req.user.id)throw new ApiError(403,'SELF_REVIEW','Another administrator must manage your partner access.');
   const approved=db.prepare("SELECT id FROM access_applications WHERE user_id=? AND status='approved'").get(req.params.id);
   if(!approved)throw new ApiError(409,'REVIEW_REQUIRED','Complete application review and invitation redemption first.');
   if(row.access_status!==req.body?.expectedStatus)throw new ApiError(409,'STATUS_CHANGED','Refresh before changing access.');
   db.prepare('UPDATE account_profiles SET access_status=? WHERE user_id=?').run(status,req.params.id);
   event(db,approved.id,req.user.id,req.params.id,status,note);
  });res.json({ok:true});
 });
 app.get('/api/business/catalog',requireUser(db),(req,res)=>{
  if(req.user.accountType!=='bulk_buyer')throw new ApiError(403,'BUSINESS_ACCESS_REQUIRED','Approved business access is required.');
  res.json(getCatalog(db));
 });
}

