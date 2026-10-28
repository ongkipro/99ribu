// Bagikan uses the platform share sheet and falls back to copying the link. Resolves to the message to show ('' when
// the share sheet handled it or the buyer dismissed it). Browser only: call it from an event handler.
export async function shareProduct(title:string){
 const url=window.location.href.split('#')[0];
 try{
  if(navigator.share){await navigator.share({title,url});return '';}
  await navigator.clipboard.writeText(url);return 'Tautan produk disalin.';
 }catch(error){return (error as Error).name==='AbortError'?'':'Tautan belum dapat dibagikan. Salin dari alamat browser.';}
}
