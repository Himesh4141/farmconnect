import { requireUser,requireSameOrigin,securityEvent } from './auth.js';
import { isAdmin } from './admin.js';
import { ApiError } from './pricing.js';
import { audit,reasonFrom,transaction,paging,choice,controls } from './admin-support.js';

export function mountAdminConsole(app,db,config) {
  const guard=[requireUser(db),(req,_res,next)=>{if(!isAdmin(db,req.user.id))throw new ApiError(403,'ADMIN_REQUIRED','Administrator access is required.');next();}];
  const count=(sql,...args)=>db.prepare(sql).get(...args).n;
  app.get('/api/admin/summary',...guard,(_req,res)=>res.json({
    controls:controls(db,config),
    counts:{orders:count('SELECT COUNT(*) n FROM orders'),openOrders:count("SELECT COUNT(*) n FROM orders WHERE status NOT IN ('delivered','cancelled')"),
      pendingApplications:count("SELECT COUNT(*) n FROM access_applications WHERE status='pending'"),pendingDelivery:count("SELECT COUNT(*) n FROM delivery_partners WHERE status='pending'"),
      unassignedPickups:count("SELECT COUNT(*) n FROM demo_shipments d JOIN orders o ON o.id=d.order_id WHERE d.status='pickup_requested' AND d.assigned_to IS NULL AND o.status!='cancelled'"),
      deliveryExceptions:count("SELECT COUNT(*) n FROM demo_shipments d JOIN delivery_partners p ON p.user_id=d.assigned_to WHERE p.status!='approved' AND d.status IN ('picked_up','in_transit','out_for_delivery')"),
      paymentReview:count("SELECT COUNT(*) n FROM order_payments WHERE state='review'"),refundReview:count("SELECT COUNT(*) n FROM payment_refunds WHERE state IN ('queued','review')"),
      blockedListings:count('SELECT COUNT(*) n FROM listing_moderation WHERE blocked=1'),users:count('SELECT COUNT(*) n FROM users')},
    money:{liveCapturedPaise:count("SELECT COALESCE(SUM(amount_paise),0) n FROM order_payments WHERE state='paid' AND is_test=0"),
      liveRefundedPaise:count("SELECT COALESCE(SUM(r.amount_paise),0) n FROM payment_refunds r JOIN order_payments p ON p.order_id=r.order_id WHERE r.state='processed' AND p.is_test=0")},
    mode:config.courierMode,paymentConfigured:Boolean(config.payment),paymentIsTest:config.payment?.isTest??false,
  }));
  app.post('/api/admin/controls',requireSameOrigin,...guard,(req,res)=>{
    const reason=reasonFrom(req.body);
    if(typeof req.body.paused!=='boolean'||!Number.isSafeInteger(req.body.revision))throw new ApiError(400,'INVALID_CONTROL','Refresh the ordering controls.');
    transaction(db,()=>{
      if(!db.prepare('UPDATE store_controls SET checkout_paused=?,reason=?,revision=revision+1 WHERE id=1 AND revision=?').run(req.body.paused?1:0,reason,req.body.revision).changes)throw new ApiError(409,'CONTROL_CHANGED','Ordering settings changed. Refresh before saving.');
      audit(db,req.user.id,req.body.paused?'checkout_paused':'checkout_resumed','store',reason);
    });res.json({controls:controls(db,config)});
  });
  app.get('/api/admin/catalog',...guard,(req,res)=>{
    const p=paging(req.query),status=choice(req.query.status,['blocked','active','archived']);
    const where=`WHERE (?='' OR instr(lower(p.name||' '||f.name||' '||p.id),lower(?))>0)
      AND (?!='blocked' OR COALESCE(m.blocked,0)=1) AND (?!='active' OR (p.active=1 AND p.archived=0 AND COALESCE(m.blocked,0)=0)) AND (?!='archived' OR p.archived=1)`;
    const args=[p.q,p.q,status,status,status],from='FROM products p JOIN farms f ON f.id=p.farm_id LEFT JOIN listing_moderation m ON m.product_id=p.id ';
    res.json({page:p.page,limit:p.limit,total:count('SELECT COUNT(*) n '+from+where,...args),products:db.prepare(`SELECT p.id,p.name,p.category,p.image,f.name AS farmName,p.active,p.archived,p.sale_mode AS saleMode,p.price_paise AS pricePaise,
      CASE WHEN p.sale_mode='weight' THEN p.stock_grams ELSE p.stock END AS stock,
      COALESCE(m.blocked,0) AS blocked,COALESCE(m.revision,0) AS moderationRevision,COALESCE(m.reason,'') AS moderationReason
      ${from}${where} ORDER BY p.updated_at DESC,p.id LIMIT ? OFFSET ?`).all(...args,p.limit,p.offset)});
  });
  app.post('/api/admin/catalog/:id/moderation',requireSameOrigin,...guard,(req,res)=>{
    const reason=reasonFrom(req.body);
    if(typeof req.body.blocked!=='boolean'||!Number.isSafeInteger(req.body.revision))throw new ApiError(400,'INVALID_MODERATION','Refresh the product before moderating it.');
    transaction(db,()=>{
      if(!db.prepare('SELECT 1 FROM products WHERE id=?').get(req.params.id))throw new ApiError(404,'NOT_FOUND','Listing not found.');
      const old=db.prepare('SELECT revision FROM listing_moderation WHERE product_id=?').get(req.params.id);
      if((old?.revision??0)!==req.body.revision)throw new ApiError(409,'MODERATION_CHANGED','This listing review changed. Refresh first.');
      db.prepare('INSERT INTO listing_moderation(product_id,blocked,reason,updated_at) VALUES (?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET blocked=excluded.blocked,reason=excluded.reason,revision=listing_moderation.revision+1,updated_at=excluded.updated_at').run(req.params.id,req.body.blocked?1:0,reason,Date.now());
      audit(db,req.user.id,req.body.blocked?'listing_hidden':'listing_restored',req.params.id,reason);
    });res.json({ok:true});
  });
  app.get('/api/admin/directory',...guard,(req,res)=>{
    const p=paging(req.query),role=choice(req.query.role,['consumer','farmer','bulk_buyer','delivery','admin']);
    const from=`FROM users u LEFT JOIN account_profiles a ON a.user_id=u.id LEFT JOIN delivery_partners d ON d.user_id=u.id LEFT JOIN admin_users x ON x.user_id=u.id`;
    const roleSql="CASE WHEN x.user_id IS NOT NULL THEN 'admin' WHEN d.user_id IS NOT NULL THEN 'delivery' ELSE COALESCE(a.account_type,'consumer') END";
    const where=` WHERE (?='' OR instr(lower(u.name||' '||u.email||' '||COALESCE(a.business_name,'')),lower(?))>0) AND (?='' OR ${roleSql}=?)`;
    const args=[p.q,p.q,role,role];
    res.json({page:p.page,limit:p.limit,total:count('SELECT COUNT(*) n '+from+where,...args),users:db.prepare(`SELECT u.id,u.name,u.email,u.created_at AS createdAt,${roleSql} AS role,COALESCE(d.status,a.access_status,'approved') AS status,COALESCE(a.business_name,'') AS businessName,
      (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.expires_at>?) AS sessions,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) AS orders ${from}${where} ORDER BY u.created_at DESC,u.id LIMIT ? OFFSET ?`).all(Date.now(),...args,p.limit,p.offset)});
  });
  app.post('/api/admin/directory/:id/revoke-sessions',requireSameOrigin,...guard,(req,res)=>{
    const reason=reasonFrom(req.body);
    transaction(db,()=>{
      if(req.params.id===req.user.id||isAdmin(db,req.params.id))throw new ApiError(403,'PROTECTED_ACCOUNT','Manage administrator sessions through that account’s own security screen.');
      if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(req.params.id))throw new ApiError(404,'NOT_FOUND','Account not found.');
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.params.id);
      securityEvent(db,req.params.id,'Sessions signed out by platform support');
      audit(db,req.user.id,'sessions_revoked',req.params.id,reason);
    });res.json({ok:true});
  });
  app.get('/api/admin/delivery-partners',...guard,(req,res)=>{
    const p=paging(req.query),status=choice(req.query.status,['pending','approved','suspended']);
    const from=`FROM delivery_partners d JOIN users u ON u.id=d.user_id WHERE (?='' OR instr(lower(u.name||' '||u.email||' '||d.phone),lower(?))>0) AND (?='' OR d.status=?)`;
    const args=[p.q,p.q,status,status];
    res.json({page:p.page,limit:p.limit,total:count('SELECT COUNT(*) n '+from,...args),partners:db.prepare(`SELECT d.user_id AS id,u.name,u.email,d.phone,d.status,
      (SELECT COUNT(*) FROM demo_shipments s JOIN orders o ON o.id=s.order_id WHERE s.assigned_to=d.user_id AND s.status!='delivered' AND o.status!='cancelled') AS activeJobs,
      (SELECT COUNT(*) FROM demo_shipments s WHERE s.assigned_to=d.user_id AND s.status IN ('picked_up','in_transit','out_for_delivery')) AS collectedJobs ${from} ORDER BY d.created_at DESC,d.user_id LIMIT ? OFFSET ?`).all(...args,p.limit,p.offset)});
  });
  app.post('/api/admin/delivery-partners/:id/access',requireSameOrigin,...guard,(req,res)=>{
    const reason=reasonFrom(req.body),status=choice(req.body.status,['approved','suspended']);
    if(!status)throw new ApiError(400,'INVALID_STATUS','Choose an access action.');
    if(status==='approved'&&req.body.verified!==true)throw new ApiError(400,'VERIFICATION_REQUIRED','Confirm identity and delivery contact verification before approval.');
    transaction(db,()=>{
      const partner=db.prepare('SELECT status FROM delivery_partners WHERE user_id=?').get(req.params.id);
      if(!partner)throw new ApiError(404,'NOT_FOUND','Delivery account not found.');
      if(req.params.id===req.user.id)throw new ApiError(403,'SELF_REVIEW','You cannot approve your own delivery access.');
      if(partner.status!==req.body.expectedStatus)throw new ApiError(409,'STATUS_CHANGED','Partner access changed. Refresh first.');
      db.prepare('UPDATE delivery_partners SET status=? WHERE user_id=?').run(status,req.params.id);
      if(status==='suspended')db.prepare("UPDATE demo_shipments SET assigned_to=NULL,revision=revision+1 WHERE assigned_to=? AND status='pickup_requested'").run(req.params.id);
      db.prepare('INSERT INTO delivery_access_events(user_id,action,created_at) VALUES (?,?,?)').run(req.params.id,status,Date.now());
      audit(db,req.user.id,'delivery_'+status,req.params.id,reason);
    });res.json({ok:true});
  });
  app.get('/api/admin/activity',...guard,(req,res)=>{
    const p=paging(req.query);
    const events=`SELECT 'admin-'||e.id AS id,e.actor_id,e.action,e.target,e.reason,e.created_at FROM admin_events e
      UNION ALL SELECT 'access-'||e.id,e.actor_id,e.action,e.target_user_id,e.note,e.created_at FROM access_events e
      UNION ALL SELECT 'order-'||e.rowid,e.actor_id,'order_'||e.status,e.order_id,'',e.created_at FROM order_events e WHERE EXISTS(SELECT 1 FROM admin_users a WHERE a.user_id=e.actor_id)`;
    const from=`FROM (${events}) e JOIN users u ON u.id=e.actor_id WHERE (?='' OR instr(lower(e.action||' '||e.target||' '||u.email||' '||e.reason),lower(?))>0)`;
    res.json({page:p.page,limit:p.limit,total:count('SELECT COUNT(*) n '+from,p.q,p.q),events:db.prepare('SELECT e.*,u.name AS actorName,u.email AS actorEmail '+from+' ORDER BY e.created_at DESC,e.id DESC LIMIT ? OFFSET ?').all(p.q,p.q,p.limit,p.offset)});
  });
  app.get('/api/admin/shipments',...guard,(req,res)=>{
    const p=paging(req.query),status=choice(req.query.status,['pickup_requested','picked_up','in_transit','out_for_delivery','delivered','cancelled']),mode=choice(req.query.mode,['demo','live']);
    const rows=`SELECT d.id,d.order_id AS orderId,f.name AS farmName,d.tracking_number AS trackingNumber,
      CASE WHEN o.status='cancelled' OR ff.status='cancelled' THEN 'cancelled' ELSE d.status END AS status,
      'demo' AS mode,COALESCE(u.name,'Unassigned') AS partnerName,COALESCE(u.email,'') AS partnerEmail,
      COALESCE(dp.status,'') AS partnerStatus,d.updated_at AS updatedAt,'' AS providerStatus
      FROM demo_shipments d JOIN orders o ON o.id=d.order_id JOIN farms f ON f.id=d.farm_id
      JOIN farm_fulfillments ff ON ff.order_id=d.order_id AND ff.farm_id=d.farm_id
      LEFT JOIN users u ON u.id=d.assigned_to LEFT JOIN delivery_partners dp ON dp.user_id=d.assigned_to
      UNION ALL SELECT e.id,e.order_id,f.name,e.waybill,CASE WHEN o.status='cancelled' THEN 'cancelled' ELSE e.status END,
      'live','Delhivery','','',e.updated_at,e.provider_status FROM external_shipments e JOIN orders o ON o.id=e.order_id JOIN farms f ON f.id=e.farm_id`;
    const from=`FROM (${rows}) s WHERE (?='' OR instr(lower(s.orderId||' '||s.farmName||' '||s.trackingNumber||' '||s.partnerName||' '||s.partnerEmail),lower(?))>0) AND (?='' OR s.status=?) AND (?='' OR s.mode=?)`;
    const args=[p.q,p.q,status,status,mode,mode];
    res.json({page:p.page,limit:p.limit,total:count('SELECT COUNT(*) n '+from,...args),shipments:db.prepare('SELECT * '+from+' ORDER BY updatedAt DESC,id DESC LIMIT ? OFFSET ?').all(...args,p.limit,p.offset)});
  });
}
