import HelpCenter from './HelpCenter';
import ReviewModeration from './ReviewModeration';
import { useState } from 'react';
import { LayoutDashboard,ClipboardList,Package,ShieldCheck,Truck,Users,Settings,History,RefreshCw } from 'lucide-react';
import OperationsPanel from './OperationsPanel';
import ApprovalQueue from './ApprovalQueue';
import { adminRequest } from '../lib/admin';
import { money,amountLabel } from '../data/products';
import type { Order } from '../lib/orders';
import { AdminShipments,AdminOverview,AdminCatalog,AdminDelivery,AdminAccounts,AdminActivity,useAdminData,useAdminSearch,LoadState,Pager } from './AdminTools';
import '../admin.css';
export const statusLabel:Record<string,string>={in_transit:'In transit',partially_delivered:'Partially delivered',placed:'Placed',confirmed:'Confirmed',packed:'Packed',out_for_delivery:'Out for delivery',delivered:'Delivered',cancelled:'Cancelled',ready_for_pickup:'Ready for pickup'};
function OrderActions({order,onSaved}:{order:Order;onSaved:()=>void}){
 const [reason,setReason]=useState(''),[cash,setCash]=useState(false),[cancel,setCancel]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const next:Record<string,string>={placed:'confirmed',confirmed:'packed',packed:'out_for_delivery',out_for_delivery:'delivered'};
 const target=next[order.status];
 async function update(status:string){if(busy)return;setBusy(true);setError('');try{await adminRequest('/orders/'+order.id+'/status',{status,expectedStatus:order.status,cashCollected:cash,reason});onSaved();}catch(failure){setError(failure instanceof Error?failure.message:'Update failed.');}finally{setBusy(false);}}
 return <article className="fc-order-card"><header><strong>{order.deliveryMode==='demo'?'Demo · ':''}{statusLabel[order.status]} · {money(order.totalPaise)}</strong><span>Payment: {order.paymentStatus} · {order.paymentMethod==='razorpay'?'Online payment':'Cash on delivery'}</span></header><small>{order.id} · {new Date(order.createdAt).toLocaleString('en-IN')}</small><p><strong>{order.address.name}</strong><br/>{order.address.phone}<br/>{order.address.line}, {order.address.city} {order.address.pincode}</p><ul>{order.items.map(item=><li key={item.productId}>{item.name} · {amountLabel(item.quantity,item.saleMode,item.unit)}</li>)}</ul>{error&&<p className="fc-order-error" role="alert">{error}</p>}
 {!order.farmerManaged&&target==='delivered'&&<label className="fc-admin-check"><input type="checkbox" checked={cash} onChange={e=>setCash(e.target.checked)} disabled={busy}/> I confirm delivery and cash collection.</label>}
 {!order.farmerManaged&&target&&<button className="fc-primary" disabled={busy||(target==='delivered'&&!cash)} onClick={()=>void update(target)}>{busy?'Saving…':'Mark '+statusLabel[target].toLowerCase()}</button>}
 {order.fulfillments.map(part=><p key={part.farmId}><strong>{part.farmName}</strong> · {statusLabel[part.status]??part.status}{part.rejectionReason&&` · ${part.rejectionReason}`}</p>)}
 {order.farmerManaged&&<p>Farmers manage preparation; delivery partners or the configured courier provide tracking. Use Operations to connect a live shipment.</p>}
 {['placed','confirmed','packed'].includes(order.status)&&<><label>Cancellation reason<textarea minLength={10} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><label className="fc-admin-check"><input type="checkbox" checked={cancel} onChange={e=>setCancel(e.target.checked)} disabled={busy}/> Confirm cancellation and restore stock</label><button className="fc-account-switch" disabled={!cancel||busy||reason.trim().length<10} onClick={()=>void update('cancelled')}>Cancel order</button></>}
 </article>;
}

function AdminOrders({refresh,onSaved}:{refresh:number;onSaved:()=>void}) {
 const s=useAdminSearch(),[status,setStatus]=useState('all'),[kind,setKind]=useState('all'),[mode,setMode]=useState('all');
 const {data,error,loading}=useAdminData<{orders:Order[];total:number}>('/orders?q='+encodeURIComponent(s.q)+'&status='+status+'&kind='+kind+'&mode='+mode+'&page='+s.page,refresh);
 return <><p>Search every order by ID, buyer, produce or farm. Transit filters include partially delivered orders. Cancellation is blocked after collection or live courier assignment.</p><div className="ac-toolbar"><input aria-label="Search orders" placeholder="Order ID, buyer, farm or produce" maxLength={120} value={s.search} onChange={e=>s.setSearch(e.target.value)}/><select aria-label="Order status" value={status} onChange={e=>{setStatus(e.target.value);s.setPage(1);}}><option value="all">All statuses</option>{['placed','confirmed','packed','out_for_delivery','delivered','cancelled'].map(v=><option key={v} value={v}>{v==='out_for_delivery'?'In delivery / partially delivered':statusLabel[v]}</option>)}</select><select aria-label="Purchase type" value={kind} onChange={e=>{setKind(e.target.value);s.setPage(1);}}><option value="all">All buyers</option><option value="consumer">Consumers</option><option value="bulk_buyer">Bulk buyers</option></select><select aria-label="Delivery mode" value={mode} onChange={e=>{setMode(e.target.value);s.setPage(1);}}><option value="all">All modes</option><option value="demo">Demo delivery</option><option value="unconnected">Non-demo</option></select></div><LoadState loading={loading} error={error}/>{data&&<>{data.orders.map(o=><OrderActions key={o.id+o.status} order={o} onSaved={onSaved}/>)}{!data.orders.length&&<p>No orders match these filters.</p>}<Pager total={data.total} page={s.page} onPage={s.setPage}/></>}</>;
}
const tabs=[['overview','Overview',LayoutDashboard],['orders','Orders',ClipboardList],['catalog','Listings',Package],['applications','Reviews',ShieldCheck],['delivery','Delivery',Truck],['accounts','Accounts',Users],['operations','Operations',Settings],['help','Order support',ClipboardList],['productreviews','Product reviews',ShieldCheck],['activity','Activity',History]] as const;
export default function AdminPanel({onChanged}:{onChanged:()=>void}) {
 const [deliveryView,setDeliveryView]=useState('shipments'),[tab,setTab]=useState('overview'),[refresh,setRefresh]=useState(0),[notice,setNotice]=useState('');
 function saved(){setNotice('Change saved. Related workspaces receive the updated data.');setRefresh(n=>n+1);onChanged();}
 function navigate(value:string){setTab(value);setNotice('');}
 return <section className="fc-account fc-admin ac-console"><header className="ac-heading"><div><span className="fc-account-eyebrow">FARMCONNECT · ADMIN WORKSPACE</span><h2 id="dialog-title">A clear view. Better decisions.</h2><p>People, produce and every order — in one place.</p></div><button className="ac-refresh" onClick={()=>{setRefresh(n=>n+1);setNotice('');}}><RefreshCw size={16}/> Refresh</button></header><nav className="ac-nav" aria-label="Admin sections">{tabs.map(([key,label,Icon])=><button key={key} aria-pressed={tab===key} onClick={()=>navigate(key)}><Icon size={18}/><span>{label}</span></button>)}</nav>{notice&&<p className="ac-notice" role="status">{notice}</p>}<div className="ac-content">
 {tab==='overview'&&<AdminOverview refresh={refresh} onNavigate={navigate} onSaved={saved}/>}
 {tab==='orders'&&<AdminOrders refresh={refresh} onSaved={saved}/>}
 {tab==='catalog'&&<AdminCatalog refresh={refresh} onSaved={saved}/>}
 {tab==='applications'&&<ApprovalQueue key={refresh}/>}
 {tab==='delivery'&&<><div className="fc-admin-tabs"><button aria-pressed={deliveryView==='shipments'} onClick={()=>setDeliveryView('shipments')}>Shipment oversight</button><button aria-pressed={deliveryView==='partners'} onClick={()=>setDeliveryView('partners')}>Partner approvals & access</button></div>{deliveryView==='shipments'?<AdminShipments refresh={refresh}/>:<AdminDelivery refresh={refresh} onSaved={saved}/>}</>}
 {tab==='accounts'&&<AdminAccounts refresh={refresh} onSaved={saved}/>}
 {tab==='operations'&&<OperationsPanel key={refresh}/>}
 {tab==='help'&&<HelpCenter role="admin" refresh={refresh}/>}
 {tab==='productreviews'&&<ReviewModeration refresh={refresh} onSaved={saved}/>}
 {tab==='activity'&&<AdminActivity refresh={refresh}/>}
 </div></section>;
}
