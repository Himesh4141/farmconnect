import { mountCustomerProfile } from './customer-profile.js';
import { mountLocation } from './location.js';
import { mountShopping } from './shopping.js';
import { syncOrder } from './fulfillment.js';
import { mountAdminConsole } from './admin-console.js';
import { controls } from './admin-support.js';
import { mountGoogleAuth } from './google-auth.js';
import { installSecurity } from './security.js';
import { mountAddresses } from './addresses.js';
import { mountOperations } from './operations.js';
import { mountPayments, mountPaymentWebhook } from './payments.js';
import { razorpayProvider, delhiveryProvider } from './providers.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mountCourier } from './courier.js';
import { mountPhotos } from './photos.js';
import { mountFarmerWorkspace } from './farmer-workspace.js';
import { mountAccess } from './access.js';
import { mountFarmer } from './farmer.js';
import { mountAdmin } from './admin.js';
import { mountOrders } from './orders.js';
import { mountAuth } from './auth.js';
import express from "express";
import { getCatalog, listProducts, findProduct } from "./catalog.js";
import { ApiError, quoteCart } from "./pricing.js";

export function createApp(db, options = {}) {
  const config = { courierMode:'disabled', payment:null, checkoutEnabled:true, production:false, ...options };
  const {courierMode} = config;
  const paymentProvider = options.paymentProvider ?? (config.payment ? razorpayProvider(config.payment) : null);
  const courierProvider = options.courierProvider ?? (courierMode === 'delhivery' && config.delhiveryToken ? delhiveryProvider(config.delhiveryToken) : null);
  for(const order of db.prepare("SELECT id FROM orders WHERE delivery_mode='demo' AND status!='cancelled'").all())syncOrder(db,order.id);
  const app = express();
  installSecurity(app,config);
  app.locals.paymentProvider = paymentProvider;
  app.locals.courierProvider = courierProvider;
  mountPaymentWebhook(app,db,config.payment);
  app.use(express.json({ limit: "16kb" }));

  mountAuth(app, db, config);
  mountGoogleAuth(app,db,config,options.googleProvider);
  mountPhotos(app, db);
  mountOrders(app, db, config);
  mountPayments(app, db, config.payment, paymentProvider);
  mountAddresses(app,db);
  mountShopping(app,db,config);
  mountCustomerProfile(app,db);
  mountLocation(app,db,config,options.geocodingProvider);
  mountOperations(app,db,config,courierProvider);
  mountAdmin(app, db);
  mountAdminConsole(app, db, config);
  mountFarmer(app, db, {courierMode});
  mountFarmerWorkspace(app, db);
  mountAccess(app, db);
  mountCourier(app, db, courierMode);
  app.get("/api/health", (_request, response) => {
    db.prepare("SELECT 1").get();
    response.json({ status: "ok", database: "connected", application: "Farmconnect", apiVersion: 1, release: "0.4.0" });
  });
  app.get('/api/store/config',(_req,res)=>res.json({appMode:config.appMode || 'live',checkoutEnabled:controls(db,config).checkoutEnabled,courierMode,
    onlinePayments:Boolean(config.payment),paymentIsTest:config.payment?.isTest??false,deliveryFeePaise:0}));
  app.get("/api/catalog", (_request, response) => response.json(getCatalog(db)));
  app.get("/api/products", (_request, response) => response.json({ products: listProducts(db) }));
  app.get("/api/products/:id", (request, response) => {
    const product = findProduct(db, request.params.id);
    if (!product) throw new ApiError(404, "PRODUCT_NOT_FOUND", "This product is not available.");
    response.json({ product });
  });
  app.post("/api/cart/quote", (request, response) => response.json(quoteCart(db, request.body)));

  if(config.clientDirectory && existsSync(join(config.clientDirectory,'index.html'))) {
    app.use(express.static(config.clientDirectory,{index:false,setHeaders:(res,path)=>{
      if(/[/\\]assets[/\\]/.test(path))res.setHeader('Cache-Control','public, max-age=31536000, immutable');
    }}));
    app.get(['/','/farmer','/delivery'],(_req,res)=>res.sendFile(join(config.clientDirectory,'index.html')));
  }

  app.use((_request, _response, next) => next(new ApiError(404, "NOT_FOUND", "This API endpoint does not exist.")));
  app.use((error, _request, response, _next) => {
    if (error.type === "entity.parse.failed") {
      return response.status(400).json({ error: { code: "INVALID_JSON", message: "Send valid JSON in the request body." } });
    }
    if (error.type === "entity.too.large") {
      return response.status(413).json({ error: { code: "REQUEST_TOO_LARGE", message: "The request body is too large." } });
    }
    if (error instanceof ApiError) {
      return response.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    console.error("API error:", {requestId:_request.requestId,name:error.name,code:error.code});
    return response.status(500).json({ error: { code: "SERVER_ERROR", message: "The server could not complete this request. Please try again.", requestId:_request.requestId } });
  });
  return app;
}






