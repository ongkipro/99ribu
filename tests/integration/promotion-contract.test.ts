import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {handlePromotions} from '../../src/modules/promotions/routes.ts';
import {BrowserSession} from '../contract/access-fixture.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {promotionFixture} from './promotion-fixture.ts';
test('all five promotion operations match actual request/response/private-header contracts for success and denial',async()=>{
 const f=await promotionFixture();const samples:Exchange[]=[];
 const observe=async(request:Request,expected:number,valid?:boolean)=>{
  const body=request.body?await request.clone().text():undefined;const response=await handlePromotions(request,f.identity);const payload=await response.json();assert.equal(response.status,expected,JSON.stringify(payload));
  samples.push({url:request.url,method:request.method,request_headers:Object.fromEntries([...request.headers].filter(([key])=>['content-type','idempotency-key'].includes(key))),request_body:body,body_bytes:body?Buffer.byteLength(body):undefined,request_valid:valid,status:response.status,headers:Object.fromEntries(response.headers),payload});return payload;
 };
 try{
  const guest=new BrowserSession(f.identity);const dummy=randomUUID();
  for(const path of ['',`/${dummy}`,`/${dummy}/versions`]) await observe(guest.request(`/api/v1/admin/shipping-promotions${path}`),401);
  for(const path of ['',`/${dummy}/versions`]) await observe(guest.request(`/api/v1/admin/shipping-promotions${path}`,{}),401);
  const input=f.config();const key=randomUUID();const first=await observe(f.request('',input,key),201,true);
  assert.deepEqual(await observe(f.request('',input,key),201,true),first);await observe(f.request('',{...input,value:1},key),409,true);
  await observe(f.request(''),200,true);await observe(f.request(`/${first.id}`),200,true);await observe(f.request(`/${first.id}/versions`),200,true);
  await observe(f.request(`/${first.id}/versions`,f.config({expected_version:1,value:5000})),201,true);
  await observe(f.request(`/${first.id}/versions`,f.config({expected_version:1})),409,true);
  for(const patch of [{value:-1},{kind:'percentage',value:10001},{payment_methods:['cod','cod']},{clock_namespace:'test'}]) await observe(f.request('',f.config(patch)),400,false);
  await observe(f.request('?limit=101'),400,false);await observe(f.request(`/${first.id}?as_of=2030`),400,false);
  const media=f.request('',input);media.headers.set('content-type','text/plain');await observe(media,415,false);
  const noKey=f.request('',input);noKey.headers.delete('idempotency-key');await observe(noKey,400,false);
  await observe(f.request('',f.config({reason:'x'.repeat(17000)})),413,false);
  const mixed=f.request('');mixed.headers.set('x-cart-token','synthetic-unsupported');await observe(mixed,401,true);
  validateExchanges(samples,'promotions');
 }finally{await f.close();}
});
