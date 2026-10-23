import {ProductLink} from './navigation';
import {matchingVariant,type CatalogQuery,type PublicProduct} from '../../modules/storefront/catalog';
import {rupiah} from '../../modules/storefront/format';

export {rupiah} from '../../modules/storefront/format';
export const isSampleUrl=(url:string|undefined)=>/^http:\/\/127\.0\.0\.1:3099\/fixtures\/(shirt|cream|mixed|bag)\.svg$/.test(url??'');
// Stored local media URLs are absolute loopback URLs; serve them origin-relative so they also load on the
// opt-in tailnet origin. Remote URLs stay untouched.
export const sameOrigin=(url:string)=>url.startsWith('http://127.0.0.1:3099/')?url.slice('http://127.0.0.1:3099'.length):url;
export const isSampleProduct=(product:PublicProduct)=>isSampleUrl(product.images[0]?.url);
export function contentName(product:PublicProduct,name:string){
 if(!isSampleUrl(product.images[0]?.url)) return name;
 const original=name.replace(/ \[[a-z0-9-]+\]$/,'');
 return ({'SYNTHETIC shirt':'Kaos contoh','SYNTHETIC cream':'Krim contoh','SYNTHETIC bag':'Tas contoh'} as Record<string,string>)[original]??name;
}
// Keeps short hyphenated tokens ("3-in-1", "Anti-Stres") on one line without changing the text.
export function keepHyphens(name:string){
 let n=0;
 return name.split(/(\S{1,6}-\S{1,12})/).map(part=>/-/.test(part)&&!/\s/.test(part)?<span key={`${part}#${n++}`} className="keep-hyphen">{part}</span>:part);
}
export function Media({product,offer,caption=false}:{product:PublicProduct;offer?:PublicProduct['variants'][number];caption?:boolean}){
 const selected=offer??product.variants[0],image=offer?.image??product.images[0];const sample=isSampleUrl(image?.url);
 if(sample){const brief=`Foto seluruh isi: ${(selected?.contents??[]).map(c=>`${c.quantity} ${contentName(product,c.name)}`).join(' + ')}, tampak depan.`;
  const slot=<div className="photo-slot" role="img" aria-label={`Slot foto ${product.name}; foto produk asli belum tersedia`}><span>Foto belum tersedia</span>{!caption&&<small>{brief}</small>}</div>;
  return caption?<figure className="product-media">{slot}<figcaption>{brief}</figcaption></figure>:slot;
 }
 // Published remote media is deliberately native: no unapproved image proxy.
 // biome-ignore lint/performance/noImgElement: preserve the supplied media URL without a new external processing service.
 return image?<img className="product-image" src={sameOrigin(image.url)} alt={image.alt} width={image.width} height={image.height} loading="lazy" referrerPolicy="no-referrer"/>:<div className="photo-slot">Foto belum tersedia</div>;
}
export function ProductGrid({products,input}:{products:PublicProduct[];input?:CatalogQuery}){
 return <ul className="product-grid">{products.map(product=>{
  const offer=matchingVariant(product,input);if(!offer) return null;const available=offer.availability==='available';
  return <li key={product.id} id={`product-${product.id}`} tabIndex={-1} className="product" data-contents={offer.contents.length} data-options={product.variants.length}><ProductLink className="product-link" product={product.id} offer={offer.id}><Media product={product} offer={offer}/><h3>{keepHyphens(product.name)}</h3>
   <p className="product-price">{rupiah(offer.price)} <span>/ pilihan lengkap</span></p>{!available&&<p className="unavailable">Stok pilihan belum tersedia</p>}
  </ProductLink></li>;
 })}</ul>;
}
