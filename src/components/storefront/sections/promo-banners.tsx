import Link from 'next/link';
import {ShelfArrows} from '../ui/shelf-arrows';
import {CatalogImage} from '../ui/media';
import {Icon} from '../ui/icon';

// Home promo banners (shop.com editorial rail, observed 2026-10-24: 410x520 photo-led cards 10px
// apart, 28px radius, caption bottom-left). The data is a plain `banners` array so an admin-managed
// source (S110) can replace today's real-data banners later. Each banner leads with its photos (a
// tilted collage of up to three curated, seal-free item photos) and shows a visible action pill.
// shop.com drifts its rail continuously; with one to a few banners this one does not autoplay
// (WCAG 2.2.2): native scroll, snap and the shelf arrows.
export type Banner={id:string;title:string;body:string;href:string;action:string;tint:string;cutout?:string;images:{src:string;width:number;height:number;alt:string}[]};
export function PromoBanners({banners}:{banners:Banner[]}){
 if(!banners.length) return null;
 return <section className="home-shelf home-banners" aria-labelledby="banners-heading" aria-roledescription="carousel">
  <h2 id="banners-heading" className="shelf-heading">Temukan pilihan</h2>
  <div className="shelf banner-shelf">
   <ul className="banner-row">{banners.map((b,i)=><li key={b.id} className="banner" aria-roledescription="slide" aria-label={`${i+1} dari ${banners.length}`}>
    <Link className="banner-card" href={b.href} style={{'--banner-tint':b.tint} as React.CSSProperties}>
     {b.images.length>0&&<span className="banner-media" data-count={b.images.length} data-cutout={b.cutout}>{b.images.map(image=>
      <CatalogImage key={image.src} src={image.src} sizes="(max-width: 700px) 85vw, 410px" max={1080} min={320} alt={image.alt} width={image.width} height={image.height} loading="lazy" decoding="async" fetchPriority="low"/>)}</span>}
     <span className="banner-caption"><strong>{b.title}</strong><span>{b.body}</span><span className="banner-action">{b.action}<Icon name="forward"/></span></span>
    </Link>
   </li>)}</ul>
   <ShelfArrows noun="Pilihan"/>
  </div>
 </section>;
}
