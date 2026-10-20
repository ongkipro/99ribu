import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';
import {appendFinanceTransaction,reverseFinanceTransaction,type JournalInput} from '../../src/modules/finance/ledger.ts';
import {postEconomicReceipt,type ReceiptInput} from '../../src/modules/finance/receipts.ts';
import {financeFixture} from './finance-ledger-fixture.ts';
import {denied} from './shipping-fixture.ts';

test('committed maximum-safe journals serialize duplicate writes, seal history and allow one exact reversal',async()=>{
 const {sql}=connectDatabase('test');const input:JournalInput={kind:'adjustment',source:'local.test',environment:'test',effect_reference:randomUUID(),order_id:null,reason:'SYNTHETIC safe-integer journal',occurred_at:new Date().toISOString(),postings:[{account:'provider_receivable',side:'debit',amount:Number.MAX_SAFE_INTEGER},{account:'buyer_funds_liability',side:'credit',amount:Number.MAX_SAFE_INTEGER}]};
 try{const [a,b]=await Promise.all([sql.begin(tx=>appendFinanceTransaction(tx,input)),sql.begin(tx=>appendFinanceTransaction(tx,input))]);assert.deepEqual(a,b);
  assert.equal((await sql`select count(*)::int n from app.finance_transaction where source=${input.source} and effect_reference=${input.effect_reference}`)[0].n,1);
  await assert.rejects(sql.begin(tx=>appendFinanceTransaction(tx,{...input,postings:input.postings.map(p=>({...p,amount:p.amount-1}))})),denied('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(sql.begin(tx=>appendFinanceTransaction(tx,{...input,effect_reference:randomUUID(),postings:input.postings.map(p=>({...p,amount:1.5}))})),denied('INVALID_INPUT'));
  await assert.rejects(sql.begin(tx=>appendFinanceTransaction(tx,{...input,effect_reference:randomUUID(),postings:[input.postings[0],{...input.postings[1],amount:1}]})),denied('UNBALANCED_JOURNAL'));
  await assert.rejects(sql`insert into app.finance_posting (transaction_id,ordinal,account,side,amount) values (${a.id},3,'company_cash','debit',1)`,{code:'23514'});
  await assert.rejects(sql`update app.finance_transaction set reason='Rewrite history' where id=${a.id}`,{code:'23514'});
  const correction={source:'local.test',environment:'test' as const,reason:'SYNTHETIC full reversal',occurred_at:new Date().toISOString()};
  const results=await Promise.allSettled([sql.begin(tx=>reverseFinanceTransaction(tx,a.id,{...correction,effect_reference:randomUUID()})),sql.begin(tx=>reverseFinanceTransaction(tx,a.id,{...correction,effect_reference:randomUUID()}))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected');assert.ok(rejected?.status==='rejected'&&denied('JOURNAL_ALREADY_REVERSED')(rejected.reason));
  const net=await sql`select account,sum(case side when 'debit' then amount else -amount end)::text amount from app.finance_posting p join app.finance_transaction h on h.id=p.transaction_id where h.id=${a.id} or h.reverses_id=${a.id} group by account`;assert.equal(net.length,2);assert.ok(net.every(row=>row.amount==='0'));
 }finally{await sql.end();}
});

test('real receipt retries and crashes yield one immutable receivable allocation and no paid/cash state',async()=>{
 const f=await financeFixture();try{const order=await f.order(),other=await f.order();const input:ReceiptInput={order_id:order.id,shipment_id:null,source:'local.payment',environment:'test',event_id:randomUUID(),effect_reference:randomUUID(),amount:order.buyer_total,occurred_at:new Date().toISOString()};
  await assert.rejects(f.identity.sql.begin(async tx=>{await postEconomicReceipt(tx,input);throw new Error('Synthetic response failure before commit');}),/Synthetic response/);
  assert.equal((await f.identity.sql`select id from app.economic_receipt where order_id=${order.id}`).length,0);
  const [first,second]=await Promise.all([f.identity.sql.begin(tx=>postEconomicReceipt(tx,input)),f.identity.sql.begin(tx=>postEconomicReceipt(tx,input))]);assert.deepEqual(first,second);assert.equal(first.occurred_at,input.occurred_at);
  assert.deepEqual(await f.identity.sql.begin(tx=>postEconomicReceipt(tx,{...input,event_id:randomUUID()})),first);
  await assert.rejects(f.identity.sql.begin(tx=>postEconomicReceipt(tx,{...input,order_id:other.id,amount:other.buyer_total})),denied('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(f.identity.sql.begin(tx=>postEconomicReceipt(tx,{...input,environment:'local'})),denied('INVALID_INPUT'));
  const [count]=await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`;assert.equal(count.n,1);
  const [state]=await f.identity.sql`select status,payment_status from app.commerce_order where id=${order.id}`;assert.deepEqual({...state},{status:'pending',payment_status:'pending'});
  await assert.rejects(f.identity.sql.begin(tx=>appendFinanceTransaction(tx,{kind:'economic_receipt',source:'local.payment',environment:'test',effect_reference:randomUUID(),order_id:other.id,reason:'Synthetic missing receipt',occurred_at:new Date().toISOString(),postings:[{account:'provider_receivable',side:'debit',amount:other.buyer_total},{account:'buyer_funds_liability',side:'credit',amount:other.buyer_total}]})),{code:'23514'});
  assert.equal((await f.identity.sql`select p.* from app.finance_posting p join app.finance_transaction h on h.id=p.transaction_id where h.order_id=${order.id} and p.account='company_cash'`).length,0);
 }finally{await f.close();}
});
