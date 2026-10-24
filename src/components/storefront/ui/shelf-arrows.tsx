'use client';
import {useEffect,useRef,useState} from 'react';
import {Icon} from './icon';

// shop.com desktop carousel arrows. Rendered only after hydration (no dead controls without JS);
// each press scrolls one view of whole cards, and an arrow is disabled at its end of the row.
const rowOf=(anchor:HTMLElement|null)=>anchor?.parentElement?.querySelector<HTMLElement>('.shelf-row, .banner-row, .gallery-row')??null;
export function ShelfArrows({noun='Produk'}:{noun?:string}){
 const anchor=useRef<HTMLSpanElement>(null),[edge,setEdge]=useState<{start:boolean;end:boolean}|null>(null);
 useEffect(()=>{
  const row=rowOf(anchor.current);if(!row) return;
  const update=()=>setEdge({start:row.scrollLeft<=1,end:row.scrollLeft+row.clientWidth>=row.scrollWidth-1});
  update();row.addEventListener('scroll',update,{passive:true});const resize=new ResizeObserver(update);resize.observe(row);
  return ()=>{row.removeEventListener('scroll',update);resize.disconnect();};
 },[]);
 const go=(direction:1|-1)=>{const row=rowOf(anchor.current);if(!row) return;
  row.scrollBy({left:direction*row.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});};
 return <span ref={anchor} hidden={!edge}>{edge&&<>
  <button type="button" className="shelf-arrow" data-side="previous" aria-label={`${noun} sebelumnya`} disabled={edge.start} onClick={()=>go(-1)}><Icon name="chevron"/></button>
  <button type="button" className="shelf-arrow" data-side="next" aria-label={`${noun} berikutnya`} disabled={edge.end} onClick={()=>go(1)}><Icon name="forward"/></button>
 </>}</span>;
}
