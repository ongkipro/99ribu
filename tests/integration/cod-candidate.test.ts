import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';
import {processDatabaseJob,type DatabaseJob} from '../../src/jobs/worker.ts';
import {postEconomicReceipt} from '../../src/modules/finance/receipts.ts';
import {confirmCodOrder,projectCodCollections} from '../../src/modules/payments/cod.ts';
import {codSourceEvent,registerCodEvent} from '../../src/modules/payments/cod-local.ts';
import {financeFixture} from './finance-ledger-fixture.ts';

test('unapplied COD model enforces signed original per-parcel money, partial/full Purchase, refusal, duplicate and recovery in a rolled-back real transaction',async()=>{
 const f=await financeFixture(),owner=connectDatabase('test','owner'),rollback=new Error('Expected COD candidate rollback');let stage='prepare',statementIndex=0;
 try{
  const prepaid=await f.order(),order=await f.order('cod',4);assert.equal(order.shipments.length,2);
  await assert.rejects(owner.sql.begin(async tx=>{
   stage='ddl';const [installed]=await tx`select to_regclass('app.cod_confirmation') is not null installed`;
   if(!installed.installed)for(const statement of readFileSync('migrations/0018_cod_collections.sql','utf8').split('--> statement-breakpoint'))if(statement.trim()){statementIndex++;await tx.unsafe(statement);}
   stage='confirmation';const confirmation=await confirmCodOrder(tx,order.id);assert.equal((await confirmCodOrder(tx,order.id)).id,confirmation.id);
   await assert.rejects(confirmCodOrder(tx,prepaid.id),{code:'COD_NOT_APPLICABLE'});
   const initial=await projectCodCollections(tx,order.id);assert.equal(initial.version,2);assert.equal(initial.collected_total,0);assert.equal(initial.parcels.reduce((n,p)=>n+p.amount_due,0),order.buyer_total);assert.ok(initial.parcels.every(p=>p.status==='due'));
   await assert.rejects(tx.savepoint(t=>t`update app.commerce_order set revision=3,payment_status='confirmed' where id=${order.id}`),{code:'23514'});
   stage='source';const first=await codSourceEvent(tx,'test',initial.parcels[0].id),firstJob=await registerCodEvent(tx,first);assert.equal(await registerCodEvent(tx,first),firstJob);
   await assert.rejects(registerCodEvent(tx,{...first,amount:first.amount+1}),{code:'INVALID_COD_SIGNATURE'});
   await assert.rejects(registerCodEvent(tx,{...first,paid:true}),{code:'INVALID_INPUT'});
   const job=async(jobId:string)=>{const [job]=await tx<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where id=${jobId}`;return job;};
   stage='missing Purchase negative';await assert.rejects(tx.savepoint(async t=>{
    const receipt=await postEconomicReceipt(t,{order_id:order.id,shipment_id:first.shipment_id,source:'local.cod',environment:'test',event_id:first.id,effect_reference:first.operation_id,amount:first.amount,occurred_at:first.occurred_at});
    await t`insert into app.cod_event_result (event_id,outcome,reason,receipt_id,transaction_id) values (${first.id},'collected','verified_collection',${receipt.id},${receipt.transaction_id})`;
    await t`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at) values (${order.id},3,'pending','partially_collected','Negative missing-Purchase seal proof',${first.id},${first.occurred_at})`;
    await t`update app.commerce_order set revision=3,payment_status='partially_collected' where id=${order.id}`;
    await t`update app.outbox_job set status='completed',completed_at=clock_timestamp(),result=${JSON.stringify({event_id:first.id,outcome:'collected'})}::jsonb where id=${firstJob}`;
    await t`set constraints all immediate`;
   }),{code:'23514'});
   assert.equal((await tx`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,0);
   stage='first actual callback';await processDatabaseJob(tx,await job(firstJob));await tx`set constraints all deferred`;
   const partial=await projectCodCollections(tx,order.id);assert.equal(partial.version,3);assert.equal(partial.collected_total,first.amount);assert.equal((await tx`select payment_status from app.commerce_order where id=${order.id}`)[0].payment_status,'partially_collected');
   stage='refusal';const refused=await codSourceEvent(tx,'test',initial.parcels[1].id,{status:'refused'});await processDatabaseJob(tx,await job(await registerCodEvent(tx,refused)));await tx`set constraints all deferred`;
   const refusal=await projectCodCollections(tx,order.id);assert.equal(refusal.parcels.find(p=>p.id===refused.shipment_id)?.status,'refused');assert.equal(refusal.collected_total,first.amount);
   assert.equal((await tx`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,1);
   stage='second original parcel collection';const second=await codSourceEvent(tx,'test',initial.parcels[1].id,{reference:randomUUID()});await processDatabaseJob(tx,await job(await registerCodEvent(tx,second)));await tx`set constraints all deferred`;
   const complete=await projectCodCollections(tx,order.id);assert.equal(complete.version,4);assert.equal(complete.collected_total,order.buyer_total);assert.equal(complete.merchandise_collected,396000);assert.ok(complete.parcels.every(p=>p.status==='collected'));assert.equal(complete.confirmed_at,new Date(confirmation.accepted_at).toISOString());
   stage='duplicate';const duplicate=await codSourceEvent(tx,'test',first.shipment_id);assert.equal(duplicate.operation_id,first.operation_id);assert.equal(duplicate.occurred_at,first.occurred_at);await processDatabaseJob(tx,await job(await registerCodEvent(tx,duplicate)));await tx`set constraints all deferred`;
   assert.equal((await tx`select outcome from app.cod_event_result where event_id=${duplicate.id}`)[0].outcome,'duplicate');
   stage='extra cash recovery';const extraReference=randomUUID(),extra=await codSourceEvent(tx,'test',first.shipment_id,{reference:extraReference});await processDatabaseJob(tx,await job(await registerCodEvent(tx,extra)));await tx`set constraints all deferred`;
   assert.equal((await tx`select outcome,receipt_id from app.cod_event_result where event_id=${extra.id}`)[0].outcome,'recovery');
   const extraRepeat=await codSourceEvent(tx,'test',first.shipment_id,{reference:extraReference});await processDatabaseJob(tx,await job(await registerCodEvent(tx,extraRepeat)));await tx`set constraints all deferred`;
   assert.equal((await tx`select outcome from app.cod_event_result where event_id=${extraRepeat.id}`)[0].outcome,'duplicate');
   stage='allocation and immutability';const events=await tx`select e.id,e.receipt_id,e.merchandise_amount,r.shipment_id from app.commerce_event e join app.economic_receipt r on r.id=e.receipt_id where e.order_id=${order.id} and e.name='Purchase'`;assert.equal(events.length,2);assert.equal(events.reduce((n,e)=>n+Number(e.merchandise_amount),0),396000);
   for(const event of events){const [units]=await tx`select count(*)::int n from app.fulfillment_item where shipment_id=${event.shipment_id}`;const [allocation]=await tx`select sum(quantity)::int n,sum(merchandise_amount)::text amount from app.purchase_allocation where event_id=${event.id}`;assert.equal(allocation.n,units.n);assert.equal(Number(allocation.amount),units.n*99000);}
   assert.equal((await tx`select count(*)::int n from app.ad_event_outbox where event_id in ${tx(events.map(e=>e.id))} and status='suppressed'`)[0].n,6);
   const [otherItem]=await tx`select id from app.order_item where order_id=${prepaid.id}`;
   await assert.rejects(tx.savepoint(async t=>{await t`insert into app.purchase_allocation (event_id,order_item_id,quantity,merchandise_amount) values (${events[0].id},${otherItem.id},1,99000)`;await t`set constraints all immediate`;}),{code:'23514'});
   await assert.rejects(tx.savepoint(t=>t`update app.cod_confirmation set accepted_at=accepted_at+interval '1 second' where id=${confirmation.id}`),{code:'23514'});
   await assert.rejects(tx.savepoint(t=>t`update app.local_cod_event set amount=amount+1 where id=${first.id}`),{code:'23514'});
   assert.equal((await tx`select count(*)::int n from app.finance_posting p join app.finance_transaction j on j.id=p.transaction_id where j.order_id=${order.id} and p.account='company_cash'`)[0].n,0);
   assert.equal((await projectCodCollections(tx,order.id)).version,4);stage='final seals';await tx`set constraints all immediate`;throw rollback;
  }),error=>{if(error===rollback)return true;const safe=error as {code?:unknown;constraint_name?:unknown;position?:unknown};assert.fail(`COD candidate failed at ${stage}/${statementIndex} (${String(safe.code??'domain')}/${String(safe.constraint_name??'constraint')}/${String(safe.position??'position')})`);});
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,0);
 }finally{await owner.sql.end();await f.close();}
});
