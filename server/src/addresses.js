import { randomUUID } from 'node:crypto';
import { requireSameOrigin, requireUser } from './auth.js';
import { addressFrom } from './orders.js';
import { ApiError } from './pricing.js';
import { ensureCustomer } from './customer-profile.js';
import { transaction } from './admin-support.js';
function list(db,userId) {
  const defaultId=db.prepare('SELECT default_address_id FROM customer_details WHERE user_id=?').get(userId)?.default_address_id;
  return db.prepare('SELECT * FROM saved_addresses WHERE user_id=? ORDER BY updated_at DESC,id').all(userId)
    .map(row=>({id:row.id,label:row.label,address:JSON.parse(row.address_json),revision:row.revision,isDefault:row.id===defaultId,
      serviceable:Boolean(db.prepare('SELECT 1 FROM delivery_areas WHERE pincode=? AND active=1').get(JSON.parse(row.address_json).pincode))}))
    .sort((a,b)=>Number(b.isDefault)-Number(a.isDefault));
}
function labelFrom(body) {
  const label=typeof body?.label==='string'?body.label.trim():'';
  if(!label||label.length>40)throw new ApiError(400,'INVALID_LABEL','Use an address label between 1 and 40 characters.');
  return label;
}
function own(db,req) {
  const row=db.prepare('SELECT * FROM saved_addresses WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
  if(!row)throw new ApiError(404,'ADDRESS_NOT_FOUND','Address not found.');
  return row;
}
export function mountAddresses(app,db) {
  app.get('/api/addresses',requireUser(db),(req,res)=>res.json({addresses:list(db,req.user.id)}));
  app.post('/api/addresses',requireSameOrigin,requireUser(db),(req,res)=>{
    const address=addressFrom(req.body),label=labelFrom(req.body);
    let id,created=false;
    transaction(db,()=>{
      ensureCustomer(db,req.user.id);
      const existing=db.prepare('SELECT id FROM saved_addresses WHERE user_id=? AND address_json=?').get(req.user.id,JSON.stringify(address));
      id=existing?.id;
      if(!id){
        if(db.prepare('SELECT count(*) AS n FROM saved_addresses WHERE user_id=?').get(req.user.id).n>=10)
          throw new ApiError(409,'ADDRESS_LIMIT','You can save up to 10 addresses. Remove one before adding another.');
        id=randomUUID();created=true;
        db.prepare('INSERT INTO saved_addresses(id,user_id,label,address_json,updated_at) VALUES (?,?,?,?,?)').run(id,req.user.id,label,JSON.stringify(address),Date.now());
      }
      if(req.body.isDefault===true||!db.prepare('SELECT default_address_id FROM customer_details WHERE user_id=?').get(req.user.id).default_address_id)
        db.prepare('UPDATE customer_details SET default_address_id=? WHERE user_id=?').run(id,req.user.id);
    });
    res.status(created?201:200).json({id,addresses:list(db,req.user.id)});
  });
  app.patch('/api/addresses/:id',requireSameOrigin,requireUser(db),(req,res)=>{
    const row=own(db,req),address=addressFrom(req.body),label=labelFrom(req.body);
    if(!Number.isSafeInteger(req.body.revision)||row.revision!==req.body.revision)
      throw new ApiError(409,'ADDRESS_CHANGED','This address changed. Reload your address book before editing.');
    const result=db.prepare('UPDATE saved_addresses SET label=?,address_json=?,updated_at=?,revision=revision+1 WHERE id=? AND user_id=? AND revision=?')
      .run(label,JSON.stringify(address),Date.now(),row.id,req.user.id,row.revision);
    if(!result.changes)throw new ApiError(409,'ADDRESS_CHANGED','This address changed. Reload your address book before editing.');
    res.json({addresses:list(db,req.user.id)});
  });
  app.post('/api/addresses/:id/default',requireSameOrigin,requireUser(db),(req,res)=>{
    const row=own(db,req);ensureCustomer(db,req.user.id);
    db.prepare('UPDATE customer_details SET default_address_id=? WHERE user_id=?').run(row.id,req.user.id);
    res.json({addresses:list(db,req.user.id)});
  });
  app.delete('/api/addresses/:id',requireSameOrigin,requireUser(db),(req,res)=>{
    own(db,req);
    db.prepare('DELETE FROM saved_addresses WHERE id=? AND user_id=?').run(req.params.id,req.user.id);
    res.json({ok:true,addresses:list(db,req.user.id)});
  });
}
