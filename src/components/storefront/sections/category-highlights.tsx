import Link from 'next/link';
import {matchingVariant,type PublicProduct} from '../../../modules/storefront/catalog';
import {sameOrigin} from '../../../modules/storefront/format';
import {ProductLink} from '../navigation';
import {Icon} from '../ui/icon';
import {CatalogImage} from '../ui/media';
import type {Department} from './category-grid';

// shop.com home merchant cards (observed 2026-10-29): a tall 28px-radius card with a cover photo, a
// 20% dark veil and a bottom-up gradient in the card colour, the name centred, and three square
// product tiles along the bottom. Ours highlights a department: its curated photo is the cover,
// the department tint (deep shade) is the card colour, and the tiles are that department's products.
// The name area and each tile are sibling links (no nested links); no JS.
export type Highlight={department:Department;tint:string;photo:{src:string;width:number;height:number}|null;products:PublicProduct[]};
export function CategoryHighlights({highlights}:{highlights:Highlight[]}){
 return <ul className="highlight-row">{highlights.map(({department,tint,photo,products})=><li key={department.id}>
  <article className="highlight-card" data-tint={tint}>
   {photo&&<CatalogImage className="highlight-cover" src={photo.src} sizes="(max-width: 700px) 80vw, 420px" max={828} min={384} alt="" width={photo.width} height={photo.height} loading="lazy" decoding="async" referrerPolicy="no-referrer"/>}
   <Link className="highlight-link" href={`/kategori/${department.slug}`}>
    <h3 className="highlight-title">{department.name}</h3><span className="highlight-action">Lihat kategori<Icon name="forward"/></span>
   </Link>
   <ul className="highlight-products">{products.slice(0,3).map(product=>{const offer=matchingVariant(product),image=offer?.image??product.images[0];if(!offer||!image) return null;
    return <li key={product.id}><ProductLink className="highlight-product" product={product.id} slug={product.public_slug} offer={offer.id} defaultOffer={offer.id}>
     <CatalogImage src={sameOrigin(image.url)} sizes="(max-width: 700px) 24vw, 128px" max={256} min={128} alt={product.name} width={image.width} height={image.height} loading="lazy" decoding="async" referrerPolicy="no-referrer"/>
    </ProductLink></li>;})}</ul>
  </article>
 </li>)}</ul>;
}
