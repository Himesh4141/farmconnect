import { createApp } from './app.js';
import { databasePath, openDatabase } from './db.js';
import { readConfig, checkBuild } from './config.js';
import { reconcilePayments } from './payments.js';
import { refreshExternal } from './operations.js';

const config = readConfig();
checkBuild(config);
const db = openDatabase();
const app = createApp(db, config);
let stopping = false, running = null;
async function maintenance() {
  if (stopping || running) return;
  running = (async () => {
    await reconcilePayments(db, app.locals.paymentProvider);
    if (app.locals.courierProvider) {
      const rows = db.prepare("SELECT id FROM external_shipments WHERE status!='delivered' AND (last_checked_at IS NULL OR last_checked_at<?) ORDER BY COALESCE(last_checked_at,0) LIMIT 10").all(Date.now()-60000);
      for (const row of rows) {
        if(stopping)break;
        try { await refreshExternal(db,app.locals.courierProvider,row.id); }
        catch { console.warn(JSON.stringify({event:'courier_refresh_pending',shipmentId:row.id})); }
      }
    }
  })();
  try { await running; } catch { console.error(JSON.stringify({event:'maintenance_failed'})); }
  finally { running = null; }
}
const timer=setInterval(()=>void maintenance(),15000);timer.unref();
const server = app.listen(config.port,config.host,()=>{
  console.log(`Farmconnect: ${config.origin || 'http://'+config.host+':'+config.port}`);
  console.log(`Database: ${databasePath()}`);
  console.log(`Delivery: ${config.courierMode}. Payments: ${config.payment ? config.payment.isTest?'Razorpay TEST':'Razorpay LIVE':'COD only'}.`);
  if(config.courierMode==='demo')console.log('DEMO only: no real pickups or cash collection.');
  void maintenance();
});
server.requestTimeout=30000;server.headersTimeout=15000;
server.on('error',error=>{
  clearInterval(timer);db.close();process.exitCode=1;
  console.error(error.code==='EADDRINUSE'?`Port ${config.port} is already in use.`:'Server could not start.');
});
async function stop(){
  if(stopping)return;stopping=true;clearInterval(timer);
  const deadline=setTimeout(()=>server.closeAllConnections(),10000);deadline.unref();
  await new Promise(resolve=>server.close(resolve));
  if(running)await running;
  db.close();clearTimeout(deadline);
}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
