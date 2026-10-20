import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {handleSettlements} from '../../src/modules/finance/settlements/routes.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {closeFulfillmentActor} from './fulfillment-fixture.ts';
import {settlementFixture} from './settlement-fixture.ts';

test('app-role settlement wire enforces finance grants/proofs, private historical truth and all five OpenAPI operations',async()=>{
 const f=await settlementFixture(),finance=await actor(f.identity,'finance',[]),samples:Exchange[]=[];
 const anonymous={request:(path:string,body?:Record<string,unknown>)=>new Request(`http://127.0.0.1:3099${path}`,{method:body?'POST':'GET',headers:{origin:'http://127.0.0.1:3099','content-type':'application/json'},body:body?JSON.stringify(body):undefined})};
 const observe=async(path:string,body:Record<string,unknown>|undefined,expected:number,browser:{request(path:string,body?:Record<string,unknown>):Request}=finance.browser,options:{key?:string;valid?:boolean;headers?:Record<string,string>}={})=>{
  const request=browser.request(path,body),key=options.key??randomUUID();if(body)request.headers.set('idempotency-key',key);for(const [name,value] of Object.entries(options.headers??{}))request.headers.set(name,value);
  const response=await handleSettlements(request,f.identity),payload=await response.json();assert.equal(response.status,expected,`Observed settlement wire: ${payload.code??'success'}`);
  samples.push({url:request.url,method:request.method,request_headers:{'content-type':request.headers.get('content-type')??'',...(body?{'idempotency-key':key}:{})},...(body?{request_body:JSON.stringify(body),body_bytes:Buffer.byteLength(JSON.stringify(body))}:{}),request_valid:options.valid??true,status:response.status,headers:Object.fromEntries(response.headers),payload});return payload;
 };
 const proof=async()=>{
  const request=finance.browser.request('/api/v1/me/reauthentication-proofs',{password:finance.password,action:'finance.reconcile',subject_id:f.head.id});request.headers.set('idempotency-key',randomUUID());const response=await handleAccess(request,f.identity);assert.equal(response.status,201);return (await response.json()).proof as string;
 };
 try{
  assert.equal((await f.identity.sql`select current_user name`)[0].name,'99ribu_test_app');await enroll(finance.browser,finance.password);
  const sourceRoot=`/api/v1/admin/settlements/${f.source.operation_id}`,input={action:'match',expected_version:1,expected_match_id:null,source_reference:f.source.statement_id,reason:'SYNTHETIC finance verification',allocations:[{receivable_transaction_id:f.receipts[0].transaction_id,gross_amount:11}],reauthentication_proof:'SYNTHETIC-NOT-ISSUED'},endpoints:[string,Record<string,unknown>|undefined][]=[['/api/v1/admin/reconciliation',undefined],[f.root,undefined],[sourceRoot,undefined],[`${f.root}/decisions`,input],[`${f.root}/matches/${randomUUID()}`,undefined]];
  for(const [path,body] of endpoints){await observe(path,body,401,anonymous);await observe(path,body,403);}
  await f.identity.sql`update app.role_grant set permissions=${['finance.reconciliation.read']} where user_id=${finance.id}`;
  const list=await observe(`/api/v1/admin/reconciliation?reference=${f.source.reference}&limit=1`,undefined,200);assert.equal(list.data.length,1);assert.equal(list.data[0].id,f.head.id);
  const initial=await observe(f.root,undefined,200);assert.equal(initial.match,null);assert.equal(initial.item.amount,9);assert.equal(initial.item.recorded_fees.carrier_fee,1);await observe(sourceRoot,undefined,200);
  await observe(`${f.root}/decisions`,input,403);
  await observe(`${f.root}?paid=true`,undefined,400,finance.browser,{valid:false});await observe(`${sourceRoot}?before=2147483648`,undefined,400,finance.browser,{valid:false});
  await observe('/api/v1/admin/reconciliation?reference=bad%20reference',undefined,400,finance.browser,{valid:false});await observe('/api/v1/admin/reconciliation?limit=1&limit=2',undefined,400,finance.browser,{valid:false});
  await observe(f.root,undefined,401,finance.browser,{headers:{authorization:'Bearer SYNTHETIC-UNSUPPORTED'}});await observe(f.root,undefined,403,finance.browser,{headers:{host:'foreign.invalid'}});
  await f.identity.sql`update app.role_grant set permissions=${['finance.reconciliation.read','finance.reconciliation.write']} where user_id=${finance.id}`;
  await observe(`${f.root}/decisions`,input,403);const token=await proof(),key=randomUUID(),valid={...input,reauthentication_proof:token};
  await observe(`${f.root}/decisions`,{...valid,company_cash_received:true},400,finance.browser,{valid:false});await observe(`${f.root}/decisions`,{...valid,expected_version:2},409);
  const hundred={...valid,reason:'界'.repeat(500),allocations:Array.from({length:100},()=>({receivable_transaction_id:randomUUID(),gross_amount:Number.MAX_SAFE_INTEGER,reopens_allocation_id:randomUUID()}))};assert.ok(Buffer.byteLength(JSON.stringify(hundred))>16384);
  assert.equal((await observe(`${f.root}/decisions`,hundred,422)).code,'SETTLEMENT_GROSS_EXCEEDED');
  await observe(`${f.root}/decisions`,{...valid,reason:'x'.repeat(32769)},413,finance.browser,{valid:false});
  await observe(`${f.root}/decisions`,valid,415,finance.browser,{valid:false,headers:{'content-type':'text/plain'}});
  const matched=await observe(`${f.root}/decisions`,valid,201,finance.browser,{key});assert.equal(matched.status,'matched');assert.equal(matched.version,2);
  assert.deepEqual(await observe(`${f.root}/decisions`,valid,201,finance.browser,{key}),matched);
  const historic=await observe(`${f.root}/matches/${matched.current_match_id}`,undefined,200);assert.equal(historic.active,true);assert.equal(historic.totals.gross_amount,11);assert.equal(historic.allocations[0].receipt_id,f.receipts[0].id);assert.deepEqual(historic.remaining,{gross_amount:0,net_amount:0,carrier_fee:0,provider_fee:0});
  await observe(`${f.root}/matches/${matched.current_match_id}?paid=true`,undefined,400,finance.browser,{valid:false});await observe(`${f.root}/matches/${randomUUID()}`,undefined,404);
  const unmatched=await observe(`${f.root}/decisions`,{...valid,action:'unmatch',expected_version:2,expected_match_id:matched.current_match_id,allocations:[],reauthentication_proof:await proof()},201);assert.equal(unmatched.status,'pending');assert.equal(unmatched.cash_transaction_id,matched.cash_transaction_id);assert.equal(unmatched.fee_transaction_id,matched.fee_transaction_id);
  const after=await observe(`${f.root}/matches/${matched.current_match_id}`,undefined,200);assert.equal(after.active,false);assert.deepEqual(after.allocations,historic.allocations);assert.deepEqual(after.totals,historic.totals);
  await f.identity.sql`update app.role_grant set permissions=${['finance.reconciliation.read']} where user_id=${finance.id}`;await observe(`${f.root}/decisions`,valid,403,finance.browser,{key});await observe(f.root,undefined,200);
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where order_id=${f.order.id} and name='Purchase'`)[0].n,2);
  validateExchanges(samples,'settlements');
 }finally{await closeFulfillmentActor(f.identity,finance);await f.close();}
});
