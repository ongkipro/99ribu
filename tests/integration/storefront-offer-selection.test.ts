import assert from 'node:assert/strict';
import test from 'node:test';
import {AccessError} from '../../src/modules/access/policy.ts';
import {catalogQuery,matchingVariant,type CatalogQuery,type PublicProduct} from '../../src/modules/storefront/catalog.ts';

type Offer=PublicProduct['variants'][number];
type Attribute={key:string;label:string;values:string[]};
const category='0a3f6c2e-5b1d-4e8f-9a7c-2d4b6e8f0a1c';
const attribute=(key:string,...values:string[]):Attribute=>({key,label:key,values});
const offer=(label:string,fields:{offer_kind?:string;availability?:Offer['availability'];attributes?:Attribute[]}={}):Offer=>({
 id:`00000000-0000-4000-8000-${label.padStart(12,'0').slice(-12)}`,catalog_id:`SYN-${label}`,label,attributes:fields.attributes??[],price:99000,currency:'IDR',
 availability:fields.availability??'available',image:undefined as unknown as Offer['image'],offer_kind:fields.offer_kind??'unit',contents:[{name:'Synthetic item',quantity:1}]} as Offer);
const product=(variants:Offer[],facts:Attribute[]=[]):PublicProduct=>({id:'00000000-0000-4000-8000-0000000000aa',catalog_id:'SYN-PRODUCT',slug:'synthetic-product',version:1,
 publication_id:'00000000-0000-4000-8000-0000000000bb',name:'Synthetic product',description:'Synthetic public product',category_id:category,images:[],facts,variants} as unknown as PublicProduct);
const query=(params:Record<string,string>):CatalogQuery=>catalogQuery(new URLSearchParams(params));
const rejected=(error:unknown)=>error instanceof AccessError&&error.status===400&&error.code==='INVALID_INPUT';

test('every explicit filter must hold on one complete offer, never across sibling offers',()=>{
 const split=product([offer('pack',{offer_kind:'multipack',availability:'unavailable'}),offer('unit',{offer_kind:'unit',availability:'available'})]);
 assert.equal(matchingVariant(split,query({offer_kind:'multipack',availability:'available'})),undefined);
 const attributed=product([offer('m-red',{attributes:[attribute('size','M'),attribute('color','Red')]}),offer('l-blue',{attributes:[attribute('size','L'),attribute('color','Blue')]})]);
 assert.equal(matchingVariant(attributed,query({category_id:category,attributes:JSON.stringify({size:['M'],color:['Blue']})})),undefined);
 assert.equal(matchingVariant(attributed,query({category_id:category,attributes:JSON.stringify({size:['L'],color:['Blue']})}))?.label,'l-blue');
});

test('an offer attribute overrides the same product fact; absent keys fall back to product facts',()=>{
 const shadowed=product([offer('blue',{attributes:[attribute('color','Blue')]})],[attribute('color','Red'),attribute('material','Cotton')]);
 assert.equal(matchingVariant(shadowed,query({category_id:category,attributes:JSON.stringify({color:['Red']})})),undefined);
 assert.equal(matchingVariant(shadowed,query({category_id:category,attributes:JSON.stringify({color:['Blue'],material:['Cotton']})}))?.label,'blue');
 assert.equal(matchingVariant(shadowed,query({category_id:category,attributes:JSON.stringify({material:['Linen']})})),undefined);
});

test('values within one key are alternatives and the first matching offer keeps stable order',()=>{
 const ordered=product([offer('first-red',{attributes:[attribute('color','Red')]}),offer('second-blue',{attributes:[attribute('color','Blue')]}),offer('third-red',{attributes:[attribute('color','Red')]})]);
 assert.equal(matchingVariant(ordered,query({category_id:category,attributes:JSON.stringify({color:['Blue','Red']})}))?.label,'first-red');
 assert.equal(matchingVariant(ordered,query({category_id:category,attributes:JSON.stringify({color:['Blue']})}))?.label,'second-blue');
 assert.equal(matchingVariant(ordered,query({}))?.label,'first-red');
});

test('an explicit unavailable-only filter retains the unavailable matching offer',()=>{
 const mixed=product([offer('in-stock',{availability:'available'}),offer('sold-out',{offer_kind:'bundle',availability:'unavailable'})]);
 assert.equal(matchingVariant(mixed,query({availability:'unavailable'}))?.label,'sold-out');
 assert.equal(matchingVariant(mixed,query({availability:'unavailable',offer_kind:'unit'})),undefined);
 assert.equal(matchingVariant(product([offer('only',{availability:'unavailable'})]),query({availability:'available'})),undefined);
});

test('a product without offers matches nothing, even unfiltered',()=>{
 assert.equal(matchingVariant(product([]),query({})),undefined);
});

test('the real parser normalizes accepted filters before matching',()=>{
 const parsed=query({category_id:category.toUpperCase(),attributes:JSON.stringify({size:['M','L','M'],color:['Red']}),offer_kind:'',availability:'',limit:'40'});
 assert.equal(parsed.category_id,category);
 assert.deepEqual(parsed.attributes,{color:['Red'],size:['L','M']});
 assert.deepEqual(Object.keys(parsed.attributes),['color','size']);
 assert.equal(parsed.offer_kind,null);assert.equal(parsed.availability,null);assert.equal(parsed.limit,40);
});

test('invalid, duplicated or control-bearing filter shapes fail closed',()=>{
 const attributes=(value:unknown)=>({category_id:category,attributes:typeof value==='string'?value:JSON.stringify(value)});
 const cases:(string|Record<string,string>)[]=[
  'offer_kind=unit&offer_kind=bundle','availability=available&availability=available','offer_kind=gift','availability=maybe','limit=0',
  {q:'kaos\u200B'},{q:'kaos\u0007'},{attributes:JSON.stringify({size:['M']})},
  attributes('{"size":'),attributes(['size']),attributes({Size:['M']}),attributes({size:[]}),attributes({size:'M'}),attributes({size:[1]}),
  attributes(Object.fromEntries(Array.from({length:11},(_,i)=>[`k${i}`,['x']]))),attributes({size:Array.from({length:11},(_,i)=>`v${i}`)}),
 ];
 for(const params of cases) assert.throws(()=>catalogQuery(new URLSearchParams(params)),rejected,JSON.stringify(params));
});
