import {ProductLink} from '../navigation';
import {ShelfArrows} from './shelf-arrows';
import {CatalogImage} from './media';
import {matchingVariant,type CatalogQuery,type PublicProduct} from '../../../modules/storefront/catalog';
import {rupiah} from '../../../modules/storefront/format';

export {rupiah} from '../../../modules/storefront/format';
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
export function Media({product,offer,caption=false,eager=false,sizes}:{product:PublicProduct;offer?:PublicProduct['variants'][number];caption?:boolean;eager?:boolean;sizes?:string}){
 const selected=offer??product.variants[0],image=offer?.image??product.images[0];const sample=isSampleUrl(image?.url);
 if(sample){const brief=`Foto seluruh isi: ${(selected?.contents??[]).map(c=>`${c.quantity} ${contentName(product,c.name)}`).join(' + ')}, tampak depan.`;
  const slot=<div className="photo-slot" role="img" aria-label={`Slot foto ${product.name}; foto produk asli belum tersedia`}><span>Foto belum tersedia</span>{!caption&&<small>{brief}</small>}</div>;
  return caption?<figure className="product-media">{slot}<figcaption>{brief}</figcaption></figure>:slot;
 }
 // Local catalog photos are resized by Next's built-in optimizer (media.tsx); other media stays native.
 return image?<CatalogImage className="product-image" src={sameOrigin(image.url)} sizes={sizes??(caption?'(max-width: 700px) 100vw, 50vw':'(max-width: 700px) 50vw, 240px')} max={caption?1080:384} min={caption?384:256} alt={image.alt} width={image.width} height={image.height} loading={eager?'eager':'lazy'} fetchPriority={eager?'high':undefined} referrerPolicy="no-referrer"/>:<div className="photo-slot">Foto belum tersedia</div>;
}
// `eager`: the first cards are above the fold on the home (the phone LCP image), so they load
// eagerly at high priority instead of waiting for lazy-load layout.
export function ProductGrid({products,input,shelf=false,eager=0}:{products:PublicProduct[];input?:CatalogQuery;shelf?:boolean;eager?:number}){
 const list=<ul className={shelf?'shelf-row':'product-grid'}>{products.map((product,index)=>{
  const offer=matchingVariant(product,input);if(!offer) return null;const available=offer.availability==='available';
  return <li key={product.id} id={`product-${product.id}`} tabIndex={-1} className="product" data-contents={offer.contents.length} data-options={product.variants.length}><ProductLink className="product-link" product={product.id} name={product.name} offer={offer.id}><span className="product-frame"><Media product={product} offer={offer} eager={index<eager} sizes={shelf?'(max-width: 700px) 44vw, (max-width: 1279px) 22vw, 180px':'(max-width: 359px) 90vw, (max-width: 700px) 50vw, (max-width: 1023px) 25vw, 210px'}/></span><h3>{keepHyphens(product.name)}</h3>
   <p className="product-price">{rupiah(offer.price)}</p>{!available&&<p className="unavailable">Stok pilihan belum tersedia</p>}
  </ProductLink></li>;
 })}</ul>;
 return shelf?<div className="shelf">{list}<ShelfArrows/></div>:list;
}
