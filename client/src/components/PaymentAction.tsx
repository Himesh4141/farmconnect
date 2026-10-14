import { useState } from 'react';
import { CreditCard, LockKeyhole } from 'lucide-react';
import { payOrder } from '../lib/commerce';
import { money } from '../data/products';
import type { Order } from '../lib/orders';

export function paymentLabel(order:Order) {
  if(order.payment){
    if(order.payment.refundPaise>0)return order.payment.refundedPaise===order.payment.refundPaise?'Refund completed':'Refund pending';
    return order.payment.state==='paid'?(order.payment.isTest?'Test payment confirmed':'Paid online'):order.status==='cancelled'?'Order cancelled':'Awaiting payment';
  }
  return order.deliveryMode==='demo'?'Demo · no payment collected':order.paymentStatus==='paid'?'Paid':order.status==='cancelled'?'Nothing payable':'Cash on delivery';
}
export default function PaymentAction({order,onUpdated}:{order:Order;onUpdated:(order:Order)=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  if(!order.payment)return null;
  const payable=order.status!=='cancelled'&&order.payment.state!=='paid'&&order.payment.expiresAt>Date.now();
  async function pay(){if(busy)return;setBusy(true);setError('');try{onUpdated(await payOrder(order));}catch(e){setError(e instanceof Error?e.message:'Check order history before paying again.');}finally{setBusy(false);}}
  return <div className="fc-payment-card"><div className="fc-payment-heading"><LockKeyhole size={18}/><strong>{paymentLabel(order)}</strong></div>
    {order.payment.refundPaise>0&&<p>{money(order.payment.refundPaise)} refund requested · {money(order.payment.refundedPaise)} confirmed by the payment provider.</p>}
    {payable&&<><p>{order.payment.isTest?'Razorpay test mode. Use provider test details only.':'Pay securely through Razorpay.'} Stock is held until {new Date(order.payment.expiresAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}.</p><button className="fc-primary" disabled={busy} onClick={()=>void pay()}><CreditCard size={18}/>{busy?'Checking payment…':`Pay ${money(order.totalPaise)}`}</button></>}
    {!payable&&order.payment.state!=='paid'&&order.status!=='cancelled'&&<p>Your payment window has closed. Refresh orders shortly to see the stock release.</p>}
    {error&&<p className="fc-order-error" role="alert">{error}</p>}
  </div>;
}
