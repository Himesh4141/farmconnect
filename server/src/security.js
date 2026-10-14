import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from './pricing.js';

export function installSecurity(app, config) {
  const windows = new Map();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy || false);
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set({ 'X-Request-ID': req.requestId, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
      'Cache-Control': 'no-store' });
    if (config.production) {
      res.set('Strict-Transport-Security', 'max-age=31536000');
      res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://*.razorpay.com; frame-src https://*.razorpay.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
      if (req.headers.origin && req.headers.origin !== config.origin && !req.path.startsWith('/api/webhooks/')) return next(new ApiError(403, 'ORIGIN_REJECTED', 'Use the official Farmconnect address.'));
    }
    if (!req.path.startsWith('/api/') || req.path === '/api/health' || req.path.startsWith('/api/webhooks/')) return next();
    const now = Date.now(), key = createHash('sha256').update(req.ip || '').digest('hex');
    if (windows.size > 10000) for (const [k, value] of windows) if (value.until < now) windows.delete(k);
    if (windows.size > 20000) return next(new ApiError(503, 'BUSY', 'Please try again shortly.'));
    let window = windows.get(key);
    if (!window || window.until < now) { window = { until: now + 60000, count: 0 }; windows.set(key, window); }
    if (++window.count > 600) { res.set('Retry-After', String(Math.ceil((window.until - now) / 1000))); return next(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment.')); }
    next();
  });
}
