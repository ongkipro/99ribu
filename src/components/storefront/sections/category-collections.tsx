import Link from 'next/link';
import type {CatalogQuery,PublicProduct} from '../../../modules/storefront/catalog';
import {Icon} from '../ui/icon';
import {ProductGrid} from '../ui/product-card';

// shop.com category feed cards (observed 2026-10-29): a 28px-radius card with a hairline border,
// the curation title and a round arrow linking to the full list, then one product carousel; two
// cards per row from 1025px, one per row below. Each card is a real, linked listing view. The first two cards' first
// photos load eagerly: one of them is the LCP image (Lighthouse flagged it lazy-loaded, 2026-10-30).
export type Collection={title:string;href:string;products:PublicProduct[];input?:CatalogQuery};
export function CategoryCollections({collections}:{collections:Collection[]}){
 return <ul className="collection-row">{collections.map(({title,href,products,input},index)=><li key={href} className="collection-card">
  <h2 className="collection-title"><Link href={href}>{title}<span className="collection-arrow"><Icon name="forward"/></span></Link></h2>
  <ProductGrid products={products} input={input} shelf eager={index<2?2:0}/>
 </li>)}</ul>;
}
