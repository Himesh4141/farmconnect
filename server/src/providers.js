import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from './pricing.js';

export function matchesSignature(value, signature, secret) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(createHmac('sha256', secret).update(value).digest(), Buffer.from(signature, 'hex'));
}

export function razorpayProvider(config, fetcher = fetch) {
  async function request(path, body, extraHeaders = {}) {
    let response;
    try {
      response = await fetcher('https://api.razorpay.com/v1' + path, {
        method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(12000), redirect: 'error',
        headers: { Authorization: 'Basic ' + Buffer.from(config.keyId + ':' + config.keySecret).toString('base64'), 'Content-Type': 'application/json', ...extraHeaders },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error('Provider rejected the request');
      return await response.json();
    } catch {
      throw new ApiError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Payment service is temporarily unavailable. Check your order before trying again.');
    }
  }
  const id = value => { if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new ApiError(400, 'INVALID_PAYMENT', 'Invalid payment reference.'); return value; };
  return {
    createOrder: (amount, receipt) => request('/orders', { amount, currency: 'INR', receipt, partial_payment: false }),
    fetchPayment: value => request('/payments/' + id(value)),
    orderPayments: value => request('/orders/' + id(value) + '/payments'),
    refund: (paymentId, amount, refundId) => request('/payments/' + id(paymentId) + '/refund', { amount, speed: 'normal' }, { 'X-Refund-Idempotency': refundId }),
    fetchRefund: value => request('/refunds/' + id(value)),
  };
}

export function delhiveryProvider(token, fetcher = fetch) {
  return {
    async track(waybill) {
      if (!/^\d{8,30}$/.test(waybill)) throw new ApiError(400, 'INVALID_WAYBILL', 'Enter the courier waybill number.');
      try {
        const response = await fetcher('https://track.delhivery.com/api/v1/packages/json/?waybill=' + encodeURIComponent(waybill), {
          headers: { Authorization: 'Token ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(12000), redirect: 'error',
        });
        if (!response.ok) throw new Error('Unavailable');
        const data = await response.json();
        const shipment = data.ShipmentData?.map(entry => entry.Shipment).find(entry => String(entry?.AWB) === waybill);
        if (!shipment?.Status?.Status) throw new Error('No matching shipment');
        return { waybill, reference: String(shipment.ReferenceNo || ''), status: shipment.Status.Status, statusType: shipment.Status.StatusType || '' };
      } catch { throw new ApiError(502, 'COURIER_UNAVAILABLE', 'Courier tracking could not be verified. No shipment status was changed.'); }
    },
  };
}
