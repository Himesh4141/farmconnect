import { ApiError } from './pricing.js';
export function audit(db, actor, action, target, reason='') {
  db.prepare('INSERT INTO admin_events(actor_id,action,target,reason,created_at) VALUES (?,?,?,?,?)').run(actor,action,target,reason,Date.now());
}
export function reasonFrom(body) {
  const reason=typeof body?.reason==='string'?body.reason.trim():'';
  if(reason.length<10||reason.length>500)throw new ApiError(400,'REASON_REQUIRED','Enter a clear reason using 10–500 characters.');
  return reason;
}
export function transaction(db,fn) {
  db.exec('BEGIN IMMEDIATE');
  try {const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
}
export function paging(query) {
  const page=Number(query.page??1),limit=Number(query.limit??20);
  if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new ApiError(400,'INVALID_PAGE','Choose a valid page and page size.');
  const q=typeof query.q==='string'?query.q.trim():'';
  if(q.length>120)throw new ApiError(400,'INVALID_SEARCH','Keep searches under 120 characters.');
  return {page,limit,offset:(page-1)*limit,q};
}
export function choice(value,allowed) {
  if(value===undefined||value==='all'||value==='')return '';
  if(typeof value!=='string'||!allowed.includes(value))throw new ApiError(400,'INVALID_FILTER','Choose a valid filter.');
  return value;
}
export function controls(db,config) {
  const row=db.prepare('SELECT checkout_paused AS paused,revision,reason FROM store_controls WHERE id=1').get();
  return {...row,paused:Boolean(row.paused),deploymentEnabled:config.checkoutEnabled,checkoutEnabled:config.checkoutEnabled&&!row.paused};
}
