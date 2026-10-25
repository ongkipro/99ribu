'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Icon} from '../ui/icon';

export type FilterGroup={key:string;label:string;value:string;active:boolean;multi?:boolean;clear?:string;options:{label:string;href:string;selected:boolean}[]};
// shop.com listing filters (observed 2026-10-24): a scrolling rail of pill chips; each opens a
// 300px popover centred under it on desktop and a bottom sheet on phones (CSS only), with radio
// rows and Reset/Done. The rows are links to the same GET URLs the no-JS form submits, so a choice
// applies at once (owner decision, round 43); Reset clears this filter and Done closes. Escape and
// light dismiss close natively (popover="auto") and focus returns to the chip.
export function FilterChips({groups,clearAll}:{groups:FilterGroup[];clearAll?:string|null}){
 const row=useRef<HTMLFieldSetElement>(null),[open,setOpen]=useState<string|null>(null),[mounted,setMounted]=useState(false);
 // Choices render after hydration: the chips (fixed-height row) are server HTML, the option
 // lists are not, so no-JS pages and crawlers keep only the GET form and its links.
 useEffect(()=>setMounted(true),[]);
 // Edge fades only while the rail can scroll that way (shop.com's rail fade).
 useEffect(()=>{
  const root=row.current;if(!root) return;
  const update=()=>{root.toggleAttribute('data-fade-start',root.scrollLeft>1);root.toggleAttribute('data-fade-end',root.scrollLeft+root.clientWidth<root.scrollWidth-1);};
  update();root.addEventListener('scroll',update,{passive:true});const resize=new ResizeObserver(update);resize.observe(root);
  return ()=>{root.removeEventListener('scroll',update);resize.disconnect();};
 },[]);
 useEffect(()=>{
  const root=row.current;if(!root||!mounted) return;
  const chipOf=(pop:HTMLElement)=>root.querySelector<HTMLElement>(`[popovertarget="${pop.id}"].filter-chip`);
  // Desktop: the popover starts at its chip's left edge 5px under it (whole pixels), kept inside the page's
  // content column (`.wrap` minus its gutters, owner 2026-10-25) and the viewport; above the chip when it
  // would run off the bottom. Phones: the CSS bottom sheet (no inline position).
  const before=(event:Event)=>{
   const pop=event.target as HTMLElement,chip=chipOf(pop);if((event as ToggleEvent).newState!=='open'||!chip) return;
   if(matchMedia('(max-width: 700px)').matches){pop.style.removeProperty('left');pop.style.removeProperty('top');return;}
   const r=chip.getBoundingClientRect(),width=Math.min(300,innerWidth-32);
   const wrap=chip.closest('.wrap'),box=wrap?.getBoundingClientRect(),cs=wrap?getComputedStyle(wrap):null;
   const minLeft=Math.max(16,box&&cs?box.left+Number.parseFloat(cs.paddingLeft):16),maxRight=Math.min(innerWidth-16,box&&cs?box.right-Number.parseFloat(cs.paddingRight):innerWidth-16);
   pop.style.left=`${Math.round(Math.max(minLeft,Math.min(r.left,maxRight-width)))}px`;pop.style.top=`${Math.round(r.bottom+5)}px`;
  };
  const place=(event:Event)=>{
   const pop=event.target as HTMLElement,chip=chipOf(pop),opened=(event as ToggleEvent).newState==='open';
   setOpen(current=>opened?pop.id:current===pop.id?null:current);
   if(!opened||!chip||!pop.style.top) return;
   const r=chip.getBoundingClientRect(),height=pop.offsetHeight,above=Math.round(r.top-5-height);
   if(Math.round(r.bottom+5)+height>innerHeight-16&&above>=16) pop.style.top=`${above}px`;
  };
  // Keyboard: focus starts on the selected row; Up/Down/Home/End move between rows; typing
  // jumps to the next row starting with the typed letters; Tab reaches Reset and Done.
  let typed='',typedAt=0;
  const items=(pop:HTMLElement)=>[...pop.querySelectorAll<HTMLAnchorElement>('.filter-option')];
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
   else if(event.key==='Home'&&at>=0) go(0);
   else if(event.key==='End'&&at>=0) go(list.length-1);
   else if(event.key.length===1&&/\S/u.test(event.key)&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
    typed=event.timeStamp-typedAt<700?typed+event.key.toLocaleLowerCase('id'):event.key.toLocaleLowerCase('id');typedAt=event.timeStamp;
    const order=[...list.slice(at+1),...list.slice(0,at+1)],hit=order.find(a=>(a.textContent??'').trim().toLocaleLowerCase('id').startsWith(typed))??(typed.length>1?undefined:order.find(a=>(a.textContent??'').trim().toLocaleLowerCase('id').startsWith(typed[0])));
    if(hit){event.preventDefault();hit.focus();}
   }
  };
  const pops=[...root.querySelectorAll<HTMLElement>('[popover]')];
  for(const pop of pops){pop.addEventListener('beforetoggle',before);pop.addEventListener('toggle',place);pop.addEventListener('toggle',focusIn);pop.addEventListener('keydown',keys);}
  return ()=>{for(const pop of pops){pop.removeEventListener('beforetoggle',before);pop.removeEventListener('toggle',place);pop.removeEventListener('toggle',focusIn);pop.removeEventListener('keydown',keys);}};
 },[mounted]);
 const close=(event:React.MouseEvent<HTMLElement>)=>(event.currentTarget.closest('[popover]') as HTMLElement|null)?.hidePopover();
 return <fieldset ref={row} className="filter-chips"><legend className="sr-only">Filter dan urutan</legend>
  {groups.map(g=>{const id=`filter-pop-${g.key}`;return <div key={g.key} className="filter-chip-item">
   <button type="button" className="filter-chip" data-active={g.active||undefined} popoverTarget={id} aria-haspopup="dialog" aria-controls={id} aria-expanded={open===id} aria-label={`${g.label}: ${g.value}`}>
    <span>{g.key==='sort'||g.active?`${g.label}: ${g.value}`:g.label}</span><Icon name="down"/>
   </button>
   {/* An active filter is removed from its own chip (no second row of the same values). */}
   {g.active&&g.clear&&<Link className="filter-chip-clear" href={g.clear} prefetch={false} scroll={false} aria-label={`Hapus filter ${g.label}: ${g.value}`}><Icon name="close"/></Link>}
   {mounted&&<div id={id} popover="auto" className="filter-pop" role="dialog" aria-labelledby={`${id}-title`} data-multi={g.multi||undefined}>
    <div className="filter-pop-head"><p className="filter-pop-title" id={`${id}-title`}>{g.label}</p><button type="button" className="filter-pop-close" aria-label="Tutup" onClick={close}><Icon name="close"/></button></div>
    <ul>{g.options.map(o=><li key={o.href}><Link className="filter-option" href={o.href} prefetch={false} aria-current={o.selected?'true':undefined} scroll={false} onClick={close}><span>{o.label}</span><span className="filter-radio" aria-hidden="true">{g.multi&&o.selected&&<Icon name="check"/>}</span></Link></li>)}</ul>
    <div className="filter-pop-actions">
     {g.active&&g.clear?<Link className="filter-reset" href={g.clear} prefetch={false} scroll={false} onClick={close}>Atur ulang</Link>:<button type="button" className="filter-reset" disabled>Atur ulang</button>}
     <button type="button" className="filter-done" onClick={close}>Selesai</button>
    </div>
   </div>}
  </div>;})}
  {clearAll&&<Link className="filter-clear-all" href={clearAll} prefetch={false} scroll={false}>Hapus semua</Link>}
 </fieldset>;
}
