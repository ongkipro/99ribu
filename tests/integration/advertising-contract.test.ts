import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {CommerceClient} from './checkout-fixture.ts';
import {advertisingFixture,grantedChoices,deniedChoices} from './advertising-fixture.ts';

test('actual first-party signal handlers enforce scope, closed bodies, retry, withdrawal and rate limits with five-operation wire parity',async()=>{
 const f=await advertisingFixture(),samples:Exchange[]=[];
 try{
  const call=async(client:CommerceClient,path:string,body?:unknown,options:Parameters<CommerceClient['request']>[2]={},requestValid=true)=>{
   const result=await f.signals(client,path,body,options),headers:Record<string,string>={};for(const name of ['content-type','idempotency-key']){const value=result.request.headers.get(name);if(value)headers[name]=value;}
   samples.push({url:result.request.url,method:result.request.method,request_headers:headers,request_body:body===undefined?undefined:JSON.stringify(body),body_bytes:body===undefined?undefined:Buffer.byteLength(JSON.stringify(body)),request_valid:requestValid,status:result.response.status,headers:Object.fromEntries(result.response.headers),payload:result.payload});return result;
  };
  const bootstrapBody={client_request_id:randomUUID()},bootstrapKey=randomUUID();assert.equal((await call(f.client,'/api/v1/visitor-sessions',bootstrapBody,{key:bootstrapKey})).response.status,401);
  assert.equal((await call(f.client,'/api/v1/consent/receipt')).response.status,401);
  assert.equal((await call(f.client,'/api/v1/visitor-sessions',bootstrapBody,{key:bootstrapKey})).response.status,201);
  assert.equal((await call(f.client,'/api/v1/consent/receipt')).response.status,404);
  const grantBody={expected_version:0,policy_version:'local-privacy-v1',choices:grantedChoices},grantKey=randomUUID(),grant=await call(f.client,'/api/v1/consent/receipt',grantBody,{key:grantKey});assert.equal(grant.response.status,201);assert.equal((await call(f.client,'/api/v1/consent/receipt')).payload.id,grant.payload.id);
  assert.equal((await call(f.client,'/api/v1/consent/receipt',grantBody,{headers:{'x-order-token':'not-issued'}})).response.status,401);
  const product={client_event_id:randomUUID(),name:'product_viewed',occurred_at:new Date().toISOString(),consent_receipt_id:grant.payload.id,product_id:f.seeded.products['fixture-offer-shirt']};
  const observed=await call(f.client,'/api/v1/funnel/events',product,{key:product.client_event_id});assert.equal(observed.response.status,202);
  assert.equal((await call(new CommerceClient(f.identity),'/api/v1/funnel/events',product,{key:product.client_event_id})).response.status,401);
  assert.equal((await call(f.client,'/api/v1/funnel/events',{...product,name:'Purchase'},{key:product.client_event_id},false)).response.status,400);
  const order=await f.order(f.client),milestone={client_event_id:randomUUID(),name:'receipt_viewed',occurred_at:new Date().toISOString(),consent_receipt_id:grant.payload.id,order_id:order.id},path=`/api/v1/orders/${order.id}/funnel/events`;
  assert.equal((await call(f.client,'/api/v1/funnel/events',milestone,{key:milestone.client_event_id})).response.status,401);
  const nested=await call(f.client,path,milestone,{key:milestone.client_event_id});assert.equal(nested.response.status,202);
  const visitorOnly=new CommerceClient(f.identity);for(const [key,cookie] of f.client.cookies)if(cookie.name.endsWith('.visitor'))visitorOnly.cookies.set(key,cookie);
  assert.equal((await call(visitorOnly,path,milestone,{key:milestone.client_event_id})).response.status,401);
  const denied=await call(f.client,'/api/v1/consent/receipt',{expected_version:1,policy_version:'local-privacy-v1',choices:deniedChoices});assert.equal(denied.response.status,201);
  assert.equal((await call(f.client,'/api/v1/consent/receipt',grantBody,{key:grantKey})).payload.id,denied.payload.id);
  assert.equal((await call(f.client,'/api/v1/funnel/events',product,{key:product.client_event_id})).payload.id,observed.payload.id);
  assert.equal((await call(f.client,path,milestone,{key:milestone.client_event_id})).payload.id,nested.payload.id);
  const declined={...product,client_event_id:randomUUID(),occurred_at:new Date().toISOString(),consent_receipt_id:denied.payload.id},ack=await call(f.client,'/api/v1/funnel/events',declined,{key:declined.client_event_id});assert.equal(ack.response.status,202);
  assert.equal((await f.identity.sql`select event_id from app.funnel_intake where id=${ack.payload.id}`)[0].event_id,null);
  assert.equal((await call(f.client,'/api/v1/visitor-sessions',{client_request_id:randomUUID()},{key:bootstrapKey})).response.status,409);
  assert.equal((await call(f.client,'/api/v1/consent/receipt',{...grantBody,expected_version:2},{headers:{origin:'https://foreign.invalid'}})).response.status,403);
  assert.equal((await call(f.client,'/api/v1/consent/receipt',{...grantBody,expected_version:2},{headers:{'content-type':'text/plain'}},false)).response.status,415);
  assert.equal((await call(f.client,'/api/v1/consent/receipt',{...grantBody,extra:'x'.repeat(17000)},{},false)).response.status,413);
  let limited:Awaited<ReturnType<typeof call>>|undefined;for(let i=0;i<65;i++){const result=await call(f.client,'/api/v1/consent/receipt');if(result.response.status===429){limited=result;break;}assert.equal(result.response.status,200);}assert.ok(limited);assert.ok(Number(limited.response.headers.get('retry-after'))>0);
  validateExchanges(samples,'advertising');
 }finally{await f.close();}
});
