'use client';
import {useState} from 'react';
import {Icon} from './ui/icon';

// Bagikan uses the platform share sheet and falls back to copying the link. Resolves to the message to show ('' when
// the share sheet handled it or the buyer dismissed it).
export async function shareProduct(title:string){
 const url=window.location.href.split('#')[0];
 try{
  if(navigator.share){await navigator.share({title,url});return '';}
  await navigator.clipboard.writeText(url);return 'Tautan produk disalin.';
 }catch(error){return (error as Error).name==='AbortError'?'':'Tautan belum dapat dibagikan. Salin dari alamat browser.';}
}

// shop.com PDP utility row (Save / Share, owner 2026-10-25). Simpan has no wishlist behind it yet, so it says so
// instead of pretending.
export function ProductUtilities({title}:{title:string}){
 const [status,setStatus]=useState('');
 const share=async()=>setStatus(await shareProduct(title));
 return <div className="product-utilities">
  <button type="button" className="utility-button" onClick={()=>setStatus('Simpan produk segera hadir.')}><Icon name="heart" size={20}/><span>Simpan</span></button>
  <button type="button" className="utility-button" onClick={share}><Icon name="share" size={20}/><span>Bagikan</span></button>
  <p className="utility-status" role="status" aria-live="polite">{status}</p>
 </div>;
}
