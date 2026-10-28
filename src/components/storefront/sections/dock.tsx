'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect,useId,useRef,useState} from 'react';
import {FilledIcon,Icon} from '../ui/icon';
import {normal} from './search-box';

// Phone dock (owner 2026-10-28): five labelled tabs, Beranda, Kategori, Cari (raised, the primary action),
// Keranjang and Akun. Cari is a real link to /cari, so it works without JavaScript; with JavaScript it opens a
// full-screen search sheet (a native modal <dialog>: focus trap, Esc, inert page) with catalog suggestions
// and the departments. The dock itself only shows below 701px (CSS).
type Active='home'|'category'|'cart'|'account'|'promo'|'none';
type Department={name:string;slug:string};
const side=[{key:'home',label:'Beranda',href:'/',icon:'home'},{key:'category',label:'Kategori',href:'/kategori',icon:'category'}] as const;
const rest=[{key:'cart',label:'Keranjang',href:'/keranjang',icon:'cart'},{key:'account',label:'Akun',href:'/akun',icon:'user'}] as const;

function Tab({tab,active,count,cartLabel}:{tab:(typeof side|typeof rest)[number];active:Active;count:number;cartLabel:string}){
 const cart=tab.key==='cart';
 return <Link href={tab.href} data-count={cart&&count>0?count:undefined} aria-label={cart?cartLabel:undefined} aria-current={active===tab.key?'page':undefined}>
  <span className="tab-icon"><span className="tab-outline"><Icon name={tab.icon}/></span><span className="tab-filled"><FilledIcon name={tab.icon}/></span></span>
  <span className="tab-label">{tab.label}</span>
 </Link>;
}

export function Dock({active,count,cartLabel,suggestions,departments}:{active:Active;count:number;cartLabel:string;suggestions:string[];departments:Department[]}){
 // /cari?category_id=… is the category listing (Shell marks Kategori current there), so Cari is current only for a plain search.
 const pathname=usePathname(),searching=pathname==='/cari'&&active!=='category';
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),id=useId();
 const [value,setValue]=useState('');
 const raw=value.trim(),typed=normal(raw);
 const matches=(typed?suggestions.filter(s=>normal(s).includes(typed)&&normal(s)!==typed):suggestions).slice(0,6);
 const open=(event:React.MouseEvent<HTMLAnchorElement>)=>{
  // Plain taps open the sheet; modified clicks and the no-JS path keep the real /cari link.
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||!dialog.current?.showModal) return;
  event.preventDefault();setValue('');dialog.current.showModal();input.current?.focus();
 };
 const close=()=>dialog.current?.close();
 // A soft navigation unmounts the dock; closing here also covers a Back press that would leave the sheet open.
 useEffect(()=>{const sheet=dialog.current;return()=>{if(sheet?.open) sheet.close();};},[]);
 return <>
  <nav className="shopping-tabs" aria-label="Navigasi belanja">
   {side.map(tab=><Tab key={tab.key} tab={tab} active={active} count={count} cartLabel={cartLabel}/>)}
   <Link href="/cari" className="tab-search" aria-current={searching?'page':undefined} onClick={open}>
    <span className="tab-fab"><Icon name="search" size={26}/></span>
    <span className="tab-label">Cari</span>
   </Link>
   {rest.map(tab=><Tab key={tab.key} tab={tab} active={active} count={count} cartLabel={cartLabel}/>)}
  </nav>
  <dialog ref={dialog} className="search-sheet" aria-label="Cari produk" onClose={()=>setValue('')}>
   <search>
    <form className="sheet-search" action="/cari" onSubmit={()=>close()}>
     <div className="sheet-field">
      <Icon name="search"/>
      <label className="sr-only" htmlFor={`${id}-q`}>Cari produk</label>
      <input ref={input} id={`${id}-q`} type="search" name="q" value={value} onChange={e=>setValue(e.target.value)} placeholder="Cari produk" maxLength={200} autoComplete="off" enterKeyHint="search"/>
      {value&&<button type="button" className="sheet-clear" aria-label="Hapus pencarian" onClick={()=>{setValue('');input.current?.focus();}}><Icon name="close" size={20}/></button>}
      <button type="submit" className="sheet-go" aria-label="Cari"><Icon name="arrow"/></button>
     </div>
     <button type="button" className="sheet-close" onClick={close}>Batal</button>
    </form>
   </search>
   <div className="sheet-body">
    {(matches.length>0||raw)&&<section aria-labelledby={`${id}-s`}>
     <h2 id={`${id}-s`}>Saran pencarian</h2>
     <ul>
     {raw&&<li><Link className="sheet-row" href={`/cari?q=${encodeURIComponent(raw)}`} onClick={close}><Icon name="search"/><span>Cari “{raw}”</span></Link></li>}
     {matches.map(text=><li key={text}><Link className="sheet-row" href={`/cari?q=${encodeURIComponent(text)}`} onClick={close}><Icon name="search"/><span>{text}</span></Link></li>)}
     </ul>
    </section>}
    {departments.length>0&&<section aria-labelledby={`${id}-k`}>
     <h2 id={`${id}-k`}>Kategori</h2>
     <ul className="sheet-chips">
      <li><Link className="sheet-chip" href="/kategori" onClick={close}>Semua kategori</Link></li>
      {departments.map(d=><li key={d.slug}><Link className="sheet-chip" href={`/kategori/${d.slug}`} onClick={close}>{d.name}</Link></li>)}
     </ul>
    </section>}
   </div>
  </dialog>
 </>;
}
