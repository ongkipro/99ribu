import Link from 'next/link';
import {ShelfArrows} from '../ui/shelf-arrows';
import {CatalogImage} from '../ui/media';

// Home promo banners as shop.com curation cards (owner 2026-10-29; see 11-promo-banners.css for the
// measured geometry): the first photo fills the card, the title and body sit bottom-left on a dark
// gradient, and up to three product thumbnails stack bottom-right. The data is a plain `banners` array
// so an admin-managed source (S110, storefront/banners.ts currentHomeBanners) replaces the real-data
// defaults; the admin editor previews the same card. `action` is read by assistive tech only (the
// whole card is the link, as on shop.com). shop.com drifts its rail continuously; this one does
// not autoplay (WCAG 2.2.2): native scroll, snap and the shelf arrows.
type Photo={src:string;width:number;height:number};
export type Banner={id:string;title:string;body:string;href:string;action:string;tint:string;cutout?:string;images:(Photo&{alt:string})[];stack?:Photo[]};
// One rail card; the admin banner editor previews the same markup (S110).
export function BannerCard({banner:b}:{banner:Banner}){
 const backdrop=b.images[0],stack=(b.stack??[]).filter(p=>p.src!==backdrop?.src).slice(0,3);
 return <Link className="banner-card" href={b.href}>
  {backdrop&&<CatalogImage className="banner-backdrop" src={backdrop.src} sizes="(max-width: 700px) 265px, (max-width: 1210px) 362px, 410px" max={1080} min={320} alt="" width={backdrop.width} height={backdrop.height} loading="lazy" decoding="async" fetchPriority="low"/>}
  <span className="banner-content">
   <span className="banner-copy"><strong className="banner-title">{b.title}</strong>{b.body&&<span className="banner-subtitle">{b.body}</span>}<span className="sr-only">{b.action}</span></span>
   {stack.length>0&&<span className="banner-stack" aria-hidden="true">{stack.map(p=><span key={p.src} className="banner-thumb">
    <CatalogImage src={p.src} sizes="40px" max={128} min={64} alt="" width={p.width} height={p.height} loading="lazy" decoding="async"/></span>)}</span>}
  </span>
 </Link>;
}
export function PromoBanners({banners}:{banners:Banner[]}){
 if(!banners.length) return null;
 return <section className="home-shelf home-banners" aria-labelledby="banners-heading" aria-roledescription="carousel">
  <h2 id="banners-heading" className="shelf-heading">Temukan pilihan</h2>
  <div className="shelf banner-shelf">
   <ul className="banner-row">{banners.map((b,i)=><li key={b.id} className="banner" aria-roledescription="slide" aria-label={`${i+1} dari ${banners.length}`}>
    <BannerCard banner={b}/>
   </li>)}</ul>
   <ShelfArrows noun="Pilihan"/>
  </div>
 </section>;
}
