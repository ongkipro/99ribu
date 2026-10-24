'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';

// Listing infinite scroll (shop.com observed 2026-10-24: the next page loads about half a screen
// before the end with a short loading row, no button, URL unchanged). The server page keeps the
// crawlable rel="next" link (no-JS users and crawlers); with this island mounted it is hidden by
// CSS. Each next page is fetched as the same server-rendered listing URL and its cards are
// appended, so there is no second card renderer and no new API. After AUTO pages the footer
// stays reachable: loading continues only through "Lihat produk lainnya".
const AUTO=3,KEEP=20,SKELETON=['a','b','c','d','e','f','g','h'];
type Saved={pages:string[];next:string|null;scroll:number};
const keyOf=()=>`listing:${location.pathname}${location.search}`;
// Card links carry the listing URL as their Back target; appended pages come from cursor URLs,
// so their Back target is reset to this listing URL (where the pages are restored) plus the card anchor.
function adopt(html:string){
 const doc=new DOMParser().parseFromString(`<ul>${html}</ul>`,'text/html');
 for(const a of doc.querySelectorAll<HTMLAnchorElement>('a.product-link')){
  const url=new URL(a.getAttribute('href')??'',location.origin),id=a.closest('li')?.id;
  if(url.searchParams.has('from')&&id){url.searchParams.set('from',`${location.pathname}${location.search}#${id}`);a.setAttribute('href',`${url.pathname}${url.search}`);}
 }
 return doc.body.firstElementChild?.innerHTML??'';
}
export function ListingMore({next:first}:{next:string|null}){
 const [pages,setPages]=useState<string[]>([]),[next,setNext]=useState(first),[state,setState]=useState<'idle'|'loading'|'error'>('idle');
 const [status,setStatus]=useState(''),[mounted,setMounted]=useState(false),[columns,setColumns]=useState(6);
 const sentinel=useRef<HTMLDivElement>(null),busy=useRef(false);
 useLayoutEffect(()=>{
  setMounted(true);
  // Restore on Back/forward (entry marked in history) or when the URL names a product that only
  // a saved page holds (the PDP's Back link: /cari?…#product-<id>). Any other visit starts fresh.
  let saved:Saved|null=null;try{saved=JSON.parse(sessionStorage.getItem(keyOf())??'null');}catch{}
  const target=decodeURIComponent(location.hash.slice(1));
  const wanted=Boolean(saved?.pages.length)&&(window.history.state?.listingPages||(target.startsWith('product-')&&!document.getElementById(target)&&saved?.pages.some(html=>html.includes(`id="${target}"`))));
  if(!wanted){try{sessionStorage.removeItem(keyOf());}catch{}return;}
  try{if(saved?.pages.length){setPages(saved.pages);setNext(saved.next);window.history.replaceState({...window.history.state,listingPages:true},'');
   requestAnimationFrame(()=>{const target=location.hash?document.getElementById(location.hash.slice(1)):null;if(target)target.scrollIntoView({block:'center'});else window.scrollTo(0,saved.scroll);});}}catch{}
 },[]);
 const save=useCallback((p:string[],n:string|null)=>{
  try{sessionStorage.setItem(keyOf(),JSON.stringify({pages:p.slice(-KEEP),next:n,scroll:Math.round(scrollY)} satisfies Saved));window.history.replaceState({...window.history.state,listingPages:true},'');}catch{}
 },[]);
 useEffect(()=>{if(!pages.length) return;const keep=()=>save(pages,next);addEventListener('pagehide',keep);document.addEventListener('click',keep,true);return ()=>{removeEventListener('pagehide',keep);document.removeEventListener('click',keep,true);};},[pages,next,save]);
 const load=useCallback(async()=>{
  if(!next||busy.current) return;busy.current=true;
  const grid=sentinel.current?.closest('.listing-grid');if(grid) setColumns(getComputedStyle(grid).gridTemplateColumns.split(' ').length);
  setState('loading');
  try{
   const response=await fetch(next,{headers:{accept:'text/html'}});if(!response.ok) throw new Error(String(response.status));
   const doc=new DOMParser().parseFromString(await response.text(),'text/html');
   const seen=new Set([...document.querySelectorAll('.listing-grid li.product')].map(li=>li.id));
   const items=[...doc.querySelectorAll('.listing-grid > .product-grid > li.product')].filter(li=>!seen.has(li.id));
   const html=adopt(items.map(li=>li.outerHTML).join('')),following=doc.querySelector<HTMLAnchorElement>('a[rel="next"]')?.getAttribute('href')??null;
   const all=[...pages,html];setPages(all);setNext(following);save(all,following);setState('idle');
   setStatus(items.length?`${items.length} produk lagi dimuat.${following?'':' Semua produk sudah tampil.'}`:'Semua produk sudah tampil.');
  }catch{setState('error');setStatus('Produk berikutnya belum dapat dimuat.');}
  finally{busy.current=false;}
 },[next,pages,save]);
 const auto=pages.length<AUTO;
 useEffect(()=>{
  const el=sentinel.current;if(!el||!next||!auto||state!=='idle') return;
  const io=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)) load();},{rootMargin:'0px 0px 100% 0px'});
  io.observe(el);return ()=>io.disconnect();
 },[next,auto,state,load]);
 return <div className="listing-more" data-mounted={mounted||undefined}>
  {pages.map((html,i)=>
   // biome-ignore lint/security/noDangerouslySetInnerHtml: same-origin card markup from this listing's own server-rendered next page (product names are escaped by React there).
   <ul key={/id="(product-[^"]+)"/.exec(html)?.[1]??`page-${i}`} className="product-grid" data-page={i+2} dangerouslySetInnerHTML={{__html:html}}/>)}
  {state==='loading'&&<ul className="product-grid listing-skeleton" aria-hidden="true">{SKELETON.slice(0,columns).map(k=><li key={k} className="product"><span className="product-frame"/><span className="skeleton-line"/><span className="skeleton-line short"/></li>)}</ul>}
  <p className="sr-only" role="status" aria-live="polite">{status}</p>
  {state==='error'&&<div className="listing-end"><p>Produk berikutnya belum dapat dimuat.</p><button type="button" className="listing-more-button" onClick={load}>Coba lagi</button></div>}
  {next&&!auto&&state==='idle'&&<div className="listing-end"><button type="button" className="listing-more-button" onClick={load}>Lihat produk lainnya</button></div>}
  {next&&<div ref={sentinel} className="listing-sentinel" aria-hidden="true"/>}
 </div>;
}
