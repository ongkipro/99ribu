import assert from 'node:assert/strict';
import test from 'node:test';
import {cartFormInput,initialCartIntent} from '../../src/modules/storefront/cart.ts';
import {catalogQuery,matchingVariant,type PublicProduct} from '../../src/modules/storefront/catalog.ts';
import {productHref,publicReturnPath} from '../../src/modules/storefront/navigation.ts';

const category='00000000-0000-4000-8000-000000000001';
const query=(value:Record<string,string>={})=>catalogQuery(new URLSearchParams(value));
const offer=(id:string,availability:'available'|'unavailable',offer_kind='unit',color='Red'):PublicProduct['variants'][number]=>({
 id,catalog_id:id,label:id,attributes:[{key:'color',label:'Warna',values:[color]}],price:99000,currency:'IDR',availability,image:{url:'http://127.0.0.1:3099/fixtures/shirt.svg',alt:'Synthetic selection fixture',width:800,height:800},offer_kind,contents:[{name:'Synthetic whole offer',quantity:1}],
});
const product:PublicProduct={id:category,catalog_id:'SYNTHETIC-S22',slug:'synthetic-s22',public_slug:'synthetic-selection',version:1,publication_id:category,name:'Synthetic selection',description:'Pure selection fixture',category_id:category,images:[],facts:[],variants:[
 offer('first-unavailable','unavailable'),offer('available-pack','available','multipack','Blue'),offer('available-unit','available'),
]};

test('an unfiltered card chooses an available whole offer before an unavailable first option',()=>{
 assert.equal(matchingVariant(product,query())?.id,'available-pack');
 assert.equal(matchingVariant(product)?.id,'available-pack');
});
test('available preference never crosses explicit kind, attribute or unavailable filters',()=>{
 assert.equal(matchingVariant(product,query({offer_kind:'unit'}))?.id,'available-unit');
 assert.equal(matchingVariant(product,query({category_id:category,attributes:JSON.stringify({color:['Red']})}))?.id,'available-unit');
 assert.equal(matchingVariant(product,query({availability:'unavailable'}))?.id,'first-unavailable');
 assert.equal(matchingVariant(product,query({offer_kind:'multipack',availability:'unavailable'})),undefined);
});
test('unavailable-only and empty listings retain their eligibility semantics',()=>{
 const unavailable={...product,variants:[offer('first','unavailable'),offer('second','unavailable')]};
 assert.equal(matchingVariant(unavailable,query())?.id,'first');
 assert.equal(matchingVariant(unavailable,query({availability:'available'})),undefined);
 assert.equal(matchingVariant({...product,variants:[]},query()),undefined);
});


test('native cart forms reject ambiguous, missing, binary and extra trust-boundary fields',()=>{
 const intent=initialCartIntent({product:category,variant:category,publication:category});
 const form=()=>{const data=new FormData();for(const [key,value] of Object.entries(intent))data.set(key,value);data.set('$ACTION_REF_1','native metadata');return data;};
 assert.deepEqual(cartFormInput(form()),intent);
 for(const mutate of [(d:FormData)=>d.append('quantity','2'),(d:FormData)=>d.delete('key'),(d:FormData)=>d.set('variant',new Blob(['binary'])),(d:FormData)=>d.set('x-cart-token','untrusted')]){const data=form();mutate(data);assert.throws(()=>cartFormInput(data),{code:'INVALID_INPUT'});}
});

test('public product return paths keep catalog context and remove private or unrelated fields',()=>{
 const source=`/kategori/shop-commerce-demo-busana?q=Kaos&availability=available&filter.size=M&filter.size=L#product-${category}`;
 assert.equal(publicReturnPath(source),source);assert.equal(publicReturnPath('/'),'/');assert.equal(publicReturnPath('/keranjang?cart_access=secret'),'/keranjang');
 assert.equal(publicReturnPath('/cari?q=Kaos&x-order-token=secret&utm_campaign=sample#private-draft'),'/cari?q=Kaos');
 const href=new URL(productHref('kaos-polos',category,source),'http://localhost');assert.equal(href.pathname,'/produk/kaos-polos');assert.equal(href.searchParams.get('offer'),category);assert.equal(href.searchParams.get('from'),source);
 // The offer the page selects on its own needs no ?offer=: the link is the bare clean slug (plus where the buyer came from).
 assert.equal(productHref('kaos-polos',category,null,category),'/produk/kaos-polos');
 assert.equal(productHref('kaos-polos',category,source,category),`/produk/kaos-polos?${new URLSearchParams({from:source})}`);
 assert.equal(productHref('kaos-polos','other-offer',null,category),'/produk/kaos-polos?offer=other-offer');
 for(const value of [undefined,null,[],['/cari'],'https://outside.invalid/search','//outside.invalid/search','/\\outside.invalid/search','javascript:alert(1)','/api/v1/orders/'+category,'/cari?q=a%0Ab','/cari?q=\u202e','/cari?q='+'x'.repeat(16384)])assert.equal(publicReturnPath(value),null);
 assert.equal(new URL(productHref('kaos-polos',category,'//outside.invalid/'),'http://localhost').searchParams.has('from'),false);
});
