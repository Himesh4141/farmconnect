import { randomUUID } from 'node:crypto';
import { ApiError } from './pricing.js';
export function registrationProfile(body,farmerSignup=false){
 const accountType=farmerSignup?'farmer':body?.accountType??'consumer';
 if(!farmerSignup&&(accountType==='farmer'||accountType==='bulk_buyer'))throw new ApiError(403,'APPLICATION_REQUIRED','Create a consumer account, then apply for farmer or business access. Approval is required.');
 if(!['consumer','farmer','bulk_buyer'].includes(accountType))throw new ApiError(400,'INVALID_ACCOUNT_TYPE','Choose Consumer, Farmer or Bulk buyer.');
 const businessName=typeof body?.businessName==='string'?body.businessName.trim():'';
 if(accountType!=='consumer'&&(businessName.length<2||businessName.length>120))throw new ApiError(400,'INVALID_BUSINESS_NAME','Enter your farm or business name (2–120 characters).');
 const phone=typeof body?.phone==='string'?body.phone.trim():'';
 if(farmerSignup&&!/^[6-9][0-9]{9}$/.test(phone))throw new ApiError(400,'INVALID_PHONE','Enter a 10-digit Indian mobile number.');
 return {accountType,businessName:accountType==='consumer'?'':businessName,phone};
}
export function createProfile(db,userId,profile){
 const farmId=profile.accountType==='farmer'?randomUUID():null;
 if(farmId)db.prepare('INSERT INTO farms VALUES (?,?)').run(farmId,profile.businessName);
 db.prepare('INSERT INTO account_profiles(user_id,account_type,business_name,farm_id,access_status) VALUES (?,?,?,?,?)').run(userId,profile.accountType,profile.businessName,farmId,farmId?'pending':'approved');
 if(farmId){
  db.prepare('INSERT INTO farm_details(farm_id,phone) VALUES (?,?)').run(farmId,profile.phone);
  db.prepare("INSERT INTO access_applications(id,user_id,account_type,business_name,phone,location,evidence,status,review_note,updated_at) VALUES (?,?,'farmer',?,?,'','','needs_information','Complete My farm and submit for verification.',?)").run(randomUUID(),userId,profile.businessName,profile.phone,Date.now());
 }
}
export function profileFor(db,userId){
 const delivery=db.prepare('SELECT status FROM delivery_partners WHERE user_id=?').get(userId);
 if(delivery)return {accountType:'delivery',requestedAccountType:'delivery',accessStatus:delivery.status,businessName:'',farmId:null};
 const row=db.prepare('SELECT account_type,business_name,farm_id,access_status FROM account_profiles WHERE user_id=?').get(userId);
 const approved=!row||row.access_status==='approved';
 return {accountType:approved?(row?.account_type??'consumer'):'consumer',businessName:row?.business_name??'',farmId:row?.farm_id??null,accessStatus:row?.access_status??'approved',requestedAccountType:row?.account_type??'consumer'};
}

