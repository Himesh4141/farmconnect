import { useEffect, useState } from 'react';
export type Portal='store'|'farmer'|'delivery';
export async function securityRequest(path:string,portal:Portal,body?:object) {
  const response=await fetch('/api/auth/'+(portal==='store'?'':portal+'/')+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'Please try again.');return result;
}
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export default function GoogleSignIn({portal='store',link=false}:{portal?:Portal;link?:boolean}) {
  const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let active=true;fetch('/api/auth/google/config').then(r=>r.json()).then(c=>{if(active)setEnabled(c.enabled);}).catch(()=>{});return()=>{active=false;};},[]);
  async function start(){
    setBusy(true);setError('');
    try{
      const verifier=encode(crypto.getRandomValues(new Uint8Array(32)));
      const challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
      sessionStorage.setItem('farmconnect.oauth.verifier',verifier);
      const result=await securityRequest('google/prepare','store',{portal,link,challenge,mobile:navigator.userAgent.includes('FarmconnectAndroid/')});
      window.location.assign(result.url);
    }catch(e){setError(e instanceof Error?e.message:'Could not open Google.');setBusy(false);}
  }
  return <div className="fc-google"><button type="button" disabled={!enabled||busy} onClick={()=>void start()}><span className="fc-google-mark" aria-hidden="true">G</span>{busy?'Opening Google…':link?'Connect Google account':'Continue with Google'}</button>{!enabled&&<small>Google sign-in will be available after the project owner connects Google.</small>}{error&&<p className="fc-order-error" role="alert">{error}</p>}</div>;
}
export function GoogleReturn() {
  const [message,setMessage]=useState(''),[failed,setFailed]=useState(false);
  useEffect(()=>{
    const url=new URL(location.href), ticket=url.searchParams.get('oauth_ticket'),failure=url.searchParams.get('google_error');
    if(!ticket&&!failure)return;
    history.replaceState(null,'',location.pathname);
    if(failure){setFailed(true);setMessage('Google sign-in was cancelled or failed. Please try again.');return;}
    const verifier=sessionStorage.getItem('farmconnect.oauth.verifier');sessionStorage.removeItem('farmconnect.oauth.verifier');
    if(!verifier){setFailed(true);setMessage('Start Google sign-in again in this browser or app.');return;}
    setMessage('Completing secure Google sign-in…');
    void securityRequest('google/complete','store',{ticket,verifier}).then(result=>location.replace(result.path)).catch(e=>{setFailed(true);setMessage(e.message);});
  },[]);
  return message?<div className="fc-auth-return" role={failed?'alert':'status'}><p>{message}</p>{failed&&<button onClick={()=>setMessage('')}>Dismiss</button>}</div>:null;
}
