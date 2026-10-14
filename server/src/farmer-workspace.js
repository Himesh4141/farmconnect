import { queueRefund, assertOrderPaid } from './payment-ledger.js';
import { syncOrder } from './fulfillment.js';
import { ApiError } from './pricing.js';
import { requireUser,requireSameOrigin } from './auth.js';
export function updateOrderAggregate(db,id){syncOrder(db,id);}
function tx(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
export function mountFarmerWorkspace(app,db){
 const member=[requireUser(db),(req,_res,next)=>{if(req.user.requestedAccountType!=='farmer'||!req.user.farmId)throw new ApiError(403,'FARMER_REQUIRED','Use your farmer account.');next();}];
 const writable=(req,_res,next)=>{if(req.user.accessStatus==='suspended')throw new ApiError(403,'SUSPENDED','Contact the administrator about your suspended access.');next();};
 const approved=(req,_res,next)=>{if(req.user.accessStatus!=='approved')throw new ApiError(403,'APPROVAL_REQUIRED','Verification is required before managing orders.');next();};
 app.get('/api/farmer/profile',...member,(req,res)=>{
  const farm=db.prepare('SELECT f.name,d.* FROM farms f JOIN farm_details d ON d.farm_id=f.id WHERE f.id=?').get(req.user.farmId);
  const application=db.prepare('SELECT status,review_note FROM access_applications WHERE user_id=?').get(req.user.id);
  res.json({farm,application,accessStatus:req.user.accessStatus,otpAvailable:false,courierAvailable:false});
 });
 app.post('/api/farmer/profile',requireSameOrigin,...member,writable,(req,res)=>{
  const b=req.body,values={};for(const [field,min,max] of [['name',2,120],['phone',10,10],['pickup_address',5,300],['city',2,80],['pincode',6,6],['evidence',20,1500]]){const value=typeof b?.[field]==='string'?b[field].trim():'';if(value.length<min||value.length>max)throw new ApiError(400,'INVALID_PROFILE',`Check ${field.replaceAll('_',' ')} (${min}–${max} characters).`);values[field]=value;}
  if(!/^[6-9][0-9]{9}$/.test(values.phone)||!/^[0-9]{6}$/.test(values.pincode))throw new ApiError(400,'INVALID_PROFILE','Enter a valid Indian mobile number and six-digit pincode.');
  tx(db,()=>{
   const old=db.prepare('SELECT f.name,d.* FROM farms f JOIN farm_details d ON d.farm_id=f.id WHERE f.id=?').get(req.user.farmId);
   if(old.revision!==b.revision)throw new ApiError(409,'PROFILE_CHANGED','Refresh My farm before editing.');
   const changed=Object.keys(values).some(k=>old[k]!==values[k]);
   if(req.user.accessStatus==='approved'&&changed&&b.confirmReverification!==true)throw new ApiError(409,'REVIEW_REQUIRED','Changing verified farm details requires a new review. Confirm before saving.');
   if(req.user.accessStatus==='approved'&&!changed)return;
   db.prepare('UPDATE farms SET name=? WHERE id=?').run(values.name,req.user.farmId);
   db.prepare('UPDATE farm_details SET phone=?,pickup_address=?,city=?,pincode=?,evidence=?,revision=revision+1 WHERE farm_id=?').run(values.phone,values.pickup_address,values.city,values.pincode,values.evidence,req.user.farmId);
   db.prepare("UPDATE account_profiles SET business_name=?,access_status='pending' WHERE user_id=?").run(values.name,req.user.id);
   db.prepare("UPDATE access_applications SET business_name=?,phone=?,location=?,evidence=?,status='pending',review_note='',revision=revision+1,updated_at=? WHERE user_id=?").run(values.name,values.phone,values.pickup_address+', '+values.city+' '+values.pincode,values.evidence,Date.now(),req.user.id);
   db.prepare('DELETE FROM access_invitations WHERE user_id=?').run(req.user.id);
   db.prepare("INSERT INTO access_events(application_id,actor_id,target_user_id,action,note,created_at) SELECT id,?,?,'farmer_profile_submitted','Farm details submitted for review.',? FROM access_applications WHERE user_id=?").run(req.user.id,req.user.id,Date.now(),req.user.id);
  });res.json({ok:true});
 });
 app.delete('/api/farmer/products/:id',requireSameOrigin,...member,writable,(req,res)=>{
  tx(db,()=>{
   const row=db.prepare('SELECT * FROM products WHERE id=? AND farm_id=?').get(req.params.id,req.user.farmId);if(!row)throw new ApiError(404,'PRODUCT_NOT_FOUND','Your product was not found.');
   if(row.revision!==req.body?.revision)throw new ApiError(409,'PRODUCT_CHANGED','Refresh the listing first.');
   if(row.active||row.published_once||db.prepare('SELECT 1 FROM order_items WHERE product_id=? LIMIT 1').get(row.id))throw new ApiError(409,'ARCHIVE_REQUIRED','Published or ordered products must be archived to preserve history.');
   db.prepare('DELETE FROM products WHERE id=?').run(row.id);
  });res.json({ok:true});
 });
 app.post('/api/farmer/products/:id/archive',requireSameOrigin,...member,writable,(req,res)=>{
  const result=db.prepare('UPDATE products SET active=0,archived=1,revision=revision+1 WHERE id=? AND farm_id=? AND revision=?').run(req.params.id,req.user.farmId,req.body?.revision??-1);
  if(!result.changes)throw new ApiError(409,'PRODUCT_CHANGED','Listing is unavailable or changed. Refresh first.');res.json({ok:true});
 });
 app.post('/api/farmer/orders/:id/reject',requireSameOrigin,...member,approved,(req,res)=>{
  const reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';if(reason.length<8||reason.length>500)throw new ApiError(400,'REASON_REQUIRED','Explain the rejection in 8–500 characters.');
  tx(db,()=>{
   const row=db.prepare('SELECT ff.*,o.status AS overall FROM farm_fulfillments ff JOIN orders o ON o.id=ff.order_id WHERE ff.order_id=? AND ff.farm_id=?').get(req.params.id,req.user.farmId);
   if(!row)throw new ApiError(404,'ORDER_NOT_FOUND','This order does not belong to your farm.');if(row.status==='cancelled')return;
   assertOrderPaid(db,row.order_id);
   if(row.status!=='placed'||['cancelled','delivered'].includes(row.overall))throw new ApiError(409,'ALREADY_ACCEPTED','You can reject only new, unaccepted farm orders.');
   for(const item of db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=? AND farm_id=?').all(row.order_id,req.user.farmId)){if(!db.prepare("UPDATE products SET stock=CASE WHEN sale_mode='pack' THEN stock+? ELSE stock END,stock_grams=CASE WHEN sale_mode='weight' THEN stock_grams+? ELSE stock_grams END,revision=revision+1 WHERE id=? AND CASE WHEN sale_mode='weight' THEN stock_grams+?<=1000000000 ELSE stock+?<=1000000 END").run(item.quantity,item.quantity,item.product_id,item.quantity,item.quantity).changes)throw new ApiError(409,'STOCK_LIMIT','Inventory limit prevents restocking. Contact the administrator.');}
   db.prepare("UPDATE farm_fulfillments SET status='cancelled',rejection_reason=?,updated_at=? WHERE order_id=? AND farm_id=?").run(reason,Date.now(),row.order_id,req.user.farmId);
   db.prepare("INSERT INTO farm_events(order_id,farm_id,actor_id,status,created_at) VALUES (?,?,?,'cancelled',?)").run(row.order_id,req.user.farmId,req.user.id,Date.now());
   updateOrderAggregate(db,row.order_id);
   queueRefund(db,row.order_id);
  });res.json({ok:true});
 });
}
