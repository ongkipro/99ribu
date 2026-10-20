import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';
import {postEconomicReceipt,type ReceiptInput} from '../../src/modules/finance/receipts.ts';
import {readFinanceTransaction,reverseFinanceTransaction} from '../../src/modules/finance/ledger.ts';
import {financeFixture} from './finance-ledger-fixture.ts';
import {denied} from './shipping-fixture.ts';

test('candidate receipt/posting transaction conserves actual order money, immutable reversal and partial rollback',async()=>{
 const f=await financeFixture(),connection=connectDatabase('test','owner'),rollback=new Error('Expected candidate rollback');
 try{const order=await f.order(),cod=await f.order('cod',4);assert.equal(cod.shipments.length,2);const input:ReceiptInput={order_id:order.id,shipment_id:null,source:'local.payment',environment:'test',event_id:randomUUID(),effect_reference:randomUUID(),amount:order.buyer_total,occurred_at:new Date().toISOString()};
  await assert.rejects(connection.sql.begin(async tx=>{
   const [installed]=await tx`select to_regclass('app.finance_transaction') is not null installed`;
   if(!installed.installed) for(const statement of readFileSync('migrations/0014_immutable_finance.sql','utf8').split('--> statement-breakpoint')) if(statement.trim()) await tx.unsafe(statement);
   await assert.rejects(tx.savepoint(t=>postEconomicReceipt(t,{...input,amount:input.amount+1})),denied('RECEIPT_AMOUNT_MISMATCH'));
   await assert.rejects(tx.savepoint(async t=>{await postEconomicReceipt(t,input);throw new Error('Synthetic crash after posting');}),/Synthetic crash/);
   assert.equal((await tx`select id from app.economic_receipt where order_id=${order.id}`).length,0);assert.equal((await tx`select id from app.finance_transaction where order_id=${order.id}`).length,0);
   const receipt=await postEconomicReceipt(tx,input);await tx`set constraints all immediate`;await tx`set constraints all deferred`;
   assert.equal(receipt.merchandise_amount,99000);assert.equal(receipt.amount,receipt.merchandise_amount+receipt.buyer_shipping);
   assert.deepEqual(await postEconomicReceipt(tx,{...input,event_id:randomUUID()}),receipt);
   const journal=await readFinanceTransaction(tx,receipt.transaction_id);assert.deepEqual(journal.postings,[{account:'provider_receivable',side:'debit',amount:input.amount},{account:'buyer_funds_liability',side:'credit',amount:input.amount}]);
   await assert.rejects(tx.savepoint(t=>postEconomicReceipt(t,{...input,event_id:randomUUID(),effect_reference:randomUUID()})),denied('RECEIPT_ALREADY_ALLOCATED'));
   const reversal=await reverseFinanceTransaction(tx,journal.id,{source:'local.correction',environment:'test',effect_reference:randomUUID(),reason:'Synthetic full reversal',occurred_at:new Date().toISOString()});
   await tx`set constraints all immediate`;assert.equal(reversal.reverses_id,journal.id);assert.deepEqual(reversal.postings.map(p=>p.side),['credit','debit']);
   assert.deepEqual(await readFinanceTransaction(tx,journal.id),journal);
   await assert.rejects(tx.savepoint(t=>t`update app.economic_receipt set amount=amount+1 where id=${receipt.id}`),{code:'23514'});
   assert.equal((await tx`select payment_status from app.commerce_order where id=${order.id}`)[0].payment_status,'pending');
   await tx`set constraints all deferred`;
   for(const shipment of cod.shipments) await postEconomicReceipt(tx,{...input,order_id:cod.id,shipment_id:shipment.id,source:'local.cod',event_id:randomUUID(),effect_reference:randomUUID(),amount:shipment.cod_collect_amount});
   await tx`set constraints all immediate`;
   const [collected]=await tx`select sum(amount)::text amount,sum(merchandise_amount)::text merchandise from app.economic_receipt where order_id=${cod.id}`;
   assert.equal(Number(collected.amount),cod.buyer_total);assert.equal(Number(collected.merchandise),396000);
   assert.equal((await tx`select p.transaction_id from app.finance_posting p join app.finance_transaction h on h.id=p.transaction_id where p.account='company_cash' and h.order_id in (${order.id},${cod.id})`).length,0);
   throw rollback;
  }),error=>error===rollback);
 }finally{await connection.sql.end();await f.close();}
});
