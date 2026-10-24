'use client';
import {type ReactNode,useEffect,useId,useRef,useState} from 'react';
import {CatalogImage} from '../ui/media';

// shop.com home "category switcher" (observed 2026-10-23): one row of very large department
// names, the selected one in ink with a product medallion over it, its products underneath.
// Server HTML is a row of links to /kategori/<slug> plus the first panel, so it works without
// JS; after hydration the links become WAI-ARIA tabs (roving tabindex, arrows/Home/End).
// No infinite loop (YAGNI): the row scrolls natively and the selected tab is centred.
export type SwitcherTab={id:string;slug:string;name:string;photo:{src:string;width:number;height:number}|null};
function centreTab(box:HTMLElement|null,index:number,behavior:ScrollBehavior){
 const tab=box?.querySelectorAll<HTMLElement>('[role="tab"]')[index];
 if(box&&tab) box.scrollTo({left:tab.offsetLeft+tab.offsetWidth/2-box.clientWidth/2,behavior});
}
export function CategorySwitcher({label,tabs,panels}:{label:string;tabs:SwitcherTab[];panels:ReactNode[]}){
 const [enhanced,setEnhanced]=useState(false),[selected,setSelected]=useState(0),id=useId(),row=useRef<HTMLDivElement>(null);
 useEffect(()=>setEnhanced(true),[]);
 // On a switch, centre the chosen tab inside the row (only the row scrolls, never the page). On
 // load the first tab starts at the row's start so the row never opens on an empty band.
 const centre=(index:number,behavior:ScrollBehavior)=>centreTab(row.current,index,behavior);
 const select=(index:number,focus:boolean)=>{setSelected(index);const tab=row.current?.querySelectorAll<HTMLElement>('[role="tab"]')[index];if(!tab) return;
  if(focus) tab.focus({preventScroll:true});
  centre(index,matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth');};
 // Every medallion is lazy: the switcher sits below the first screen, so an eager medallion
 // would compete with the above-the-fold shelf photo (the phone LCP).
 const art=(tab:SwitcherTab)=>tab.photo&&<span className="switcher-art" aria-hidden="true">
  <CatalogImage src={tab.photo.src} sizes="(max-width: 700px) 56px, 112px" max={256} min={64} alt="" width={tab.photo.width} height={tab.photo.height} loading="lazy" referrerPolicy="no-referrer"/></span>;
 return <div className="category-switcher">
  <div ref={row} className="switcher-row" {...(enhanced?{role:'tablist','aria-label':label}:{})}>
   {tabs.map((tab,index)=>enhanced
    ?<button key={tab.id} type="button" role="tab" id={`${id}-tab-${index}`} aria-selected={index===selected} aria-controls={`${id}-panel-${index}`} tabIndex={index===selected?0:-1}
      onClick={()=>select(index,false)} onKeyDown={e=>{const last=tabs.length-1,next={ArrowRight:selected===last?0:selected+1,ArrowLeft:selected===0?last:selected-1,Home:0,End:last}[e.key];
       if(next!==undefined){e.preventDefault();select(next,true);}}}>{art(tab)}<span className="switcher-label">{tab.name}</span></button>
    :<a key={tab.id} href={`/kategori/${tab.slug}`} aria-current={index===0?'true':undefined}>{art(tab)}<span className="switcher-label">{tab.name}</span></a>)}
  </div>
  {panels.map((panel,index)=><div key={tabs[index].id} className="switcher-panel" id={`${id}-panel-${index}`} {...(enhanced?{role:'tabpanel','aria-labelledby':`${id}-tab-${index}`}:{})} hidden={index!==selected}>{panel}</div>)}
 </div>;
}
