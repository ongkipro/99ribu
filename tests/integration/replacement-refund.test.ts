import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {createReturn,decideReturn} from '../../src/modules/returns/cases.ts';
import {inspectReturn} from '../../src/modules/returns/inspection.ts';
import {simulateReplacementReceipt,ingestReplacementReceiptSource} from '../../src/modules/returns/replacement-receipts.ts';
import {acceptRefundDestination,queueRefund,projectBuyerRefund} from '../../src/modules/returns/refunds.ts';
import {createRefundDestinationSource,simulateRefundOutcome,ingestRefundSourceEvent} from '../../src/modules/returns/refund-source.ts';
import {refundAdapter} from '../../src/modules/returns/worker.ts';
import {replacementFixture} from './replacement-fixture.ts';

for(const method of ['cod','prepaid'] as const)test(`${method} refund of a received replacement quarantines its components and spends only the original unit entitlement`,async()=>{
 const f=await replacementFixture(method),sql=f.sql;let stage='original financial snapshot';
 try{
  const immutable=async()=>JSON.stringify({receipts:await sql`select to_jsonb(r) row from app.economic_receipt r where order_id=${f.order.id} order by id`,
   purchases:await sql`select to_jsonb(e) row from app.commerce_event e where order_id=${f.order.id} and name='Purchase' order by id`,
   parcels:await sql`select to_jsonb(s) row from app.order_shipment s where order_id=${f.order.id} order by id`});
  const original=await immutable();
  const run=async(jobId:string)=>{assert.equal(await runOneJob(sql,{'refund.create':refundAdapter(sql,'test')},jobId),true);const [job]=await sql`select status,last_error from app.outbox_job where id=${jobId}`;assert.equal(job.status,'completed',`Stage ${stage}; safe worker code ${job.last_error??'none'}`);};
  stage='actual zero-charge physical shipment and later signed replacement receipt';
  await f.act('prepare');await f.act('book');const bookingId=f.head.booking_id;assert.ok(bookingId);
  execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','test','--issue-replacement-waybill',bookingId],{timeout:15000,stdio:'pipe'});
  await f.act('handover');
  await sql`update app.local_fixture_namespace set clock=clock+interval '2 hours',revision=revision+1 where name=${f.namespace}`;
  const delivered=await simulateReplacementReceipt(sql,'test',{reference:randomUUID(),booking_id:bookingId,unit_ids:f.head.items.map((item:{id:string})=>item.id)});
  await run(await ingestReplacementReceiptSource(sql,delivered));
  const unit=f.head.items[0],buyer=await commerceActor(f.client.request('/api/v1/carts'),f.identity);assert.ok(buyer);
  const [economicUnit]=await sql`select f.id,f.buyer_shipping,r.id receipt_id from app.fulfillment_item f join app.economic_receipt r on r.order_id=${f.order.id}
    and (r.kind='prepaid' or (r.kind='cod' and r.shipment_id=f.shipment_id)) where f.id=${unit.original_fulfillment_item_id}`;
  const input={items:[{order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'defective',details:'SYNTHETIC replacement itself arrived defective'}],requested_resolution:'refund'};
  stage='new physical receipt owns this claim window while the original economic root is retained';
  const created=await createReturn(f.client.request(`/api/v1/orders/${f.order.id}/returns`,input),f.identity,buyer,f.order.id,input) as {id:string};
  const [returned]=await sql`select id,fulfillment_item_id,replacement_link_id,deadline_at from app.return_item where case_id=${created.id}`;
  assert.equal(returned.fulfillment_item_id,unit.original_fulfillment_item_id);assert.equal(returned.replacement_link_id,unit.id);
  assert.equal(new Date(returned.deadline_at).getTime(),Date.parse(delivered.occurred_at)+168*60*60*1000);
  await assert.rejects(createReturn(f.client.request(`/api/v1/orders/${f.order.id}/returns`,input),f.identity,buyer,f.order.id,input),{code:'RETURN_QUANTITY_ALREADY_CLAIMED'});
  assert.deepEqual(await sql`select id,fulfillment_item_id,source_id,received_at from app.buyer_receipt where fulfillment_item_id in ${sql(f.originalReceipts.map(row=>row.fulfillment_item_id))} order by id`,f.originalReceipts);
  const decision={decision:'approve_refund',expected_version:1,reason:'SYNTHETIC defective replacement approved for original-entitlement refund'};
  await decideReturn(f.command(`/api/v1/admin/returns/${created.id}/decisions`,decision),f.identity,f.principal,created.id,decision);
  stage='actual returned replacement components enter quarantine without minting sellable stock';
  const components=await sql`select a.balance_id,a.quantity,b.on_hand,b.quarantined,b.reserved from app.replacement_component_allocation a join app.inventory_balance b on b.id=a.balance_id where a.replacement_link_id=${unit.id} order by a.balance_id`;
  assert.ok(components.length);
  const inspection={expected_version:2,result:'accepted',reason:'SYNTHETIC identified physical replacement returned',items:[{return_item_id:returned.id,goods:components.map(component=>({expected_balance_id:component.balance_id,quantity:component.quantity,identity_confirmed:true}))}]};
  await inspectReturn(f.command(`/api/v1/admin/returns/${created.id}/inspections`,inspection),f.identity,f.principal,created.id,inspection);
  for(const component of components){const [after]=await sql`select on_hand,quarantined,reserved from app.inventory_balance where id=${component.balance_id}`;
   assert.equal(after.on_hand-component.on_hand,component.quantity);assert.equal(after.quarantined-component.quarantined,component.quantity);
   assert.equal(after.on_hand-after.reserved-after.quarantined,component.on_hand-component.reserved-component.quarantined);
  }
  const duplicate={...inspection,expected_version:3,result:'record_goods'};
  await assert.rejects(inspectReturn(f.command(`/api/v1/admin/returns/${created.id}/inspections`,duplicate),f.identity,f.principal,created.id,duplicate),{code:'RETURN_COMPONENT_ALREADY_RECEIVED'});
  const proofRequest=f.finance.browser.request('/api/v1/me/reauthentication-proofs',{password:f.finance.password,action:'finance.refund',subject_id:created.id});proofRequest.headers.set('idempotency-key',randomUUID());
  const proofResponse=await handleAccess(proofRequest,f.identity);assert.equal(proofResponse.status,201);
  const queue={return_case_id:created.id,expected_version:3,reason:'SYNTHETIC replacement refund uses only original collected amount',reauthentication_proof:String((await proofResponse.json()).proof)};
  const request=f.finance.browser.request('/api/v1/admin/refunds',queue);request.headers.set('idempotency-key',randomUUID());
  stage='fresh finance obligation binds the original collection and frozen per-unit shipping';
  let refund=await queueRefund(request,f.identity,f.financePrincipal,queue) as Awaited<ReturnType<typeof projectBuyerRefund>>;
  assert.equal(refund.amount,99000+Number(economicUnit.buyer_shipping));
  assert.deepEqual(await queueRefund(request,f.identity,f.financePrincipal,queue),refund);
  const allocations=await sql`select a.receipt_id,a.merchandise_amount,a.buyer_shipping,a.amount,r.fulfillment_item_id,r.replacement_link_id from app.refund_allocation a join app.return_item r on r.id=a.return_item_id where r.fulfillment_item_id=${unit.original_fulfillment_item_id}`;
  assert.equal(allocations.length,1);assert.equal(allocations[0].receipt_id,economicUnit.receipt_id);assert.equal(allocations[0].replacement_link_id,unit.id);
  assert.equal(Number(allocations[0].merchandise_amount),99000);assert.equal(Number(allocations[0].amount),refund.amount);
  assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_cash'`)[0].n,0);
  if(method==='cod'){
   const source=await createRefundDestinationSource(sql,'test',refund.id),body={destination_source_id:source.id,expected_version:refund.version};
   refund=await acceptRefundDestination(f.client.request(`/api/v1/orders/${f.order.id}/refunds/${refund.id}/destinations`,body),f.identity,buyer,f.order.id,refund.id,body) as typeof refund;
  }
  stage='original signed successful cash result resolves one original unit and one physical occurrence';
  await run((await sql`select current_job_id from app.refund where id=${refund.id}`)[0].current_job_id);
  const success=await simulateRefundOutcome(sql,'test',refund.id,'succeeded'),callback=await ingestRefundSourceEvent(sql,success);await run(callback);
  assert.equal(await runOneJob(sql,{},callback),false);
  assert.equal((await sql.begin(tx=>projectBuyerRefund(tx,refund.id))).status,'succeeded');
  assert.equal((await sql`select claim_state from app.return_item where id=${returned.id}`)[0].claim_state,'refunded');
  assert.equal((await sql`select count(*)::int n from app.refund_allocation a join app.return_item r on r.id=a.return_item_id where r.fulfillment_item_id=${unit.original_fulfillment_item_id}`)[0].n,1);
  const cash=await sql`select p.account,p.side,p.amount from app.finance_posting p join app.finance_transaction t on t.id=p.transaction_id where t.order_id=${f.order.id} and t.kind='refund_cash' order by p.account`;
  assert.deepEqual(cash.map(row=>({account:row.account,side:row.side,amount:Number(row.amount)})),[{account:'company_cash',side:'credit',amount:refund.amount},{account:'refund_payable',side:'debit',amount:refund.amount}]);
  assert.equal(await immutable(),original);
 }catch(error){const code=error&&typeof error==='object'&&'code'in error?String(error.code):'ASSERTION';throw new Error(`Replacement refund stage ${stage}; safe code ${code}; ${error instanceof Error?error.message.slice(0,240):'unknown failure'}`);
 }finally{await f.close();}
});
