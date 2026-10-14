import { useEffect,useState } from 'react';
import { commerceRequest } from '../lib/commerce';
export default function ConnectionStatus(){
  const [offline,setOffline]=useState(!navigator.onLine);
  const [hostedDemo,setHostedDemo]=useState(false);
  useEffect(()=>{let active=true;commerceRequest<{appMode?:string}>('/store/config').then(config=>{if(active)setHostedDemo(config.appMode==='demo');}).catch(()=>{});return()=>{active=false;};},[]);
  useEffect(()=>{const update=()=>setOffline(!navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  return <>{hostedDemo&&<div style={{background:'#e6f2cd',color:'#244431',padding:'9px 16px',fontSize:12,textAlign:'center',lineHeight:1.5}}>Demo marketplace · Orders are for testing. No real payments or deliveries.</div>}{offline&&<div className="fc-offline" role="status">You’re offline. Reconnect before saving changes or placing an order.</div>}</>;
}
