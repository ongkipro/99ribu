import {ProductLink} from './navigation';
import {matchingVariant,type CatalogQuery,type PublicProduct} from '../../modules/storefront/catalog';
import {rupiah} from '../../modules/storefront/format';

export {rupiah} from '../../modules/storefront/format';
const sampleUrl=(url:string|undefined)=>/^http:\/\/127\.0\.0\.1:3099\/fixtures\/(shirt|cream|mixed|bag)\.svg$/.test(url??'');
export const isSampleProduct=(product:PublicProduct)=>sampleUrl(product.images[0]?.url);
export function contentName(product:PublicProduct,name:string){
 if(!sampleUrl(product.images[0]?.url)) return name;
 const original=name.replace(/ \[[a-z0-9-]+\]$/,'');
 return ({'SYNTHETIC shirt':'Kaos contoh','SYNTHETIC cream':'Krim contoh','SYNTHETIC bag':'Tas contoh'} as Record<string,string>)[original]??name;
}
export function Media({product,offer,caption=false}:{product:PublicProduct;offer?:PublicProduct['variants'][number];caption?:boolean}){
 const selected=offer??product.variants[0],image=offer?.image??product.images[0];const sample=sampleUrl(image?.url);
 if(sample){const brief=`Foto seluruh isi: ${(selected?.contents??[]).map(c=>`${c.quantity} ${contentName(product,c.name)}`).join(' + ')}, tampak depan.`;
  const slot=<div className="photo-slot" role="img" aria-label={`Slot foto ${product.name}; foto produk asli belum tersedia`}><span>Foto belum tersedia</span>{!caption&&<small>{brief}</small>}</div>;
  return caption?<figure className="product-media">{slot}<figcaption>{brief}</figcaption></figure>:slot;
 }
 // Published remote media is deliberately native: no unapproved image proxy.
 // biome-ignore lint/performance/noImgElement: preserve the supplied media URL without a new external processing service.
 return image?<img className="product-image" src={image.url} alt={image.alt} width={image.width} height={image.height} loading="lazy" referrerPolicy="no-referrer"/>:<div className="photo-slot">Foto belum tersedia</div>;
}
export function ProductGrid({products,input}:{products:PublicProduct[];input?:CatalogQuery}){
 return <ul className="product-grid">{products.map(product=>{
  const offer=matchingVariant(product,input);if(!offer) return null;const available=offer.availability==='available';
  return <li key={product.id} id={`product-${product.id}`} tabIndex={-1} className="product"><ProductLink className="product-link" product={product.id} offer={offer.id}><Media product={product} offer={offer}/><h3>{product.name}</h3>
   <p className="product-contents">{offer.contents.map(c=>`${c.quantity} × ${contentName(product,c.name)}`).join(' + ')}{product.variants.length>1?` · ${product.variants.length} pilihan`:''}</p>
   <p className="product-price">{rupiah(offer.price)}<span>/ pilihan lengkap</span></p>{!available&&<p className="unavailable">Stok pilihan belum tersedia</p>}
  </ProductLink></li>;
 })}</ul>;
}
