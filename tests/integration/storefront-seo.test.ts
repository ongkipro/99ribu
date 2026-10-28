import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join,relative,sep} from 'node:path';
import test from 'node:test';
import {siteConfig} from '../../src/config/site.ts';
import {readPublicationState,withdrawPublication} from '../../src/modules/catalog/publication.ts';
import type {PublicProduct} from '../../src/modules/storefront/catalog.ts';
import {isListingParam} from '../../src/modules/storefront/navigation.ts';
import * as seo from '../../src/modules/storefront/seo.ts';
import {shippingFixture} from './shipping-fixture.ts';

const config=siteConfig(process.env),origin=config.origin,closed=Object.freeze({origin,indexing:false});
// Parallel-route slots (`@modal`, S112) are not URLs: they render over the page at the same URL, whose
// own route carries the metadata (a hard load of /masuk renders the noindex page itself).
const pages=(dir:string):string[]=>readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?(name.startsWith('@')?[]:pages(path)):name==='page.tsx'?[path]:[];});
const routeOf=(file:string)=>`/${relative('src/app',file).split(sep).slice(0,-1).filter(s=>!/^\(.*\)$/.test(s)).join('/')}`;
const policyOf=(route:string)=>seo.routePolicy.find(p=>p.route===route||(p.route.endsWith('/**')&&(route===p.route.slice(0,-3)||route.startsWith(p.route.slice(0,-2)))));
const inRange=(text:string,[min,max]:readonly [number,number])=>seo.textLength(text)>=min&&seo.textLength(text)<=max;
const cta=/\b(beli sekarang|pesan sekarang|order now|buy|shop now|add to cart)\b/i;

test('every page route is classified, and only index-class routes opt into indexable metadata',()=>{
 for(const file of pages('src/app')){
  const route=routeOf(file),policy=policyOf(route),source=readFileSync(file,'utf8');
  assert.ok(policy,`${route} (${file}) is missing from seo.ts routePolicy`);
  assert.equal(source.includes('publicMetadata('),policy.index,`${route}: publicMetadata usage must match its policy`);
  if(!policy.index&&route.startsWith('/admin')) continue;
  if(!policy.index) assert.match(source,/privateMetadata\(|searchMetadata\(|robots:\s*\{\s*index:\s*false/,`${route} declares its noindex robots explicitly`);
 }
 assert.deepEqual(seo.rootMetadata(config).robots,{index:false,follow:false},'unclassified routes inherit noindex');
 for(const path of ['/admin','/api/','/keranjang','/checkout','/akun','/pesanan','/masuk','/afiliasi']) assert.ok((seo.disallowedPaths as readonly string[]).includes(path));
});

test('robots.txt allows the catalog, disallows private areas and points at the sitemap; the switch closes the site',()=>{
 assert.deepEqual(seo.robotsFile(config),{rules:{userAgent:'*',allow:'/',disallow:[...seo.disallowedPaths]},sitemap:`${origin}/sitemap.xml`});
 for(const path of seo.disallowedPaths) assert.ok(!['/','/kategori','/kategori/','/produk/','/bantuan','/media/','/cari'].some(p=>p.startsWith(path)),`${path} never blocks a public path`);
 assert.deepEqual(seo.robotsFile(closed),{rules:{userAgent:'*',disallow:'/'}});
 assert.equal(siteConfig({...process.env,SITE_INDEXING:undefined}).indexing,true,'index is the default in every profile');
 assert.equal(siteConfig({...process.env,SITE_INDEXING:'noindex'}).indexing,false);
 assert.throws(()=>siteConfig({...process.env,SITE_INDEXING:'yes'}),/SITE_INDEXING/);
});

test('public metadata: absolute self canonical, index robots and social cards; variants and the switch are noindex',()=>{
 const meta=seo.publicMetadata(config,{path:'/produk/abc',title:'T',description:'D',image:{url:'http://127.0.0.1:3099/media/catalog/x.webp',alt:'Foto',width:800,height:800}});
 assert.deepEqual(meta.alternates,{canonical:`${origin}/produk/abc`});
 assert.equal((meta.robots as {index:boolean}).index,true);
 assert.deepEqual((meta.openGraph as {images:unknown}).images,[{url:`${origin}/media/catalog/x.webp`,alt:'Foto',width:800,height:800}]);
 assert.equal((meta.openGraph as {locale:string}).locale,'id_ID');
 assert.equal((meta.twitter as {card:string}).card,'summary_large_image');
 const filtered=seo.publicMetadata(config,{path:'/kategori/x',title:'T',description:'D',indexable:false});
 assert.deepEqual([filtered.robots,filtered.alternates],[{index:false,follow:true},undefined],'parameterised listing: noindex, follow, no canonical');
 assert.deepEqual(seo.publicMetadata(closed,{path:'/',title:'T',description:'D'}).robots,{index:false,follow:false});
 assert.deepEqual(seo.searchMetadata('Cari produk').robots,{index:false,follow:true});
 for(const key of ['utm_source','utm_campaign','gclid','fbclid','ttclid','ref']) assert.equal(isListingParam(key),false,`${key} is ignored, so the clean category canonical stays indexable`);
 for(const key of ['q','category_id','sort','offer_kind','availability','attributes','limit','cursor','filter.size']) assert.equal(isListingParam(key),true,`${key} is listing state (noindex, follow)`);
 assert.equal(seo.absoluteMedia('http://127.0.0.1:3099/media/catalog/x.webp','https://shop.invalid'),'https://shop.invalid/media/catalog/x.webp','loopback media is rebased onto the public origin');
 assert.equal(seo.absoluteMedia('https://cdn.invalid/a.webp','https://shop.invalid'),'https://cdn.invalid/a.webp');
});

test('titles and descriptions of every committed catalog page fit 55-70 / 120-155 without CTA or banned separators',()=>{
 const catalog=JSON.parse(readFileSync('data/catalog/berlapak/catalog.json','utf8')) as {categories:{slug:string;name:string}[];products:{name:string;description:string;category:string}[]};
 const names=new Map(catalog.categories.map(c=>[c.slug,c.name]));
 const pairs:[string,string][]=[[seo.homeTitle,seo.homeDescription],[seo.categoriesTitle,seo.categoriesDescription],[seo.helpTitle,seo.helpDescription],
  ...catalog.categories.map(c=>[seo.categoryTitle(c.name),seo.categoryDescription(c.name)] as [string,string]),
  ...catalog.products.map(p=>[seo.productTitle(p,names.get(p.category)),seo.productDescription(p,names.get(p.category))] as [string,string])];
 assert.equal(pairs.length,3+catalog.categories.length+catalog.products.length);
 for(const [title,description] of pairs){
  assert.ok(inRange(title,seo.titleRange),`title length ${seo.textLength(title)}: ${title}`);
  assert.ok(inRange(description,seo.descriptionRange),`description length ${seo.textLength(description)}: ${description}`);
  assert.ok(description.endsWith('.'),description);
  for(const text of [title,description]){assert.doesNotMatch(text,/[|—]/);assert.doesNotMatch(text,cta);}
 }
 assert.equal(seo.fitDescription(['x '.repeat(200)]).length<=155,true,'an over-long sentence is cut at a word');
});

const uuidShape=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Every string under a url, @id, item or offers.url key, however deeply nested.
const jsonLdUrls=(node:unknown):string[]=>Array.isArray(node)?node.flatMap(jsonLdUrls):node&&typeof node==='object'?Object.entries(node).flatMap(([key,value])=>typeof value==='string'?(['url','@id','item'].includes(key)?[value]:[]):jsonLdUrls(value)):[];
const product=(variants:Partial<PublicProduct['variants'][number]>[]):PublicProduct=>({id:'00000000-0000-4000-8000-0000000000aa',catalog_id:'p_aa',slug:'p-aa',public_slug:'paket-lem-kuat',version:1,publication_id:'00000000-0000-4000-8000-0000000000bb',
 name:'Paket Lem <b>Kuat</b>',description:'Isi paket: 10 pcs lem.\nHarga Rp99.000 untuk satu paket lengkap.',category_id:'00000000-0000-4000-8000-0000000000dd',
 images:[{url:'http://127.0.0.1:3099/media/catalog/a.webp',alt:'Lem',width:800,height:800}],facts:[],
 variants:variants.map((v,i)=>({id:`00000000-0000-4000-8000-00000000000${i}`,catalog_id:`v_${i}`,label:`Pilihan ${i}`,attributes:[],price:99000,currency:'IDR',availability:'available',
  image:{url:`http://127.0.0.1:3099/media/catalog/v${i}.webp`,alt:'Lem',width:800,height:800},offer_kind:'unit',contents:[{name:'Lem',quantity:10}],...v}))} as PublicProduct);
const category={id:'00000000-0000-4000-8000-0000000000dd',name:'Perkakas & Lem',slug:'perkakas',parent_id:null};
function assertOffer(node:Record<string,unknown>,url:string){
 assert.equal(node['@type'],'Product');assert.ok(typeof node.name==='string'&&node.name);assert.ok(Array.isArray(node.image)&&node.image.length&&(node.image as string[]).every(i=>i.startsWith(`${origin}/`)));
 const offer=node.offers as Record<string,unknown>;
 assert.deepEqual([offer['@type'],offer.price,offer.priceCurrency,offer.itemCondition,offer.url],['Offer',99000,'IDR','https://schema.org/NewCondition',url]);
 assert.match(String(offer.availability),/^https:\/\/schema\.org\/(InStock|OutOfStock)$/);
 for(const banned of ['aggregateRating','review','gtin','gtin13','brand']) assert.ok(!(banned in node),`${banned} is never invented`);
}

test('JSON-LD parses back and carries the required Product, Offer, ProductGroup and BreadcrumbList fields',()=>{
 const url=`${origin}/produk/paket-lem-kuat`;
 const html=seo.serializeJsonLd(seo.jsonLdGraph(seo.productJsonLd(config,product([{},]),category),seo.breadcrumbJsonLd(config,[{name:'Beranda',path:'/'},{name:category.name,path:'/kategori/perkakas'},{name:'Paket Lem',path:'/produk/paket-lem-kuat'}])));
 assert.ok(!html.includes('<'),'"<" is escaped inside the script element');
 const graph=JSON.parse(html) as {'@context':string;'@graph':Record<string,unknown>[]};
 assert.equal(graph['@context'],'https://schema.org');
 const [single,crumbs]=graph['@graph'];assertOffer(single,url);assert.equal(single.url,url);assert.equal(single.sku,'v_0');assert.equal(single.category,'Perkakas & Lem');
 assert.equal((single.offers as {availability:string}).availability,'https://schema.org/InStock');
 const items=crumbs.itemListElement as {position:number;name:string;item:string}[];
 assert.equal(crumbs['@type'],'BreadcrumbList');assert.ok(items.length>=2);
 for(const [index,step] of items.entries()){assert.equal(step.position,index+1);assert.ok(step.name);assert.ok(step.item.startsWith(`${origin}/`));}

 const group=JSON.parse(seo.serializeJsonLd(seo.productJsonLd(config,product([{},{availability:'unavailable'}]),null))) as Record<string,unknown>;
 assert.deepEqual([group['@type'],group.url,group.productGroupID],['ProductGroup',url,'p_aa']);
 const variants=group.hasVariant as Record<string,unknown>[];assert.equal(variants.length,2);
 for(const variant of variants) assertOffer(variant,url);
 const urls=jsonLdUrls([single,crumbs,group]);assert.ok(urls.length>=6);assert.ok(urls.every(u=>!uuidShape.test(u)),`no JSON-LD url carries an id: ${urls}`);
 assert.equal((variants[1].offers as {availability:string}).availability,'https://schema.org/OutOfStock');

 const site=JSON.parse(seo.serializeJsonLd(seo.jsonLdGraph(seo.organizationJsonLd(config),seo.websiteJsonLd(config))))['@graph'] as Record<string,unknown>[];
 assert.deepEqual(site.map(n=>n['@type']),['Organization','WebSite']);
 assert.ok(!('potentialAction' in site[1]),'no SearchAction while /search is noindex');
 assert.equal(site[1].inLanguage,'id-ID');
});

// lazy: ~30 s on the shared test database as it grows (2.8 s on a fresh one); explicit budget until test-data growth is addressed (TASKS S122).
test('sitemap lists sellable publications at their canonical URL with publication lastmod, and drops a withdrawn one',{timeout:180000},async()=>{
 const f=await shippingFixture();try{
  const published=Object.entries(f.seeded.publications).filter(([,p])=>p.id).map(([key])=>f.seeded.products[key]);assert.ok(published.length>=2);
  const urls=async(c=config)=>new Map((await seo.sitemapEntries(f.identity.sql,c)).map(e=>[e.url,e]));
  let entries=await urls();
  for(const path of ['/','/kategori','/bantuan','/promo']) assert.ok(entries.has(`${origin}${path}`),path);
  assert.ok(![...entries.keys()].some(u=>/[?#]|\/cari|\/keranjang|\/checkout|\/akun|\/pesanan|\/masuk|\/afiliasi|\/admin|\/api\//.test(u)),'only canonical public URLs');
  const productUrl=async(id:string)=>{const [{public_slug}]=await f.identity.sql`select public_slug from app.product where id=${id}`;const url=`${origin}/produk/${public_slug}`;return entries.has(url)?url:undefined;};
  const productUrls=[...entries.keys()].filter(u=>u.startsWith(`${origin}/produk/`));
  assert.ok(productUrls.length>=2&&productUrls.every(u=>/^\/produk\/[a-z0-9]+(-[a-z0-9]+)*$/.test(new URL(u).pathname)&&!uuidShape.test(u)),'every product sitemap URL is /produk/<clean-slug> without an id');
  const target=published[0],url=await productUrl(target)??'';assert.ok(url,'the product is listed at /produk/<public_slug>');
  const [created]=await f.identity.sql`select v.created_at from app.publication_head h join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision where h.product_id=${target}`;
  assert.equal(new Date(entries.get(url)?.lastModified??0).toISOString(),new Date(created.created_at).toISOString(),'lastmod is the publication time');
  const [{slug}]=await f.identity.sql`select c.slug from app.product_revision r join app.publication_version v on v.product_id=r.product_id and v.product_revision=r.revision
   join app.publication_head h on h.product_id=v.product_id and h.revision=v.revision join app.category c on c.id=r.category_id where r.product_id=${target}`;
  assert.ok(entries.has(`${origin}/kategori/${slug}`),'the product category is listed');

  const head=await readPublicationState(f.identity,f.principal,target);assert.ok(head.current);
  const request=f.request();request.headers.set('idempotency-key',randomUUID());
  await withdrawPublication(request,f.identity,f.principal,target,{expected_publication_version:head.latest_version,reason:'Synthetic sitemap withdrawal'});
  entries=await urls();assert.ok(!entries.has(url),'a withdrawn publication leaves the sitemap');assert.ok(await productUrl(published[1]));
  assert.deepEqual(await seo.sitemapEntries(f.identity.sql,closed),[],'the closed site publishes no sitemap URLs');
 }finally{await f.close();}
});
