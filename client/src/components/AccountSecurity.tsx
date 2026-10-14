import { useEffect, useState } from 'react';
import { ShieldCheck, Smartphone, KeyRound } from 'lucide-react';
import GoogleSignIn,{securityRequest,type Portal} from './GoogleSignIn';
type Security={sessions:{id:string|null;device:string;createdAt:number|null;expiresAt:number;current:boolean}[];events:{event:string;createdAt:number}[];googleLinked:boolean;passwordEnabled:boolean};
export default function AccountSecurity({portal='store'}:{portal?:Portal}) {
  const [data,setData]=useState<Security|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[current,setCurrent]=useState(''),[next,setNext]=useState('');
  async function load(){setData(await securityRequest('security',portal));}
  useEffect(()=>{void load().catch(e=>setError(e.message));},[portal]);
  async function action(path:string,body:object){setBusy(true);setError('');setNotice('');try{await securityRequest(path,portal,body);setCurrent('');setNext('');setNotice(path==='password'?'Password updated. Other sessions were signed out.':'Other sessions signed out.');await load();}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
  return <details className="fc-security"><summary><ShieldCheck size={19}/>Account security</summary><div className="fc-security-body">{error&&<p role="alert" className="fc-order-error">{error}</p>}{notice&&<p role="status">{notice}</p>}{data&&<>
    <h3>Sign-in methods</h3>{data.googleLinked?<p>✓ Google account connected</p>:<GoogleSignIn portal={portal} link/>}
    {data.passwordEnabled&&<form onSubmit={e=>{e.preventDefault();void action('password',{currentPassword:current,newPassword:next});}}><fieldset disabled={busy}><h3><KeyRound size={18}/>Change password</h3><label>Current password<input type="password" required maxLength={128} autoComplete="current-password" value={current} onChange={e=>setCurrent(e.target.value)}/></label><label>New password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={next} onChange={e=>setNext(e.target.value)}/></label><button className="fc-primary">{busy?'Saving…':'Update password'}</button></fieldset></form>}
    <h3><Smartphone size={18}/>Signed-in devices</h3>{data.sessions.map((s,i)=><div className="fc-session" key={s.id||i}><strong>{s.device}{s.current?' · This session':''}</strong><small>{s.createdAt?'Signed in '+new Date(s.createdAt).toLocaleString():'Existing session'} · Expires {new Date(s.expiresAt).toLocaleDateString()}</small></div>)}<button disabled={busy} onClick={()=>void action('revoke-others',{})}>Sign out all other sessions</button><small>This also signs out your other Farmconnect tabs and devices for this account.</small>
    <h3>Recent security activity</h3>{data.events.map((event,i)=><div className="fc-session" key={i}><span>{event.event}</span><small>{new Date(event.createdAt).toLocaleString()}</small></div>)}{!data.events.length&&<p>No recent security events.</p>}
  </>}</div></details>;
}
