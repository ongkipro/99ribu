import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Sql} from 'postgres';
import {runOneJob} from '../../src/jobs/worker.ts';
import {simulateSettlement,ingestSettlementEvent} from '../../src/modules/finance/settlements/local.ts';
import {simulateCollection,ingestProviderEvent} from '../../src/modules/payments/local.ts';
import {handlePayments} from '../../src/modules/payments/routes.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {simulateCodCollection,ingestCodEvent} from '../../src/modules/payments/cod-local.ts';
import {advertisingFixture} from './advertising-fixture.ts';
import {fulfillmentFixture} from './fulfillment-fixture.ts';

export async function settlementBasisFixture(){
 const prepaid=await advertisingFixture();let cod:Awaited<ReturnType<typeof fulfillmentFixture>>|undefined;
 try{
  const order=await prepaid.order(prepaid.client),paid=await prepaid.pay(prepaid.client,order.id);assert.equal(await paid.complete(),true);
  const second=await prepaid.order(prepaid.client),response=await handlePayments(prepaid.client.request(`/api/v1/orders/${second.id}/payment-attempts`,{method_id:'local-prepaid'}),prepaid.identity);assert.equal(response.status,201);const attempt=await response.json();
  const [stored]=await prepaid.identity.sql`select creation_job_id from app.payment_attempt where id=${attempt.id}`;assert.equal(await runOneJob(prepaid.identity.sql,{'payment.create':paymentAdapter(prepaid.identity.sql,'test')},stored.creation_job_id),true);
  const extra=await simulateCollection(prepaid.identity.sql,'test',attempt.id,{amount:second.buyer_total+1});assert.equal(await runOneJob(prepaid.identity.sql,{},await ingestProviderEvent(prepaid.identity.sql,extra)),true);
  cod=await fulfillmentFixture('cod');const collected=await simulateCodCollection(cod.identity.sql,'test',cod.parcels[0].shipment_id);await cod.run(await ingestCodEvent(cod.identity.sql,collected));
  const extraCod=await simulateCodCollection(cod.identity.sql,'test',cod.parcels[0].shipment_id,{reference:randomUUID()});await cod.run(await ingestCodEvent(cod.identity.sql,extraCod));
  const refusal=await simulateCodCollection(cod.identity.sql,'test',cod.parcels[1].shipment_id,{status:'refused'});await cod.run(await ingestCodEvent(cod.identity.sql,refusal));
  const rows=await prepaid.identity.sql`select receipt_id,transaction_id from app.payment_event_result where event_id in ${prepaid.identity.sql([paid.event.id,extra.id])}`;
  const [codRecovery]=await cod.identity.sql`select receipt_id,transaction_id from app.cod_event_result where event_id=${extraCod.id}`;assert.equal(codRecovery.receipt_id,null);
  const cases=[...rows.map(row=>({provider:'local.payment' as const,clock_namespace:null,transaction_id:String(row.transaction_id),receipt_id:row.receipt_id===null?null:String(row.receipt_id),source_basis:row.receipt_id===null?'recovery':'qualified'})),{provider:'local.cod' as const,clock_namespace:cod.namespace,transaction_id:String(codRecovery.transaction_id),receipt_id:null,source_basis:'recovery'}];
  assert.deepEqual(cases.map(c=>`${c.provider}:${c.source_basis}`).sort(),['local.cod:recovery','local.payment:qualified','local.payment:recovery']);
  const orders=[order.id,second.id,cod.order.id],close=async()=>{try{await cod?.close();}finally{await prepaid.close();}};
  return {identity:prepaid.identity,cases,orders,close};
 }catch(error){try{await cod?.close();}finally{await prepaid.close();}throw error;}
}
export async function assertSettlementBases(sql:Sql,f:Awaited<ReturnType<typeof settlementBasisFixture>>){
 const before=(await sql`select count(*)::int n from app.commerce_event where order_id in ${sql(f.orders)} and name='Purchase'`)[0].n;assert.equal(before,2);
 for(const c of f.cases){
  const source=await simulateSettlement(sql,'test',{provider:c.provider,reference:randomUUID(),direction:'credit',net_amount:9,clock_namespace:c.clock_namespace,statement:{gross_amount:11,carrier_fee:1,provider_fee:1,allocation_claims:[{receivable_transaction_id:c.transaction_id,gross_amount:11}],reverses_reference:null}}),job=await ingestSettlementEvent(sql,source);assert.equal(await runOneJob(sql,{},job),true);
  const [head]=await sql`select * from app.provider_settlement where operation_id=${source.operation_id}`;assert.equal(head.status,'matched',`Signed ${c.provider} ${c.source_basis} basis must match`);
  const [a]=await sql`select * from app.settlement_allocation where match_id=${head.current_match_id}`;assert.equal(a.receivable_transaction_id,c.transaction_id);assert.equal(a.receipt_id,c.receipt_id);assert.equal(a.source_basis,c.source_basis);assert.equal(Number(a.gross_amount),11);assert.equal(Number(a.net_amount),9);
  assert.equal((await sql`select status from app.outbox_job where id=${job}`)[0].status,'completed');
 }
 assert.equal((await sql`select count(*)::int n from app.commerce_event where order_id in ${sql(f.orders)} and name='Purchase'`)[0].n,before);
}
