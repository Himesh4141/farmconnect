import { DurableObject } from 'cloudflare:workers';
import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { CloudDatabase, migrate } from './database.js';
import { migrations } from './migrations.js';
import { createApp } from '../server/src/app.js';
import { readRuntimeConfig } from '../server/src/runtime-config.js';
import { reconcilePayments } from '../server/src/payments.js';
import { refreshExternal } from '../server/src/operations.js';

export class FarmconnectDatabase extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Use the same configuration and all API routes as the existing full application.
    // Google/payment/courier credentials are private Worker bindings, never web assets.
    const config = readRuntimeConfig({...env, TRUST_PROXY:'loopback'});
    if(config.appMode !== 'live')throw new Error('This deployment requires APP_MODE=live.');
    this.db = new CloudDatabase(ctx.storage);
    migrate(this.db, migrations);
    this.app = createApp(this.db, config);
    this.handler = httpServerHandler(createServer(this.app));
  }
  async fetch(request) {
    if ((this.app.locals.paymentProvider || this.app.locals.courierProvider) && await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(Date.now()+15000);
    }
    return this.handler.fetch(request);
  }
  async alarm() {
    try {
      await reconcilePayments(this.db, this.app.locals.paymentProvider);
      if(this.app.locals.courierProvider) {
        const rows=this.db.prepare("SELECT id FROM external_shipments WHERE status!='delivered' AND (last_checked_at IS NULL OR last_checked_at<?) ORDER BY COALESCE(last_checked_at,0) LIMIT 10").all(Date.now()-60000);
        for(const row of rows) {
          try { await refreshExternal(this.db,this.app.locals.courierProvider,row.id); }
          catch { console.warn('Courier refresh pending.'); }
        }
      }
    } finally {
      if(this.app.locals.paymentProvider || this.app.locals.courierProvider)await this.ctx.storage.setAlarm(Date.now()+60000);
    }
  }
}
export default {
  fetch(request, env) {
    if(!env.APP_ORIGIN || new URL(request.url).origin!==env.APP_ORIGIN)return Response.json({error:{message:'Use the official Farmconnect address.'}},{status:403});
    // This Worker is private: only the Pages service binding can call it in production.
    const headers=new Headers(request.headers);
    headers.delete('x-forwarded-host');
    headers.set('x-forwarded-proto',new URL(env.APP_ORIGIN).protocol.slice(0,-1));
    return env.DATABASE.get(env.DATABASE.idFromName('farmconnect')).fetch(new Request(request,{headers}));
  },
};
