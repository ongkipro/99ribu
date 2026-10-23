import type {Sql} from 'postgres';
import {readLocalConfig} from '../../config/local.ts';
import {defaultCatalogDatasetDir,readCatalogDocument} from './dataset.ts';
import {publicProduct,type PublicProduct} from '../storefront/catalog.ts';
import {productHref,productSlug} from '../storefront/navigation.ts';

// Local Google Merchant Center product data in RSS 2.0 (g: namespace). This is a
// file artifact only: nothing here uploads, submits, pings or claims indexing.
// google_product_category comes from the committed catalog dataset (Google Product Taxonomy id:
// product override, else its department default), product_type from our Indonesian department path.
// lazy: the mapping is read from the dataset file, not stored per category/product row; products
// outside the dataset and its departments get none. Upgrade path: a category/product column via
// migration when staff need to edit it. GTIN identifiers stay absent (PR-15 gap).
type Offer=PublicProduct['variants'][number];
export type FeedItem=ReturnType<typeof feedItem>['item'];
export type FeedIssue={code:'INVALID_INPUT'|'DESCRIPTION_REQUIRED'|'MEDIA_REQUIRED'|'REQUIRED_FACT_MISSING';catalog_id:string;field:string};
const limits:Record<string,number>={title:150,description:5000,brand:70,product_type:750};
const xmlText=/^[\t\n\r\x20-퟿-�\u{10000}-\u{10FFFF}]*$/u;

export function feedItem(origin:string,product:PublicProduct,offer:Offer,productType:string|null=null,googleCategory:string|null=null){
 const brand=(offer.attributes.find(a=>a.key==='brand')??product.facts.find(a=>a.key==='brand'))?.values;
 const item={id:offer.catalog_id,item_group_id:product.catalog_id,title:`${product.name} - ${offer.label}`,description:product.description.trim(),
  // Single-offer products link to the canonical page; several offers keep a link that preselects this offer (Merchant variant landing page).
  link:new URL(product.variants.length===1?`/produk/${productSlug(product.id,product.name)}`:productHref(product.id,offer.id,null,product.name),origin).href,image_link:offer.image?.url??null,availability:offer.availability==='available'?'in_stock' as const:'out_of_stock' as const,
  price:`${offer.price}.00 ${offer.currency}`,brand:brand?.length===1?brand[0]:null,product_type:productType,
  ...(googleCategory?{google_product_category:googleCategory}:{})};
 const issues:FeedIssue[]=[],report=(code:FeedIssue['code'],field:string)=>issues.push({code,catalog_id:item.id,field});
 if(!item.description) report('DESCRIPTION_REQUIRED','description');
 // lazy: rejects only known-unsupported SVG media; extensionless CDN URLs pass.
 if(!item.image_link||/\.svg$/i.test(new URL(item.image_link).pathname)) report('MEDIA_REQUIRED','image_link');
 if(!brand) report('REQUIRED_FACT_MISSING','brand');else if(brand.length!==1) report('INVALID_INPUT','brand');
 for(const [field,value] of Object.entries(item)) if(value!==null&&(!xmlText.test(value)||Array.from(value).length>(limits[field]??2000))) report('INVALID_INPUT',field);
 return {item,issues};
}

// Published-only export through the same frozen publication/availability reader as
// the storefront. Invalid items are reported before export and never serialized.
export async function catalogFeed(sql:Sql,productIds?:readonly string[]){
 const {origin}=readLocalConfig(process.env);
 return sql.begin(async tx=>{
  const categories=new Map((await tx`select id,slug,name,parent_id from app.category`).map(c=>[c.id as string,c]));
  // Google product category by offer SKU (product override) or by department slug (default).
  const dataset=readCatalogDocument(defaultCatalogDatasetDir);
  const bySlug=new Map(dataset.categories.flatMap(c=>c.google_product_category?[[c.slug,String(c.google_product_category)] as const]:[]));
  const bySku=new Map(dataset.products.flatMap(p=>p.google_product_category?[[p.offer.sku,String(p.google_product_category)] as const]:[]));
  const google=(categoryId:string,sku:string)=>{let c=categories.get(categoryId);while(c?.parent_id) c=categories.get(c.parent_id);return bySku.get(sku)??(c?bySlug.get(c.slug as string):undefined)??null;};
  const path=(id:string)=>{const names:string[]=[];for(let c=categories.get(id);c;c=categories.get(c.parent_id)) names.unshift(c.name);return names.join(' > ');};
  // lazy: one transaction scans every current publication head; page by product id
  // once the published catalog outgrows a single local export.
  const heads=productIds?.length
   ?await tx`select product_id from app.publication_head where revision>0 and product_id in ${tx(productIds)} order by product_id`
   :await tx`select h.product_id from app.publication_head h join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision where h.revision>0
    and not exists (select 1 from app.publication_withdrawal w where w.publication_id=v.id) order by v.created_at desc,h.product_id limit 50`;
  const items:FeedItem[]=[],issues:FeedIssue[]=[];
  for(const head of heads){
   const product=await publicProduct(tx,head.product_id);if(!product) continue;
   const skus=new Map((await tx`select id,sku from app.offer where product_id=${product.id}`).map(o=>[o.id as string,o.sku as string]));
   for(const offer of product.variants){const result=feedItem(origin,product,offer,path(product.category_id),google(product.category_id,skus.get(offer.id)??''));if(result.issues.length) issues.push(...result.issues);else items.push(result.item);}
  }
  return {items:items.sort((a,b)=>a.id.localeCompare(b.id)),issues:issues.sort((a,b)=>a.catalog_id.localeCompare(b.catalog_id)||a.field.localeCompare(b.field))};
 });
}
const xml=(value:string)=>value.replace(/[&<>"']/g,c=>`&${{'&':'amp','<':'lt','>':'gt','"':'quot',"'":'apos'}[c]};`);
export function feedXml(origin:string,items:readonly FeedItem[]){
 const item=(v:FeedItem)=>`<item>${Object.entries(v).filter(([,value])=>value!==null).map(([key,value])=>`<g:${key}>${xml(value as string)}</g:${key}>`).join('')}</item>`;
 return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>99ribu</title><link>${xml(new URL('/',origin).href)}</link><description>Katalog lokal 99ribu</description>\n${items.map(item).join('\n')}${items.length?'\n':''}</channel></rss>\n`;
}
