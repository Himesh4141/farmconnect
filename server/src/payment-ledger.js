import { randomUUID } from 'node:crypto';
import { ApiError } from './pricing.js';

export function assertOrderPaid(db, orderId) {
  const row = db.prepare('SELECT state FROM order_payments WHERE order_id=?').get(orderId);
  if (row && row.state !== 'paid') throw new ApiError(409, 'PAYMENT_PENDING', 'This order is awaiting payment. Preparation starts only after confirmed payment.');
}

// Call inside the same transaction as a cancellation. A later worker sends the refund.
export function queueRefund(db, orderId) {
  const payment = db.prepare('SELECT * FROM order_payments WHERE order_id=?').get(orderId);
  if (!payment?.provider_payment_id || payment.state !== 'paid') return;
  const order = db.prepare('SELECT status,delivery_fee_paise FROM orders WHERE id=?').get(orderId);
  const cancelled = order.status === 'cancelled' ? payment.amount_paise : db.prepare(`SELECT COALESCE(SUM(i.line_total_paise),0) AS amount
    FROM order_items i JOIN farm_fulfillments ff ON ff.order_id=i.order_id AND ff.farm_id=i.farm_id
    WHERE i.order_id=? AND ff.status='cancelled'`).get(orderId).amount;
  const queued = db.prepare('SELECT COALESCE(SUM(amount_paise),0) AS amount FROM payment_refunds WHERE order_id=?').get(orderId).amount;
  const support=db.prepare('SELECT COALESCE(SUM(refund_paise),0) amount FROM order_help WHERE order_id=?').get(orderId).amount;
  const difference = Math.min(cancelled + support, payment.amount_paise) - queued;
  if (difference > 0) db.prepare('INSERT INTO payment_refunds(id,order_id,amount_paise,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run(randomUUID(), orderId, difference, Date.now(), Date.now());
}

export function paymentSummary(db, orderId) {
  const row = db.prepare('SELECT * FROM order_payments WHERE order_id=?').get(orderId);
  if (!row) return null;
  const refunds = db.prepare('SELECT amount_paise AS amountPaise,state FROM payment_refunds WHERE order_id=? ORDER BY created_at').all(orderId);
  return { state: row.state, isTest: Boolean(row.is_test), expiresAt: row.expires_at,
    refundPaise: refunds.reduce((sum, refund) => sum + refund.amountPaise, 0),
    refundedPaise: refunds.filter(refund => refund.state === 'processed').reduce((sum, refund) => sum + refund.amountPaise, 0),
    refunds };
}
