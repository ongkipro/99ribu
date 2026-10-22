import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {Sql,TransactionSql} from 'postgres';
import {connectDatabase} from '../../src/db/client.ts';
import {runOneJob} from '../../src/jobs/worker.ts';
import {appendFinanceTransaction,reverseFinanceTransaction} from '../../src/modules/finance/ledger.ts';
import {settlementSourceEvent,reviseSettlementStatement,registerSettlementEvent,type SettlementSourceEvent} from '../../src/modules/finance/settlements/local.ts';
import {applySettlementFees,createSettlementMatch,advanceSettlement,type SettlementHead,type SettlementCause} from '../../src/modules/finance/settlements/core.ts';
import {simulateCodCollection,ingestCodEvent} from '../../src/modules/payments/cod-local.ts';
import {fulfillmentFixture} from '../integration/fulfillment-fixture.ts';

// Candidate DDL and real services share one rollback-only transaction. This
// cannot establish independently committed source or fresh-process evidence.
function candidateConnection(tx:TransactionSql){return new Proxy(tx,{get(target,property,receiver){if(property==='begin')return (run:(inner:TransactionSql)=>Promise<unknown>)=>target.savepoint(async inner=>{await inner`set constraints all deferred`;return run(inner);});return Reflect.get(target,property,receiver);}}) as unknown as Sql;}

test('rollback-only settlement candidate preserves authentic cash, actual fees, original receivables, version history and zero additional Purchases',async()=>{
 const f=await fulfillmentFixture('cod'),owner=connectDatabase('test','owner'),rollback=new Error('Expected full settlement candidate rollback');let stage='setup';
 try{
  assert.equal((await owner.sql`select to_regclass('app.local_settlement_operation') installed`)[0].installed,null,'Candidate is only valid before0020 application');
  for(const parcel of f.parcels){const source=await simulateCodCollection(f.identity.sql,'test',parcel.shipment_id);await f.run(await ingestCodEvent(f.identity.sql,source));}
  const receipts=await f.identity.sql`select r.* from app.economic_receipt r where r.order_id=${f.order.id} order by r.shipment_id`;assert.equal(receipts.length,2);
  await assert.rejects(owner.sql.begin(async tx=>{
   stage='candidate DDL';for(const statement of readFileSync('migrations/0020_settlement_reconciliation.sql','utf8').split('--> statement-breakpoint'))if(statement.trim())await tx.unsafe(statement);
   const sql=candidateConnection(tx),unknown={gross_amount:null,carrier_fee:null,provider_fee:null,allocation_claims:null,reverses_reference:null};
   const process=async(event:SettlementSourceEvent)=>{const job=await sql.begin(inner=>registerSettlementEvent(inner,event));assert.equal(await runOneJob(sql,{},job),true);const [stored]=await tx`select status,last_error,result from app.outbox_job where id=${job}`;assert.equal(stored.status,'completed',`Stage ${stage}; safe worker error ${stored.last_error??'none'}`);return {job,result:stored.result};};
   const balance=async(account:string)=>Number((await tx`select coalesce(sum(case p.side when 'debit' then p.amount::numeric else -p.amount::numeric end),0)::text amount from app.finance_posting p join app.finance_transaction h on h.id=p.transaction_id
    where p.account=${account} and (h.order_id=${f.order.id} or h.id in (select cash_transaction_id from app.provider_settlement) or h.id in (select fee_transaction_id from app.provider_settlement) or h.id in (select transaction_id from app.settlement_match))`)[0].amount);
   const purchases=async()=>Number((await tx`select count(*)::int n from app.commerce_event where order_id=${f.order.id} and name='Purchase'`)[0].n);
   const first=receipts[0],second=receipts[1],gross=Number(first.amount),net=gross-500,reference=randomUUID();
   const known={gross_amount:gross,carrier_fee:400,provider_fee:100,allocation_claims:[{receivable_transaction_id:first.transaction_id,gross_amount:gross}],reverses_reference:null};
   stage='later complete statement arrives before the first delivery';
   const original=await sql.begin(inner=>settlementSourceEvent(inner,'test',{provider:'local.cod',reference,direction:'credit',net_amount:net,clock_namespace:f.namespace,statement:unknown}));
   const latest=await sql.begin(inner=>reviseSettlementStatement(inner,'test',original.operation_id,1,known));
   const accepted=await process(latest);assert.equal(accepted.result.outcome,'matched');assert.equal(accepted.result.version,1);assert.equal(await balance('company_cash'),net);assert.equal(await balance('carrier_expense'),400);assert.equal(await balance('provider_fee_expense'),100);
   assert.equal((await process(original)).result.outcome,'older');
   const duplicate=await sql.begin(inner=>reviseSettlementStatement(inner,'test',original.operation_id,1,known)),duplicateResult=await process(duplicate);assert.equal(duplicateResult.result.outcome,'duplicate');
   assert.equal((await tx`select count(*)::int n from app.finance_transaction where kind='settlement_cash'`)[0].n,1);assert.equal(await purchases(),2);
   const [forward]=await tx`select a.* from app.settlement_allocation a join app.settlement_match m on m.id=a.match_id join app.provider_settlement p on p.id=m.settlement_id where p.operation_id=${original.operation_id}`;assert.equal(Number(forward.gross_amount),gross);
   stage='native event/head reciprocity rejects a future event with no head advancement';
   const [firstHead]=await tx<SettlementHead[]>`select * from app.provider_settlement where operation_id=${original.operation_id}`;
   await assert.rejects(sql.begin(async inner=>{
    await inner`insert into app.settlement_event (settlement_id,revision,status,kind,source_kind,source_id,statement_id,match_id,fee_transaction_id,applied_fee_statement_id,reason,occurred_at)
     values (${firstHead.id},${firstHead.revision+1},'matched','match','provider',${duplicate.id},${duplicate.statement_id},${firstHead.current_match_id},${firstHead.fee_transaction_id},${firstHead.applied_fee_statement_id},'SYNTHETIC orphan future transition',${duplicate.source_reported_at})`;
    await inner`set constraints all immediate`;
   }),{code:'23514',message:/Observed bank money commits with a complete reconciliation head and transition/});
   for(const mode of ['different-provider-claims','missing-callback-result'] as const){
    stage=`native ${mode} cannot commit authentic bank money with a fabricated classification or incomplete callback`;
    await assert.rejects(sql.begin(async inner=>{
     const source=await settlementSourceEvent(inner,'test',{provider:'local.cod',reference:randomUUID(),direction:'credit',net_amount:1,clock_namespace:f.namespace,statement:{gross_amount:1,carrier_fee:0,provider_fee:0,allocation_claims:[{receivable_transaction_id:mode==='different-provider-claims'?first.transaction_id:second.transaction_id,gross_amount:1}],reverses_reference:null}});
     const job=await registerSettlementEvent(inner,source),[prepared]=await inner<SettlementHead[]>`insert into app.provider_settlement (operation_id,current_statement_id,created_at) values (${source.operation_id},${source.statement_id},${source.occurred_at}) returning *`;
     const cause:SettlementCause={source_kind:'provider',source_id:source.id,actor_id:null,reason:'SYNTHETIC native callback integrity boundary',occurred_at:source.source_reported_at};
     const cash=await appendFinanceTransaction(inner,{kind:'settlement_cash',source:'local.settlement',environment:'test',effect_reference:`cash:${source.operation_id}`,order_id:null,reason:cause.reason,occurred_at:source.occurred_at,postings:[{account:'company_cash',side:'debit',amount:1},{account:'settlement_clearing',side:'credit',amount:1}]});
     const fees=await applySettlementFees(inner,prepared,source,cause),match=await createSettlementMatch(inner,prepared,source,[{receivable_transaction_id:second.transaction_id,gross_amount:1}],cause);
     const transition=await advanceSettlement(inner,prepared,source,cause,{kind:'observe',cash_transaction_id:cash.id,fee_transaction_id:fees.fee_transaction_id,applied_fee_statement_id:fees.applied_fee_statement_id,match_id:match.match_id,status:'matched',problem:null});
     if(mode==='different-provider-claims'){
      await inner`insert into app.settlement_event_result (event_id,settlement_id,head_revision,outcome,settlement_event_id) values (${source.id},${prepared.id},${transition.version},'matched',${transition.event_id})`;
      await inner`update app.outbox_job set status='completed',attempts=1,completed_at=clock_timestamp(),result=${JSON.stringify({event_id:source.id,settlement_id:prepared.id,outcome:'matched',version:transition.version})}::jsonb where id=${job}`;
     }
     await inner`set constraints all immediate`;
    }),{code:'23514',message:mode==='different-provider-claims'?/Automatic matching preserves every exact authenticated original allocation claim/:/Provider monetary transition commits with its exact result and own completed callback/});
   }
   stage='unknown newer statement preserves recorded cash, fees and the old matching exception';
   const newer=await sql.begin(inner=>reviseSettlementStatement(inner,'test',original.operation_id,2,unknown));assert.equal((await process(newer)).result.outcome,'exception');
   const [head]=await tx`select * from app.provider_settlement where operation_id=${original.operation_id}`;assert.equal(head.status,'exception');assert.equal(head.revision,2);assert.equal(head.current_statement_id,newer.statement_id);assert.equal(head.applied_fee_statement_id,latest.statement_id);assert.equal(await balance('company_cash'),net);
   await tx`update app.outbox_job set run_at=run_at where id=${duplicateResult.job}`;await tx`set constraints all immediate`;
   stage='zero-net deduction posts real expense and gross matching without a zero cash journal';
   const zero=await sql.begin(inner=>settlementSourceEvent(inner,'test',{provider:'local.cod',reference:randomUUID(),direction:'credit',net_amount:0,clock_namespace:f.namespace,statement:{gross_amount:Number(second.amount),carrier_fee:Number(second.amount)-1,provider_fee:1,allocation_claims:[{receivable_transaction_id:second.transaction_id,gross_amount:Number(second.amount)}],reverses_reference:null}}));
   const zeroResult=await process(zero);assert.equal(zeroResult.result.outcome,'matched');assert.equal((await tx`select cash_transaction_id from app.provider_settlement where operation_id=${zero.operation_id}`)[0].cash_transaction_id,null);assert.equal(await balance('company_cash'),net);assert.equal(await balance('provider_receivable'),0);assert.equal(await purchases(),2);
   stage='authenticated bank debit reopens only its original gross, net and fee portion';
   const debit=await sql.begin(inner=>settlementSourceEvent(inner,'test',{provider:'local.cod',reference:randomUUID(),direction:'debit',net_amount:net,clock_namespace:f.namespace,statement:{...known,allocation_claims:[{receivable_transaction_id:first.transaction_id,gross_amount:gross,reopens_allocation_id:forward.id}],reverses_reference:reference}}));
   assert.equal((await process(debit)).result.outcome,'matched');assert.equal(await balance('company_cash'),0);assert.equal(await balance('provider_receivable'),gross);assert.equal(await balance('carrier_expense'),Number(second.amount)-1);assert.equal(await purchases(),2);
   stage='over-reversal retains actual observed cash as unresolved clearing without another matching effect';
   const excess=await sql.begin(inner=>settlementSourceEvent(inner,'test',{provider:'local.cod',reference:randomUUID(),direction:'debit',net_amount:1,clock_namespace:f.namespace,statement:{gross_amount:1,carrier_fee:0,provider_fee:0,allocation_claims:[{receivable_transaction_id:first.transaction_id,gross_amount:1,reopens_allocation_id:forward.id}],reverses_reference:reference}}));
   assert.equal((await process(excess)).result.outcome,'exception');const [excessHead]=await tx`select * from app.provider_settlement where operation_id=${excess.operation_id}`;assert.equal(excessHead.problem_code,'SETTLEMENT_REVERSAL_EXCEEDED');assert.equal(excessHead.current_match_id,null);assert.equal(excessHead.fee_transaction_id,null);assert.equal(await balance('company_cash'),-1);assert.equal(await balance('provider_receivable'),gross);
   stage='mixed invalid references cannot partially consume an otherwise valid original receivable';
   const mixedInput={gross_amount:2,carrier_fee:0,provider_fee:0,allocation_claims:[{receivable_transaction_id:first.transaction_id,gross_amount:1},{receivable_transaction_id:randomUUID(),gross_amount:1}],reverses_reference:null};
   const mixed=await sql.begin(inner=>settlementSourceEvent(inner,'test',{provider:'local.cod',reference:randomUUID(),direction:'credit',net_amount:2,clock_namespace:f.namespace,statement:mixedInput}));assert.equal((await process(mixed)).result.outcome,'exception');
   const [mixedHead]=await tx`select * from app.provider_settlement where operation_id=${mixed.operation_id}`;assert.equal(mixedHead.status,'mismatched');assert.equal(mixedHead.current_match_id,null);assert.equal(await balance('provider_receivable'),gross);assert.equal(await balance('company_cash'),1);
   const corrected=await sql.begin(inner=>reviseSettlementStatement(inner,'test',mixed.operation_id,1,{...mixedInput,allocation_claims:[{receivable_transaction_id:first.transaction_id,gross_amount:2}]}));assert.equal((await process(corrected)).result.outcome,'matched');assert.equal(await balance('company_cash'),1);assert.equal(await balance('provider_receivable'),gross-2);
   stage='controlled native matching rejection retains authentic cash and an explicit review outcome';
   const rejected=await sql.begin(inner=>settlementSourceEvent(inner,'test',{provider:'local.cod',reference:randomUUID(),direction:'credit',net_amount:3,clock_namespace:f.namespace,statement:{gross_amount:3,carrier_fee:0,provider_fee:0,allocation_claims:[{receivable_transaction_id:first.transaction_id,gross_amount:3}],reverses_reference:null}}));
   await tx`select set_config('app.s30_fault_event',${rejected.id},true)`;
   // Add only a rollback-local fault check targeting this exact synthetic
   // event. Every production invariant remains active throughout the proof.
   await tx.unsafe("alter table app.settlement_match add constraint s30_candidate_matching_fault check (source_id is distinct from current_setting('app.s30_fault_event',true)::uuid)");
   const rejectedResult=await process(rejected);assert.equal(rejectedResult.result.outcome,'exception');
   const [rejectedHead]=await tx`select * from app.provider_settlement where operation_id=${rejected.operation_id}`;assert.equal(rejectedHead.problem_code,'SETTLEMENT_NATIVE_MATCH_REVIEW_REQUIRED');assert.equal(rejectedHead.current_match_id,null);assert.ok(rejectedHead.cash_transaction_id);assert.equal(await balance('company_cash'),4);assert.equal(await balance('provider_receivable'),gross-2);
   assert.equal((await tx`select count(*)::int n from app.settlement_match where source_id=${rejected.id}`)[0].n,0);
   await tx.unsafe('alter table app.settlement_match drop constraint s30_candidate_matching_fault');
   stage='native journal/source immutability and reciprocal seals';
   await assert.rejects(tx.savepoint(inner=>inner`update app.local_settlement_operation set net_amount=net_amount+1 where id=${original.operation_id}`),{code:'23514'});
   await assert.rejects(tx.savepoint(inner=>inner`update app.local_settlement_statement set carrier_fee=0 where id=${latest.statement_id}`),{code:'23514'});
   await assert.rejects(tx.savepoint(inner=>inner`update app.provider_settlement set status='matched' where id=${head.id}`),{code:'23514'});
   const at=latest.source_reported_at;
   await assert.rejects(sql.begin(async inner=>{await reverseFinanceTransaction(inner,head.cash_transaction_id,{source:'local.settlement',environment:'test',effect_reference:randomUUID(),reason:'SYNTHETIC forbidden cash rewrite',occurred_at:at});await inner`set constraints all immediate`;}),{code:'23514'});
   await assert.rejects(sql.begin(inner=>reverseFinanceTransaction(inner,first.transaction_id,{source:'local.settlement',environment:'test',effect_reference:randomUUID(),reason:'SYNTHETIC active original reversal',occurred_at:at})),{code:'23514'});
   await assert.rejects(sql.begin(inner=>appendFinanceTransaction(inner,{kind:'adjustment',source:'local.settlement',environment:'test',effect_reference:randomUUID(),order_id:null,reason:'SYNTHETIC forbidden generic clearing',occurred_at:at,postings:[{account:'company_cash',side:'debit',amount:1},{account:'settlement_clearing',side:'credit',amount:1}]})),{code:'23514'});
   await assert.rejects(sql.begin(async inner=>{await appendFinanceTransaction(inner,{kind:'settlement_cash',source:'local.settlement',environment:'test',effect_reference:`cash:${randomUUID()}`,order_id:null,reason:'SYNTHETIC missing original bank observation',occurred_at:at,postings:[{account:'company_cash',side:'debit',amount:1},{account:'settlement_clearing',side:'credit',amount:1}]});await inner`set constraints all immediate`;}),{code:'23514'});
   assert.equal(await purchases(),2);assert.equal((await tx`select count(*)::int n from app.settlement_event_result`)[0].n,10);
   await tx`set constraints all immediate`;throw rollback;
  }),error=>{if(error!==rollback)console.error(`settlement_candidate stage=${stage} code=${error&&typeof error==='object'&&'code' in error?String(error.code):'none'}`);return error===rollback;});
  assert.equal((await owner.sql`select to_regclass('app.local_settlement_operation') installed`)[0].installed,null);
 }finally{await owner.sql.end();await f.close();}
});
