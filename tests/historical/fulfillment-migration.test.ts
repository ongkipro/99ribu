import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';
import {packingDeadline} from '../../src/modules/fulfillment/calendar.ts';
import {fulfillmentCalendarFixture} from '../integration/fulfillment-calendar-fixture.ts';

test('unapplied fulfillment migration parses on real PostgreSQL, preserves source types and rolls its entire schema back',async()=>{
 const {sql}=connectDatabase('test','owner'),rollback=new Error('Expected complete candidate rollback');
 try{
  const [before]=await sql`select count(*)::int n from pg_tables where schemaname='app'`;
  assert.equal(before.n,87);
  await assert.rejects(sql.begin(async tx=>{
   for(const statement of readFileSync('migrations/0019_fulfillment_deadlines.sql','utf8').split('--> statement-breakpoint'))if(statement.trim())await tx.unsafe(statement);
   const [tables]=await tx`select count(*)::int n from pg_tables where schemaname='app'`;assert.equal(tables.n,96);
   const fields=await tx`select table_name,column_name,data_type,is_nullable from information_schema.columns where table_schema='app' and ((table_name='fulfillment_deadline' and column_name in ('calendar_coverage','handover_calendar_coverage')) or (table_name='local_waybill_operation' and column_name='terminal_at')) order by table_name,column_name`;
   assert.deepEqual(fields.map(f=>[f.column_name,f.data_type,f.is_nullable]),[['calendar_coverage','jsonb','NO'],['handover_calendar_coverage','jsonb','YES'],['terminal_at','timestamp with time zone','YES']]);
   await assert.rejects(tx.savepoint(t=>t`insert into app.fulfillment (shipment_id,created_at) values (${randomUUID()},clock_timestamp())`),error=>Boolean(error&&typeof error==='object'&&'code' in error&&['23503','23514'].includes(String(error.code))));
   const [rights]=await tx`select has_table_privilege('99ribu_test_app','app.local_waybill_operation','TRUNCATE') allowed`;assert.equal(rights.allowed,false);
   throw rollback;
  }),error=>error===rollback);
  const [after]=await sql`select count(*)::int n from pg_tables where schemaname='app'`;assert.equal(after.n,87);assert.equal((await sql`select to_regclass('app.fulfillment') is null absent`)[0].absent,true);
 }finally{await sql.end();}
});

test('SQL deadline constraints independently recompute real scoped policy snapshots and reject forged coverage',async()=>{
 const f=await fulfillmentCalendarFixture(),{sql}=connectDatabase('test','owner'),rollback=new Error('Expected SQL calendar rollback');
 try{
  await f.append(0);const anchor=f.at(0,'23:59:59.999'),basis=await f.identity.sql.begin(tx=>packingDeadline(tx,f.warehouseId,anchor));
  await assert.rejects(sql.begin(async tx=>{
   for(const statement of readFileSync('migrations/0019_fulfillment_deadlines.sql','utf8').split('--> statement-breakpoint'))if(statement.trim())await tx.unsafe(statement);
   const coverage=JSON.stringify(basis.calendar_coverage),[actual]=await tx`select app.shipping_calendar_due(${f.warehouseId},${coverage}::jsonb,${anchor},2) due`;assert.equal(new Date(actual.due).toISOString(),basis.packing_due_at);
   const forged=JSON.stringify([{...basis.calendar_coverage[0],values:{...basis.calendar,closed_dates:[]}}]);
   await assert.rejects(tx.savepoint(t=>t`select app.shipping_calendar_due(${f.warehouseId},${forged}::jsonb,${anchor},2)`),{code:'23514'});
   await assert.rejects(tx.savepoint(t=>t`select app.shipping_calendar_due(${randomUUID()},${coverage}::jsonb,${anchor},2)`),{code:'23514'});
   await assert.rejects(tx.savepoint(t=>t`select app.shipping_calendar_due(${f.warehouseId},${coverage}::jsonb,${anchor},3)`),{code:'23514'});
   throw rollback;
  }),error=>error===rollback);
 }finally{await sql.end();await f.close();}
});
