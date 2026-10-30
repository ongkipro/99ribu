'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';

// Listing infinite scroll (shop.com observed 2026-10-24: the next page loads about half a screen
// before the end with a short loading row, no button, URL unchanged). The server page keeps the
// crawlable rel="next" link (no-JS users and crawlers); with this island mounted it is hidden by
// CSS. Each next page is fetched as the same server-rendered listing URL and its cards are
// appended, so there is no second card renderer and no new API. After AUTO pages the footer
// stays reachable: loading continues only through "Lihat produk lainnya". `auto={0}` (the home's
// "Terbaru" feed) loads only on that button. `reveal` (home): the server page holds more cards than
// CSS shows (four rows per width); the first press only shows them, no request. `step` (category and
// search listings, owner 2026-10-30): `rows` rows show first (default `step`); each scroll to the end
// shows `step` more rows, up to `max`, from the cards already loaded and fetches the next page only
// when they run out. The PDP related grid (owner 2026-10-30) uses rows=2, step=1, max=5, no next page and margin 0px:
// one more row each time the end of the grid actually enters the viewport. Hidden
// cards are display:none, so their lazy photos are not fetched; without JS every card shows.
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
export function ListingMore({next:first,auto:autoPages=AUTO,reveal=false,step=0,rows:initialRows=step,max=Number.MAX_SAFE_INTEGER,margin='0px 0px 50% 0px'}:{next:string|null;auto?:number;reveal?:boolean;step?:number;rows?:number;max?:number;margin?:string}){
 const [pages,setPages]=useState<string[]>([]),[next,setNext]=useState(first),[state,setState]=useState<'idle'|'loading'|'error'>('idle');
 const [status,setStatus]=useState(''),[mounted,setMounted]=useState(false),[columns,setColumns]=useState(6);
 const sentinel=useRef<HTMLDivElement>(null),root=useRef<HTMLDivElement>(null),busy=useRef(false);
 const [hidden,setHidden]=useState(0),[expanded,setExpanded]=useState(false);
 const [rows,setRows]=useState(initialRows),[later,setLater]=useState(0);
 useLayoutEffect(()=>{
  setMounted(true);
  // Restore on Back/forward (entry marked in history) or when the URL names a product that only
  // a saved page holds (the PDP's Back link: /cari?…#product-<id>). Any other visit starts fresh.
  let saved:Saved|null=null;try{saved=JSON.parse(sessionStorage.getItem(keyOf())??'null');}catch{}
  const target=decodeURIComponent(location.hash.slice(1));
  const wanted=Boolean(saved?.pages.length)&&(window.history.state?.listingPages||(target.startsWith('product-')&&!document.getElementById(target)&&saved?.pages.some(html=>html.includes(`id="${target}"`))));
  if(!wanted){try{sessionStorage.removeItem(keyOf());}catch{}return;}
  try{if(saved?.pages.length){setPages(saved.pages);setNext(saved.next);setRows(Number.MAX_SAFE_INTEGER);window.history.replaceState({...window.history.state,listingPages:true},'');
   requestAnimationFrame(()=>{const target=location.hash?document.getElementById(location.hash.slice(1)):null;if(target)target.scrollIntoView({block:'center'});else window.scrollTo(0,saved.scroll);});}}catch{}
 },[]);
 // CSS hides the extra rows only once data-mounted is set, so count after that commit.
 // lazy: counted once; a later resize that hides or shows rows is not recounted.
 useLayoutEffect(()=>{
  if(reveal&&mounted) setHidden([...root.current?.closest('.listing-grid')?.querySelectorAll(':scope > .product-grid > li')??[]].filter(li=>getComputedStyle(li).display==='none').length);
 },[reveal,mounted]);
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
 // Step mode: every card past `rows` rows (at the grid's current column count) carries data-later, which CSS hides.
 // Recounted after each page, step and resize; the static CSS cap covers the first paint before this runs.
 // biome-ignore lint/correctness/useExhaustiveDependencies: `pages` is the trigger: appended page markup adds cards to recount.
 useLayoutEffect(()=>{
  if(!step||!mounted) return;
  // Listings: the cards of every page share .listing-grid; the PDP related grid wraps one .product-grid in .related-grid.
  const grid=root.current?.closest('.listing-grid, .related-grid'),columnsOf=grid?.matches('.listing-grid')?grid:grid?.querySelector('.product-grid');if(!grid||!columnsOf) return;
  const mark=()=>{const cols=getComputedStyle(columnsOf).gridTemplateColumns.split(' ').length,cards=[...grid.querySelectorAll<HTMLElement>('li.product:not(.listing-skeleton li)')];
   for(const [i,li] of cards.entries()) li.toggleAttribute('data-later',i>=rows*cols);setLater(Math.max(0,cards.length-rows*cols));};
  mark();addEventListener('resize',mark);return ()=>removeEventListener('resize',mark);
 },[step,mounted,rows,pages]);
 // A reveal announces itself; after a fetch the load's own announcement (count, "Semua produk sudah tampil") stands.
 const widen=useCallback(()=>setRows(r=>Math.min(r+step,max)),[step,max]);
 const grow=useCallback(()=>{widen();setStatus('Produk lainnya ditampilkan.');},[widen]);
 const auto=pages.length<autoPages;
 const more=reveal&&hidden>0&&!expanded&&!pages.length,scrollReveal=more&&autoPages>0;
 const show=useCallback(()=>{setExpanded(true);setStatus(`${hidden} produk lagi ditampilkan.`);},[hidden]);
 // Step mode reveals while loaded cards remain; then it fetches (within AUTO pages) and reveals the next rows.
 const stepNext=step>0&&mounted&&rows<max?(later>0?'reveal':next&&auto?'load':null):null;
 useEffect(()=>{
  const el=sentinel.current;if(!el||state!=='idle') return;
  const act=stepNext==='reveal'?grow:stepNext==='load'?()=>load().then(widen):scrollReveal?show:!step&&next&&auto?load:null;if(!act) return;
  const io=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)) act();},{rootMargin:margin});
  io.observe(el);return ()=>io.disconnect();
 },[next,auto,state,load,scrollReveal,show,step,stepNext,grow,widen,margin]);
 return <div ref={root} className="listing-more" data-mounted={mounted||undefined} data-expanded={(!step&&(expanded||pages.length>0))||undefined} data-rows={(step&&mounted&&rows)||undefined}>
  {pages.map((html,i)=>
   // biome-ignore lint/security/noDangerouslySetInnerHtml: same-origin card markup from this listing's own server-rendered next page (product names are escaped by React there).
   <ul key={/id="(product-[^"]+)"/.exec(html)?.[1]??`page-${i}`} className="product-grid" data-page={i+2} dangerouslySetInnerHTML={{__html:html}}/>)}
  {state==='loading'&&<ul className="product-grid listing-skeleton" aria-hidden="true">{SKELETON.slice(0,columns).map(k=><li key={k} className="product"><span className="product-frame"/><span className="skeleton-line"/><span className="skeleton-line short"/></li>)}</ul>}
  <p className="sr-only" role="status" aria-live="polite">{status}</p>
  {state==='error'&&<div className="listing-end"><p>Produk berikutnya belum dapat dimuat.</p><button type="button" className="listing-more-button" onClick={load}>Coba lagi</button></div>}
  {((more&&!scrollReveal)||(!more&&!stepNext&&next&&!auto&&state==='idle'))&&<div className="listing-end"><button type="button" className="listing-more-button" onClick={more?show:step?()=>load().then(widen):load}>Lihat produk lainnya</button></div>}
  {(next||scrollReveal||stepNext)&&<div ref={sentinel} className="listing-sentinel" aria-hidden="true"/>}
 </div>;
}
