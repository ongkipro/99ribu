import Link from 'next/link';
import {Shell} from '../../components/storefront/shell';
import {Icon} from '../../components/storefront/ui/icon';
import {ProductGrid,sameOrigin} from '../../components/storefront/ui/product-card';
import {CategorySwitcher} from '../../components/storefront/sections/category-switcher';
import {HomeHero} from '../../components/storefront/sections/home-hero';
import {CategoryGrid} from '../../components/storefront/sections/category-grid';
import {PromoBanners,type Banner} from '../../components/storefront/sections/promo-banners';
import {currentHomeBanners,homeBanners} from '../../modules/storefront/banners';
import {activeShippingPromotions,bundleOffers,promotionSummary} from '../../modules/storefront/promotions';
import {rupiah} from '../../modules/storefront/format';
import {departmentTint} from '../../components/storefront/sections/category-pills';
import {storefrontRequest} from '../../modules/storefront/browser';
import {departmentPhotos,heroPhotos as curatedHero,homeSafe} from '../../modules/storefront/department-photos';
import {getPrincipal} from '../../modules/access/policy';
import {getLocalAuth} from '../../modules/access/auth';
import {catalogQuery,featuredProducts,featuredDepartments,listProducts} from '../../modules/storefront/catalog';
import {JsonLd} from '../../components/storefront/json-ld';
import {siteConfig} from '../../config/site';
import {homeDescription,homeTitle,jsonLdGraph,organizationJsonLd,publicMetadata,websiteJsonLd} from '../../modules/storefront/seo';
export const dynamic='force-dynamic';
export function generateMetadata(){return publicMetadata(siteConfig(),{path:'/',title:homeTitle,description:homeDescription});}
// Composition mirrors the shop.com home order (observed 2026-10-23): hero card, the category grid,
// a product shelf, then the category switcher (large department names over that department's
// shelf). Store carousels and editorial collections are skipped: no data behind them.
export default async function Home(){
 const identity=getLocalAuth();
 // Independent reads in parallel; only the five switcher departments need a product listing.
 const [newest,departments]=await Promise.all([featuredProducts(identity,16),featuredDepartments(identity,10)]);
 const products=newest.filter(homeSafe).slice(0,8);
 const seen=new Set(products.map(p=>p.id));
 const media=(image:{url:string;width:number;height:number}|undefined)=>image?{src:sameOrigin(image.url),width:image.width,height:image.height}:null;
 // Department imagery is the curated pick (department-photos.ts) for the grid, the switcher
 // medallion and the hero. featuredDepartments only returns departments with published products.
 const curated=await departmentPhotos(identity,departments);
 const groups=departments.map((department,index)=>{const photo=media(curated.get(department.id));return {department,tint:departmentTint(department.name,index),tile:photo,photo};});
 // Five departments of seven cards (one full desktop row; 40 read so seven survive the homeSafe and Terbaru filters) keep the server HTML and its RSC payload small (every panel is
 // server-rendered for progressive enhancement and serialised again for hydration).
 const shelves=await Promise.all(groups.slice(0,5).map(async group=>{
  const {data:listed}=await listProducts(identity,catalogQuery(new URLSearchParams({category_id:group.department.id,sort:'newest',limit:'40'})));
  const data=listed.filter(homeSafe),fresh=data.filter(p=>!seen.has(p.id));
  return {...group,products:(fresh.length?fresh:data).slice(0,7)};
 })).then(all=>all.filter(s=>s.products.length));
 // Hero: its own curated photos only, so it does not repeat the tiles and pills below.
 const heroPhotos=(await curatedHero(identity)).map(photo=>media(photo)).filter(x=>x!==null);
 // Promo banners plus one per active shipping promotion; no banner, no section. S110: the admin-managed
 // banners current now (WIB windows) while any is not retired; otherwise the data-backed HOME_BANNERS defaults.
 const [bundles,promotions,managed]=await Promise.all([bundleOffers(identity,1),activeShippingPromotions(identity),currentHomeBanners(identity.sql)]);
 const banners:Banner[]=[
  ...(managed.configured
   ?managed.banners.map(b=>({id:b.id,title:b.title,body:b.subtitle??'',href:b.href,action:b.action_label,tint:'#efeafd',cutout:b.tint??undefined,images:[b.image]}))
   :(await homeBanners(identity,{bundles:bundles.length,departments})).map(b=>({id:b.id,title:b.title,body:b.body,href:b.href,action:b.action,tint:'#efeafd',cutout:b.tint,images:[{src:sameOrigin(b.image.url),width:b.image.width,height:b.image.height,alt:''}]}))),
  ...promotions.map(p=>({id:`shipping-${p.id}`,title:p.name,body:promotionSummary(p,rupiah),href:'/promo',action:'Lihat promo',tint:'#fdf3d6',images:[]})),
 ];
 let signedIn=false;try{await getPrincipal(await storefrontRequest('GET','/'),identity);signedIn=true;}catch{}
 const shelf=(id:string,title:string,href:string,items:typeof products)=><section key={id} className="home-shelf" aria-labelledby={id}><h2 id={id} className="shelf-heading"><Link href={href}>{title}<Icon name="forward"/></Link></h2><ProductGrid products={items} shelf/></section>;
 return <Shell><JsonLd data={jsonLdGraph(organizationJsonLd(siteConfig()),websiteJsonLd(siteConfig()))}/><main id="main" className="wrap home-main"><HomeHero photos={heroPhotos} signedIn={signedIn}/>
  {groups.length>0&&<section className="home-shelf" aria-labelledby="categories-heading"><h2 id="categories-heading" className="shelf-heading"><Link href="/kategori">Kategori<Icon name="forward"/></Link></h2><CategoryGrid tiles={groups.map(({department,tint,tile})=>({department,tint,photo:tile}))}/></section>}
  {products.length?shelf('products-heading','Terbaru','/cari?sort=newest',products):<section className="home-shelf empty-state"><h2>Pilihan sedang disiapkan</h2><p>Produk akan tampil setelah publikasi dan rincian isinya siap.</p><Link href="/cari">Lihat katalog</Link></section>}
  {shelves.length>0&&<section className="home-shelf home-switcher" aria-labelledby="switcher-heading"><h2 id="switcher-heading" className="sr-only">Belanja per kategori</h2>
   <CategorySwitcher label="Kategori pilihan" tabs={shelves.map(({department,photo})=>({id:department.id,slug:department.slug,name:department.name,photo}))}
    panels={shelves.map(({products})=><ProductGrid key={products[0]?.id} products={products} shelf/>)}/></section>}
  <PromoBanners banners={banners}/>
 </main></Shell>;
}
