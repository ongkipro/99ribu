import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {Sql,TransactionSql} from 'postgres';
import {connectDatabase} from '../../src/db/client.ts';
import {assertSettlementBases,settlementBasisFixture} from './settlement-basis-fixture.ts';

test('rollback-only native prepaid and authenticated COD/prepaid recovery bases match without extra Purchase',async()=>{
 const f=await settlementBasisFixture(),owner=connectDatabase('test','owner'),rollback=new Error('Expected full settlement basis candidate rollback');
 try{
  assert.equal((await owner.sql`select to_regclass('app.local_settlement_operation') installed`)[0].installed,null);
  await assert.rejects(owner.sql.begin(async tx=>{
   for(const statement of readFileSync('migrations/0020_settlement_reconciliation.sql','utf8').split('--> statement-breakpoint'))if(statement.trim())await tx.unsafe(statement);
   const sql=new Proxy(tx,{get(target,property,receiver){if(property==='begin')return (run:(inner:TransactionSql)=>Promise<unknown>)=>target.savepoint(async inner=>{await inner`set constraints all deferred`;return run(inner);});return Reflect.get(target,property,receiver);}}) as unknown as Sql;
   await assertSettlementBases(sql,f);await tx`set constraints all immediate`;throw rollback;
  }),error=>error===rollback);
  assert.equal((await owner.sql`select to_regclass('app.local_settlement_operation') installed`)[0].installed,null);
 }finally{await owner.sql.end();await f.close();}
});
