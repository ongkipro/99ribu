import Link from 'next/link';
import {currentBrowserCart} from '../../modules/storefront/browser';
import {cartUnits} from '../../modules/storefront/cart';
import {TaskBack} from './navigation';

import {Icon} from './icon';
export {Icon} from './icon';
export async function Shell({children,q='',active='home',task=false,backTo=null}:{children:React.ReactNode;q?:string;active?:'home'|'category'|'cart'|'account'|'none';task?:boolean;backTo?:string|null}){
 const current=await currentBrowserCart(),count=current.kind==='ready'&&current.cart.state==='open'&&Date.parse(current.cart.expires_at)>Date.parse(current.now)?cartUnits(current.cart):0;
 const cartLabel=count?`Keranjang, ${count} pilihan`:'Keranjang';
 const destinations=[{key:'home',label:'Beranda',href:'/',icon:'home'},{key:'category',label:'Kategori',href:'/categories',icon:'category'},{key:'cart',label:'Keranjang',href:'/cart',icon:'bag'},{key:'account',label:'Akun',href:'/account',icon:'user'}] as const;
 return <>
  <a className="skip" href="#main">Lewati ke konten</a>
  <div className="local-notice">Data contoh. Pesanan dan pengiriman simulasi.</div>
  {task?<header className="task-header wrap"><TaskBack from={backTo}/><Link href="/" className="brand" aria-label="99ribu, beranda">99<span>ribu</span><i aria-hidden="true">.</i></Link><Link href="/cart" className="task-cart" aria-label={cartLabel}><Icon name="bag"/>{count>0&&<span className="cart-count">{count}</span>}</Link></header>:<header className="store-header"><div className="header-main wrap">
   <Link href="/" className="brand" aria-label="99ribu, beranda">99<span>ribu</span><i aria-hidden="true">.</i></Link>
   <search className="search-region"><form action="/search" className="search-form"><label className="sr-only" htmlFor="site-search">Cari produk</label><input type="search" id="site-search" name="q" placeholder="Cari produk" defaultValue={q} maxLength={200}/><button type="submit" aria-label="Cari produk"><Icon name="search"/></button></form></search>
   <nav className="utilities" aria-label="Belanja"><Link href="/cart" aria-label={cartLabel} aria-current={active==='cart'?'page':undefined}><Icon name="bag"/><span className="utility-label">Keranjang</span>{count>0&&<b className="cart-count utility-count">{count}</b>}</Link><Link href="/account" aria-current={active==='account'?'page':undefined}><Icon name="user"/><span>Akun</span></Link></nav>
  </div><nav className="departments wrap" aria-label="Kategori produk"><Link href="/search">Semua produk</Link><Link href="/category/shop-commerce-demo-busana">Busana</Link><Link href="/category/shop-commerce-demo-perawatan">Perawatan</Link></nav></header>}
  {!task&&<nav className="shopping-tabs" aria-label="Navigasi belanja">{destinations.map(d=><Link key={d.key} href={d.href} data-count={d.key==='cart'&&count>0?count:undefined} aria-label={d.key==='cart'?cartLabel:undefined} aria-current={active===d.key?'page':undefined}><Icon name={d.icon}/><span>{d.label}</span></Link>)}</nav>}
  {children}
  <footer className="store-footer wrap"><p className="brand footer-name">99<span>ribu</span><i aria-hidden="true">.</i></p><div><Link href="/help#returns">Cara pesan dan pengembalian</Link></div><p className="local-footnote">Katalog lokal menggunakan data contoh. Foto produk asli belum tersedia.</p></footer>
  {!task&&<div className="shopping-tabs-space" aria-hidden="true">{destinations.map(d=><span className="tab-space" key={d.key} data-count={d.key==='cart'&&count>0?count:undefined}><Icon name={d.icon}/><span>{d.label}</span></span>)}</div>}

 </>;
}
