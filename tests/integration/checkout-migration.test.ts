import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';

test('checkout migration parses transactionally and rejects invalid authority and immutable rewrites',async()=>{
 const {sql}=connectDatabase('test','owner');const rollback=new Error('Expected rollback');
 try{await assert.rejects(sql.begin(async tx=>{
  const [installed]=await tx`select to_regclass('app.cart') is not null as installed`;
  if(!installed.installed) for(const statement of readFileSync('migrations/0013_checkout_orders.sql','utf8').split('--> statement-breakpoint')) if(statement.trim()) await tx.unsafe(statement);
  const [tables]=await tx`select count(*)::int as n from pg_tables where schemaname='app' and tablename in ('commerce_guest_context','cart','cart_line','commerce_operation','checkout_quote','commerce_order','order_item','order_shipment','fulfillment_item','fulfillment_component_allocation','order_event','order_access')`;assert.equal(tables.n,12);
  await assert.rejects(tx.savepoint(t=>t`insert into app.commerce_guest_context (digest,expires_at) values ('bad',clock_timestamp()+interval '7 days')`),{code:'23514'});
  const [guest]=await tx`insert into app.commerce_guest_context (digest,created_at,expires_at) values (repeat('a',64),clock_timestamp(),clock_timestamp()+interval '6 days') returning id`;
  await assert.rejects(tx.savepoint(t=>t`insert into app.cart (owner_guest_id,transport,created_at,expires_at) values (${guest.id},'browser',clock_timestamp(),clock_timestamp()+interval '1 day')`),{code:'23514'});
  await assert.rejects(tx.savepoint(t=>t`update app.commerce_guest_context set digest=repeat('b',64) where id=${guest.id}`),{code:'23514'});
  await tx`update app.commerce_guest_context set revoked_at=clock_timestamp() where id=${guest.id}`;
  await assert.rejects(tx.savepoint(t=>t`update app.commerce_guest_context set revoked_at=null where id=${guest.id}`),{code:'23514'});
  throw rollback;
 }),error=>error===rollback);}finally{await sql.end();}
});
