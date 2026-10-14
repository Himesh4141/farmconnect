import StockHistory from './StockHistory';
import {useState} from 'react';
import {Plus, X} from 'lucide-react';
import {marketplaceRequest,type FarmerProduct} from '../lib/marketplace';
export default function RestockProduct({product,onSaved,disabled}:{product:FarmerProduct;onSaved:(updated:FarmerProduct)=>void;disabled:boolean}){
 const [open,setOpen]=useState(false),[amount,setAmount]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [action,setAction]=useState<'add'|'remove'>('add'),[reason,setReason]=useState('');
 const weight=product.saleMode==='weight',factor=weight?1000:1,unit=weight?'kg':'packs';
 const valid=(weight?/^\d+(\.\d{1,3})?$/:/^\d+$/).test(amount)&&Number(amount)>0;
 const addition=Math.round(Number(amount)*factor),maximum=weight?1000000000:1000000;
 const delta=action==='remove'?-addition:addition,after=product.stock+delta;
 const canSave=valid&&Number.isSafeInteger(addition)&&after>=0&&after<=maximum&&(action==='add'||reason.trim().length>=8&&reason.trim().length<=200);
 async function save(){
  if(busy||disabled)return;
  if(!canSave){
   setError(!valid||!Number.isSafeInteger(addition)?'Enter a number greater than zero'+(weight?' in kg (for example 2.5). Do not type kg in the box.':', using whole packs only.'):
    after<0?'You cannot remove more than the available '+(product.stock/factor)+' '+unit+'.':
    after>maximum?'This quantity exceeds the stock limit.':
    'For a reduction, enter a reason of at least 8 characters, such as Damaged produce.');
   return;
  }
  setBusy(true);setError('');
  try{const result=await marketplaceRequest<{product:FarmerProduct}>('/products/'+product.id+'/restock',{amount:addition,revision:product.revision,action,reason});setOpen(false);setAmount('');setReason('');onSaved(result.product);}
  catch(failure){setError(failure instanceof Error?failure.message:'Could not add stock. Refresh before retrying.');}
  finally{setBusy(false);}
 }
 return <div className="fp-restock">{!open?<button type="button" disabled={disabled} className="fp-restock-trigger" onClick={()=>{setError('');setOpen(true);}}><Plus size={15}/>Manage stock</button>:<form noValidate onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy||disabled}><div className="fp-restock-heading"><strong>Manage available stock</strong><button type="button" aria-label="Close stock form" onClick={()=>{setOpen(false);setAmount('');}}><X size={16}/></button></div><label>Action<select value={action} onChange={e=>{setAction(e.target.value as 'add'|'remove');setError('');}}><option value="add">Add harvested stock</option><option value="remove">Reduce unavailable stock</option></select></label><label>{unit} to {action==='add'?'add':'remove'}<input autoFocus inputMode={weight?'decimal':'numeric'} value={amount} maxLength={12} placeholder={weight?'e.g. 25.5':'e.g. 20'} onChange={e=>{setAmount(e.target.value.trim());setError('');}}/></label><p>{product.stock/factor} {unit} available{valid&&Number.isSafeInteger(addition)&&after>=0&&after<=maximum&&<> → <strong>{Number((after/factor).toFixed(3))} {unit}</strong> after saving</>}</p>{action==='remove'&&<label>Reason for reduction (at least 8 characters)<textarea rows={2} required minLength={8} maxLength={200} value={reason} placeholder="e.g. 3 kg damaged during sorting" onChange={e=>setReason(e.target.value)}/></label>}<small>Enter the amount to add or remove, not the new total. Existing orders stay unchanged. For a new harvest, also update freshness details in Edit listing.</small>{error&&<p role="alert" className="fc-order-error">{error}</p>}<button type="submit" className="fc-primary" disabled={busy||disabled}>{busy?'Saving…':action==='add'?'Add stock':'Reduce stock'}</button></fieldset></form>}<StockHistory key={product.id+':'+product.revision} productId={product.id}/></div>;
}
