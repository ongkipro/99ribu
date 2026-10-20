import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';

test('candidate finance migration parses transactionally and rejects unbalanced or mutable journals',async()=>{
 const {sql}=connectDatabase('test','owner'),rollback=new Error('Expected finance migration rollback');
 try{await assert.rejects(sql.begin(async tx=>{
  const [installed]=await tx`select to_regclass('app.finance_transaction') is not null installed`;
  if(!installed.installed) for(const statement of readFileSync('migrations/0014_immutable_finance.sql','utf8').split('--> statement-breakpoint')) if(statement.trim()) await tx.unsafe(statement);
  const [tables]=await tx`select count(*)::int n from pg_tables where schemaname='app' and tablename in ('finance_transaction','finance_posting','economic_receipt')`;assert.equal(tables.n,3);
  const header=async(t:typeof tx,kind='adjustment')=>{const [h]=await t`insert into app.finance_transaction (kind,source,environment,effect_reference,request_hash,reason,occurred_at,created_xid)
   values (${kind},'test.ledger','test',${randomUUID()},repeat('a',64),'Synthetic constraint probe',clock_timestamp(),'spoofed') returning id,created_xid`;return h;};
  await assert.rejects(tx.savepoint(async t=>{await header(t);await t`set constraints all immediate`;}),{code:'23514'});
  await assert.rejects(tx.savepoint(async t=>{const h=await header(t);await t`insert into app.finance_posting (transaction_id,ordinal,account,side,amount) values (${h.id},1,'provider_receivable','debit',1),(${h.id},2,'buyer_funds_liability','credit',2)`;await t`set constraints all immediate`;}),{code:'23514'});
  const h=await header(tx);assert.notEqual(h.created_xid,'spoofed');
  await tx`insert into app.finance_posting (transaction_id,ordinal,account,side,amount) values (${h.id},1,'provider_receivable','debit',99000),(${h.id},2,'buyer_funds_liability','credit',99000)`;
  await tx`set constraints all immediate`;
  await assert.rejects(tx.savepoint(t=>t`insert into app.finance_posting (transaction_id,ordinal,account,side,amount) values (${h.id},3,'company_cash','debit',1)`),{code:'23514'});
  for(const statement of [tx`update app.finance_transaction set reason='Rewrite' where id=${h.id}`,tx`delete from app.finance_posting where transaction_id=${h.id}`]) await assert.rejects(tx.savepoint(async()=>{await statement;}),{code:'23514'});
  await assert.rejects(tx.savepoint(t=>t`insert into app.finance_posting (transaction_id,ordinal,account,side,amount) values (${h.id},3,'company_cash','credit',0)`),{code:'23514'});
  throw rollback;
 }),error=>error===rollback);}finally{await sql.end();}
});
