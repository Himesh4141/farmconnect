import express from 'express';
import { randomUUID } from 'node:crypto';
import { isAdmin } from './admin.js';
import { requireUser, requireSameOrigin, currentUser } from './auth.js';
import { ApiError } from './pricing.js';
// Only JPEG is served, with fixed MIME and sandbox headers. Strip EXIF/GPS and comments.
export function cleanJpeg(bytes) {
 const invalid=()=>{throw new ApiError(400,'INVALID_PHOTO','Choose a valid JPEG, PNG or WebP photo using the upload button.');};
 if(!Buffer.isBuffer(bytes)||bytes.length<12||bytes.readUInt16BE(0)!==0xffd8||bytes.readUInt16BE(bytes.length-2)!==0xffd9)invalid();
 const parts=[bytes.subarray(0,2)];let pos=2,dimensions=false;
 while(pos<bytes.length-2){
  if(bytes[pos++]!==255)invalid();
  while(bytes[pos]===255)pos++;
  const marker=bytes[pos++];
  if(pos+2>bytes.length)invalid();
  const length=bytes.readUInt16BE(pos);
  if(length<2||pos+length>bytes.length)invalid();
  if([0xc0,0xc1,0xc2].includes(marker)){
   if(length<8)invalid();const height=bytes.readUInt16BE(pos+3),width=bytes.readUInt16BE(pos+5);
   if(!width||!height||width>1600||height>1600)invalid();dimensions=true;
  }
  if(marker===0xda){if(!dimensions)invalid();parts.push(Buffer.from([255,marker]),bytes.subarray(pos));return Buffer.concat(parts);}
  if(!(marker>=0xe0&&marker<=0xef)&&marker!==0xfe)parts.push(Buffer.from([255,marker]),bytes.subarray(pos,pos+length));
  pos+=length;
 }
 invalid();
}
export function assertPhotoOwner(db,image,farmId){
 if(image?.startsWith('/api/photos/')){
  const row=db.prepare('SELECT farm_id FROM product_photos WHERE id=?').get(image.slice('/api/photos/'.length));
  if(!row||row.farm_id!==farmId)throw new ApiError(400,'INVALID_IMAGE','Upload a photo from your own farmer account.');
 }
}
export function mountPhotos(app,db){
 function checkLimit(farmId){
  const usage=db.prepare('SELECT COUNT(*) AS total,SUM(created_at>?) AS recent FROM product_photos WHERE farm_id=?').get(Date.now()-86400000,farmId);
  if(usage.total>=100||usage.recent>=20)throw new ApiError(429,'PHOTO_LIMIT','Photo limit reached: 20 per day and 100 per farm. Reuse an existing photo or contact support.');
 }

 app.post('/api/farmer/photos',requireSameOrigin,requireUser(db),(req,res,next)=>{
  if(req.user.requestedAccountType!=='farmer'||!req.user.farmId||req.user.accessStatus==='suspended')throw new ApiError(403,'FARMER_REQUIRED','Farmer access is required.');
  checkLimit(req.user.farmId);
  if(!req.is('image/jpeg'))throw new ApiError(415,'PHOTO_TYPE','Use the photo upload button to prepare your image.');next();
 },express.raw({type:'image/jpeg',limit:'1mb'}),(req,res)=>{
  checkLimit(req.user.farmId);
  const bytes=cleanJpeg(req.body),id=randomUUID()+'.jpg';
  db.prepare('INSERT INTO product_photos VALUES (?,?,?,?)').run(id,req.user.farmId,bytes,Date.now());
  res.status(201).json({image:'/api/photos/'+id});
 });
 app.get('/api/photos/:id',(req,res)=>{
  const row=db.prepare('SELECT * FROM product_photos WHERE id=?').get(req.params.id);
  const url='/api/photos/'+req.params.id;
  const published=row&&db.prepare("SELECT 1 FROM products p JOIN account_profiles a ON a.farm_id=p.farm_id WHERE p.image=? AND p.active=1 AND p.archived=0 AND NOT EXISTS(SELECT 1 FROM listing_moderation m WHERE m.product_id=p.id AND m.blocked=1) AND a.access_status='approved' LIMIT 1").get(url);
  const user=!published?currentUser(db,req,'farmer'):null;
  const reviewer=!published?currentUser(db,req):null;
  const canReview=reviewer&&isAdmin(db,reviewer.id);
  if(!row||(!published&&!canReview&&(!user||user.farmId!==row.farm_id||user.accessStatus==='suspended')))throw new ApiError(404,'PHOTO_NOT_FOUND','Photo not available.');
  res.set('Content-Security-Policy',"default-src 'none'; sandbox");res.type('image/jpeg').send(Buffer.from(row.bytes));
 });
}
