import Link from 'next/link';
import {Shell} from '../../components/storefront/shell';
import {Icon} from '../../components/storefront/ui/icon';
import {ProductGrid} from '../../components/storefront/ui/product-card';
import {CategorySwitcher} from '../../components/storefront/sections/category-switcher';
import {HomeHero} from '../../components/storefront/sections/home-hero';
import {CategoryGrid} from '../../components/storefront/sections/category-grid';
import {CategoryHighlights} from '../../components/storefront/sections/category-highlights';
import {ListingMore} from '../../components/storefront/sections/listing-more';
import {PromoBanners,type Banner} from '../../components/storefront/sections/promo-banners';
import {currentHomeBanners,homeBanners} from '../../modules/storefront/banners';
import {activeShippingPromotions,bundleOffers,promotionSummary} from '../../modules/storefront/promotions';
import {rupiah,sameOrigin} from '../../modules/storefront/format';
import {departmentTint} from '../../components/storefront/sections/category-pills';
import {storefrontRequest} from '../../modules/storefront/browser';
import {departmentPhotos,heroPhotos as curatedHero,homeSafe} from '../../modules/storefront/department-photos';
import {getPrincipal} from '../../modules/access/policy';
import {getLocalAuth} from '../../modules/access/auth';
import {catalogQuery,featuredDepartments,listProducts} from '../../modules/storefront/catalog';
import {JsonLd} from '../../components/storefront/json-ld';
import {catalogTtl,memo} from '../../modules/storefront/memo';
import {siteConfig} from '../../config/site';
import {homeDescription,homeTitle,jsonLdGraph,organizationJsonLd,publicMetadata,websiteJsonLd} from '../../modules/storefront/seo';
export const dynamic='force-dynamic';
export function generateMetadata(){return publicMetadata(siteConfig(),{path:'/',title:homeTitle,description:homeDescription});}
// Composition after shop.com's home (observed 2026-10-23/29): hero card, the category grid, three
// department highlight cards (shop.com's merchant cards), the category switcher (large department
// names over that department's shelf), promo banners, then every newest product as a grid that
// grows with "Lihat produk lainnya" (owner 2026-10-29).
// Everything on the home except the visitor's own sign-in state; the same for every visitor (memo.ts).
async function homeData(){
 const identity=getLocalAuth();
 // Independent reads in parallel; only the five switcher departments need a product listing.
 // 24 newest: CSS shows four rows (24/16/12/8 at 6/4/3/2 columns), the first "Lihat produk lainnya" shows the
 // rest without a request, then each press appends one /cari?sort=newest page (same query fingerprint, so this
 // cursor is valid there). This feed is the plain catalogue like /cari, so it is not homeSafe-filtered (owner
 // 2026-10-29: four full rows; 18 of 24 newest failed homeSafe); the curated surfaces above keep the filter.
 const [newest,departments]=await Promise.all([listProducts(identity,catalogQuery(new URLSearchParams({sort:'newest',limit:'24'}))),featuredDepartments(identity,10)]);
 const latest=newest.data,products=latest.filter(homeSafe),cursor=newest.pagination.next_cursor;
 const more=cursor?`/cari?${new URLSearchParams({sort:'newest',cursor})}`:null;
 const media=(image:{url:string;width:number;height:number}|undefined)=>image?{src:sameOrigin(image.url),width:image.width,height:image.height}:null;
 // Department imagery is the curated pick (department-photos.ts) for the grid, the switcher
 // medallion and the hero. featuredDepartments only returns departments with published products.
 const curated=await departmentPhotos(identity,departments);
 const groups=departments.map((department,index)=>{const photo=media(curated.get(department.id));return {department,tint:departmentTint(department.name,index),tile:photo,photo};});
 // Five departments of seven cards (one full desktop row) keep the server HTML and its RSC payload small (every panel is
 // server-rendered for progressive enhancement and serialised again for hydration). listProducts loads each candidate
 // serially, so read only 14 (twice the row, for the homeSafe filter). A department with fewer than seven is filled
 // with the newest products so every row is full (owner 2026-10-29).
 const shelves=await Promise.all(groups.slice(0,5).map(async group=>{
  const {data:listed}=await listProducts(identity,catalogQuery(new URLSearchParams({category_id:group.department.id,sort:'newest',limit:'14'})));
  const own=listed.filter(homeSafe),ids=new Set(own.map(p=>p.id));
  return {...group,own,products:[...own,...products.filter(p=>!ids.has(p.id))].slice(0,7)};
 })).then(all=>all.filter(s=>s.products.length));
 // Three highlight cards: departments with a cover photo and at least three of their own products (fewer if the
 // catalogue cannot fill three), from the same listings as the switcher, so no extra query.
 const covered=shelves.filter(s=>s.photo&&s.own.length);
 const highlights=[...covered.filter(s=>s.own.length>=3),...covered.filter(s=>s.own.length<3)].slice(0,3)
  .map(({department,tint,photo,own})=>({department,tint,photo,products:own}));
 // Hero: its own curated photos only, so it does not repeat the tiles and pills below.
 const heroPhotos=(await curatedHero(identity)).map(photo=>media(photo)).filter(x=>x!==null);
 // Promo banners plus one per active shipping promotion; no banner, no section. S110: the admin-managed
 // banners current now (WIB windows) while any is not retired; otherwise the data-backed HOME_BANNERS defaults.
 const [bundles,promotions,managed]=await Promise.all([bundleOffers(identity,1),activeShippingPromotions(identity),currentHomeBanners(identity.sql)]);
 // Curation-card thumbnails: a department banner shows that department's own products, any other the newest.
 const photo=(p:(typeof products)[number])=>p.images[0]&&{src:sameOrigin(p.images[0].url),width:p.images[0].width,height:p.images[0].height};
 const stack=(href:string)=>{const slug=/^\/kategori\/([^/?#]+)/.exec(href)?.[1],own=slug?shelves.find(s=>s.department.slug===slug)?.own:undefined;
  return (own?.length?own:products).slice(0,4).map(photo).filter(p=>p!==undefined);};
 const banners:Banner[]=[
  ...(managed.configured
   ?managed.banners.map(b=>({id:b.id,title:b.title,body:b.subtitle??'',href:b.href,action:b.action_label,tint:'#efeafd',cutout:b.tint??undefined,images:[b.image]}))
   :(await homeBanners(identity,{bundles:bundles.length,departments})).map(b=>({id:b.id,title:b.title,body:b.body,href:b.href,action:b.action,tint:'#efeafd',cutout:b.tint,images:[{src:sameOrigin(b.image.url),width:b.image.width,height:b.image.height,alt:''}]}))),
  ...promotions.map(p=>({id:`shipping-${p.id}`,title:p.name,body:promotionSummary(p,rupiah),href:'/promo',action:'Lihat promo',tint:'#fdf3d6',images:[]})),
 ].map(b=>({...b,stack:stack(b.href)}));
 return {heroPhotos,groups,highlights,shelves,banners,latest,more};
}
export default async function Home(){
 const {heroPhotos,groups,highlights,shelves,banners,latest,more}=await memo('home',catalogTtl(),homeData);
 let signedIn=false;try{await getPrincipal(await storefrontRequest('GET','/'),getLocalAuth());signedIn=true;}catch{}
 return <Shell><JsonLd data={jsonLdGraph(organizationJsonLd(siteConfig()),websiteJsonLd(siteConfig()))}/><main id="main" className="wrap home-main"><HomeHero photos={heroPhotos} signedIn={signedIn}/>
  {groups.length>0&&<section className="home-shelf" aria-labelledby="categories-heading"><h2 id="categories-heading" className="shelf-heading"><Link href="/kategori">Kategori<Icon name="forward"/></Link></h2><CategoryGrid tiles={groups.map(({department,tint,tile})=>({department,tint,photo:tile}))}/></section>}
  {highlights.length>0&&<section className="home-shelf" aria-labelledby="highlights-heading"><h2 id="highlights-heading" className="sr-only">Sorotan kategori</h2><CategoryHighlights highlights={highlights}/></section>}
  {shelves.length>0&&<section className="home-shelf home-switcher" aria-labelledby="switcher-heading"><h2 id="switcher-heading" className="sr-only">Belanja per kategori</h2>
   <CategorySwitcher label="Kategori pilihan" tabs={shelves.map(({department,photo})=>({id:department.id,slug:department.slug,name:department.name,photo}))}
    panels={shelves.map(({products})=><ProductGrid key={products[0]?.id} products={products} shelf/>)}/></section>}
  <PromoBanners banners={banners}/>
  {latest.length?<section className="home-shelf home-latest" aria-labelledby="products-heading"><h2 id="products-heading" className="shelf-heading"><Link href="/cari?sort=newest">Terbaru<Icon name="forward"/></Link></h2>
   <div className="listing-grid"><ProductGrid products={latest}/><ListingMore next={more} auto={0} reveal/></div>
   {more&&<div className="pagination"><Link className="button secondary" href={more} rel="next">Produk berikutnya</Link></div>}</section>
  :<section className="home-shelf empty-state"><h2>Pilihan sedang disiapkan</h2><p>Produk akan tampil setelah publikasi dan rincian isinya siap.</p><Link href="/cari">Lihat katalog</Link></section>}
 </main></Shell>;
}
