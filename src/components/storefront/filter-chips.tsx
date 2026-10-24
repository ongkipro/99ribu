'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Icon} from './icon';

export type FilterGroup={key:string;label:string;value:string;active:boolean;multi?:boolean;clear?:string;options:{label:string;href:string;selected:boolean}[]};
// shop.com listing filters (observed 2026-10-24): a row of pill chips, each opening its choices.
// Each chip is a popover invoker (Escape and light dismiss close it, focus returns to the chip);
// the choices are links, so choosing one navigates at once with the same GET parameters as the
// no-JS form. Desktop anchors the popover to the chip's left edge on whole pixels (flipped to
// the right edge near the viewport end); phones show it as a bottom sheet (CSS only).
export function FilterChips({groups,clearAll}:{groups:FilterGroup[];clearAll?:string|null}){
 const row=useRef<HTMLFieldSetElement>(null),[open,setOpen]=useState<string|null>(null),[mounted,setMounted]=useState(false);
 // Choices render after hydration: the chips (fixed-height row) are server HTML, the option
 // lists are not, so no-JS pages and crawlers keep only the GET form and its links.
 useEffect(()=>setMounted(true),[]);
 useEffect(()=>{
  const root=row.current;if(!root||!mounted) return;
  // Before it shows: anchor at the chip's left edge, 8px below, on whole pixels. Once it is
  // open (size known): flip to the chip's right edge or above it when it would leave the viewport.
  const chipOf=(pop:HTMLElement)=>root.querySelector<HTMLElement>(`[popovertarget="${pop.id}"]`);
  const before=(event:Event)=>{
   const pop=event.target as HTMLElement,chip=chipOf(pop);if((event as ToggleEvent).newState!=='open'||!chip) return;
   if(matchMedia('(max-width: 700px)').matches){pop.style.removeProperty('left');pop.style.removeProperty('top');return;}
   const r=chip.getBoundingClientRect();pop.style.minWidth=`${Math.round(r.width)}px`;pop.style.left=`${Math.round(r.left)}px`;pop.style.top=`${Math.round(r.bottom+4)}px`;
  };
  const after=(event:Event)=>{
   const pop=event.target as HTMLElement,chip=chipOf(pop),opened=(event as ToggleEvent).newState==='open';
   setOpen(current=>opened?pop.id:current===pop.id?null:current);
   if(!opened||!chip||!pop.style.left) return;
   // Whole-pixel box: round the content-sized width up, so the right edge and border are crisp too.
   pop.style.width='';const r=chip.getBoundingClientRect(),width=Math.ceil(pop.getBoundingClientRect().width),height=pop.offsetHeight;pop.style.width=`${width}px`;
   if(Math.round(r.left)+width>innerWidth-16) pop.style.left=`${Math.max(16,Math.round(r.right-width))}px`;
   if(Math.round(r.bottom+4)+height>innerHeight-16&&r.top-4-height>=16){pop.style.top=`${Math.round(r.top-4-height)}px`;pop.style.transformOrigin='bottom left';}else pop.style.transformOrigin='';
  };
  // Keyboard (shadcn Select): focus starts on the selected choice; Up/Down/Home/End move it;
  // typing jumps to the next choice starting with the typed letters; Tab closes (focus returns
  // to the chip, then moves on). Escape and outside clicks close natively (popover="auto").
  let typed='',typedAt=0;
  const items=(pop:HTMLElement)=>[...pop.querySelectorAll<HTMLAnchorElement>('.filter-option:not([aria-disabled="true"])')];
  const focusIn=(event:Event)=>{
   const pop=event.target as HTMLElement;if((event as ToggleEvent).newState!=='open') return;
   const list=items(pop);(list.find(a=>a.getAttribute('aria-current'))??list[0])?.focus({preventScroll:true});
  };
  const keys=(event:KeyboardEvent)=>{
   const pop=(event.target as HTMLElement).closest<HTMLElement>('[popover]');if(!pop) return;
   const list=items(pop),at=list.indexOf(document.activeElement as HTMLAnchorElement);
   const go=(i:number)=>{event.preventDefault();list[(i+list.length)%list.length]?.focus();};
   if(event.key==='ArrowDown') go(at+1);
   else if(event.key==='ArrowUp') go(at<0?list.length-1:at-1);
   else if(event.key==='Home') go(0);
   else if(event.key==='End') go(list.length-1);
   else if(event.key==='Tab') pop.hidePopover();
   else if(event.key.length===1&&/\S/u.test(event.key)&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
    typed=event.timeStamp-typedAt<700?typed+event.key.toLocaleLowerCase('id'):event.key.toLocaleLowerCase('id');typedAt=event.timeStamp;
    const order=[...list.slice(at+1),...list.slice(0,at+1)],hit=order.find(a=>(a.textContent??'').trim().toLocaleLowerCase('id').startsWith(typed))??(typed.length>1?undefined:order.find(a=>(a.textContent??'').trim().toLocaleLowerCase('id').startsWith(typed[0])));
    if(hit){event.preventDefault();hit.focus();}
   }
  };
  const pops=[...root.querySelectorAll<HTMLElement>('[popover]')];
  for(const pop of pops){pop.addEventListener('beforetoggle',before);pop.addEventListener('toggle',after);pop.addEventListener('toggle',focusIn);pop.addEventListener('keydown',keys);}
  return ()=>{for(const pop of pops){pop.removeEventListener('beforetoggle',before);pop.removeEventListener('toggle',after);pop.removeEventListener('toggle',focusIn);pop.removeEventListener('keydown',keys);}};
 },[mounted]);
 return <fieldset ref={row} className="filter-chips"><legend className="sr-only">Filter dan urutan</legend>
  {groups.map(g=>{const id=`filter-pop-${g.key}`;return <div key={g.key} className="filter-chip-item">
   <button type="button" className="filter-chip" data-active={g.active||undefined} popoverTarget={id} aria-haspopup="dialog" aria-controls={id} aria-expanded={open===id} aria-label={`${g.label}: ${g.value}`}>
    <span>{g.key==='sort'||g.active?`${g.label}: ${g.value}`:g.label}</span><Icon name="down"/>
   </button>
   {/* An active filter is removed from its own chip (no second row of the same values). */}
   {g.active&&g.clear&&<Link className="filter-chip-clear" href={g.clear} prefetch={false} scroll={false} aria-label={`Hapus filter ${g.label}: ${g.value}`}><Icon name="close"/></Link>}
   {mounted&&<div id={id} popover="auto" className="filter-pop" role="dialog" aria-labelledby={`${id}-title`}>
    <p className="filter-pop-title" id={`${id}-title`}>{g.label}</p>
    <ul>{g.options.map((o,i)=><li key={o.href} className={i===1&&!g.multi&&g.key!=='sort'?'filter-separated':undefined}><Link className="filter-option" href={o.href} prefetch={false} aria-current={o.selected?'true':undefined} scroll={false} onClick={event=>(event.currentTarget.closest('[popover]') as HTMLElement|null)?.hidePopover()}><span>{o.label}</span>{o.selected&&<Icon name="check"/>}</Link></li>)}</ul>
   </div>}
  </div>;})}
  {clearAll&&<Link className="filter-clear-all" href={clearAll} prefetch={false} scroll={false}>Hapus semua</Link>}
 </fieldset>;
}
