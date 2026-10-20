import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {lockRefundCollectionBasis} from '../../src/modules/returns/financial-basis.ts';
import {ingestCodEvent,simulateCodCollection} from '../../src/modules/payments/cod-local.ts';
import {reverseFinanceTransaction} from '../../src/modules/finance/ledger.ts';
import {fulfillmentFixture} from './fulfillment-fixture.ts';

test('a COD refund basis uses only qualified original parcel money and frozen whole-offer shipping shares',async()=>{
 const f=await fulfillmentFixture('cod');
 try{
  const sql=f.identity.sql,units=await sql`select id,shipment_id,buyer_shipping from app.fulfillment_item where shipment_id in ${sql(f.parcels.map(p=>p.shipment_id))} order by id`;
  const paid=units.filter(u=>u.shipment_id===f.parcels[0].shipment_id),unpaid=units.filter(u=>u.shipment_id===f.parcels[1].shipment_id);
  const event=await simulateCodCollection(sql,'test',f.parcels[0].shipment_id);await f.run(await ingestCodEvent(sql,event));
  const basis=await sql.begin(tx=>lockRefundCollectionBasis(tx,f.order.id,paid.map(u=>u.id).reverse()));
  assert.equal(basis.units.length,paid.length);assert.equal(basis.environment,'test');assert.equal(basis.order.clock_namespace,f.namespace);
  assert.equal(basis.amount,paid.reduce((n,u)=>n+99000+Number(u.buyer_shipping),0));
  for(const unit of basis.units){assert.equal(unit.merchandise_amount,99000);assert.equal(unit.original_payment_operation_id,null);assert.ok(unit.purchase_event_id);assert.equal(unit.original_occurred_at,event.occurred_at);}
  assert.equal(new Set(basis.units.map(u=>u.receipt_id)).size,1);
  for(const ids of [unpaid.map(u=>u.id),[paid[0].id,unpaid[0].id]])await assert.rejects(sql.begin(tx=>lockRefundCollectionBasis(tx,f.order.id,ids)),{code:'REFUND_COLLECTION_NOT_QUALIFIED'});
  await assert.rejects(sql.begin(tx=>lockRefundCollectionBasis(tx,f.order.id,[paid[0].id,paid[0].id])),{code:'INVALID_INPUT'});
  await assert.rejects(sql.begin(tx=>lockRefundCollectionBasis(tx,f.order.id,[randomUUID()])),{code:'NOT_FOUND'});
  // An authenticated but mismatched collection is recovery money. It cannot
  // fund an ordinary return or manufacture a qualified receipt/Purchase.
  const [unpaidShipment]=await sql`select cod_due from app.order_shipment where id=${f.parcels[1].shipment_id}`;
  const recovery=await simulateCodCollection(sql,'test',f.parcels[1].shipment_id,{amount:Number(unpaidShipment.cod_due)+1});await f.run(await ingestCodEvent(sql,recovery));
  await assert.rejects(sql.begin(tx=>lockRefundCollectionBasis(tx,f.order.id,unpaid.map(u=>u.id))),{code:'REFUND_COLLECTION_NOT_QUALIFIED'});
  assert.equal((await sql`select count(*)::int n from app.commerce_event where order_id=${f.order.id} and name='Purchase'`)[0].n,1);
  assert.equal((await sql`select count(*)::int n from app.finance_posting p join app.finance_transaction t on t.id=p.transaction_id where t.order_id=${f.order.id} and p.account='company_cash'`)[0].n,0);
 }finally{await f.close();}
});

test('prepaid partial units retain the original payer and signed receipt; reversing that collection removes eligibility',async()=>{
 const f=await fulfillmentFixture('prepaid'),rollback=new Error('Expected original collection eligibility rollback');
 try{
  const sql=f.identity.sql,units=await sql`select f.id,f.buyer_shipping from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where i.order_id=${f.order.id} order by f.id`,chosen=[units[0],units.at(-1)];
  const basis=await sql.begin(tx=>lockRefundCollectionBasis(tx,f.order.id,chosen.map(u=>u?.id)));
  assert.equal(basis.units.length,2);assert.equal(new Set(basis.units.map(u=>u.receipt_id)).size,1);assert.equal(new Set(basis.units.map(u=>u.original_payment_operation_id)).size,1);assert.ok(basis.units[0].original_payment_operation_id);
  assert.equal(basis.amount,chosen.reduce((n,u)=>n+99000+Number(u?.buyer_shipping),0));
  await assert.rejects(sql.begin(async tx=>{
   await reverseFinanceTransaction(tx,basis.units[0].transaction_id,{source:'local.return.test',environment:'test',effect_reference:randomUUID(),reason:'SYNTHETIC rolled-back original refund collection reversal',occurred_at:basis.occurred_at});
   await assert.rejects(lockRefundCollectionBasis(tx,f.order.id,chosen.map(u=>u?.id)),{code:'SETTLEMENT_RECEIVABLE_REVERSED'});throw rollback;
  }),error=>error===rollback);
  assert.equal((await sql`select count(*)::int n from app.finance_transaction where reverses_id=${basis.units[0].transaction_id}`)[0].n,0);
  assert.equal((await sql`select count(*)::int n from app.commerce_event where order_id=${f.order.id} and name='Purchase'`)[0].n,1);
 }finally{await f.close();}
});
