const origin='https://storefront.invalid';
// Listing state carried in /cari and /kategori URLs; anything else (utm_*, gclid, fbclid) is ignored.
export const isListingParam=(key:string)=>['q','category_id','sort','offer_kind','availability','attributes','limit','cursor'].includes(key)||/^filter\.[a-z][a-z0-9_]{0,49}$/.test(key);

export function publicReturnPath(value:unknown):string|null{
 if(typeof value!=='string'||value.length>16384||!value.startsWith('/')||/[\\\p{Cc}\p{Cf}]/u.test(value))return null;
 try{
  const url=new URL(value,origin),catalog=url.pathname==='/cari'||/^\/kategori\/[a-z0-9-]+$/.test(url.pathname);
  if(url.origin!==origin||!catalog&&!['/','/keranjang'].includes(url.pathname))return null;
  for(const key of new Set(url.searchParams.keys())){
   if(!catalog||!isListingParam(key))url.searchParams.delete(key);
  }
  for(const text of url.searchParams.values())if(/[\p{Cc}\p{Cf}]/u.test(text))return null;
  if(!/^#product-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.hash))url.hash='';
  return url.pathname+url.search+url.hash;
 }catch{return null;}
}

// Product URLs read /produk/<title-in-kebab-case>-<uuid>. Only the trailing id resolves the page;
// a stale or missing title part is answered with a 308 to the canonical slug.
const uuidTail=/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export function productSlug(id:string,name?:string|null){
 const title=(name??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,80).replace(/^-+|-+$/g,'');
 return title?`${title}-${id}`:id;
}
export const productIdFromSlug=(slug:string)=>uuidTail.exec(slug)?.[1].toLowerCase()??null;
export function productHref(product:string,offer:string,from?:string|null,name?:string|null){
 const params=new URLSearchParams({offer}),parent=publicReturnPath(from);if(parent)params.set('from',parent);
 return `/produk/${productSlug(product,name)}?${params}`;
}
