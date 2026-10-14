import { requireSameOrigin, requireUser } from './auth.js';
import { ApiError } from './pricing.js';
import { transaction } from './admin-support.js';
export function ensureCustomer(db,id) {
  db.prepare('INSERT INTO customer_details(user_id) VALUES (?) ON CONFLICT DO NOTHING').run(id);
}
export function customerProfile(db,id) {
  const row=db.prepare(`SELECT u.name,u.email,u.created_at,COALESCE(d.phone,'') AS phone,
    COALESCE(d.revision,0) AS revision FROM users u LEFT JOIN customer_details d ON d.user_id=u.id WHERE u.id=?`).get(id);
  return {name:row.name,email:row.email,phone:row.phone,revision:row.revision,joinedAt:row.created_at};
}
export function mountCustomerProfile(app,db) {
  app.get('/api/profile',requireUser(db),(req,res)=>res.json({profile:customerProfile(db,req.user.id)}));
  app.patch('/api/profile',requireSameOrigin,requireUser(db),(req,res)=>{
    const {name,phone,revision}=req.body??{};
    if(typeof name!=='string'||name.trim().length<2||name.trim().length>80||typeof phone!=='string'||(phone!==''&&!/^[6-9][0-9]{9}$/.test(phone)))
      throw new ApiError(400,'INVALID_PROFILE','Enter a name of 2–80 characters and a 10-digit Indian mobile number, or leave mobile blank.');
    transaction(db,()=>{
      ensureCustomer(db,req.user.id);
      const result=db.prepare('UPDATE customer_details SET phone=?,revision=revision+1 WHERE user_id=? AND revision=?')
        .run(phone,req.user.id,Number.isSafeInteger(revision)?revision:-1);
      if(!result.changes)throw new ApiError(409,'PROFILE_CHANGED','Your profile changed in another tab. Reload it before saving.');
      // Email, roles and approval cannot be changed through this endpoint.
      db.prepare('UPDATE users SET name=? WHERE id=?').run(name.trim(),req.user.id);
    });
    res.json({profile:customerProfile(db,req.user.id)});
  });
}
