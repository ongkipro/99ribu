import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';
import type {Sql,TransactionSql} from 'postgres';
import {connectDatabase} from '../../src/db/client.ts';
import {runOneJob} from '../../src/jobs/worker.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {createReturn,decideReturn} from '../../src/modules/returns/cases.ts';
import {ingestParcelReceiptSource,simulateParcelReceipt} from '../../src/modules/returns/receipt-source.ts';
import {ingestRefundSourceEvent,simulateRefundOutcome} from '../../src/modules/returns/refund-source.ts';
import {projectBuyerRefund,queueRefund} from '../../src/modules/returns/refunds.ts';
import {handleReturns} from '../../src/modules/returns/routes.ts';
import {refundAdapter} from '../../src/modules/returns/worker.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor} from './fulfillment-fixture.ts';
import {approvedRefundFixture} from './return-refund-fixture.ts';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const fingerprint=(value:unknown)=>digest(JSON.stringify(value));
function named(sql:Sql,name:string){return new Proxy(sql,{get(target,property,receiver){if(property==='begin')return (run:(tx:TransactionSql)=>Promise<unknown>)=>target.begin(async tx=>{await tx`select set_config('application_name',${name},true)`;return run(tx);});return Reflect.get(target,property,receiver);}}) as unknown as Sql;}
async function hold(sql:Sql,resourceId:string,kind:'order'|'case'='order'){
 let release=()=>{},entered=()=>{},failed=(_error:unknown)=>{};const released=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>((resolve,reject)=>{entered=resolve;failed=reject;});
 const done=sql.begin(async tx=>{if(kind==='case')await tx`select id from app.return_case where id=${resourceId} for update`;else await tx`select id from app.commerce_order where id=${resourceId} for update`;entered();await released;});void done.catch(failed);await ready;return {release,done};
}
async function blocked(sql:Sql,names:string[]){
 const deadline=Date.now()+5000;while(Date.now()<deadline){const [row]=await sql`select count(*)::int n from pg_stat_activity where datname=current_database() and usename=current_user and application_name=any(${names}::text[]) and wait_event_type='Lock'`;if(row.n===names.length)return;await setImmediate();}assert.fail('Every named return transaction must reach the real database lock barrier');
}

test('concurrent original-buyer claims admit one different-key winner and one immutable same-key result',async()=>{
 const f=await approvedRefundFixture(),sql=f.identity.sql,blocker=connectDatabase('test'),pending:Promise<Response>[]=[];let barrier:Awaited<ReturnType<typeof hold>>|undefined;
 try{
  const remaining=f.units.filter(unit=>unit.id!==f.unit.id);assert.ok(remaining.length>=2);
  for(const unit of remaining.slice(0,2)){
   const parcel=f.parcels.find(row=>row.shipment_id===unit.shipment_id),booking=f.bookings.find(row=>row.fulfillment_id===parcel?.id);assert.ok(booking);
   const source=await simulateParcelReceipt(sql,'test',{reference:randomUUID(),booking_id:booking.id,unit_ids:[unit.id]});assert.equal(await runOneJob(sql,{},await ingestParcelReceiptSource(sql,source)),true);
  }
  for(let phase=0;phase<2;phase++){
   const unit=remaining[phase],body={items:[{order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'defective',details:'SYNTHETIC contended original unit'}],requested_resolution:'refund'},key=randomUUID(),names=[`s31-${randomUUID()}`,`s31-${randomUUID()}`];pending.length=0;
   barrier=await hold(blocker.sql,f.order.id);
   for(let i=0;i<2;i++)pending.push(handleReturns(f.client.request(`/api/v1/orders/${f.order.id}/returns`,body,{key:phase===1?key:randomUUID()}),{...f.identity,sql:named(sql,names[i])}));
   try{await blocked(sql,names);}finally{barrier.release();await barrier.done;}
   const results=await Promise.all(pending),bodies=await Promise.all(results.map(response=>response.json()));
   assert.deepEqual(results.map(response=>response.status).sort(),phase===0?[201,409]:[201,201]);
   if(phase===1)assert.deepEqual(bodies[0],bodies[1]);else assert.equal(bodies[results.findIndex(response=>response.status===409)].code,'RETURN_QUANTITY_ALREADY_CLAIMED');
   assert.equal((await sql`select count(*)::int n from app.return_item where fulfillment_item_id=${unit.id} and claim_state<>'released'`)[0].n,1);
  }
  assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_obligation'`)[0].n,1);assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_cash'`)[0].n,0);
 }finally{barrier?.release();if(barrier)await barrier.done;await Promise.allSettled(pending);await blocker.sql.end();await f.close();}
});

test('two independently authenticated finance retries serialize on original-order CAS and consume exactly one bound proof',async()=>{
 const f=await approvedRefundFixture(),sql=f.identity.sql,blocker=connectDatabase('test'),pending:Promise<Response>[]=[];let extra:Awaited<ReturnType<typeof actor>>|undefined,barrier:Awaited<ReturnType<typeof hold>>|undefined;
 try{
  assert.equal(await runOneJob(sql,{'refund.create':refundAdapter(sql,'test')},f.jobId),true);const failed=await simulateRefundOutcome(sql,'test',f.refund.id,'failed');assert.equal(await runOneJob(sql,{},await ingestRefundSourceEvent(sql,failed)),true);
  const originalResult=fingerprint(await sql`select revision,refund_event_id,cash_transaction_id from app.refund_event_result where event_id=${failed.id}`),head=await sql.begin(tx=>projectBuyerRefund(tx,f.refund.id));
  extra=await actor(f.identity,'finance',[]);await enroll(extra.browser,extra.password);await sql`update app.role_grant set permissions=${['finance.refunds.read','finance.refunds.write']},revision=revision+1 where user_id=${extra.id}`;
  const proofRequest=extra.browser.request('/api/v1/me/reauthentication-proofs',{password:extra.password,action:'finance.refund',subject_id:f.refund.id});proofRequest.headers.set('idempotency-key',randomUUID());const proofResponse=await handleAccess(proofRequest,f.identity);assert.equal(proofResponse.status,201);
  const proofs=[await f.proof(f.refund.id),(await proofResponse.json()).proof as string],actors=[f.finance,extra],names=actors.map(()=>`s31-${randomUUID()}`);
  barrier=await hold(blocker.sql,f.order.id);
  for(let i=0;i<2;i++){const input={action:'retry',expected_version:head.version,reason:'SYNTHETIC competing explicit bank-failure retry',reauthentication_proof:proofs[i]},request=actors[i].browser.request(`/api/v1/admin/refunds/${f.refund.id}/reconciliations`,input);request.headers.set('idempotency-key',randomUUID());pending.push(handleReturns(request,{...f.identity,sql:named(sql,names[i])}));}
  try{await blocked(sql,names);}finally{barrier.release();await barrier.done;}
  const responses=await Promise.all(pending);assert.deepEqual(responses.map(response=>response.status).sort(),[202,409]);for(const response of responses)if(response.status===409)assert.equal((await response.json()).code,'VERSION_CONFLICT');
  assert.equal((await sql`select count(*)::int n from app.access_proof where digest=any(${proofs.map(digest)}::text[]) and consumed_at is not null`)[0].n,1);
  const [current]=await sql`select current_job_id from app.refund where id=${f.refund.id}`;assert.notEqual(current.current_job_id,f.jobId);assert.equal((await sql`select payload from app.outbox_job where id=${current.current_job_id}`)[0].payload.attempt,2);
  assert.equal(await runOneJob(sql,{'refund.create':refundAdapter(sql,'test')},current.current_job_id),true);assert.equal(await runOneJob(sql,{},await ingestRefundSourceEvent(sql,await simulateRefundOutcome(sql,'test',f.refund.id,'succeeded'))),true);
  assert.equal(fingerprint(await sql`select revision,refund_event_id,cash_transaction_id from app.refund_event_result where event_id=${failed.id}`),originalResult);assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_cash'`)[0].n,1);
 }finally{barrier?.release();if(barrier)await barrier.done;await Promise.allSettled(pending);await blocker.sql.end();if(extra)await closeFulfillmentActor(f.identity,extra);await f.close();}
});

test('simultaneous original-unit bank callbacks conserve one receipt and retain historical adjustment prefixes',async()=>{
 const f=await approvedRefundFixture(),sql=f.identity.sql,blocker=connectDatabase('test'),pending:Promise<boolean>[]=[];let barrier:Awaited<ReturnType<typeof hold>>|undefined;
 try{
  const originalPurchases=fingerprint(await sql`select id,receipt_id,occurred_at,payload from app.commerce_event where order_id=${f.order.id} and name='Purchase' order by id`),unit=f.units.find(row=>row.id!==f.unit.id);assert.ok(unit);
  const parcel=f.parcels.find(row=>row.shipment_id===unit.shipment_id),booking=f.bookings.find(row=>row.fulfillment_id===parcel?.id);assert.ok(booking);const receipt=await simulateParcelReceipt(sql,'test',{reference:randomUUID(),booking_id:booking.id,unit_ids:[unit.id]});assert.equal(await runOneJob(sql,{},await ingestParcelReceiptSource(sql,receipt)),true);
  const input={items:[{order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'damaged',details:'SYNTHETIC second whole unit of the same original payment'}],requested_resolution:'refund'},claim=await createReturn(f.client.request(`/api/v1/orders/${f.order.id}/returns`,input),f.identity,f.buyer,f.order.id,input) as {id:string};
  const decision={decision:'approve_refund',expected_version:1,requires_goods:false,reason:'SYNTHETIC explicit second company-fault physical waiver'},decisionRequest=f.owner.browser.request(`/api/v1/admin/returns/${claim.id}/decisions`,decision);decisionRequest.headers.set('idempotency-key',randomUUID());await decideReturn(decisionRequest,f.identity,f.principal,claim.id,decision);
  const queue={return_case_id:claim.id,expected_version:2,reason:'SYNTHETIC distinct original-unit obligation',reauthentication_proof:await f.proof(claim.id)},second=await queueRefund(f.financeRequest('/api/v1/admin/refunds',queue),f.identity,f.financePrincipal,queue) as {id:string;amount:number};
  const heads=await sql`select id,current_job_id from app.refund where id=any(${[f.refund.id,second.id]}::uuid[]) order by id`,jobs:string[]=[];
  for(const head of heads){assert.equal(await runOneJob(sql,{'refund.create':refundAdapter(sql,'test')},head.current_job_id),true);jobs.push(await ingestRefundSourceEvent(sql,await simulateRefundOutcome(sql,'test',head.id,'succeeded')));}
  const names=jobs.map(()=>`s31-${randomUUID()}`);barrier=await hold(blocker.sql,f.order.id);
  for(let i=0;i<jobs.length;i++)pending.push(runOneJob(named(sql,names[i]),{},jobs[i]));
  try{await blocked(sql,names);}finally{barrier.release();await barrier.done;}
  assert.deepEqual(await Promise.all(pending),[true,true]);assert.ok((await sql`select status from app.outbox_job where id=any(${jobs}::uuid[])`).every(row=>row.status==='completed'));
  const intents=await sql`select receipt_id,sequence,merchandise_refunded,retained_merchandise from app.refund_adjustment_intent where refund_id=any(${[f.refund.id,second.id]}::uuid[]) order by sequence`;assert.equal(intents.length,2);assert.equal(intents[0].receipt_id,intents[1].receipt_id);
  const [original]=await sql`select merchandise_amount from app.economic_receipt where id=${intents[0].receipt_id}`;for(let i=0;i<2;i++){assert.equal(intents[i].sequence,i+1);assert.equal(Number(intents[i].merchandise_refunded),99000);assert.equal(Number(intents[i].retained_merchandise),Number(original.merchandise_amount)-99000*(i+1));}
  assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_cash'`)[0].n,2);assert.equal(Number((await sql`select sum(p.amount)::text amount from app.finance_posting p join app.finance_transaction t on t.id=p.transaction_id where t.order_id=${f.order.id} and t.kind='refund_cash' and p.account='company_cash' and p.side='credit'`)[0].amount),f.refund.amount+second.amount);
  assert.equal(fingerprint(await sql`select id,receipt_id,occurred_at,payload from app.commerce_event where order_id=${f.order.id} and name='Purchase' order by id`),originalPurchases);
 }finally{barrier?.release();if(barrier)await barrier.done;await Promise.allSettled(pending);await blocker.sql.end();await f.close();}
});


test('buyer return list keeps each case version and refund child facts coherent while finance queues its obligation',async()=>{
 const f=await approvedRefundFixture(),sql=f.identity.sql,blocker=connectDatabase('test'),pending:Promise<Response>[]=[];let barrier:Awaited<ReturnType<typeof hold>>|undefined;
 try{
  const unit=f.units.find(row=>row.id!==f.unit.id);assert.ok(unit);const parcel=f.parcels.find(row=>row.shipment_id===unit.shipment_id),booking=f.bookings.find(row=>row.fulfillment_id===parcel?.id);assert.ok(booking);
  assert.equal(await runOneJob(sql,{},await ingestParcelReceiptSource(sql,await simulateParcelReceipt(sql,'test',{reference:randomUUID(),booking_id:booking.id,unit_ids:[unit.id]}))),true);
  const input={items:[{order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'damaged',details:'SYNTHETIC concurrently listed original-unit case'}],requested_resolution:'refund'},claim=await createReturn(f.client.request(`/api/v1/orders/${f.order.id}/returns`,input),f.identity,f.buyer,f.order.id,input) as {id:string};
  const decision={decision:'approve_refund',expected_version:1,requires_goods:false,reason:'SYNTHETIC explicit original company-fault waiver'},decisionRequest=f.owner.browser.request(`/api/v1/admin/returns/${claim.id}/decisions`,decision);decisionRequest.headers.set('idempotency-key',randomUUID());await decideReturn(decisionRequest,f.identity,f.principal,claim.id,decision);
  const queue={return_case_id:claim.id,expected_version:2,reason:'SYNTHETIC obligation racing a genuine buyer case list',reauthentication_proof:await f.proof(claim.id)},names=[`s31-read-${randomUUID()}`,`s31-write-${randomUUID()}`],path=`/api/v1/orders/${f.order.id}/returns?limit=1`;
  barrier=await hold(blocker.sql,claim.id,'case');
  pending.push(handleReturns(f.client.request(path),{...f.identity,sql:named(sql,names[0])}));
  await blocked(sql,[names[0]]);
  const [reader]=await sql`select query from pg_stat_activity where application_name=${names[0]} and wait_event_type='Lock'`;assert.ok(reader);assert.match(reader.query,/from app\.return_case.*for share/i);
  pending.push(handleReturns(f.financeRequest('/api/v1/admin/refunds',queue),{...f.identity,sql:named(sql,names[1])}));
  try{await blocked(sql,names);}finally{barrier.release();await barrier.done;}
  const [listedResponse,queuedResponse]=await Promise.all(pending);assert.equal(listedResponse.status,200);assert.equal(queuedResponse.status,202);const listed=await listedResponse.json(),refund=await queuedResponse.json(),before=listed.data[0];
  assert.equal(before.id,claim.id);assert.equal(before.version,2);assert.equal(before.status,'approved');assert.deepEqual(before.refund_ids,[]);assert.equal('refund_amount' in before,false);
  const currentResponse=await handleReturns(f.client.request(path),f.identity);assert.equal(currentResponse.status,200);const current=(await currentResponse.json()).data[0];assert.equal(current.id,claim.id);assert.equal(current.version,3);assert.equal(current.status,'refunding');assert.deepEqual(current.refund_ids,[refund.id]);assert.equal(current.refund_amount,refund.amount);
  assert.equal((await sql`select count(*)::int n from app.refund where case_id=${claim.id}`)[0].n,1);assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_cash'`)[0].n,0);
 }finally{barrier?.release();if(barrier)await barrier.done;await Promise.allSettled(pending);await blocker.sql.end();await f.close();}
});
