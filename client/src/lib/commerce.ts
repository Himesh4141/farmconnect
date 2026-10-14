import type { Address, Order } from './orders';

export type StoreConfig = { appMode?:'live'|'demo'; checkoutEnabled:boolean; courierMode:string; onlinePayments:boolean; paymentIsTest:boolean; deliveryFeePaise:number };
export type SavedAddress = { id:string; label:string; address:Address; revision:number; isDefault:boolean; serviceable:boolean };
export async function commerceRequest<T>(path:string, body?:unknown, method?:string):Promise<T> {
  const response = await fetch('/api'+path,{method:method??(body?'POST':'GET'),credentials:'same-origin',cache:'no-store',
    headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const result = await response.json();
  if(!response.ok)throw new Error(result.error?.message??'Unable to complete this request. Please try again.');
  return result;
}
type PaymentReply = {razorpay_payment_id:string;razorpay_order_id:string;razorpay_signature:string};
type RazorpayOptions = {key:string;order_id:string;amount:number;currency:string;name:string;description:string;
  theme:{color:string};handler:(reply:PaymentReply)=>void;modal:{ondismiss:()=>void};prefill:{name:string;contact:string}};
declare global {interface Window {Razorpay?:new (options:RazorpayOptions)=>{open:()=>void}}}
let checkoutScript:Promise<void>|null=null;
function loadCheckout() {
  if(window.Razorpay)return Promise.resolve();
  if(!checkoutScript)checkoutScript=new Promise<void>((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://checkout.razorpay.com/v1/checkout.js';script.async=true;
    const timeout=window.setTimeout(()=>{script.remove();checkoutScript=null;reject(new Error('Payment window could not load. Your order remains saved.'));},15000);
    script.onload=()=>{clearTimeout(timeout);if(window.Razorpay)resolve();else{checkoutScript=null;reject(new Error('Payment service is unavailable.'));}};
    script.onerror=()=>{clearTimeout(timeout);script.remove();checkoutScript=null;reject(new Error('Payment window could not load. Check your connection.'));};
    document.head.appendChild(script);
  });
  return checkoutScript;
}
export async function payOrder(order:Order):Promise<Order> {
  const setup=await commerceRequest<{paid?:boolean;order?:Order;key:string;providerOrderId:string;amount:number;currency:string;isTest:boolean}>('/orders/'+order.id+'/payment',{});
  if(setup.paid&&setup.order)return setup.order;
  await loadCheckout();
  return new Promise<Order>((resolve,reject)=>{
    const instance=new window.Razorpay!({key:setup.key,order_id:setup.providerOrderId,amount:setup.amount,currency:setup.currency,
      name:'Farmconnect',description:setup.isTest?'Test payment · no real charge':'Fresh produce from your farmers',theme:{color:'#244431'},
      prefill:{name:order.address.name,contact:order.address.phone},
      handler:reply=>{void commerceRequest<{order:Order}>('/orders/'+order.id+'/payment/verify',reply).then(data=>resolve(data.order)).catch(reject);},
      modal:{ondismiss:()=>{void commerceRequest<{order:Order}>('/orders/'+order.id).then(data=>resolve(data.order)).catch(reject);}},
    });instance.open();
  });
}
