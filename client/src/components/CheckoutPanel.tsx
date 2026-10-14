import OrderTools from './OrderTools';
import { Pager } from './AdminTools';
import LocationAssist from './LocationAssist';
import type { CustomerDetails } from './CustomerProfile';
import PaymentAction, {paymentLabel} from './PaymentAction';
import {commerceRequest,type SavedAddress,type StoreConfig} from '../lib/commerce';
import { useRefreshTick } from '../lib/useRefreshTick';
import OrderTracking from './OrderTracking';
import { amountLabel, orderLineTotal } from '../data/products';
import { statusLabel } from './AdminPanel';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Package } from 'lucide-react';
import { money } from '../data/products';
import { OrderError, orderRequest, type Address, type CheckoutRequest, type Order } from '../lib/orders';
import type { CartItem } from '../lib/api';
import type { User } from '../lib/auth';
export function OrderReceipt({order:initial}:{order:Order}) {
 const [order,setOrder]=useState(initial);
 const awaiting=Boolean(order.payment&&order.payment.state!=='paid'&&order.status!=='cancelled');
 return <div className="fc-order-receipt"><CheckCircle2 size={38}/><h2 id="dialog-title">{awaiting?'Complete your payment.':'Your order is saved.'}</h2><p>{awaiting?'We are holding your produce while you pay.':'Follow your farmers and delivery progress in Your orders.'}</p><strong>{money(order.totalPaise)} · {paymentLabel(order)}</strong><PaymentAction order={order} onUpdated={setOrder}/><small>Order ID: {order.id}</small><p>{order.address.name}<br/>{order.address.line}, {order.address.city} {order.address.pincode}</p>{order.deliveryMode==='demo'&&<p className="fc-order-note">Local delivery demo. No real pickup or delivery will take place.</p>}</div>;
}
export function CheckoutPanel({user,items,subtotal,pincode,onBack,onPlaced,onBusy,mobile=false,summaryItems=[]}:{mobile?:boolean;summaryItems?:{productId:string;name:string;image:string;quantity:number;saleMode?:string;unit:string;lineTotalPaise:number}[];user:User;items:CartItem[];subtotal:number;pincode:string;onBack:()=>void;onBusy:(busy:boolean)=>void;onPlaced:(order:Order)=>void}) {
 const storageKey='farmconnect.checkout.'+user.id;
 const [pending,setPending]=useState<CheckoutRequest|null>(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)??'null');}catch{return null;}});
 const [step,setStep]=useState(pending?1:0);
 const [address,setAddress]=useState<Address>(pending?.address??{name:user.name,phone:'',line:'',city:'',pincode});
 const addressTouched=useRef(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [blocked,setBlocked]=useState(false);
 const [config,setConfig]=useState<StoreConfig|null>(null),[saved,setSaved]=useState<SavedAddress[]>([]),[saveAddress,setSaveAddress]=useState(false),[paymentMethod,setPaymentMethod]=useState<'cod'|'razorpay'>(pending?.paymentMethod??'cod');
 useEffect(()=>{let active=true;commerceRequest<StoreConfig>('/store/config').then(value=>{if(active)setConfig(value);}).catch(()=>{if(active)setError('Checkout could not load. Return to your basket and try again.');});Promise.all([commerceRequest<{addresses:SavedAddress[]}>('/addresses'),commerceRequest<{profile:CustomerDetails}>('/profile')]).then(([value,details])=>{if(active){setSaved(value.addresses);if(!pending&&!addressTouched.current){const preferred=value.addresses.find(row=>row.isDefault);setAddress(current=>preferred?{...preferred.address}:{...current,name:details.profile.name,phone:details.profile.phone});}}}).catch(()=>{});return()=>{active=false;};},[]);
 async function removeAddress(id:string){try{await commerceRequest('/addresses/'+id,undefined,'DELETE');setSaved(rows=>rows.filter(row=>row.id!==id));}catch(e){setError(e instanceof Error?e.message:'Unable to remove address.');}}
 const lock=useRef(false),errorRef=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(error){errorRef.current?.focus();errorRef.current?.scrollIntoView({block:'nearest'});}},[error]);
 const amount=pending?.expectedSubtotalPaise??subtotal;
 function reviewDelivery(){
  if(address.name.trim().length<2||address.line.trim().length<5||address.city.trim().length<2){setError('Enter your full name, street address and city.');return;}
  if(!/^[6-9][0-9]{9}$/.test(address.phone)||!/^\d{6}$/.test(address.pincode)){setError('Enter a valid 10-digit mobile number and six-digit pincode.');return;}
  setError('');setStep(1);document.querySelector('.fc-dialog')?.scrollTo({top:0,behavior:'instant'});
 }

 async function place(){
  if(lock.current||blocked||!config?.checkoutEnabled)return;
  setError('');
  if(!pending){
   if(address.name.trim().length<2||address.line.trim().length<5||address.city.trim().length<2){setError('Enter your full name, street address and city.');return;}
   if(!/^[6-9][0-9]{9}$/.test(address.phone)){setError('Enter a 10-digit Indian mobile number.');return;}
   if(!/^[0-9]{6}$/.test(address.pincode)){setError('Enter a six-digit delivery pincode.');return;}
   if(!items.length||!subtotal){setError('Return to your basket and add products.');return;}
  }
  const request=pending??{requestKey:crypto.randomUUID(),address,items,expectedSubtotalPaise:subtotal,paymentMethod};
  // Save the exact attempt before sending it so a retry cannot create a second order.
  try{sessionStorage.setItem(storageKey,JSON.stringify(request));}catch{setError('Enable browser storage before checkout so order retries can be handled safely.');return;}
  setPending(request);lock.current=true;setBusy(true);onBusy(true);
  try{
   const result=await orderRequest<{order:Order}>('',request);
   sessionStorage.removeItem(storageKey);setPending(null);
   if(saveAddress)try{await commerceRequest('/addresses',{label:'Delivery address',address:request.address});}catch{/* The order is already saved; address-book failure must not retry checkout. */}
   onPlaced(result.order);
  }catch(failure){
   setError(failure instanceof Error?failure.message:'Unable to place order.');
   if(failure instanceof OrderError&&failure.status>=400&&failure.status<500&&failure.status!==401){
    sessionStorage.removeItem(storageKey);setPending(null);
    if(failure.status===409||failure.status===404)setBlocked(true);
   }
  }finally{lock.current=false;setBusy(false);onBusy(false);}
 }
 return <section className="fc-account fc-checkout"><button className="fc-account-switch" onClick={onBack} disabled={busy}><ArrowLeft size={16}/> Back to basket</button><span className="fc-account-eyebrow">FROM THE GROWER TO YOUR DOOR</span><h2 id="dialog-title">Your next fresh delivery.</h2>
 <div className="fc-checkout-steps"><span aria-current={step===0?'step':undefined}>1 · Delivery details</span><span aria-current={step===1?'step':undefined}>2 · Review & pay</span></div>
 {config?.courierMode==='demo'&&<p className="fc-order-note">You are using the local delivery demo. No real delivery will be booked.</p>}
 {config&&!config.checkoutEnabled&&<p className="fc-order-error" role="alert">Ordering is temporarily paused. Your basket is saved.</p>}
 {error&&<p ref={errorRef} tabIndex={-1} className="fc-order-error" role="alert">{error}</p>}
 {pending&&<p role="status">A checkout attempt is saved. Retry checks that same order without placing it twice.</p>}
 <form noValidate onSubmit={event=>{event.preventDefault();if(mobile&&step===0&&!pending)reviewDelivery();else void place();}}>
 {(!mobile||step===0)&&<>{!!saved.length&&!pending&&<div className="fc-saved-addresses"><h3>Saved addresses</h3>{saved.map(row=><div key={row.id}><button disabled={busy} type="button" onClick={()=>{addressTouched.current=true;setAddress({...row.address});}}><strong>{row.label}{row.isDefault?" · Default":""}</strong><span>{row.address.line}, {row.address.city} {row.address.pincode}</span></button><button className="fc-account-switch" disabled={busy} type="button" aria-label={'Remove saved address '+row.address.line} onClick={()=>void removeAddress(row.id)}>Remove</button></div>)}</div>}
 <fieldset disabled={busy||Boolean(pending)||blocked}>
 <LocationAssist disabled={busy||Boolean(pending)||blocked} onApply={result=>{addressTouched.current=true;setAddress(current=>({...current,...result.address}));}}/>
 {([['name','Recipient name','name',80],['phone','Mobile number','tel',10],['line','House, street and area','street-address',200],['city','City','address-level2',80],['pincode','Pincode','postal-code',6]] as const).map(([field,label,complete,max])=><label key={field}>{label}<input autoComplete={complete} maxLength={max} inputMode={field==='phone'||field==='pincode'?'numeric':'text'} value={address[field]} onChange={event=>{addressTouched.current=true;setAddress({...address,[field]:event.target.value});}}/></label>)}
 </fieldset><label className="fc-admin-check"><input type="checkbox" checked={saveAddress} disabled={busy} onChange={e=>setSaveAddress(e.target.checked)}/> Save this address for next time</label></>}
 {mobile&&step===1&&<><div className="fc-checkout-destination"><strong>Deliver to {address.name}</strong><p>{address.line}, {address.city} {address.pincode}</p><p>{address.phone}</p>{!pending&&<button type="button" onClick={()=>setStep(0)}>Change delivery details</button>}</div>{!pending&&<section className="fc-checkout-review" aria-label="Order items">{summaryItems.map(item=><article key={item.productId}>{item.image&&<img src={item.image} alt=""/>}<span><strong>{item.name}</strong><small>{amountLabel(item.quantity,item.saleMode,item.unit)}</small></span><strong>{money(item.lineTotalPaise)}</strong></article>)}</section>}</>}
 {(!mobile||step===1)&&<fieldset className="fc-payment-methods" disabled={busy||Boolean(pending)}><legend>Payment method</legend><label><input type="radio" name="payment" checked={paymentMethod==='cod'} onChange={()=>setPaymentMethod('cod')}/><span><strong>{config?.courierMode==='demo'?'Demo checkout':'Cash on delivery'}</strong><small>{config?.courierMode==='demo'?'No money collected':'Pay when your order arrives'}</small></span></label>{config?.onlinePayments&&<label><input type="radio" name="payment" checked={paymentMethod==='razorpay'} onChange={()=>setPaymentMethod('razorpay')}/><span><strong>{config.paymentIsTest?'Online payment · test mode':'Pay online'}</strong><small>Secure checkout with Razorpay</small></span></label>}</fieldset>}
 <div className="fc-order-totals"><p>Produce <strong>{money(amount)}</strong></p><p>Delivery <strong>Free</strong></p><p>Total <strong>{money(amount)}</strong></p></div><button className="fc-primary" disabled={busy||blocked||!config?.checkoutEnabled} type="submit">{busy?'Saving your order…':pending?'Retry saved checkout':mobile&&step===0?'Review order →':paymentMethod==='razorpay'?`Continue to payment · ${money(amount)}`:`Place order · ${money(amount)}`}</button></form></section>;
}
function OrderProgress({order}:{order:Order}){
 const stages:Record<string,number>={placed:0,confirmed:1,packed:1,ready_for_pickup:2,pickup_requested:2,picked_up:3,in_transit:3,out_for_delivery:3,delivered:4};
 const parts=order.fulfillments.filter(f=>!['cancelled','rejected'].includes(f.status));
 const stage=order.status==='cancelled'?-1:parts.length?Math.min(...parts.map(f=>stages[f.status]??0)):0;
 return stage<0?null:<><div className="fc-order-progress" aria-label={'Order progress: '+(statusLabel[order.status]??order.status)}>{['Ordered','Preparing','Ready','On the way','Delivered'].map((label,i)=><span key={label} data-complete={i<=stage} title={label}/>)}</div><p className="fc-order-progress-label">{['Order received','Being prepared by your grower','Ready for courier pickup','With the delivery partner','Delivered'][stage]}{parts.length>1?' · '+parts.length+' farm shipments':''}</p></>;
}
function CustomerOrderCard({order,onChanged,onReorder}:{order:Order;onChanged:()=>void;onReorder:(items:CartItem[])=>Promise<void>}){
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function cancel(){if(busy)return;setBusy(true);setError('');try{await orderRequest('/'+order.id+'/cancel',{expectedStatus:order.status});onChanged();}catch(failure){setError(failure instanceof Error?failure.message:'Unable to cancel order.');}finally{setBusy(false);}}
 return <article className="fc-order-card"><header><strong>{new Date(order.createdAt).toLocaleDateString('en-IN')}</strong><span>{order.deliveryMode==='demo'?'Demo · ':''}{statusLabel[order.status]} · {paymentLabel(order)}</span></header><small>Order {order.id}{order.purchaseKind === "bulk_buyer" ? " · Business: " + order.businessName : ""}</small><OrderProgress order={order}/><div className="fc-farm-progress">{order.fulfillments?.map(farm=><p key={farm.farmId}><strong>{farm.farmName}</strong> · {statusLabel[farm.status] ?? farm.status}{farm.rejectionReason ? " — " + farm.rejectionReason : ""}</p>)}</div><ul>{order.items.map(item=><li key={item.productId}><span>{item.name} · {amountLabel(item.quantity,item.saleMode,item.unit)}</span><strong>{money(orderLineTotal(item))}</strong></li>)}</ul>{order.cancelledPaise>0&&<p>Cancelled produce: −{money(order.cancelledPaise)}. Original order: {money(order.originalTotalPaise)}.</p>}<p><strong>{money(order.totalPaise)}</strong> · {order.status==="cancelled"?"Nothing payable":order.payment?paymentLabel(order):order.deliveryMode==='demo'?"Test order total — no payment collected":"Payable on delivery"}</p><p>{order.address.line}, {order.address.city} {order.address.pincode}</p>{error&&<p className="fc-order-error" role="alert">{error}</p>}{order.status==='placed'&&<><label className="fc-admin-check"><input type="checkbox" checked={confirm} disabled={busy} onChange={e=>setConfirm(e.target.checked)}/> I want to cancel this order.</label><button className="fc-account-switch" disabled={!confirm||busy} onClick={()=>void cancel()}>{busy?'Cancelling…':'Cancel order'}</button></>}<PaymentAction order={order} onUpdated={()=>onChanged()}/><OrderTracking orderId={order.id}/><OrderTools order={order} onReorder={onReorder}/>{order.status==='confirmed'&&<p>Preparation has started. Customer cancellation is no longer available.</p>}</article>;
}
export function OrdersPanel({onChanged,onReorder}:{onChanged:()=>void;onReorder:(items:CartItem[])=>Promise<void>}){
 const tick=useRefreshTick();
 const [orders,setOrders]=useState<Order[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[page,setPage]=useState(1),[total,setTotal]=useState(0),[status,setStatus]=useState('all'),[search,setSearch]=useState(''),[query,setQuery]=useState('');
 useEffect(()=>{let active=true;setLoading(true);setError('');orderRequest<{orders:Order[];total:number}>('?page='+page+'&status='+status+'&q='+encodeURIComponent(query)).then(result=>{if(active){setOrders(result.orders);setTotal(result.total);}}).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Could not load orders.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[attempt,tick,page,status,query]);
 return <section className="fc-account"><Package size={32}/><h2 id="dialog-title">Your orders.</h2><p>Track deliveries, buy favourites again, review delivered produce or get help with an order.</p><form className="fc-history-tools" onSubmit={e=>{e.preventDefault();setQuery(search);setPage(1);}}><input aria-label="Search my orders" placeholder="Order ID, produce or farmer" maxLength={120} value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Filter my orders" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="all">All orders</option><option value="active">In progress</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select><button type="submit">Search</button><button type="button" disabled={loading} onClick={()=>setAttempt(n=>n+1)}>Refresh</button></form>{loading&&<p role="status">Updating orders…</p>}{error?<p className="fc-order-error" role="alert">{error}</p>:<>{orders.map(order=><CustomerOrderCard key={order.id} order={order} onReorder={onReorder} onChanged={()=>{setAttempt(n=>n+1);onChanged();}}/>)}{!loading&&!orders.length&&<p>No orders match your search.</p>}<Pager total={total} page={page} onPage={setPage}/></>}</section>;
}
