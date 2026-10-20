import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {handlePayments} from '../../src/modules/payments/routes.ts';
import {CommerceClient} from './checkout-fixture.ts';
import {paymentFixture} from './payment-fixture.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';

test('payment API parity denies foreign ownership, client money/status and unsupported transports',async()=>{
 const f=await paymentFixture(),samples:Exchange[]=[];
 const observe=async(client:CommerceClient,path:string,expected:number,body?:unknown,valid=true,options:Parameters<CommerceClient['request']>[2]={})=>{
  const request=client.request(path,body,options),response=await handlePayments(request,f.identity),payload=await response.json();assert.equal(response.status,expected);
  samples.push({url:request.url,method:request.method,request_headers:Object.fromEntries([...request.headers].filter(([k])=>['content-type','idempotency-key'].includes(k))),request_body:body===undefined?undefined:JSON.stringify(body),body_bytes:body===undefined?undefined:Buffer.byteLength(JSON.stringify(body)),request_valid:valid,status:response.status,headers:Object.fromEntries(response.headers),payload});return payload;
 };
 try{
  const first=await f.order(),other=await f.order(),path=`/api/v1/orders/${first.order.id}/payment-attempts`,anonymous=new CommerceClient(f.identity),input={method_id:'local-prepaid'};
  const attempt=await observe(first.client,path,201,input);await observe(first.client,`${path}/${attempt.id}`,200);
  await observe(anonymous,path,401,input);await observe(anonymous,`${path}/${attempt.id}`,401);
  await observe(other.client,path,401,input);await observe(other.client,`${path}/${attempt.id}`,401);
  await observe(first.client,`/api/v1/orders/${other.order.id}/payment-attempts/${attempt.id}`,401);
  await observe(first.client,`${path}/${randomUUID()}`,404);
  await observe(first.client,path,400,{...input,amount:first.order.buyer_total},false);
  await observe(first.client,path,400,{...input,status:'confirmed'},false);
  await observe(first.client,path,400,{...input,return_url:'https://example.invalid'},false);
  await observe(first.client,path,409,input);
  await observe(first.client,path,401,input,true,{headers:{'x-cart-token':'invalid'}});
  await observe(first.client,path,403,input,true,{headers:{origin:'https://example.invalid'}});
  await observe(first.client,path,415,input,false,{headers:{'content-type':'text/plain'}});
  await observe(first.client,path,413,{...input,padding:'x'.repeat(16384)},false);
  validateExchanges(samples,'payments');
 }finally{await f.close();}
});
