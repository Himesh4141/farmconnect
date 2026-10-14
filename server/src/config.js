import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const appMode = env.APP_MODE || 'live';
  if (!['live', 'demo'].includes(appMode)) throw new Error('APP_MODE must be live or demo.');
  const hostedDemo = appMode === 'demo';
  const port = Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const courierMode = env.COURIER_MODE || 'disabled';
  if (!['disabled', 'demo', 'delhivery'].includes(courierMode)) throw new Error('COURIER_MODE must be disabled, demo or delhivery.');
  if (production && courierMode === 'demo' && !hostedDemo) throw new Error('Demo delivery requires explicit APP_MODE=demo when hosted.');
  if (hostedDemo && courierMode !== 'demo') throw new Error('APP_MODE=demo requires COURIER_MODE=demo.');
  if (hostedDemo && [env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, env.RAZORPAY_WEBHOOK_SECRET, env.DELHIVERY_TOKEN].some(Boolean)) throw new Error('Hosted demonstrations cannot use payment or courier credentials.');
  const origin = env.APP_ORIGIN || '';
  if (origin) {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw new Error('APP_ORIGIN must contain only the exact public origin, without a trailing slash.');
  }
  if (production && !origin.startsWith('https://')) throw new Error('Production requires HTTPS APP_ORIGIN.');
  const keyId = env.RAZORPAY_KEY_ID || '', keySecret = env.RAZORPAY_KEY_SECRET || '', webhookSecret = env.RAZORPAY_WEBHOOK_SECRET || '';
  const configured = Boolean(keyId && keySecret && webhookSecret);
  if ([keyId, keySecret, webhookSecret].some(Boolean) && !configured) throw new Error('Configure all three Razorpay values, or leave all empty.');
  if (configured && !/^rzp_(test|live)_[a-zA-Z0-9]+$/.test(keyId)) throw new Error('Invalid Razorpay key ID.');
  if (configured && webhookSecret.length < 20) throw new Error('Use a webhook secret of at least 20 characters.');
  const live = configured && keyId.startsWith('rzp_live_');
  if (live && (!production || courierMode !== 'delhivery')) throw new Error('Live payment keys require production HTTPS and a configured live delivery service.');
  if (production && configured && !live) throw new Error('Use Razorpay test keys in a local or staging environment, not production.');
  if (courierMode === 'delhivery' && !env.DELHIVERY_TOKEN) throw new Error('Delhivery mode requires DELHIVERY_TOKEN.');
  let trustProxy=false;
  if(env.TRUST_PROXY){
    if(env.TRUST_PROXY==='loopback')trustProxy='loopback';
    else if(env.TRUST_PROXY==='render'&&env.RENDER==='true')trustProxy=1;
    else {const [ip,bits]=env.TRUST_PROXY.split('/');if(isIP(ip)!==4||!/^\d{1,2}$/.test(bits??'')||Number(bits)<8||Number(bits)>32)throw new Error('TRUST_PROXY must be loopback, the exact proxy IPv4 CIDR, or render on Render.');trustProxy=env.TRUST_PROXY;}
  }
  const checkoutEnabled = env.CHECKOUT_ENABLED !== 'false' && (!production || hostedDemo || courierMode === 'delhivery');
  const googleId=env.GOOGLE_CLIENT_ID||'',googleSecret=env.GOOGLE_CLIENT_SECRET||'';
  if(Boolean(googleId)!==Boolean(googleSecret))throw new Error('Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or leave both empty.');
  if(googleId&&(!googleId.endsWith('.apps.googleusercontent.com')||!origin))throw new Error('Google sign-in requires a Google web client ID and APP_ORIGIN.');
  if(googleId&&!origin.startsWith('https://')&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))throw new Error('Google sign-in requires HTTPS, except localhost development.');
  return { production, appMode, port, host: env.HOST || '127.0.0.1', origin,
    trustProxy, geocodingKey: env.GEOAPIFY_API_KEY?.trim() || '',
    courierMode, checkoutEnabled, payment: configured ? { keyId, keySecret, webhookSecret, isTest: !live } : null,
    delhiveryToken: env.DELHIVERY_TOKEN || '',
    google:googleId?{clientId:googleId,clientSecret:googleSecret,redirectUri:origin+'/api/auth/google/callback'}:null,
    clientDirectory: fileURLToPath(new URL('../../client/dist/', import.meta.url)) };
}

export function checkBuild(config) {
  if (config.production && !existsSync(config.clientDirectory + '/index.html')) throw new Error('Build the client before starting production.');
}
