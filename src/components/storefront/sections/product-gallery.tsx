'use client';
import {useEffect,useRef,useState} from 'react';
import {CatalogImage} from '../ui/media';
import {ShelfArrows} from '../ui/shelf-arrows';

// shop.com PDP media (observed 2026-10-24): one horizontally scrolling row of photo cards (28px
// radius, white, soft shadow) with round previous/next buttons, and a vertical strip of 48px
// thumbnails on desktop; phones show the row with the next photo peeking. Everything is server
// HTML: the row scrolls and snaps natively, and each thumbnail is a link to its photo (#foto-N), so
// the strip works without JavaScript and takes its column before hydration (no layout shift).
// Hydration adds smooth row-only scrolling, the current-thumbnail ring, the "N / M" counter on
// phones and the hover arrows.
export type GalleryImage={src:string;alt:string;width:number;height:number};
export function ProductGallery({images}:{images:GalleryImage[]}){
 const row=useRef<HTMLUListElement>(null),[current,setCurrent]=useState(0),[mounted,setMounted]=useState(false);
 useEffect(()=>{
  setMounted(true);const el=row.current;if(!el) return;
  const update=()=>{const first=el.firstElementChild as HTMLElement|null;if(!first) return;const step=first.offsetWidth+Number.parseFloat(getComputedStyle(el).columnGap||'0');setCurrent(Math.min(images.length-1,Math.round(el.scrollLeft/step)));};
  el.addEventListener('scroll',update,{passive:true});return ()=>el.removeEventListener('scroll',update);
 },[images.length]);
 const show=(index:number)=>{const el=row.current,slide=el?.children[index] as HTMLElement|undefined;if(!el||!slide) return;
  el.scrollTo({left:slide.offsetLeft-el.offsetLeft-Number.parseFloat(getComputedStyle(el).paddingLeft||'0'),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});};
 const many=images.length>1;
 return <div className="product-gallery" data-count={images.length}>
  {many&&<ol className="gallery-thumbs" aria-label="Foto produk">{images.map((image,index)=><li key={image.src}>
   <a href={`#foto-${index+1}`} aria-label={`Foto ${index+1} dari ${images.length}`} aria-current={index===current||undefined} onClick={event=>{event.preventDefault();show(index);}}>
    <CatalogImage src={image.src} sizes="48px" max={128} min={64} alt="" width={image.width} height={image.height} loading="lazy" decoding="async"/>
   </a></li>)}</ol>}
  <div className="gallery-stage">
   <ul ref={row} className="gallery-row">{images.map((image,index)=><li key={image.src} id={`foto-${index+1}`} aria-roledescription={many?'slide':undefined} aria-label={many?`${index+1} dari ${images.length}`:undefined}>
    <CatalogImage className="product-image" src={image.src} sizes="(max-width: 700px) 88vw, (max-width: 1050px) 50vw, 640px" max={1080} min={384} alt={image.alt} width={image.width} height={image.height} loading={index===0?'eager':'lazy'} fetchPriority={index===0?'high':undefined} referrerPolicy="no-referrer"/>
   </li>)}</ul>
   {many&&mounted&&<p className="gallery-count" aria-hidden="true">{current+1} / {images.length}</p>}
   {many&&<ShelfArrows noun="Foto"/>}
  </div>
 </div>;
}
