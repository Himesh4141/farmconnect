import { useEffect, useState } from 'react';
import { CheckCircle2, Truck, CreditCard, MapPin, RefreshCw } from 'lucide-react';
import { commerceRequest } from '../lib/commerce';
import { money } from '../data/products';
import type { Address } from '../lib/orders';
type Dispatch={orderId:string;farmId:string;farmName:string;reference:string;address:Address;pickup_address:string;city:string;pincode:string;phone:string;waybill:string|null;providerStatus:string|null;shipmentId:string|null};
type Operations={paymentConfigured:boolean;paymentIsTest:boolean;courierConfigured:boolean;courierMode:string;checkoutEnabled:boolean;
  dispatch:Dispatch[];areas:{pincode:string;active:number}[];payments:{orderId:string;amountPaise:number;state:string;isTest:number}[];
  refunds:{id:string;orderId:string;amountPaise:number;state:string;lastError:string}[]};
function ShipmentRow({row,onSaved}:{row:Dispatch;onSaved:()=>void}){
  const [waybill,setWaybill]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(){if(busy)return;setBusy(true);setError('');try{
    await commerceRequest(row.shipmentId?'/admin/dispatch/'+row.shipmentId+'/refresh':'/admin/dispatch',row.shipmentId?{}:{orderId:row.orderId,farmId:row.farmId,waybill});onSaved();
  }catch(e){setError(e instanceof Error?e.message:'Unable to save shipment.');}finally{setBusy(false);}}
  return <article className="fc-order-card"><header><strong>{row.farmName}</strong><span>{row.providerStatus??'Ready for dispatch'}</span></header>
    <p>Pickup: {row.pickup_address}, {row.city} {row.pincode} · {row.phone}</p><p>Deliver to: {row.address.name} · {row.address.line}, {row.address.city} {row.address.pincode} · {row.address.phone}</p>
    <label>Courier order reference<input readOnly value={row.reference} onFocus={e=>e.target.select()}/></label>
    {row.waybill?<p>Delhivery waybill: <strong>{row.waybill}</strong></p>:<><p>Book the shipment and pickup in your business courier account using this exact reference, then connect its waybill here.</p><label>Waybill<input inputMode="numeric" value={waybill} maxLength={30} onChange={e=>setWaybill(e.target.value)}/></label></>}
    <button className="fc-primary" disabled={busy||(!row.shipmentId&&!/^\d{8,30}$/.test(waybill))} onClick={()=>void save()}>{busy?'Verifying…':row.shipmentId?'Refresh courier status':'Verify and connect shipment'}</button>
    {error&&<p className="fc-order-error" role="alert">{error}</p>}
  </article>;
}
export default function OperationsPanel(){
  const [data,setData]=useState<Operations|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0),[pin,setPin]=useState('');
  useEffect(()=>{let active=true;setError('');commerceRequest<Operations>('/admin/operations').then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[attempt]);
  async function area(pincode:string,active:boolean){if(busy)return;setBusy(true);setError('');try{await commerceRequest('/admin/delivery-areas',{pincode,active});setPin('');setAttempt(n=>n+1);}catch(e){setError(e instanceof Error?e.message:'Unable to save area.');}finally{setBusy(false);}}
  return <div className="fc-operations"><button className="fc-account-switch" onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={16}/> Refresh operations</button>{error&&<p className="fc-order-error" role="alert">{error}</p>}
    {!data?<p>Loading operations…</p>:<><div className="fc-operations-summary"><article><CreditCard/><strong>Payments</strong><span>{data.paymentConfigured?data.paymentIsTest?'Razorpay test mode':'Razorpay live':'Cash on delivery'}</span></article><article><Truck/><strong>Delivery</strong><span>{data.courierConfigured?'Delhivery tracking':data.courierMode==='demo'?'Local demo':'Not connected'}</span></article><article><CheckCircle2/><strong>Ordering</strong><span>{data.checkoutEnabled?'Enabled':'Paused'}</span></article></div>
    <h3><MapPin size={20}/> Delivery areas</h3><p>Enable only areas your farmers and delivery operation can serve.</p><div className="fc-area-chips">{data.areas.map(item=><button key={item.pincode} aria-pressed={Boolean(item.active)} disabled={busy} onClick={()=>void area(item.pincode,!item.active)}>{item.pincode} · {item.active?'Active':'Paused'}</button>)}</div>
    <form className="fc-inline-form" onSubmit={e=>{e.preventDefault();void area(pin,true);}}><input aria-label="New delivery pincode" inputMode="numeric" placeholder="Add pincode" maxLength={6} value={pin} onChange={e=>setPin(e.target.value)}/><button className="fc-primary" disabled={busy||!/^[1-9][0-9]{5}$/.test(pin)}>Add area</button></form>
    <h3>Dispatch desk</h3>{data.courierConfigured?<><p>Booking and pickup scheduling happen in Delhivery One. Verified tracking updates sync automatically to buyers and farmers.</p>{data.dispatch.length?data.dispatch.map(row=><ShipmentRow key={row.orderId+row.farmId} row={row} onSaved={()=>setAttempt(n=>n+1)}/>):<p>No farm orders awaiting courier dispatch.</p>}</>:<p>{data.courierMode==='demo'?'Approved delivery partners manage the demo queue at /delivery.':'Connect a business courier account to enable verified shipment tracking.'}</p>}
    <h3>Online payments</h3>{data.payments.length?data.payments.map(row=><article className="fc-ledger-row" key={row.orderId}><span>{row.orderId.slice(0,8)} · {row.isTest?'Test · ':''}{row.state}</span><strong>{money(row.amountPaise)}</strong></article>):<p>No online payments yet.</p>}
    <h3>Refunds</h3>{data.refunds.length?data.refunds.map(row=><article className="fc-order-card" key={row.id}><strong>{money(row.amountPaise)} · {row.state}</strong><p>Order {row.orderId}</p>{row.lastError&&<p>{row.lastError}</p>}</article>):<p>No refund requests.</p>}
    </>}
  </div>;
}
