'use client';
import {useEffect,useRef} from 'react';

// Optional owner-supplied hero clip: muted, looped, inline, nothing fetched until the page has
// loaded, and never started under reduced motion or Save-Data (the poster stays).
export type HeroVideoSource={poster:string;webm?:string;mp4?:string};
export function HeroVideo({poster,webm,mp4}:HeroVideoSource){
 const video=useRef<HTMLVideoElement>(null);
 useEffect(()=>{
  const saveData=(navigator as Navigator&{connection?:{saveData?:boolean}}).connection?.saveData;
  if(saveData||matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const start=()=>{video.current?.load();video.current?.play().catch(()=>{});};
  if(document.readyState==='complete') start();else{addEventListener('load',start,{once:true});return ()=>removeEventListener('load',start);}
 },[]);
 return <video ref={video} className="hero-video" poster={poster} muted loop playsInline preload="none">{webm&&<source src={webm} type="video/webm"/>}{mp4&&<source src={mp4} type="video/mp4"/>}</video>;
}
