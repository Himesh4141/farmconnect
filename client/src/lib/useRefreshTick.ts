import { useEffect, useState } from 'react';
// Refresh active screens quietly and immediately when returning to their tab.
export function useRefreshTick(enabled=true) {
  const [tick,setTick]=useState(0);
  useEffect(()=>{
    if(!enabled)return;
    const refresh=()=>{if(document.visibilityState==='visible')setTick(n=>n+1);};
    const timer=window.setInterval(refresh,5000);
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[enabled]);
  return tick;
}
