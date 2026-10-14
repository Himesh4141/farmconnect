import {readConfig,checkBuild} from './config.js';
try {
  const config=readConfig();checkBuild(config);
  console.log(JSON.stringify({configuration:'valid',production:config.production,checkoutEnabled:config.checkoutEnabled,
    delivery:config.courierMode,payments:config.payment?config.payment.isTest?'test':'live':'cod-only',addressLookup:Boolean(config.geocodingKey),googleSignIn:Boolean(config.google)},null,2));
} catch(error){console.error(error.message);process.exitCode=1;}
