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

// Product URLs read /produk/<public_slug>: a short, clean, stored and immutable slug (app.product.public_slug,
// migration 0040), unique by construction (the first product of a name keeps it, later ones get -2, -3). The slug
// carries no id. Links that were published as /produk/<title>-<uuid> keep resolving: only their trailing uuid is read
// (legacyProductId) and the page answers one 308 to the current slug.
const uuidTail=/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const publicSlugShape=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const productPath=(slug:string)=>`/produk/${slug}`;
export const legacyProductId=(segment:string)=>uuidTail.exec(segment)?.[1].toLowerCase()??null;
// `?offer=` only names a choice the page would not select anyway: the link to the default offer is the bare slug.
export function productHref(slug:string,offer:string,from?:string|null,defaultOffer?:string|null){
 const params=new URLSearchParams(),parent=publicReturnPath(from);if(offer!==defaultOffer)params.set('offer',offer);if(parent)params.set('from',parent);
 const query=params.toString();return `${productPath(slug)}${query?`?${query}`:''}`;
}
