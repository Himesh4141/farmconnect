import { assertOrderPaid } from './payment-ledger.js';
import { ensureDemoPickup } from './courier.js';
import { farmStatusSql } from './fulfillment.js';
import presetCategories from './preset-categories.json' with {type:'json'};
import { assertPhotoOwner } from './photos.js';
import { updateOrderAggregate } from './farmer-workspace.js';
import { produceImages } from './produce-images.js';
import { randomUUID } from 'node:crypto';
import { ApiError } from './pricing.js';
import { requireUser,requireSameOrigin } from './auth.js';
const columns=`id,name,category,unit,price_paise AS pricePaise,bulk_price_paise AS bulkPricePaise,CASE WHEN sale_mode='weight' THEN bulk_min_grams ELSE bulk_min END AS bulkMin,CASE WHEN sale_mode='weight' THEN stock_grams ELSE stock END AS stock,sale_mode AS saleMode,preset_id AS presetId,image,photo_credit AS photoCredit,active,revision,archived,published_once AS publishedOnce,variety,quality_notes AS qualityNotes,harvest_date AS harvestDate,COALESCE((SELECT blocked FROM listing_moderation WHERE product_id=products.id),0) AS moderationBlocked,COALESCE((SELECT reason FROM listing_moderation WHERE product_id=products.id),'') AS moderationReason`;
function validateProduct(b){
 const result={};
 const mode=b?.saleMode??'pack';if(!['pack','weight'].includes(mode))throw new ApiError(400,'INVALID_MODE','Choose a valid selling method.');
 const presetId=b?.presetId??'';if(typeof presetId!=='string'||(presetId&&(!presetCategories[presetId]||presetCategories[presetId]!==b.category)))throw new ApiError(400,'INVALID_CATEGORY','The category must match the chosen produce.');
 result.saleMode=mode;result.presetId=presetId;
 for(const [field,min,max] of [['name',2,160],['unit',1,40]]){const value=typeof b?.[field]==='string'?b[field].trim():'';if(value.length<min||value.length>max)throw new ApiError(400,'INVALID_PRODUCT',`Check product ${field}.`);result[field]=value;}
 if(!['Vegetables','Fruits','Leafy greens'].includes(b.category))throw new ApiError(400,'INVALID_CATEGORY','Choose an available category.');
 if(![b.pricePaise,b.bulkPricePaise,b.bulkMin,b.stock].every(Number.isSafeInteger)||b.pricePaise<1||b.pricePaise>100000000||b.bulkPricePaise<1||b.bulkPricePaise>b.pricePaise||b.bulkMin<2||b.bulkMin>(mode==='weight'?100000000:10000)||b.stock<0||b.stock>(mode==='weight'?1000000000:1000000)||![0,1].includes(b.active))throw new ApiError(400,'INVALID_PRODUCT','Check prices, whole pack quantities and availability.');
 if(mode==='weight'&&(b.unit!=='kg'||b.bulkMin<50||b.bulkMin%50!==0))throw new ApiError(400,'INVALID_WEIGHT','Use kg pricing and a bulk minimum in multiples of 0.05 kg.');
 const image=typeof b.image==='string'&&b.image.trim()?b.image.trim():'/farmconnect.svg';
 if(image!=='/farmconnect.svg'&&!produceImages.has(image)&&!/^\/api\/photos\/[a-f0-9-]{36}\.jpg$/.test(image)){let url;try{url=new URL(image);}catch{}if(!url||url.protocol!=='https:'||url.username||url.password||image.length>1500)throw new ApiError(400,'INVALID_IMAGE','Use a public HTTPS image URL, or leave it blank.');}
 const extra={};
 for(const [field,max] of [['variety',80],['qualityNotes',500]]){if(b[field]!==undefined&&typeof b[field]!=='string')throw new ApiError(400,'INVALID_DETAILS','Product descriptions must be text.');extra[field]=(b[field]??'').trim();if(extra[field].length>max)throw new ApiError(400,'INVALID_DETAILS',field+' is too long.');}
 const date=b.harvestDate??'';const today=new Date(Date.now()+330*60*1000).toISOString().slice(0,10);
 if(typeof date!=='string'||(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>today||date<'2000-01-01')))throw new ApiError(400,'INVALID_HARVEST_DATE','Use a real harvest date from 2000 onwards, no later than today.');
 extra.harvestDate=date;
 const credit=typeof b.photoCredit==='string'?b.photoCredit.trim():'';if(credit.length>200)throw new ApiError(400,'INVALID_CREDIT','Photo credit must be at most 200 characters.');
 return {...result,...extra,category:b.category,pricePaise:b.pricePaise,bulkPricePaise:b.bulkPricePaise,bulkMin:b.bulkMin,stock:b.stock,active:b.active,image,photoCredit:credit};
}
function farmerOrders(db,farmId,query={}){
 const value=(key,fallback)=>{if(query[key]===undefined)return fallback;if(typeof query[key]!=='string')throw new ApiError(400,'INVALID_FILTER','Check your order filters.');return query[key];};
 const status=value('status','all'),kind=value('kind','all'),search=value('search','').trim();
 const page=Number(value('page','1')),limit=Number(value('limit','100'));
 const statuses=['placed','confirmed','packed','ready_for_pickup','in_transit','out_for_delivery','delivered','cancelled'];
 if(!['all',...statuses].includes(status)||!['all','consumer','bulk_buyer'].includes(kind)||search.length>100||!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new ApiError(400,'INVALID_FILTER','Choose valid order filters and page size.');
 const effective=farmStatusSql;
 const join=' FROM farm_fulfillments ff JOIN orders o ON o.id=ff.order_id LEFT JOIN demo_shipments d ON d.order_id=ff.order_id AND d.farm_id=ff.farm_id ';
 const where=["ff.farm_id=?","NOT EXISTS (SELECT 1 FROM order_payments op WHERE op.order_id=o.id AND op.state!='paid' AND o.status!='cancelled')"],params=[farmId];
 if(status!=='all'){where.push(effective+'=?');params.push(status);}
 if(kind!=='all'){where.push('o.purchase_kind=?');params.push(kind);}
 if(search){where.push("(instr(lower(o.id),lower(?))>0 OR instr(lower(json_extract(o.address_json,'$.name')),lower(?))>0 OR instr(lower(o.business_name),lower(?))>0 OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=o.id AND i.farm_id=ff.farm_id AND instr(lower(i.name),lower(?))>0))");params.push(search,search,search,search);}
 const condition=' WHERE '+where.join(' AND ');
 const total=db.prepare('SELECT COUNT(*) AS total'+join+condition).get(...params).total;
 const counts=Object.fromEntries(statuses.map(key=>[key,0]));
 for(const row of db.prepare('SELECT '+effective+' AS state,COUNT(*) AS total'+join+"WHERE ff.farm_id=? AND NOT EXISTS (SELECT 1 FROM order_payments op WHERE op.order_id=o.id AND op.state!='paid' AND o.status!='cancelled') GROUP BY state").all(farmId))counts[row.state]=row.total;
 const orders=db.prepare('SELECT o.id,o.address_json,o.purchase_kind,o.business_name,o.created_at,o.status AS order_status,ff.status,ff.rejection_reason,o.delivery_mode,'+effective+' AS effective_status'+join+condition+' ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?').all(...params,limit,(page-1)*limit).map(row=>{
  const items=db.prepare('SELECT product_id AS productId,name,unit,quantity,sale_mode AS saleMode,line_total_paise AS lineTotalPaise,unit_price_paise AS unitPricePaise FROM order_items WHERE order_id=? AND farm_id=?').all(row.id,farmId);
  return {id:row.id,address:JSON.parse(row.address_json),purchaseKind:row.purchase_kind,businessName:row.business_name,createdAt:row.created_at,status:row.effective_status,preparationStatus:row.status,deliveryMode:row.delivery_mode,rejectionReason:row.rejection_reason,orderStatus:row.order_status,items,totalPaise:items.reduce((sum,item)=>sum+item.lineTotalPaise,0)};
 });
 return {orders,total,page,limit,counts};
}
export function mountFarmer(app,db,{courierMode='disabled'}={}){
 const guard=[requireUser(db),(req,_res,next)=>{if(req.user.requestedAccountType!=='farmer'||!req.user.farmId||req.user.accessStatus==='suspended')throw new ApiError(403,'FARMER_REQUIRED','Farmer access is unavailable for this account.');next();}];
 const approved=(req,_res,next)=>{if(req.user.accessStatus!=='approved')throw new ApiError(403,'APPROVAL_REQUIRED','Verification is required before publishing or managing orders.');next();};
 app.get('/api/farmer/products',...guard,(req,res)=>res.json({products:db.prepare(`SELECT ${columns} FROM products WHERE farm_id=? ORDER BY display_order,id`).all(req.user.farmId)}));
 app.post('/api/farmer/products',requireSameOrigin,...guard,(req,res)=>{
  const b=validateProduct(req.body),id=randomUUID();assertPhotoOwner(db,b.image,req.user.farmId);if(b.active&&req.user.accessStatus!=='approved')throw new ApiError(403,'APPROVAL_REQUIRED','Save a draft until your farm is approved.');
  db.prepare('INSERT INTO products(id,farm_id,name,category,unit,price_paise,bulk_price_paise,bulk_min,stock,image,photo_credit,active,published_once,variety,quality_notes,harvest_date,sale_mode,stock_grams,bulk_min_grams,preset_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,req.user.farmId,b.name,b.category,b.unit,b.pricePaise,b.bulkPricePaise,b.saleMode==='weight'?2:b.bulkMin,b.saleMode==='weight'?0:b.stock,b.image,b.photoCredit,b.active,b.active,b.variety,b.qualityNotes,b.harvestDate,b.saleMode,b.saleMode==='weight'?b.stock:null,b.saleMode==='weight'?b.bulkMin:null,b.presetId);
  res.status(201).json({product:db.prepare(`SELECT ${columns} FROM products WHERE id=?`).get(id)});
 });
 app.post('/api/farmer/products/:id',requireSameOrigin,...guard,(req,res)=>{
  const existing=db.prepare(`SELECT revision,CASE WHEN sale_mode='weight' THEN stock_grams ELSE stock END AS stock,sale_mode AS saleMode,preset_id AS presetId,variety,quality_notes AS qualityNotes,harvest_date AS harvestDate FROM products WHERE id=? AND farm_id=?`).get(req.params.id,req.user.farmId);
  if(!existing)throw new ApiError(404,'PRODUCT_NOT_FOUND','Your product was not found.');
  if(Number.isSafeInteger(req.body.revision)&&req.body.revision!==existing.revision)throw new ApiError(409,'PRODUCT_CHANGED','Listing changed. Refresh before saving.');
  if(req.body.stock!==undefined&&req.body.stock!==existing.stock)throw new ApiError(400,'USE_STOCK_MANAGER','Use Manage stock to change quantities. Edit listing changes product details only.');
  if(req.body.saleMode&&req.body.saleMode!==existing.saleMode)throw new ApiError(400,'MODE_LOCKED','Archive this legacy listing and create a new kg listing to keep past orders and stock safe.');
  const b=validateProduct({...existing,...req.body});assertPhotoOwner(db,b.image,req.user.farmId);if(b.active&&req.user.accessStatus!=='approved')throw new ApiError(403,'APPROVAL_REQUIRED','Save as draft until approved.');if(!Number.isSafeInteger(req.body.revision))throw new ApiError(400,'INVALID_REVISION','Refresh products before editing.');
  const result=db.prepare("UPDATE products SET name=?,category=?,unit=?,price_paise=?,bulk_price_paise=?,bulk_min=?,stock=?,image=?,photo_credit=?,active=?,published_once=MAX(published_once,?),variety=?,quality_notes=?,harvest_date=?,stock_grams=?,bulk_min_grams=?,preset_id=?,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND farm_id=? AND revision=? AND archived=0").run(b.name,b.category,b.unit,b.pricePaise,b.bulkPricePaise,b.saleMode==='weight'?2:b.bulkMin,b.saleMode==='weight'?0:b.stock,b.image,b.photoCredit,b.active,b.active,b.variety,b.qualityNotes,b.harvestDate,b.saleMode==='weight'?b.stock:null,b.saleMode==='weight'?b.bulkMin:null,b.presetId,req.params.id,req.user.farmId,req.body.revision);
  if(!result.changes)throw new ApiError(409,'PRODUCT_CHANGED','Stock or product details changed. Refresh and retry your edit.');
  res.json({ok:true});
 });
 app.get('/api/farmer/products/:id/stock-history',...guard,(req,res)=>{
  const owned=db.prepare('SELECT 1 FROM products WHERE id=? AND farm_id=?').get(req.params.id,req.user.farmId);
  if(!owned)throw new ApiError(404,'PRODUCT_NOT_FOUND','Your product was not found.');
  const cursor=req.query.before===undefined?null:Number(req.query.before);
  if(req.query.before!==undefined&&(typeof req.query.before!=='string'||!Number.isSafeInteger(cursor)||cursor<1))throw new ApiError(400,'INVALID_CURSOR','Refresh stock history.');
  const rows=db.prepare('SELECT id,sale_mode AS saleMode,quantity_change AS change,previous_stock AS previousStock,new_stock AS newStock,reason,created_at AS createdAt FROM inventory_adjustments WHERE product_id=? AND (? IS NULL OR id<?) ORDER BY id DESC LIMIT 21').all(req.params.id,cursor,cursor);
  const adjustments=rows.slice(0,20);res.json({adjustments,nextCursor:rows.length>20?adjustments[19].id:null});
 });
 app.post('/api/farmer/products/:id/restock',requireSameOrigin,...guard,(req,res)=>{
  const amount=req.body?.amount,revision=req.body?.revision,action=req.body?.action??'add';
  if(!['add','remove'].includes(action))throw new ApiError(400,'INVALID_ACTION','Choose add or reduce stock.');
  const reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';
  if(reason.length>200||(action==='remove'&&reason.length<8))throw new ApiError(400,'REASON_REQUIRED','Explain the stock reduction in 8–200 characters.');
  if(!Number.isSafeInteger(amount)||amount<1||!Number.isSafeInteger(revision)||revision<0)throw new ApiError(400,'INVALID_STOCK','Enter a positive quantity and refresh your listing.');
  const delta=action==='remove'?-amount:amount;
  db.exec('BEGIN IMMEDIATE');
  try{
   const row=db.prepare('SELECT sale_mode,stock,stock_grams,revision,archived FROM products WHERE id=? AND farm_id=?').get(req.params.id,req.user.farmId);
   if(!row)throw new ApiError(404,'PRODUCT_NOT_FOUND','Your product was not found.');
   if(row.archived)throw new ApiError(409,'PRODUCT_ARCHIVED','Archived listings cannot receive more stock.');
   if(row.revision!==revision)throw new ApiError(409,'PRODUCT_CHANGED','Stock or listing details changed. Refresh and check the available quantity before changing stock again.');
   const column=row.sale_mode==='weight'?'stock_grams':'stock',maximum=row.sale_mode==='weight'?1000000000:1000000;
   if(row[column]+delta<0||row[column]+delta>maximum)throw new ApiError(400,'STOCK_LIMIT','This change would make available stock negative or exceed its limit.');
   db.prepare("UPDATE products SET "+column+"="+column+"+?,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND farm_id=? AND revision=?").run(delta,req.params.id,req.user.farmId,revision);
   db.prepare('INSERT INTO inventory_adjustments(product_id,actor_id,sale_mode,quantity_change,previous_stock,new_stock,reason,created_at) VALUES (?,?,?,?,?,?,?,?)').run(req.params.id,req.user.id,row.sale_mode,delta,row[column],row[column]+delta,reason||'Harvest added',Date.now());
   const product=db.prepare(`SELECT ${columns} FROM products WHERE id=?`).get(req.params.id);
   db.exec('COMMIT');res.json({product});
  }catch(error){db.exec('ROLLBACK');throw error;}
 });
 app.get('/api/farmer/orders',...guard,approved,(req,res)=>res.json(farmerOrders(db,req.user.farmId,req.query)));
 app.post('/api/farmer/orders/:id/status',requireSameOrigin,...guard,approved,(req,res)=>{
  const status=req.body?.status,expected=req.body?.expectedStatus;
  db.exec('BEGIN IMMEDIATE');
  try{
   const row=db.prepare('SELECT ff.status,o.status AS overall FROM farm_fulfillments ff JOIN orders o ON o.id=ff.order_id WHERE ff.order_id=? AND ff.farm_id=?').get(req.params.id,req.user.farmId);
   if(!row)throw new ApiError(404,'ORDER_NOT_FOUND','This order does not belong to your farm.');
   assertOrderPaid(db,req.params.id);
   if(['cancelled','delivered'].includes(row.overall))throw new ApiError(409,'ORDER_LOCKED','This order can no longer be prepared.');
   const next={placed:'confirmed',confirmed:'packed',packed:'ready_for_pickup'};
   if(status!==row.status){
    if(row.status!==expected||next[row.status]!==status)throw new ApiError(409,'INVALID_TRANSITION','Refresh and use the next preparation step. Farmers cannot mark courier pickup or delivery.');
    db.prepare('UPDATE farm_fulfillments SET status=?,updated_at=? WHERE order_id=? AND farm_id=?').run(status,Date.now(),req.params.id,req.user.farmId);
    db.prepare('INSERT INTO farm_events(order_id,farm_id,actor_id,status,created_at) VALUES (?,?,?,?,?)').run(req.params.id,req.user.farmId,req.user.id,status,Date.now());
    updateOrderAggregate(db,req.params.id);
   }
   if(status==='ready_for_pickup'&&courierMode==='demo')ensureDemoPickup(db,req.params.id,req.user.farmId,req.user.id);
   db.exec('COMMIT');res.json({ok:true});
  }catch(error){db.exec('ROLLBACK');throw error;}
 });
}


