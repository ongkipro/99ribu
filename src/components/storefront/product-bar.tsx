'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {shareProduct} from './share-product';
import {Icon} from './ui/icon';

// Phone product page (owner 2026-10-28, marketplace pattern): the store header with its search steps aside and
// this bar floats over the photo: back on the left; share, cart (with the unit count) and a "more" menu on the right.
// After a short scroll it turns solid white and shows the product name. Hidden from 701px up (CSS), where the
// regular header stays. Back and the menu work without JavaScript: back is a link to the category, the menu a native popover.
function Glyph({children}:{children:React.ReactNode}){
 return <svg aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

export function ProductBar({title,backHref,count,cartLabel}:{title:string;backHref:string;count:number;cartLabel:string}){
 const [solid,setSolid]=useState(false),[status,setStatus]=useState({text:'',id:0});
 useEffect(()=>{const update=()=>setSolid(window.scrollY>240);update();window.addEventListener('scroll',update,{passive:true});return ()=>window.removeEventListener('scroll',update);},[]);
 // Every message restarts the timer (`id`), so sharing twice announces and hides it again.
 useEffect(()=>{if(!status.text)return;const timer=window.setTimeout(()=>setStatus(s=>({...s,text:''})),3200);return ()=>window.clearTimeout(timer);},[status]);
 // Back is the listing the buyer came from (`?from=`, which also restores the page and scroll position), else the category.
 return <header className="pdp-bar" data-solid={solid||undefined}>
  <Link href={backHref} className="pdp-bar-button" aria-label="Kembali"><Glyph><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></Glyph></Link>
  <span className="pdp-bar-title" aria-hidden="true">{title}</span>
  <button type="button" className="pdp-bar-button" aria-label="Bagikan produk" onClick={async()=>{const text=await shareProduct(title);setStatus(s=>({text,id:s.id+1}));}}><Icon name="share"/></button>
  <Link href="/keranjang" className="pdp-bar-button" aria-label={cartLabel} prefetch={false}><Icon name="cart"/>{count>0&&<b className="pdp-bar-count" aria-hidden="true">{count}</b>}</Link>
  <button type="button" className="pdp-bar-button" aria-label="Menu lainnya" popoverTarget="pdp-more"><Glyph><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></Glyph></button>
  <nav id="pdp-more" className="pdp-more" popover="auto" aria-label="Menu lainnya">
   <Link href="/">Beranda</Link><Link href="/kategori">Kategori</Link><Link href="/cari">Cari produk</Link><Link href="/bantuan#percakapan">Chat bantuan</Link><Link href="/akun">Akun</Link>
  </nav>
  <p className="pdp-bar-status" role="status" aria-live="polite">{status.text}</p>
 </header>;
}
