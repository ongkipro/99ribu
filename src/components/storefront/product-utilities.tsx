'use client';
import {useState} from 'react';
import {Icon} from './ui/icon';

// shop.com PDP utility row (Save / Share, owner 2026-10-25). Bagikan uses the platform share sheet and falls
// back to copying the link; Simpan has no wishlist behind it yet, so it says so instead of pretending.
export function ProductUtilities({title}:{title:string}){
 const [status,setStatus]=useState('');
 const share=async()=>{
  const url=window.location.href.split('#')[0];
  try{
   if(navigator.share){await navigator.share({title,url});return;}
   await navigator.clipboard.writeText(url);setStatus('Tautan produk disalin.');
  }catch(error){if((error as Error).name!=='AbortError')setStatus('Tautan belum dapat dibagikan. Salin dari alamat browser.');}
 };
 return <div className="product-utilities">
  <button type="button" className="utility-button" onClick={()=>setStatus('Simpan produk segera hadir.')}><Icon name="heart" size={20}/><span>Simpan</span></button>
  <button type="button" className="utility-button" onClick={share}><Icon name="share" size={20}/><span>Bagikan</span></button>
  <p className="utility-status" role="status" aria-live="polite">{status}</p>
 </div>;
}
