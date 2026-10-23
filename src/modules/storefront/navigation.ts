const origin='https://storefront.invalid';
// Listing state carried in /search and /category URLs; anything else (utm_*, gclid, fbclid) is ignored.
export const isListingParam=(key:string)=>['q','category_id','sort','offer_kind','availability','attributes','limit','cursor'].includes(key)||/^filter\.[a-z][a-z0-9_]{0,49}$/.test(key);

export function publicReturnPath(value:unknown):string|null{
 if(typeof value!=='string'||value.length>16384||!value.startsWith('/')||/[\\\p{Cc}\p{Cf}]/u.test(value))return null;
 try{
  const url=new URL(value,origin),catalog=url.pathname==='/search'||/^\/category\/[a-z0-9-]+$/.test(url.pathname);
  if(url.origin!==origin||!catalog&&!['/','/cart'].includes(url.pathname))return null;
  for(const key of new Set(url.searchParams.keys())){
   if(!catalog||!isListingParam(key))url.searchParams.delete(key);
  }
  for(const text of url.searchParams.values())if(/[\p{Cc}\p{Cf}]/u.test(text))return null;
  if(!/^#product-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.hash))url.hash='';
  return url.pathname+url.search+url.hash;
 }catch{return null;}
}

export function productHref(product:string,offer:string,from?:string|null){
 const params=new URLSearchParams({offer}),parent=publicReturnPath(from);if(parent)params.set('from',parent);
 return `/product/${product}?${params}`;
}
