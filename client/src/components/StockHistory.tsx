import {useEffect,useState} from 'react';
import {History,ChevronDown} from 'lucide-react';
import {marketplaceRequest} from '../lib/marketplace';
type Adjustment={id:number;saleMode:string;change:number;previousStock:number;newStock:number;reason:string;createdAt:number};
type Page={adjustments:Adjustment[];nextCursor:number|null};
function amount(value:number,mode:string){return (value/(mode==='weight'?1000:1)).toLocaleString('en-IN',{maximumFractionDigits:3})+(mode==='weight'?' kg':' packs');}
export default function StockHistory({productId}:{productId:string}){
 const [open,setOpen]=useState(false),[rows,setRows]=useState<Adjustment[]>([]),[cursor,setCursor]=useState<number|null>(null),[next,setNext]=useState<number|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{if(!open)return;let active=true;setLoading(true);setError('');
  marketplaceRequest<Page>('/products/'+productId+'/stock-history'+(cursor?'?before='+cursor:'')).then(page=>{if(active){setRows(previous=>cursor?[...previous,...page.adjustments]:page.adjustments);setNext(page.nextCursor);}}).catch(failure=>{if(active)setError(failure.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[open,cursor,productId,attempt]);
 function toggle(){if(!open){setRows([]);setCursor(null);setNext(null);}setOpen(!open);}
 return <section className="fp-stock-history"><button type="button" className="fp-history-toggle" aria-expanded={open} onClick={toggle}><History size={14}/>Stock history<ChevronDown size={14}/></button>{open&&<div><p>Manual stock adjustments. Order deductions and cancellations are not listed here.</p>{rows.length>0&&<ol>{rows.map(row=><li key={row.id}><div><strong className={row.change>0?'fp-stock-added':'fp-stock-reduced'}>{row.change>0?'+':'−'}{amount(Math.abs(row.change),row.saleMode)}</strong><time dateTime={new Date(row.createdAt).toISOString()}>{new Date(row.createdAt).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</time></div><p>{amount(row.previousStock,row.saleMode)} → {amount(row.newStock,row.saleMode)}</p><span>{row.reason}</span></li>)}</ol>}{loading&&<p role="status">Loading history…</p>}{error&&<p role="alert">{error} <button type="button" onClick={()=>setAttempt(n=>n+1)}>Retry</button></p>}{!loading&&!error&&!rows.length&&<p>No manual stock changes recorded yet.</p>}{next&&!loading&&!error&&<button type="button" className="fp-history-more" onClick={()=>setCursor(next)}>Load older changes</button>}</div>}</section>;
}
