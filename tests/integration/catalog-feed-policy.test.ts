import assert from 'node:assert/strict';
import test from 'node:test';
import {feedItem,feedXml} from '../../src/modules/catalog/feed.ts';
import type {PublicProduct} from '../../src/modules/storefront/catalog.ts';

type Offer=PublicProduct['variants'][number];
const origin='http://127.0.0.1:3099',productId='00000000-0000-4000-8000-0000000000aa',offerId='00000000-0000-4000-8000-0000000000cc';
const image=(url:string)=>({url,alt:'Synthetic media',width:1500,height:1500});
const offer=(fields:Partial<Offer>={}):Offer=>({id:offerId,catalog_id:'v_00000000-0000-4000-8000-0000000000cc',label:'Satuan',attributes:[],price:99000,currency:'IDR',
 availability:'available',image:image('https://media.invalid/kaos.png'),offer_kind:'unit',contents:[{name:'Synthetic item',quantity:1}],...fields} as Offer);
const product=(fields:Partial<PublicProduct>={},variant=offer()):PublicProduct=>({id:productId,catalog_id:'p_00000000-0000-4000-8000-0000000000aa',slug:`p-${productId}`,version:1,
 publication_id:'00000000-0000-4000-8000-0000000000bb',name:'Kaos Sintetis',description:'Kaos katun sintetis.',category_id:'00000000-0000-4000-8000-0000000000dd',
 images:[],facts:[{key:'brand',label:'Merek',values:['Merek Uji']}],variants:[variant],...fields} as PublicProduct);
const codes=(p:PublicProduct,v=p.variants[0])=>feedItem(origin,p,v).issues.map(i=>`${i.code}:${i.field}`).sort();

test('a valid offer maps to exact permanent IDs, integer IDR price, real availability and the canonical product link',()=>{
 const {item,issues}=feedItem(origin,product(),offer(),'Busana > Kaos');assert.deepEqual(issues,[]);
 assert.deepEqual(item,{id:'v_00000000-0000-4000-8000-0000000000cc',item_group_id:'p_00000000-0000-4000-8000-0000000000aa',title:'Kaos Sintetis - Satuan',description:'Kaos katun sintetis.',
  link:`${origin}/produk/kaos-sintetis-${productId}`,image_link:'https://media.invalid/kaos.png',availability:'in_stock',price:'99000.00 IDR',brand:'Merek Uji',product_type:'Busana > Kaos'});
 const sold=offer({availability:'unavailable'});assert.equal(feedItem(origin,product({},sold),sold).item.availability,'out_of_stock');
 assert.equal(feedItem(origin,product({},sold),sold).item.price,'99000.00 IDR');
 const second=offer({id:'00000000-0000-4000-8000-0000000000ce',catalog_id:'v_00000000-0000-4000-8000-0000000000ce',label:'Paket 2'}),both=product({variants:[offer(),second]});
 assert.equal(feedItem(origin,both,second).item.link,`${origin}/produk/kaos-sintetis-${productId}?offer=${second.id}`,'several offers keep a link that preselects the item offer');
 const renamed=product({name:'Nama baru',slug:'renamed-slug'});assert.equal(feedItem(origin,renamed,renamed.variants[0]).item.id,item.id);assert.equal(feedItem(origin,renamed,renamed.variants[0]).item.item_group_id,item.item_group_id);
});

test('google_product_category is emitted only when the catalog maps one (Google taxonomy id)',()=>{
 const {item,issues}=feedItem(origin,product(),offer(),'Fashion Pria','212');assert.deepEqual(issues,[]);
 assert.equal(item.google_product_category,'212');assert.equal(item.product_type,'Fashion Pria');
 assert.ok(feedXml(origin,[item]).includes('<g:google_product_category>212</g:google_product_category>'));
 assert.equal('google_product_category' in feedItem(origin,product(),offer(),'Fashion Pria').item,false);
});

test('an offer attribute brand overrides the product fact, exactly like storefront fact precedence',()=>{
 const own=offer({attributes:[{key:'brand',label:'Merek',values:['Merek Varian']}]});assert.equal(feedItem(origin,product({},own),own).item.brand,'Merek Varian');
});

test('invalid required product data is reported per catalog ID and field before export',()=>{
 assert.deepEqual(codes(product({facts:[]})),['REQUIRED_FACT_MISSING:brand']);
 assert.deepEqual(codes(product({facts:[{key:'brand',label:'Merek',values:['A','B']}]})),['INVALID_INPUT:brand']);
 const svg=offer({image:image('http://127.0.0.1:3099/fixtures/shirt.svg')});assert.deepEqual(codes(product({},svg)),['MEDIA_REQUIRED:image_link']);
 assert.deepEqual(codes(product({},offer({image:undefined as unknown as Offer['image']}))),['MEDIA_REQUIRED:image_link']);
 assert.deepEqual(codes(product({description:'   '})),['DESCRIPTION_REQUIRED:description']);
 assert.deepEqual(codes(product({name:'K'.repeat(151-' - Satuan'.length)})),['INVALID_INPUT:title']);
 assert.deepEqual(codes(product({description:'d'.repeat(5001)})),['INVALID_INPUT:description']);
 assert.deepEqual(codes(product({description:'Bel\u0007'})),['INVALID_INPUT:description']);
 assert.deepEqual(codes(product({facts:[{key:'brand',label:'Merek',values:['M'.repeat(71)]}]})),['INVALID_INPUT:brand']);
 assert.deepEqual(codes(product({name:'K'.repeat(150-' - Satuan'.length)})),[]);
});

test('serialization is deterministic, escaped and contains only the given items',()=>{
 const {item}=feedItem(origin,product({name:'Kaos & "Polo" <Pria>'}),offer());
 const xml=feedXml(origin,[item]);assert.equal(xml,feedXml(origin,[structuredClone(item)]));
 assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>99ribu</title><link>http://127.0.0.1:3099/</link>'));
 assert.ok(xml.includes('<g:title>Kaos &amp; &quot;Polo&quot; &lt;Pria&gt; - Satuan</g:title>'));
 assert.ok(xml.includes(`<g:link>${origin}/produk/kaos-polo-pria-${productId}</g:link>`));
 assert.ok(xml.includes('<g:price>99000.00 IDR</g:price>')&&xml.includes('<g:availability>in_stock</g:availability>'));
 assert.ok(!xml.includes('product_type'),'null attributes are omitted');
 assert.equal(xml.match(/<item>/g)?.length,1);assert.equal(feedXml(origin,[]).includes('<item>'),false);
});
