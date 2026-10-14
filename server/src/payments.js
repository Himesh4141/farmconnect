import express from 'express';
import { ApiError } from './pricing.js';
import { requireSameOrigin, requireUser } from './auth.js';
import { serialize } from './orders.js';
import { changeOrder } from './admin.js';
import { queueRefund } from './payment-ledger.js';
import { matchesSignature } from './providers.js';

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function recordCaptured(db, payment) {
  const row = db.prepare('SELECT * FROM order_payments WHERE provider_order_id=?').get(payment?.order_id ?? '');
  if (!row) throw new ApiError(409, 'UNKNOWN_PAYMENT', 'Payment reference is awaiting reconciliation.');
  if (payment.status !== 'captured' || payment.currency !== 'INR' || payment.amount !== row.amount_paise || !/^pay_[a-zA-Z0-9]+$/.test(payment.id ?? ''))
    throw new ApiError(409, 'PAYMENT_NOT_CAPTURED', 'Payment is not confirmed. Refresh your order shortly; do not pay twice.');
  if (row.provider_payment_id && row.provider_payment_id !== payment.id) throw new ApiError(409, 'PAYMENT_CONFLICT', 'Payment needs operator review.');
  db.prepare("UPDATE order_payments SET state='paid',provider_payment_id=?,updated_at=? WHERE order_id=?").run(payment.id, Date.now(), row.order_id);
  db.prepare("UPDATE orders SET payment_status='paid' WHERE id=? AND status!='cancelled'").run(row.order_id);
  queueRefund(db, row.order_id);
  return row.order_id;
}

export function mountPaymentWebhook(app, db, config) {
  app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '128kb' }), (req, res) => {
    if (!config) throw new ApiError(503, 'PAYMENT_NOT_CONFIGURED', 'Payment service is not configured.');
    if (!Buffer.isBuffer(req.body) || !matchesSignature(req.body, req.get('x-razorpay-signature'), config.webhookSecret))
      throw new ApiError(400, 'INVALID_SIGNATURE', 'Invalid webhook signature.');
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { throw new ApiError(400, 'INVALID_JSON', 'Invalid webhook body.'); }
    const eventId = req.get('x-razorpay-event-id');
    if (!eventId || !/^[a-zA-Z0-9_-]{1,160}$/.test(eventId)) throw new ApiError(400, 'INVALID_EVENT', 'Missing webhook event ID.');
    transaction(db, () => {
      if (db.prepare('SELECT 1 FROM payment_events WHERE event_id=?').get(eventId)) return;
      if (['payment.captured', 'order.paid'].includes(event.event)) recordCaptured(db, event.payload?.payment?.entity);
      if (event.event === 'refund.processed') {
        const refund = event.payload?.refund?.entity;
        const row = db.prepare(`SELECT r.*,p.provider_payment_id FROM payment_refunds r JOIN order_payments p ON p.order_id=r.order_id WHERE r.provider_refund_id=?`).get(refund?.id ?? '');
        // Retry a webhook that races the response from the refund creation request.
        if (!row) throw new ApiError(409, 'REFUND_PENDING', 'Refund is awaiting reconciliation.');
        if (refund.payment_id !== row.provider_payment_id || refund.amount !== row.amount_paise || refund.status !== 'processed') throw new ApiError(400, 'REFUND_MISMATCH', 'Refund details do not match.');
        db.prepare("UPDATE payment_refunds SET state='processed',updated_at=? WHERE id=?").run(Date.now(), row.id);
      }
      db.prepare('INSERT INTO payment_events VALUES (?,?)').run(eventId, Date.now());
    });
    res.json({ received: true });
  });
}

export function mountPayments(app, db, config, provider) {
  const locks = new Set();
  const owner = [requireUser(db), (req, _res, next) => {
    const row = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!row) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    if (!config || !provider) throw new ApiError(503, 'PAYMENT_NOT_CONFIGURED', 'Online payments are not configured.');
    req.order = row; next();
  }];
  app.post('/api/orders/:id/payment', requireSameOrigin, ...owner, async (req, res) => {
    const id = req.order.id;
    let payment = db.prepare('SELECT * FROM order_payments WHERE order_id=?').get(id);
    if (!payment) throw new ApiError(409, 'COD_ORDER', 'This is a cash-on-delivery order.');
    if (payment.state === 'paid') return res.json({ order: serialize(db, req.order), paid: true });
    if (req.order.status === 'cancelled' || payment.expires_at <= Date.now()) throw new ApiError(409, 'PAYMENT_EXPIRED', 'Payment window has closed. Check your orders and start a new basket.');
    if (locks.has(id)) throw new ApiError(409, 'PAYMENT_BUSY', 'Payment is being prepared. Retry in a moment.');
    if (!payment.provider_order_id) {
      // Persist the attempt before network I/O. A crash or timeout never creates a second provider order automatically.
      if (payment.state !== 'creating') throw new ApiError(409, 'PAYMENT_REVIEW', 'Payment setup needs review. Cancel this unpaid order and try again.');
      db.prepare("UPDATE order_payments SET state='review',updated_at=? WHERE order_id=?").run(Date.now(), id);
      locks.add(id);
      try {
        const result = await provider.createOrder(payment.amount_paise, id);
        if (!/^order_[a-zA-Z0-9]+$/.test(result.id ?? '') || result.amount !== payment.amount_paise || result.currency !== 'INR') throw new ApiError(502, 'PAYMENT_MISMATCH', 'Payment service returned unexpected details.');
        db.prepare("UPDATE order_payments SET provider_order_id=?,state=CASE WHEN state='expired' THEN state ELSE 'pending' END,updated_at=? WHERE order_id=?").run(result.id, Date.now(), id);
      } finally { locks.delete(id); }
      payment = db.prepare('SELECT * FROM order_payments WHERE order_id=?').get(id);
    }
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    if (order.status === 'cancelled' || payment.expires_at <= Date.now()) throw new ApiError(409, 'PAYMENT_EXPIRED', 'Order was cancelled or the payment window closed.');
    res.json({ key: config.keyId, providerOrderId: payment.provider_order_id, amount: payment.amount_paise, currency: 'INR', isTest: config.isTest });
  });
  app.post('/api/orders/:id/payment/verify', requireSameOrigin, ...owner, async (req, res) => {
    const payment = db.prepare('SELECT * FROM order_payments WHERE order_id=?').get(req.order.id);
    const body = req.body;
    if (!payment?.provider_order_id || body?.razorpay_order_id !== payment.provider_order_id || typeof body?.razorpay_payment_id !== 'string' || !matchesSignature(payment.provider_order_id + '|' + body.razorpay_payment_id, body.razorpay_signature, config.keySecret))
      throw new ApiError(400, 'INVALID_SIGNATURE', 'Payment verification failed. Check order history before paying again.');
    const actual = await provider.fetchPayment(body.razorpay_payment_id);
    if (actual.order_id !== payment.provider_order_id) throw new ApiError(400, 'PAYMENT_MISMATCH', 'Payment belongs to another order.');
    transaction(db, () => recordCaptured(db, actual));
    res.json({ order: serialize(db, db.prepare('SELECT * FROM orders WHERE id=?').get(req.order.id)) });
  });
}

export async function reconcilePayments(db, provider) {
  // Only one worker runs per single-instance application. All DB changes are synchronous transactions.
  const pending = db.prepare("SELECT p.*,o.user_id,o.status AS order_status FROM order_payments p JOIN orders o ON o.id=p.order_id WHERE p.state IN ('creating','pending','review','expired') AND (p.state!='expired' OR p.updated_at>?) ORDER BY CASE WHEN p.state='expired' THEN 1 ELSE 0 END,p.updated_at LIMIT 30").all(Date.now() - 86400000);
  for (const payment of pending) {
    if (provider && payment.provider_order_id) {
      try {
        const result = await provider.orderPayments(payment.provider_order_id);
        for (const actual of result.items ?? []) if (actual.status === 'captured') transaction(db, () => recordCaptured(db, actual));
      } catch { /* Verified callbacks and later worker attempts can still recover. */ }
    }
    const state = db.prepare('SELECT state FROM order_payments WHERE order_id=?').get(payment.order_id).state;
    if (state !== 'paid' && payment.expires_at <= Date.now() && payment.order_status === 'placed') {
      changeOrder(db, payment.order_id, payment.user_id, { status: 'cancelled', expectedStatus: 'placed' });
      db.prepare("UPDATE order_payments SET state='expired',updated_at=? WHERE order_id=? AND state!='paid'").run(Date.now(), payment.order_id);
    }
  }
  if (!provider) return;
  const refunds = db.prepare("SELECT r.*,p.provider_payment_id FROM payment_refunds r JOIN order_payments p ON p.order_id=r.order_id WHERE r.state IN ('queued','submitted') ORDER BY r.created_at LIMIT 30").all();
  for (const refund of refunds) {
    try {
      const actual = refund.provider_refund_id ? await provider.fetchRefund(refund.provider_refund_id) : await provider.refund(refund.provider_payment_id, refund.amount_paise, refund.id);
      if (!/^rfnd_[a-zA-Z0-9]+$/.test(actual.id ?? '') || actual.payment_id !== refund.provider_payment_id || actual.amount !== refund.amount_paise) throw new Error('Mismatch');
      db.prepare('UPDATE payment_refunds SET provider_refund_id=?,state=?,updated_at=?,last_error=? WHERE id=?')
        .run(actual.id, actual.status === 'processed' ? 'processed' : actual.status === 'failed' ? 'review' : 'submitted', Date.now(), '', refund.id);
    } catch {
      db.prepare("UPDATE payment_refunds SET last_error='Provider confirmation pending; retry uses the same refund key.',updated_at=? WHERE id=?").run(Date.now(), refund.id);
    }
  }
}
