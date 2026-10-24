import type {Metadata,MetadataRoute} from 'next';
import type {Sql} from 'postgres';
import type {SiteConfig} from '../../config/site.ts';
import {salePublication} from '../catalog/publication.ts';
import type {PublicCategory,PublicProduct} from './catalog.ts';
import {productHref,productSlug} from './navigation.ts';
import {rupiah} from './format.ts';

// Search indexing policy for every page route (README "Search indexing"). A route is
// indexable only when listed with index:true AND SITE_INDEXING allows it; the root layout
// default is noindex, so a new route stays private until it is classified here.
export const routePolicy:readonly {route:string;index:boolean;rule:string}[]=[
 {route:'/',index:true,rule:'canonical self; Organization + WebSite JSON-LD'},
 {route:'/kategori',index:true,rule:'canonical self; ?cursor: noindex, follow; other params ignored'},
 {route:'/kategori/[slug]',index:true,rule:'canonical clean URL; listing state (filter, sort, cursor): noindex, follow; tracking params ignored; BreadcrumbList'},
 {route:'/produk/[slug]',index:true,rule:'canonical /produk/<title>-<id> (drops ?offer= and ?from=; a stale title part 308s to it); Product/ProductGroup + BreadcrumbList'},
 {route:'/bantuan',index:true,rule:'canonical self'},
 {route:'/promo',index:true,rule:'canonical self; active shipping promotions and published bundles only'},
 {route:'/tentang',index:false,rule:'placeholder until the owner supplies content: noindex, follow; not in the sitemap'},
 {route:'/kontak',index:false,rule:'placeholder until the owner supplies content: noindex, follow; not in the sitemap'},
 {route:'/privasi',index:false,rule:'placeholder until the owner supplies content: noindex, follow; not in the sitemap'},
 {route:'/syarat',index:false,rule:'placeholder until the owner supplies content: noindex, follow; not in the sitemap'},
 {route:'/cari',index:false,rule:'noindex, follow; never canonical or in the sitemap'},
 {route:'/keranjang',index:false,rule:'noindex, nofollow; robots.txt Disallow'},
 {route:'/checkout',index:false,rule:'noindex, nofollow; robots.txt Disallow'},
 {route:'/checkout/order/[orderId]',index:false,rule:'noindex, nofollow; robots.txt Disallow'},
 {route:'/pesanan/[orderId]',index:false,rule:'noindex, nofollow; robots.txt Disallow'},
 {route:'/akun',index:false,rule:'noindex, nofollow; robots.txt Disallow'},
 {route:'/afiliasi',index:false,rule:'noindex, nofollow; robots.txt Disallow'},
 {route:'/masuk',index:false,rule:'noindex, nofollow; robots.txt Disallow'},
 {route:'/masuk/verifikasi',index:false,rule:'noindex, nofollow; robots.txt Disallow (under /masuk); email verification landing (S123)'},
 {route:'/masuk/atur-sandi',index:false,rule:'noindex, nofollow; robots.txt Disallow (under /masuk); set-password and account activation landing, Referer origin-only (S123)'},
 {route:'/admin/**',index:false,rule:'noindex, nofollow; robots.txt Disallow'},
];
export const disallowedPaths=['/admin','/api/','/keranjang','/checkout','/akun','/pesanan','/masuk','/afiliasi'] as const;

export const brand='99ribu';
const suffix=` - ${brand}`,price=rupiah(99000);
export const titleRange=[55,70] as const,descriptionRange=[120,155] as const;
export const textLength=(text:string)=>Array.from(text).length;
const clean=(text:string)=>text.replace(/\s+/g,' ').trim();
const privateRobots={index:false,follow:false},listingRobots={index:false,follow:true};
const indexRobots={index:true,follow:true,googleBot:{index:true,follow:true,'max-image-preview':'large' as const,'max-snippet':-1,'max-video-preview':-1}};

// Word-boundary cut that never leaves a dangling separator.
function cut(text:string,max:number){
 const chars=Array.from(text);if(chars.length<=max) return text;
 const head=chars.slice(0,max+1).join(''),space=head.lastIndexOf(' ');
 return (space>0?head.slice(0,space):chars.slice(0,max).join('')).replace(/[\s,;:&/-]+$/,'');
}
// First candidate inside the range; otherwise the longest one that fits; otherwise the first, cut.
export function fitTitle(candidates:readonly string[],[min,max]:readonly [number,number]=titleRange){
 const fits=candidates.map(clean).filter(c=>textLength(c)<=max);
 return fits.find(c=>textLength(c)>=min)??fits.sort((a,b)=>textLength(b)-textLength(a))[0]??cut(clean(candidates[0]),max);
}
// Whole sentences in order while they fit; a first sentence longer than the range is cut at a word.
export function fitDescription(sentences:readonly string[],[,max]:readonly [number,number]=descriptionRange){
 const stop=(s:string)=>`${clean(s).replace(/[\s.,;:!?-]+$/,'')}.`;
 let out='';
 for(const sentence of sentences.map(stop)){const next=out?`${out} ${sentence}`:sentence;if(textLength(next)<=max) out=next;else if(!out) out=stop(cut(sentence,max-1));}
 return out;
}

// Stored local media URLs are absolute loopback URLs (see products.tsx sameOrigin); rebase them
// onto the configured public origin so crawlers never see the loopback host.
export const absoluteMedia=(url:string,origin:string)=>new URL(url.replace(/^http:\/\/127\.0\.0\.1:3099(?=\/)/,''),origin).href;
export const pageUrl=(path:string,config:SiteConfig)=>new URL(path,config.origin).href;
export const productPath=(id:string,name?:string|null)=>`/produk/${productSlug(id,name)}`;
export const categoryPath=(slug:string)=>`/kategori/${slug}`;

export function rootMetadata(config:SiteConfig):Metadata{
 return {metadataBase:new URL(config.origin),title:{default:`${brand} - Pilihan lengkap seharga ${price}`,template:`%s${suffix}`},
  description:`Pilihan lengkap seharga ${price} dengan rincian isi dan foto produk asli.`,applicationName:brand,authors:[{name:brand}],publisher:brand,
  robots:privateRobots,openGraph:{siteName:brand,locale:'id_ID',type:'website'}};
}
export const privateMetadata=(title:string):Metadata=>({title,robots:privateRobots});
export const searchMetadata=(title:string):Metadata=>({title,robots:listingRobots});

// Full metadata for a public route. `indexable:false` marks a parameterised variant (noindex,
// follow, no canonical); the site-wide switch turns every page into noindex, nofollow.
export const shareImageAlt='Kartu 99ribu: Semua Rp99.000, harga tetap untuk setiap pilihan lengkap.';
export function publicMetadata(config:SiteConfig,{path,title,description,image,indexable=true}:{path:string;title:string;description:string;image?:{url:string;alt:string;width?:number;height?:number};indexable?:boolean}):Metadata{
 const url=pageUrl(path,config),index=config.indexing&&indexable;
 // Pages without their own photo share the brand card (src/app/opengraph-image.png); page-level
 // openGraph metadata would otherwise replace the file convention's image.
 const images=image?[{url:absoluteMedia(image.url,config.origin),alt:image.alt,...(image.width&&image.height?{width:image.width,height:image.height}:{})}]
  :[{url:pageUrl('/opengraph-image.png',config),alt:shareImageAlt,width:1200,height:630}];
 return {title:{absolute:title},description,robots:index?indexRobots:config.indexing?listingRobots:privateRobots,...(index?{alternates:{canonical:url}}:{}),
  openGraph:{type:'website',siteName:brand,locale:'id_ID',url,title,description,images},
  twitter:{card:'summary_large_image',title,description,images:images.map(i=>i.url)}};
}

export const homeTitle=`${brand} - Pilihan Lengkap Harga Tetap ${price} per Paket`;
export const homeDescription=`Katalog pilihan lengkap seharga ${price}: perlengkapan rumah tangga, dapur, fashion, kecantikan, dan lainnya, dengan rincian isi dan foto asli.`;
export const categoriesTitle=`Kategori Produk - Semua Pilihan Lengkap ${price}${suffix}`;
export const categoriesDescription=`Daftar kategori 99ribu, dari rumah tangga, dapur, fashion, hingga hobi. Setiap produk dijual sebagai pilihan lengkap seharga ${price} per paket.`;
export const promoTitle=`Promo Ongkir dan Paket Campuran ${price} - Belanja Hemat${suffix}`;
export const promoDescription=`Promo ongkir yang sedang aktif beserta syaratnya, dan paket campuran berisi beberapa barang berbeda dalam satu pilihan lengkap seharga ${price}.`;
export const helpTitle=`Bantuan Belanja - Cara Pesan, Ongkir, dan Pengembalian${suffix}`;
export const helpDescription=`Cara memesan pilihan lengkap ${price} di 99ribu, cara ongkir dihitung dari alamat dan paket, ketentuan pengembalian, dan privasi data pesanan.`;

export function categoryTitle(name:string){
 return fitTitle([`${name} - Pilihan Lengkap ${price}${suffix}`,`${name} - Harga Tetap ${price}${suffix}`,`${name} ${price}${suffix}`,
  `Produk ${name} - Pilihan Lengkap Harga Tetap ${price}${suffix}`,`Produk ${name} - Pilihan Lengkap ${price}${suffix}`]);
}
export function categoryDescription(name:string){
 return fitDescription([`Produk ${name} dengan harga tetap ${price} per pilihan lengkap.`,'Setiap produk menampilkan foto asli, rincian isi, dan status stok.',
  'Isi setiap paket tercantum jelas di halaman produk.','Rincian isi tampil di setiap produk.']);
}
export function productTitle(product:Pick<PublicProduct,'name'>,categoryName?:string|null){
 const name=clean(product.name);
 return fitTitle([...(categoryName?[`${name} - ${categoryName}${suffix}`]:[]),`${name} - ${price}${suffix}`,`${name}${suffix}`,name,
  ...(categoryName?[`${name} - ${categoryName} - ${price}${suffix}`]:[]),`${name} - Pilihan Lengkap ${price}${suffix}`,
  ...(categoryName?[`${name} - ${categoryName} - Pilihan Lengkap ${price}${suffix}`]:[])]);
}
export function productDescription(product:Pick<PublicProduct,'description'|'name'>,categoryName?:string|null){
 // A long bundle list (one run-on sentence) would be cut mid-item; lead with the product name instead.
 const own=clean(product.description||product.name).split(/(?<=[.!?])\s+/),lead=textLength(own[0])<descriptionRange[1]?own:[clean(product.name)];
 return fitDescription([...lead,...(categoryName?[`Kategori ${categoryName}.`]:[]),`Harga tetap ${price} per pilihan lengkap.`,
  'Foto produk asli dan rincian isi tersedia.','Stok diperiksa sebelum pesanan dibuat.','Foto produk asli.']);
}

// JSON-LD (schema.org). Only facts visible on the page: no ratings, reviews, brand or GTIN.
const organizationId=(config:SiteConfig)=>pageUrl('/#organization',config);
export const organizationJsonLd=(config:SiteConfig)=>({'@type':'Organization','@id':organizationId(config),name:brand,url:pageUrl('/',config),logo:pageUrl('/brand/logo-512.png',config)});
// No SearchAction: /search is noindex by policy and Google retired the sitelinks search box.
export const websiteJsonLd=(config:SiteConfig)=>({'@type':'WebSite','@id':pageUrl('/#website',config),name:brand,url:pageUrl('/',config),inLanguage:'id-ID',publisher:{'@id':organizationId(config)}});
export function breadcrumbJsonLd(config:SiteConfig,trail:readonly {name:string;path:string}[]){
 return {'@type':'BreadcrumbList',itemListElement:trail.map((step,index)=>({'@type':'ListItem',position:index+1,name:step.name,item:pageUrl(step.path,config)}))};
}
export function productJsonLd(config:SiteConfig,product:PublicProduct,category:PublicCategory|null){
 const url=pageUrl(productPath(product.id,product.name),config),description=clean(product.description)||undefined;
 const images=(offer:PublicProduct['variants'][number])=>[...new Set([offer.image,...product.images].filter(Boolean).map(i=>absoluteMedia((i as {url:string}).url,config.origin)))];
 const item=(offer:PublicProduct['variants'][number],name:string,offerUrl:string)=>({'@type':'Product',name,sku:offer.catalog_id,image:images(offer),...(description?{description}:{}),
  ...(category?{category:category.name}:{}),offers:{'@type':'Offer',url:offerUrl,price:offer.price,priceCurrency:offer.currency,
   availability:`https://schema.org/${offer.availability==='available'?'InStock':'OutOfStock'}`,itemCondition:'https://schema.org/NewCondition',seller:{'@id':organizationId(config)}}});
 const [only]=product.variants;
 if(product.variants.length===1) return {...item(only,clean(product.name),url),'@id':`${url}#product`,url};
 // Several complete offers on one canonical page: Google's single-page ProductGroup variant model.
 return {'@type':'ProductGroup','@id':`${url}#product`,name:clean(product.name),url,productGroupID:product.catalog_id,...(description?{description}:{}),
  hasVariant:product.variants.map(offer=>item(offer,`${clean(product.name)} - ${offer.label}`,pageUrl(productHref(product.id,offer.id,null,product.name),config)))};
}
export const jsonLdGraph=(...nodes:object[])=>({'@context':'https://schema.org','@graph':nodes});
// Escapes "<" so catalog text can never close the script element.
export const serializeJsonLd=(data:object)=>JSON.stringify(data).replace(/</g,'\\u003c');

export function robotsFile(config:SiteConfig):MetadataRoute.Robots{
 if(!config.indexing) return {rules:{userAgent:'*',disallow:'/'}};
 return {rules:{userAgent:'*',allow:'/',disallow:[...disallowedPaths]},sitemap:pageUrl('/sitemap.xml',config)};
}

// Canonical URLs of every currently sellable publication (the same guard as the PDP), their
// categories with ancestors, home and the static public pages. lastmod is the publication time;
// /help has no true modification date, so none is claimed.
// lazy: one transaction re-checks every head; split with generateSitemaps past ~10k products.
export async function sitemapEntries(sql:Sql,config:SiteConfig):Promise<MetadataRoute.Sitemap>{
 if(!config.indexing) return [];
 return sql.begin(async tx=>{
  const [clock]=await tx`select clock_timestamp()::text as now`;
  const heads=await tx`select h.product_id,v.created_at from app.publication_head h join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision
   where h.revision>0 and not exists (select 1 from app.publication_withdrawal w where w.publication_id=v.id) order by v.created_at desc,h.product_id`;
  const categories=new Map((await tx`select id,slug,parent_id from app.category`).map(c=>[c.id as string,c]));
  const products:MetadataRoute.Sitemap=[],categoryDates=new Map<string,Date>();
  for(const head of heads){
   const sale=await salePublication(tx,head.product_id,clock.now);if(!sale?.draft.variants.some(v=>!v.retired)) continue;
   const lastModified=new Date(head.created_at);
   const images=[...new Set([...sale.draft.variants.filter(v=>!v.retired).map(v=>v.image?.url),...sale.draft.images.map(i=>i.url)].filter((u):u is string=>Boolean(u)).map(u=>absoluteMedia(u,config.origin)))];
   products.push({url:pageUrl(productPath(head.product_id,sale.draft.name),config),lastModified,...(images.length?{images}:{})});
   for(let c=categories.get(sale.draft.category_id);c;c=categories.get(c.parent_id)){const seen=categoryDates.get(c.id);if(!seen||seen<lastModified) categoryDates.set(c.id,lastModified);}
  }
  const newest=products.length?products[0].lastModified as Date:undefined,at=(date?:Date)=>date?{lastModified:date}:{};
  return [{url:pageUrl('/',config),...at(newest)},{url:pageUrl('/kategori',config),...at(newest)},{url:pageUrl('/bantuan',config)},{url:pageUrl('/promo',config)},
   ...[...categoryDates].sort(([a],[b])=>String(categories.get(a)?.slug).localeCompare(String(categories.get(b)?.slug))).map(([id,lastModified])=>({url:pageUrl(categoryPath(String(categories.get(id)?.slug)),config),lastModified})),
   ...products];
 });
}
