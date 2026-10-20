import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {handleAffiliateRates} from '../../src/modules/affiliates/routes.ts';
import {actor} from '../contract/access-fixture.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {closeFulfillmentActor} from './fulfillment-fixture.ts';
import {returnFixture} from './return-fixture.ts';

test('owner rate cookie adapter enforces private proof, prospective CAS and current authority while retaining immutable retries',async()=>{
 const f=await returnFixture('prepaid'),affiliate=await actor(f.identity,'affiliate',[]),sql=f.identity.sql,samples:Exchange[]=[];
 try{
  const [account]=await sql`insert into app.affiliate_account (user_id) values (${affiliate.id}) returning id`,root=`/api/v1/admin/affiliates/${account.id}/rates`;
  const proof=async()=>{const request=f.owner.browser.request('/api/v1/me/reauthentication-proofs',{password:f.owner.password,action:'affiliate_rate.version',subject_id:account.id});request.headers.set('idempotency-key',randomUUID());const response=await handleAccess(request,f.identity);assert.equal(response.status,201);return String((await response.json()).proof);};
  const command=(body:Record<string,unknown>,key=randomUUID(),browser=f.owner.browser)=>{const request=browser.request(root,body);request.headers.set('idempotency-key',key);return request;};
  const observe=async(request:Request,valid=true)=>{
   const text=await request.clone().text(),response=await handleAffiliateRates(request,f.identity),payload=await response.json(),headers=Object.fromEntries(response.headers);
   for(const [name,value] of [['cache-control','no-store'],['referrer-policy','no-referrer'],['x-content-type-options','nosniff']])assert.equal(headers[name],value);
   samples.push({url:request.url,method:request.method,request_headers:Object.fromEntries(request.headers),request_body:text,body_bytes:Buffer.byteLength(text),request_valid:valid,status:response.status,headers,payload});return {status:response.status,payload};
  };
  const expected=async(result:ReturnType<typeof observe>,status:number)=>{const value=await result;assert.equal(value.status,status,`Safe affiliate rate code ${value.payload.code??'none'}`);return value.payload;};
  const body={basis_points:0,effective_at:null,expected_version:0,reason:'SYNTHETIC actual owner rate endpoint',reauthentication_proof:await proof()},key=randomUUID();
  const anonymous=command(body);anonymous.headers.delete('cookie');await expected(observe(anonymous),401);
  await expected(observe(command(body,randomUUID(),f.finance.browser)),403);
  await expected(observe(command({...body,commission_amount:99000}),false),400);
  const first=await expected(observe(command(body,key)),201);
  assert.deepEqual(Object.keys(first).sort(),['affiliate_id','basis_points','effective_at','id','version']);assert.equal(first.affiliate_id,account.id);assert.equal(first.basis_points,0);assert.equal(first.version,1);
  assert.deepEqual(await expected(observe(command(body,key)),201),first);
  await expected(observe(command({...body,basis_points:100},key)),409);
  const staleProof=await proof(),stale={...body,basis_points:100,reauthentication_proof:staleProof};
  await expected(observe(command(stale)),409);
  assert.equal((await sql`select consumed_at from app.access_proof where digest=${createHash('sha256').update(staleProof).digest('hex')}`)[0].consumed_at,null);
  const retroactive={...body,expected_version:1,effective_at:'2020-01-01T00:00:00.000Z',reauthentication_proof:staleProof};await expected(observe(command(retroactive)),400);
  await sql`update app.auth_user set email_verified=false where id=${affiliate.id}`;
  try{
   assert.deepEqual(await expected(observe(command(body,key)),201),first);
   await expected(observe(command({...body,expected_version:1,reauthentication_proof:staleProof})),409);
  }finally{await sql`update app.auth_user set email_verified=true where id=${affiliate.id}`;}
  for(const header of ['authorization','x-cart-token','x-order-token']){const request=command(body,key);request.headers.set(header,'SYNTHETIC unsupported transport');await expected(observe(request),401);}
  const foreign=command(body,key);foreign.headers.set('origin','https://foreign.invalid');await expected(observe(foreign),403);
  const badMedia=command(body,key);badMedia.headers.set('content-type','text/plain');await expected(observe(badMedia,false),415);
  await expected(observe(command({...body,reason:'x'.repeat(17000)}),false),413);
  await sql`update app.auth_user set email_verified=false where id=${f.owner.id}`;
  try{await expected(observe(command(body,key)),401);}finally{await sql`update app.auth_user set email_verified=true where id=${f.owner.id}`;}
  assert.equal((await sql`select count(*)::int n from app.affiliate_rate_version where affiliate_id=${account.id}`)[0].n,1);
  assert.ok(samples.some(sample=>sample.status===201)&&samples.some(sample=>sample.status>=400));
  validateExchanges(samples,'affiliate-rates');
 }finally{try{await closeFulfillmentActor(f.identity,affiliate);}finally{await f.close();}}
});
