import { useEffect, useRef, useState } from 'react';
export type Panel = 'product'|'saved'|'help'|'basket'|'location'|'account'|'checkout'|'orders'|'receipt'|'admin'|'farmer'|'business'|'access'|null;
const panels:Panel[]=['product','saved','help','basket','location','account','checkout','orders','receipt','admin','farmer','business','access'];
type View={panel:Panel;tab:'home'|'browse';productId:string};
function read():View {const params=new URLSearchParams(location.hash.slice(1)),panel=params.get('view') as Panel;return {panel:panels.includes(panel)?panel:null,tab:params.get('tab')==='browse'?'browse':'home',productId:params.get('product')??''};}
function url(view:View){const p=new URLSearchParams();if(view.tab==='browse')p.set('tab','browse');if(view.panel)p.set('view',view.panel);if(view.panel==='product'&&view.productId)p.set('product',view.productId);return location.pathname+location.search+(p.size?'#'+p:'');}
export function useStoreNavigation(blocked:boolean){
  const [view,setView]=useState(read),viewRef=useRef(view),blockedRef=useRef(blocked);
  const [mobile,setMobile]=useState(()=>matchMedia('(max-width:760px)').matches);
  blockedRef.current=blocked;viewRef.current=view;
  useEffect(()=>{const query=matchMedia('(max-width:760px)'),resize=()=>setMobile(query.matches);query.addEventListener('change',resize);return()=>query.removeEventListener('change',resize);},[]);
  useEffect(()=>{const pop=()=>{if(blockedRef.current){history.pushState({fcView:true},'',url(viewRef.current));return;}setView(read());};window.addEventListener('popstate',pop);window.addEventListener('hashchange',pop);return()=>{window.removeEventListener('popstate',pop);window.removeEventListener('hashchange',pop);};},[]);
  function change(next:View,replace=false){if(blockedRef.current&&next.panel!=='receipt')return;if(url(next)!==location.pathname+location.search+location.hash){if(replace)history.replaceState({fcView:true},'',url(next));else history.pushState({fcView:true},'',url(next));}viewRef.current=next;setView(next);}
  function back(){if(blockedRef.current)return;if(history.state?.fcView)history.back();else change({...viewRef.current,panel:null},true);}
  return {...view,mobile,back,setPanel:(panel:Panel,replace=false)=>change({...viewRef.current,panel},replace),setTab:(tab:'home'|'browse')=>{change({...viewRef.current,panel:null,tab});window.scrollTo({top:0,behavior:'instant'});},openProduct:(productId:string)=>change({...viewRef.current,productId,panel:'product'})};
}
