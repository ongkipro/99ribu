import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';

test('order-history timestamp upgrade preserves unknown legacy ingestion and creates keyset indexes',async()=>{
 const {sql}=connectDatabase('test','owner'),rollback=new Error('Expected timestamp migration rollback');
 try{await assert.rejects(sql.begin(async tx=>{
  const [column]=await tx`select count(*)::int n from information_schema.columns where table_schema='app' and table_name='order_event' and column_name='recorded_at'`;
  const before=column.n===0?await tx`select id from app.order_event`:[];
  if(column.n===0) for(const statement of readFileSync('migrations/0015_order_history_timestamps.sql','utf8').split('--> statement-breakpoint')) if(statement.trim()) await tx.unsafe(statement);
  if(before.length) assert.equal((await tx`select count(*)::int n from app.order_event where id in ${tx(before.map(r=>r.id))} and recorded_at is null`)[0].n,before.length);
  const [indexes]=await tx`select count(*)::int n from pg_indexes where schemaname='app' and indexname in ('commerce_order_history_idx','order_event_history_idx')`;assert.equal(indexes.n,2);
  const [field]=await tx`select column_default,is_nullable from information_schema.columns where table_schema='app' and table_name='order_event' and column_name='recorded_at'`;assert.equal(field.is_nullable,'YES');assert.equal(field.column_default,'clock_timestamp()');
  throw rollback;
 }),error=>error===rollback);}finally{await sql.end();}
});
