import assert from 'node:assert/strict';
import test from 'node:test';
import {codCollectionBasis,collectionUnitTotals,receiptUnitIds} from '../../src/modules/finance/receipt-units.ts';
import {lockRefundCollectionBasis} from '../../src/modules/returns/financial-basis.ts';
import {ingestCodEvent,simulateCodCollection} from '../../src/modules/payments/cod-local.ts';
import {fulfillmentFixture} from './fulfillment-fixture.ts';

const first='a0000000-0000-4000-8000-000000000001',second='b0000000-0000-4000-8000-000000000002';
const units=[{id:second,unit_price:99000,buyer_shipping:10000},{id:first,unit_price:99000,buyer_shipping:10000}];

test('COD basis freezes each complete original unit price and its allocated buyer shipping',()=>{
 const before=structuredClone(units);
 assert.deepEqual(collectionUnitTotals(units),{unit_ids:[first,second],merchandise_amount:198000,buyer_shipping:20000,payment_charge:0,amount:218000});
 assert.deepEqual(units,before);
 // S92: a frozen buyer-paid unit share (COD fee / transfer code) is its own component of the basis.
 assert.deepEqual(collectionUnitTotals([{...units[1],payment_charge:3697}]),{unit_ids:[first],merchandise_amount:99000,buyer_shipping:10000,payment_charge:3697,amount:112697});
});

test('one remaining unit has only its own entitlement and no cancelled-unit shipping or price',()=>{
 assert.deepEqual(collectionUnitTotals([units[0]]),{unit_ids:[second],merchandise_amount:99000,buyer_shipping:10000,payment_charge:0,amount:109000});
 assert.deepEqual(collectionUnitTotals([]),{unit_ids:[],merchandise_amount:0,buyer_shipping:0,payment_charge:0,amount:0});
});

test('original identities are normalized before duplicate detection and arbitrary prices cannot enter the basis',()=>{
 assert.throws(()=>collectionUnitTotals([units[0],{...units[0],id:second.toUpperCase()}]),{code:'COLLECTION_UNIT_SCOPE_INVALID'});
 for(const unit_price of [98000,99001,0,-1,'99000'])assert.throws(()=>collectionUnitTotals([{...units[0],unit_price:unit_price as number}]),{code:'INVALID_INPUT'});
 for(const buyer_shipping of [-1,0.1,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>collectionUnitTotals([{...units[0],buyer_shipping}]),{code:'INVALID_INPUT'});
});

test('aggregate original money uses exact integers and rejects overflowing or excessive unit scope',()=>{
 const near=Number.MAX_SAFE_INTEGER-99000;
 assert.equal(collectionUnitTotals([{...units[0],buyer_shipping:near}]).amount,Number.MAX_SAFE_INTEGER);
 assert.throws(()=>collectionUnitTotals([{...units[0],buyer_shipping:near},units[1]]),{code:'COLLECTION_AMOUNT_LIMIT_EXCEEDED'});
 assert.throws(()=>collectionUnitTotals(Array(101).fill(units[0])),{code:'COLLECTION_UNIT_LIMIT_EXCEEDED'});
});

test('original COD source, economic receipt, refund entitlement and Purchase retain one exact funded parcel scope',async()=>{
 const f=await fulfillmentFixture('cod');try{
  const sql=f.identity.sql,shipment=String(f.parcels[0].shipment_id),other=String(f.parcels[1].shipment_id);
  const original=await sql`select f.id,f.order_item_id,f.shipment_id,f.buyer_shipping,f.subsidy_amount,i.unit_price from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where i.order_id=${f.order.id} order by f.id`;
  const wanted=original.filter(unit=>unit.shipment_id===shipment),basis=await sql.begin(tx=>codCollectionBasis(tx,shipment));
  assert.deepEqual(basis,collectionUnitTotals(wanted.map(unit=>({id:String(unit.id),unit_price:Number(unit.unit_price),buyer_shipping:Number(unit.buyer_shipping)}))));
  const event=await simulateCodCollection(sql,'test',shipment);
  assert.equal(event.amount,basis.amount);
  assert.deepEqual(await sql.begin(tx=>codCollectionBasis(tx,shipment,event.operation_id)),basis);
  await assert.rejects(sql.begin(tx=>codCollectionBasis(tx,other,event.operation_id)),{code:'NOT_FOUND'});
  await f.run(await ingestCodEvent(sql,event));
  const [receipt]=await sql`select * from app.economic_receipt where shipment_id=${shipment}`;
  assert.equal(Number(receipt.amount),basis.amount);assert.equal(Number(receipt.merchandise_amount),basis.merchandise_amount);assert.equal(Number(receipt.buyer_shipping),basis.buyer_shipping);
  assert.deepEqual(await sql.begin(tx=>receiptUnitIds(tx,String(receipt.id))),basis.unit_ids);
  const entitlement=await sql.begin(tx=>lockRefundCollectionBasis(tx,f.order.id,basis.unit_ids));
  assert.deepEqual(entitlement.units.map(unit=>unit.fulfillment_item_id).sort(),basis.unit_ids);assert.equal(entitlement.amount,basis.amount);
  const foreign=original.filter(unit=>unit.shipment_id===other).map(unit=>unit.id);
  await assert.rejects(sql.begin(tx=>lockRefundCollectionBasis(tx,f.order.id,foreign)),{code:'REFUND_COLLECTION_NOT_QUALIFIED'});
  const [purchase]=await sql`select * from app.commerce_event where receipt_id=${receipt.id} and name='Purchase'`;
  assert.equal(Number(purchase.merchandise_amount),basis.merchandise_amount);
  assert.equal(purchase.payload.contents.reduce((sum:number,line:{quantity:number})=>sum+line.quantity,0),basis.unit_ids.length);
  const retry=await simulateCodCollection(sql,'test',shipment);assert.equal(retry.operation_id,event.operation_id);assert.equal(retry.amount,event.amount);
  await f.run(await ingestCodEvent(sql,retry));
  assert.equal((await sql`select count(*)::int n from app.economic_receipt where shipment_id=${shipment}`)[0].n,1);
  assert.equal((await sql`select count(*)::int n from app.commerce_event where receipt_id=${receipt.id} and name='Purchase'`)[0].n,1);
  assert.deepEqual(await sql`select f.id,f.order_item_id,f.shipment_id,f.buyer_shipping,f.subsidy_amount,i.unit_price from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where i.order_id=${f.order.id} order by f.id`,original);
 }finally{await f.close();}
});
