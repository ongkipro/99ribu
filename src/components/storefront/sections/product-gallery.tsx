'use client';
import {useEffect,useRef,useState} from 'react';
import {CatalogImage} from '../ui/media';
import {ShelfArrows} from '../ui/shelf-arrows';

// shop.com PDP media (observed 2026-10-24): one horizontally scrolling row of photo cards (28px
// radius, white, soft shadow) with round previous/next buttons, and a vertical strip of 48px
// thumbnails on desktop; phones show the row with the next photo peeking. The photos are server
// HTML (native scroll and snap work without JS); thumbnails and arrows appear after hydration.
export type GalleryImage={src:string;alt:string;width:number;height:number};
export function ProductGallery({images}:{images:GalleryImage[]}){
 const row=useRef<HTMLUListElement>(null),[current,setCurrent]=useState(0),[mounted,setMounted]=useState(false);
 useEffect(()=>{
  setMounted(true);const el=row.current;if(!el) return;
  const update=()=>{const first=el.firstElementChild as HTMLElement|null;if(!first) return;const step=first.offsetWidth+Number.parseFloat(getComputedStyle(el).columnGap||'0');setCurrent(Math.round(el.scrollLeft/step));};
  el.addEventListener('scroll',update,{passive:true});return ()=>el.removeEventListener('scroll',update);
 },[]);
 const show=(index:number)=>{const el=row.current,slide=el?.children[index] as HTMLElement|undefined;if(!el||!slide) return;
  el.scrollTo({left:slide.offsetLeft-el.offsetLeft-Number.parseFloat(getComputedStyle(el).paddingLeft||'0'),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});};
 const many=images.length>1;
 return <div className="product-gallery" data-count={images.length}>
  {many&&mounted&&<ol className="gallery-thumbs" aria-label="Foto produk">{images.map((image,index)=><li key={image.src}>
   <button type="button" aria-label={`Foto ${index+1} dari ${images.length}`} aria-current={index===current||undefined} onClick={()=>show(index)}>
    <CatalogImage src={image.src} sizes="48px" max={128} min={64} alt="" width={image.width} height={image.height} loading="lazy" decoding="async"/>
   </button></li>)}</ol>}
  <div className="gallery-stage">
   <ul ref={row} className="gallery-row">{images.map((image,index)=><li key={image.src} aria-roledescription={many?'slide':undefined} aria-label={many?`${index+1} dari ${images.length}`:undefined}>
    <CatalogImage className="product-image" src={image.src} sizes="(max-width: 700px) 88vw, 50vw" max={1080} min={384} alt={image.alt} width={image.width} height={image.height} loading={index===0?'eager':'lazy'} fetchPriority={index===0?'high':undefined} referrerPolicy="no-referrer"/>
   </li>)}</ul>
   {many&&<ShelfArrows noun="Foto"/>}
  </div>
 </div>;
}
