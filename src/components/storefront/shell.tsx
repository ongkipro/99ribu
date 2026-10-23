import Link from 'next/link';
import {connection} from 'next/server';
import {preload} from 'react-dom';
import {currentBrowserCart} from '../../modules/storefront/browser';
import {cartUnits} from '../../modules/storefront/cart';
import {getLocalAuth} from '../../modules/access/auth';
import {featuredDepartments,searchSuggestions} from '../../modules/storefront/catalog';
import {departmentPhotos} from '../../modules/storefront/department-photos';
import {sameOrigin} from './products';
import {hasPromoContent} from '../../modules/storefront/promotions';
import {CategoryPills} from './category-pills';
import {SearchBox} from './search-box';
import {TaskBack} from './navigation';

import {Icon} from './icon';
export {Icon} from './icon';
// Header and footer catalog chrome (top departments with their pill photos, search suggestions,
// whether /promo has content) is the same for every visitor, so it is computed once per 30s per
// server process instead of on every request (it cost ~60ms of TTFB on every storefront page).
// lazy: in-process TTL; a catalog change shows in the chrome within 30s. Upgrade path: tag-based
// revalidation from the publication/withdrawal services.
type Chrome={departments:Awaited<ReturnType<typeof featuredDepartments>>;pills:(Awaited<ReturnType<typeof featuredDepartments>>[number]&{image:string|null})[];suggestions:string[];promo:boolean};
let cached:{at:number;value:Promise<Chrome>}|null=null;
function chrome(){
 if(cached&&Date.now()-cached.at<30000) return cached.value;
 const identity=getLocalAuth(),value=(async():Promise<Chrome>=>{
  const [departments,all,promo]=await Promise.all([featuredDepartments(identity,5),featuredDepartments(identity,100),hasPromoContent(identity)]);
  const suggestions=await searchSuggestions(identity,all);
  // Pill photo = the department's curated photo (department-photos.ts), as on its grid tile.
  const photos=await departmentPhotos(identity,departments),pills=departments.map(d=>{const photo=photos.get(d.id);return {...d,image:photo?sameOrigin(photo.url):null};});
  return {departments,pills,suggestions,promo};
 })();
 cached={at:Date.now(),value};value.catch(()=>{if(cached?.value===value) cached=null;});
 return value;
}
export async function Shell({children,q='',active='home',task=false,backTo=null,department=null}:{children:React.ReactNode;q?:string;active?:'home'|'category'|'cart'|'account'|'promo'|'none';task?:boolean;backTo?:string|null;department?:string|null}){
 // Every page using this shell already renders per request (it reads the cart cookies). Saying so up front keeps
 // `next build` from querying the database while prerendering, which a production image build cannot reach (S82/S84).
 await connection();
 // The Latin Inter subset is the only font the storefront needs; fetch it with the HTML instead of
 // after the stylesheet, so text (the phone LCP) settles in its final face sooner.
 preload('/fonts/inter-4.1/InterVariable-latin.woff2',{as:'font',type:'font/woff2',crossOrigin:'anonymous'});
 const current=await currentBrowserCart(),count=current.kind==='ready'&&current.cart.state==='open'&&Date.parse(current.cart.expires_at)>Date.parse(current.now)?cartUnits(current.cart):0;
 const cartLabel=count?`Keranjang, ${count} pilihan`:'Keranjang';
 // Task pages hide the header chrome but keep the same footer menus, so the chrome is read for every page.
 const {departments,pills,suggestions,promo}=await chrome();
 const destinations=[{key:'home',label:'Beranda',href:'/',icon:'home'},{key:'category',label:'Kategori',href:'/kategori',icon:'category'},{key:'cart',label:'Keranjang',href:'/keranjang',icon:'cart'},{key:'account',label:'Akun',href:'/akun',icon:'user'}] as const;
 return <>
  <a className="skip" href="#main">Lewati ke konten</a>
  <div className="local-notice"><span className="notice-long">Data contoh: pesanan, pembayaran, dan pengiriman masih simulasi lokal.</span><span className="notice-short">Data contoh: simulasi lokal.</span></div>
  {task?<header className="task-header wrap"><TaskBack from={backTo}/><Link href="/" className="brand" aria-label="99rb - 99ribu, beranda">99<span>rb</span><i aria-hidden="true">.</i></Link><Link href="/keranjang" className="task-cart" aria-label={cartLabel}><Icon name="cart"/>{count>0&&<span className="cart-count">{count}</span>}</Link></header>:<header className="store-header"><div className="header-main wrap">
   {/* Pointer hover/focus reveals "Serba 99ribu" (CSS only); the link is always named by its label. */}
   <Link href="/" className="brand brand-reveal" aria-label="Serba 99ribu, beranda"><span className="grow" aria-hidden="true"><span>Serba&nbsp;</span></span>99<span>r<span className="grow" aria-hidden="true"><span>i</span></span>b<span className="grow" aria-hidden="true"><span>u</span></span></span><i aria-hidden="true">.</i></Link>
   <search className="search-region"><SearchBox key={q} q={q} suggestions={suggestions}/></search>
   <nav className="utilities" aria-label="Belanja">{promo&&<Link href="/promo" aria-label="Promo" aria-current={active==='promo'?'page':undefined}><Icon name="tag"/></Link>}<Link href="/keranjang" aria-label={cartLabel} aria-current={active==='cart'?'page':undefined}><Icon name="cart"/>{count>0&&<b className="cart-count utility-count" aria-hidden="true">{count}</b>}</Link><Link href="/akun" aria-label="Akun" aria-current={active==='account'?'page':undefined}><Icon name="user"/></Link></nav>
  </div><CategoryPills departments={pills} current={department} allCurrent={active==='category'&&department===null}/></header>}
  {children}
  {/* After main: on short phone screens the dock is static, so it follows the page content instead of preceding it. */}
  {!task&&<nav className="shopping-tabs" aria-label="Navigasi belanja">{destinations.map(d=><Link key={d.key} href={d.href} data-count={d.key==='cart'&&count>0?count:undefined} aria-label={d.key==='cart'?cartLabel:undefined} aria-current={active===d.key?'page':undefined}><Icon name={d.icon}/><span>{d.label}</span></Link>)}</nav>}
  <footer className="store-footer"><div className="wrap footer-inner">
   <div className="footer-brand"><p className="brand footer-name">99<span>rb</span><i aria-hidden="true">.</i></p><p>Semua pilihan lengkap Rp99.000.</p><p className="local-footnote">Pesanan, pembayaran, dan pengiriman masih simulasi lokal.</p></div>
   <div className="footer-menus">
    <nav aria-labelledby="footer-shop"><h2 id="footer-shop">Belanja</h2><ul><li><Link href="/kategori">Semua kategori</Link></li>{departments.slice(0,4).map(d=><li key={d.id}><Link href={`/kategori/${d.slug}`}>{d.name}</Link></li>)}<li><Link href="/cari">Cari produk</Link></li></ul></nav>
    <nav aria-labelledby="footer-help"><h2 id="footer-help">Bantuan</h2><ul><li><Link href="/bantuan">Bantuan belanja</Link></li><li><Link href="/bantuan#returns">Pengembalian</Link></li><li><Link href="/akun">Status pesanan</Link></li><li><Link href="/kontak">Hubungi kami</Link></li></ul></nav>
    <nav aria-labelledby="footer-about"><h2 id="footer-about">99ribu</h2><ul><li><Link href="/tentang">Tentang kami</Link></li><li><Link href="/afiliasi">Afiliasi</Link></li></ul></nav>
   </div>
   <div className="footer-bottom"><p>© 2026 99ribu</p><nav className="footer-legal" aria-label="Legal"><ul><li><Link href="/privasi">Kebijakan privasi</Link></li><li><Link href="/syarat">Syarat dan ketentuan</Link></li></ul></nav></div>
  </div></footer>
  {!task&&<div className="shopping-tabs-space" aria-hidden="true">{destinations.map(d=><span className="tab-space" key={d.key} data-count={d.key==='cart'&&count>0?count:undefined}><Icon name={d.icon}/><span>{d.label}</span></span>)}</div>}

 </>;
}
