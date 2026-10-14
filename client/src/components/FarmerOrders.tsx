import { useRefreshTick } from '../lib/useRefreshTick';
import { useEffect, useState } from 'react';
import { marketplaceRequest, type FarmerOrder } from '../lib/marketplace';
import { FarmOrder } from './FarmerPanel';
type Result={orders:FarmerOrder[];total:number;page:number;limit:number;counts:Record<string,number>};
const stages=[['all','All orders'],['placed','New'],['confirmed','To pack'],['packed','Packed'],['ready_for_pickup','Ready for pickup'],['in_transit','In transit'],['out_for_delivery','Out for delivery'],['delivered','Delivered'],['cancelled','Cancelled']] as const;
export default function FarmerOrders({refresh,onChanged}:{refresh:number;onChanged:()=>void}){
 const [search,setSearch]=useState(''),[term,setTerm]=useState(''),[kind,setKind]=useState('all'),[status,setStatus]=useState('all'),[page,setPage]=useState(1);
 const [data,setData]=useState<Result|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const tick=useRefreshTick();
 useEffect(()=>{let active=true;if(!data)setLoading(true);setError('');
  const query=new URLSearchParams({search:term,kind,status,page:String(page),limit:'20'});
  marketplaceRequest<Result>('/orders?'+query).then(result=>{if(active){if(page>1&&result.total<=(page-1)*20){setPage(Math.max(1,Math.ceil(result.total/20)));return;}setData(result);}}).catch(failure=>{if(active)setError(failure.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[term,kind,status,page,refresh,retry,tick]);
 const counts=data?.counts;
 return <section className="fp-order-board" aria-label="Farm orders">
  <div className="fp-order-intro"><div><h2>From order to pickup.</h2><p>Accept new orders, pack your produce, then mark it ready for collection.</p></div><button className="fc-account-button" disabled={loading} onClick={()=>setRetry(n=>n+1)}>Refresh orders</button></div>
  <div className="fp-order-stats">{[['placed','Awaiting acceptance'],['confirmed','Need packing'],['packed','Packed'],['ready_for_pickup','Ready for pickup']].map(([key,label])=><button key={key} aria-pressed={status===key} onClick={()=>{setStatus(key);setPage(1);}}><span>{label}</span><strong>{counts?.[key]??'—'}</strong></button>)}</div>
  <small>Counts include all your farm’s orders. Filters below control the list.</small>
  <form className="fp-order-filters" onSubmit={e=>{e.preventDefault();setTerm(search.trim());setPage(1);}}><label>Search your orders<input type="search" maxLength={100} placeholder="Order ID, buyer, business or produce" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Buyer type<select value={kind} onChange={e=>{setKind(e.target.value);setPage(1);}}><option value="all">All buyers</option><option value="consumer">Consumers</option><option value="bulk_buyer">Bulk buyers</option></select></label><button className="fc-primary" type="submit">Search</button></form>
  <div className="fc-admin-tabs" aria-label="Order status">{stages.map(([key,label])=><button key={key} aria-pressed={status===key} onClick={()=>{setStatus(key);setPage(1);}}>{label}</button>)}</div>
  {error?<div role="alert" className="fc-order-error">{error} <button onClick={()=>setRetry(n=>n+1)}>Try again</button></div>:loading?<p role="status">Loading orders…</p>:data&&<><p role="status">{data.total?((page-1)*20+1)+'–'+Math.min(page*20,data.total)+' of '+data.total+' matching orders':'No orders match these filters.'}</p>{!data.total&&<button className="fc-account-switch" onClick={()=>{setSearch('');setTerm('');setKind('all');setStatus('all');setPage(1);}}>Show all orders</button>}{data.orders.map(order=><FarmOrder key={order.id+order.status+order.orderStatus} order={order} onSaved={()=>{setRetry(n=>n+1);onChanged();}}/>)}{data.total>20&&<nav className="fp-order-pages" aria-label="Order pages"><button disabled={page===1} onClick={()=>setPage(n=>n-1)}>Previous</button><span>Page {page} of {Math.ceil(data.total/20)}</span><button disabled={page*20>=data.total} onClick={()=>setPage(n=>n+1)}>Next</button></nav>}</>}
  <p className="fc-order-note">Ready for pickup records your preparation. In local test mode, marking ready automatically sends the pickup to delivery partners. Live courier delivery is not connected.</p>
 </section>;
}
