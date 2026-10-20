import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {appendFinanceTransaction,reverseFinanceTransaction} from '../../src/modules/finance/ledger.ts';
import {handleSettlements} from '../../src/modules/finance/settlements/routes.ts';
import {assertSettlementBases,settlementBasisFixture} from './settlement-basis-fixture.ts';
import {settlementFixture} from './settlement-fixture.ts';

test('real app role cannot fabricate bank cash, reverse observed cash, rewrite final decisions or commit an orphan finance operation',async()=>{
 const f=await settlementFixture();
 try{
  const sql=f.identity.sql;assert.equal((await sql`select current_user name`)[0].name,'99ribu_test_app');
  for(const name of ['local_settlement_operation','local_settlement_statement','local_settlement_event','settlement_provider_event','provider_settlement','settlement_match','settlement_allocation','settlement_event','settlement_event_result'])assert.equal((await sql`select has_table_privilege(current_user,${`app.${name}`},'TRUNCATE') allowed`)[0].allowed,false);
  await assert.rejects(sql.begin(async tx=>{await appendFinanceTransaction(tx,{kind:'settlement_cash',source:'local.settlement',environment:'test',effect_reference:`cash:${randomUUID()}`,order_id:null,reason:'SYNTHETIC missing bank observation',occurred_at:f.source.occurred_at,postings:[{account:'company_cash',side:'debit',amount:1},{account:'settlement_clearing',side:'credit',amount:1}]});await tx`set constraints all immediate`;}),{code:'23514',message:/Cash journal belongs to one original authenticated bank observation/});
  await assert.rejects(sql.begin(async tx=>{await reverseFinanceTransaction(tx,f.head.cash_transaction_id,{source:'local.settlement',environment:'test',effect_reference:randomUUID(),reason:'SYNTHETIC forbidden cash reversal',occurred_at:f.source.occurred_at});await tx`set constraints all immediate`;}),{code:'23514',message:/Settlement accounts require their own source-bound journal kind/});
  assert.equal((await sql`select count(*)::int n from app.finance_transaction where reverses_id=${f.head.cash_transaction_id}`)[0].n,0);
  assert.equal((await sql`select cash_transaction_id from app.provider_settlement where id=${f.head.id}`)[0].cash_transaction_id,f.head.cash_transaction_id);
  await assert.rejects(sql.begin(tx=>tx`update app.local_settlement_operation set net_amount=net_amount+1 where id=${f.source.operation_id}`),{code:'23514'});
  const proofRequest=f.owner.browser.request('/api/v1/me/reauthentication-proofs',{password:f.owner.password,action:'finance.reconcile',subject_id:f.head.id});proofRequest.headers.set('idempotency-key',randomUUID());const issued=await handleAccess(proofRequest,f.identity);assert.equal(issued.status,201);
  const key=randomUUID(),request=f.owner.browser.request(`${f.root}/decisions`,{action:'match',expected_version:1,expected_match_id:null,source_reference:f.source.statement_id,reason:'SYNTHETIC protected replay response',allocations:[{receivable_transaction_id:f.receipts[0].transaction_id,gross_amount:11}],reauthentication_proof:(await issued.json()).proof});request.headers.set('idempotency-key',key);
  const response=await handleSettlements(request,f.identity);assert.equal(response.status,201);const original=await response.json(),[operation]=await sql`select id from app.access_operation where actor_id=${f.owner.id} and action='finance.reconcile' and key=${key}`;
  await assert.rejects(sql.begin(tx=>tx`update app.access_operation set response=response||'{"explanation":"SYNTHETIC forged replay"}'::jsonb where id=${operation.id}`),{code:'23514',message:/Final finance decisions and replay responses are immutable/});
  await assert.rejects(sql.begin(tx=>tx`delete from app.access_operation where id=${operation.id}`),{code:'23514',message:/Final finance decisions and replay responses are immutable/});
  assert.deepEqual((await sql`select response from app.access_operation where id=${operation.id}`)[0].response,original);
  await assert.rejects(sql.begin(async tx=>{await tx`insert into app.access_operation (actor_id,action,key,request_hash,response) values (${f.owner.id},'finance.reconcile',${randomUUID()},'SYNTHETIC orphan','{}'::jsonb)`;await tx`set constraints all immediate`;}),{code:'23514',message:/Finance decision commits with its exact immutable transition and final response/});
  await assert.rejects(sql.begin(tx=>reverseFinanceTransaction(tx,f.receipts[0].transaction_id,{source:'local.settlement',environment:'test',effect_reference:randomUUID(),reason:'SYNTHETIC active receipt full reversal',occurred_at:f.source.occurred_at})),{code:'23514',message:/Unmatch active original receivable allocations before full reversal/});
  assert.equal((await sql`select count(*)::int n from app.commerce_event where order_id=${f.order.id} and name='Purchase'`)[0].n,2);
 }finally{await f.close();}
});
test('app-role native prepaid receipt and authenticated COD/prepaid recovery allocations preserve their independent original bases',async()=>{
 const f=await settlementBasisFixture();try{assert.equal((await f.identity.sql`select current_user name`)[0].name,'99ribu_test_app');await assertSettlementBases(f.identity.sql,f);}finally{await f.close();}
});
