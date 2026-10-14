import { useEffect, useRef, useState } from 'react';
import { LocateFixed, MapPin } from 'lucide-react';
import { commerceRequest } from '../lib/commerce';
export type LocationSuggestion = {address:{line:string;city:string;pincode:string};serviceable:boolean};
export default function LocationAssist({onApply,disabled=false,pickup=false}:{onApply:(value:LocationSuggestion)=>void;disabled?:boolean;pickup?:boolean}) {
 const [config,setConfig]=useState<{addressLookup:boolean}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[suggestion,setSuggestion]=useState<LocationSuggestion|null>(null);
 const attempt=useRef(0);
 useEffect(()=>{let active=true;commerceRequest<{addressLookup:boolean}>('/location/config').then(value=>{if(active)setConfig(value);}).catch(()=>{});return()=>{active=false;attempt.current++;};},[]);
 useEffect(()=>{if(disabled){attempt.current++;setBusy(false);setSuggestion(null);}},[disabled]);
 async function locate(){
  if(disabled||busy)return;
  const id=++attempt.current;setMessage('');setSuggestion(null);
  if(!window.isSecureContext||!navigator.geolocation){setMessage('Location needs HTTPS or localhost and a supported browser. You can enter the address below.');return;}
  setBusy(true);
  try{
   const settings=config??await commerceRequest<{addressLookup:boolean}>('/location/config');
   if(id!==attempt.current)return;setConfig(settings);
   const position=await new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:12000,maximumAge:0}));
   if(id!==attempt.current)return;
   const accuracy=Math.round(position.coords.accuracy);
   if(!settings.addressLookup){setMessage(`Location detected (approximately ${accuracy} m accuracy). Automatic address lookup is not connected yet. Enter your address below.`);return;}
   const result=await commerceRequest<LocationSuggestion>('/location/reverse',{latitude:position.coords.latitude,longitude:position.coords.longitude});
   if(id!==attempt.current)return;
   setSuggestion(result);setMessage(`Approximate location · ${accuracy} m accuracy. Check your house/farm number and pincode before saving.`);
  }catch(e){if(id!==attempt.current)return;const code=(e as {code?:number})?.code;setMessage(code===1?'Location permission was denied. Allow it in your browser or app settings, or enter your address below.':code===2?'Your device could not determine its location. Check location settings or enter your address below.':code===3?'Location detection timed out. Try again or enter your address below.':e instanceof Error?e.message:'Location unavailable. Enter your address below.');}
  finally{if(id===attempt.current)setBusy(false);}
 }
 return <div className="fc-locate">
  <div className="fc-locate-heading"><LocateFixed size={23}/><div><strong>{pickup?'Find your farm location':'Find your address'}</strong><small>When address lookup is connected, your location is sent to Geoapify through Farmconnect. Review the suggestion before saving. No background tracking.</small></div></div>
  {config&&!config.addressLookup&&<p>Automatic address suggestions are unavailable. You can enter your address below.</p>}
  <button type="button" className="fc-profile-outline" disabled={busy||disabled} onClick={()=>void locate()}>{busy?'Finding your location…':'Use my location'}</button>
  {busy&&<button type="button" className="fc-account-switch" onClick={()=>{attempt.current++;setBusy(false);setMessage('Location lookup cancelled. You can enter the address manually.');}}>Cancel lookup</button>}
  {message&&<p role="status">{message}</p>}
  {suggestion&&<div className="fc-location-result"><MapPin size={20}/><div><strong>{suggestion.address.line||'Nearby area'}</strong><p>{suggestion.address.city} {suggestion.address.pincode}</p><small>{pickup?'Confirm this is the pickup location. Detection does not verify farm ownership.':suggestion.serviceable?'Delivery is available for this pincode.':'Delivery is not currently available for this pincode.'}</small><button type="button" className="fc-primary" disabled={disabled} onClick={()=>{onApply(suggestion);setSuggestion(null);setMessage('Suggestion applied. Complete the address and save to confirm.');}}>Use this suggestion</button></div></div>}
  {config?.addressLookup&&<small className="fc-location-credit">Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></small>}
 </div>;
}
