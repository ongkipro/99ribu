import Link from 'next/link';
import {Icon} from '../ui/icon';
import {CatalogImage} from '../ui/media';
import {HeroVideo,type HeroVideoSource} from './hero-video';

// shop.com home hero card (observed 2026-10-23): a 36px-radius card with a background media layer
// and a bottom-left copy overlay. 99ribu draws its own media: up to eight of its own product photos
// drifting slowly on a brand tint (CSS transform/opacity only; static under reduced motion).
// `video` is the upgrade path for an owner-supplied clip; none ships now. The photos are low
// priority (no preload): on phones the heading text is the LCP element and must not wait for them.
export type HeroPhoto={src:string;width:number;height:number};
export function HomeHero({photos,signedIn,video}:{photos:HeroPhoto[];signedIn:boolean;video?:HeroVideoSource}){
 return <section className="home-hero" aria-labelledby="offer-heading">
  <div className="hero-media" aria-hidden="true">
   {video?<HeroVideo {...video}/>:photos.slice(0,8).map((photo,index)=><span key={photo.src} className="hero-photo" data-slot={index}>
    <CatalogImage src={photo.src} sizes="(max-width: 700px) 30vw, 240px" max={384} min={128} alt="" width={photo.width} height={photo.height} loading="lazy" fetchPriority="low" decoding="async" referrerPolicy="no-referrer"/>
   </span>)}
  </div>
  <div className="hero-copy">
   <h1 id="offer-heading">Semua<br/><span className="hero-price">Rp99.000</span></h1>
   <p>Harga tetap untuk setiap pilihan lengkap.<br/>Bayar transfer bank atau COD.</p>
   <div className="hero-actions">
    {signedIn?<Link className="hero-primary" href="/cari">Lihat produk</Link>:<Link className="hero-primary" href="/masuk">Masuk</Link>}
    <Link className="hero-secondary" href="/bantuan"><span><Icon name="arrow"/>Bantuan belanja</span></Link>
   </div>
  </div>
 </section>;
}
