import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {handleStorefront} from '../../src/modules/storefront/routes.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {shippingFixture} from './shipping-fixture.ts';

test('all three public catalog API contracts have real anonymous success, closed query denial and redacted dependency failure',async()=>{
 const f=await shippingFixture(),samples:Exchange[]=[];try{
  const curated=await prepareStorefront(f.request(),f.identity,'test',f.namespace,f.seeded);
  const observe=async(path:string,status:number,requestValid?:boolean,identity=f.identity)=>{
   const request=new Request(`http://127.0.0.1:3099/api/v1${path}`),response=await handleStorefront(request,identity),payload=await response.json();assert.equal(response.status,status,JSON.stringify(payload));
   samples.push({url:request.url,method:'GET',request_headers:{},request_valid:requestValid,status,headers:Object.fromEntries(response.headers),payload});return payload;
  };
  await observe('/categories?limit=1',200,true);await observe('/categories?limit=101',400,false);
  const list=await observe(`/products?category_id=${curated.categories.busana}&limit=1`,200,true);assert.equal(list.data.length,1);assert.ok(list.pagination.next_cursor);
  await observe('/products?q=a&q=b',400,false);await observe('/products?sort=cheapest',400,false);await observe(`/products?category_id=${randomUUID()}`,404,true);
  const product=await observe(`/products/${curated.products.shirt.id}`,200,true);assert.equal(product.publication_id,curated.products.shirt.publication_id);
  await observe(`/products/${f.seeded.products['fixture-offer-bag']}`,404,true);await observe(`/products/${curated.products.shirt.id}?as_of=2030`,400,false);
  const unavailable=createLocalAuth('test');await unavailable.sql.end();await observe('/products',503,true,unavailable);
  validateExchanges(samples,'storefront');
 }finally{await f.close();}
});
