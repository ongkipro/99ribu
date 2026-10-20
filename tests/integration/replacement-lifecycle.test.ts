import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {handleInventory} from '../../src/modules/inventory/routes.ts';
import {createReturn,decideReturn} from '../../src/modules/returns/cases.ts';
import {simulateParcelReceipt,ingestParcelReceiptSource} from '../../src/modules/returns/receipt-source.ts';
import {createReplacement,actOnReplacement} from '../../src/modules/returns/replacements.ts';
import {simulateReplacementWaybill,ingestReplacementWaybillEvent,replacementShippingAdapter} from '../../src/modules/returns/replacement-shipping.ts';
import {simulateReplacementReceipt,ingestReplacementReceiptSource} from '../../src/modules/returns/replacement-receipts.ts';
import {returnFixture} from './return-fixture.ts';

// Installed schema, application role and separate committed domain transactions.
// No owner connection, inline DDL or enclosing rollback is used here.
for(const method of ['cod','prepaid'] as const)test(`app-role ${method} replacement preserves the original sale across independent commits`,async()=>{
 const f=await returnFixture(method),sql=f.identity.sql,tx=sql,identity=f.identity;let stage='installed app-role precondition';
 try{
  assert.equal((await sql`select current_user actor`)[0].actor,'99ribu_test_app');
  assert.notEqual((await sql`select to_regclass('app.replacement_shipment') installed`)[0].installed,null);
   const command=(path:string,body:Record<string,unknown>,key=randomUUID())=>{const request=f.owner.browser.request(path,body);request.headers.set('idempotency-key',key);return request;};
   const run=async(jobId:string)=>{assert.equal(await runOneJob(sql,{'replacement.shipping.create':replacementShippingAdapter(sql,'test')},jobId),true);const [job]=await tx`select status,last_error from app.outbox_job where id=${jobId}`;assert.equal(job.status,'completed',`Stage ${stage}; safe worker code ${job.last_error??'none'}`);};
   const economic=async()=>JSON.stringify({receipts:await tx`select to_jsonb(r) row from app.economic_receipt r where order_id=${f.order.id} order by id`,purchases:await tx`select id,payload,occurred_at from app.commerce_event where order_id=${f.order.id} and name='Purchase' order by id`,parcels:await tx`select to_jsonb(s) row from app.order_shipment s where order_id=${f.order.id} order by id`,money:await tx`select to_jsonb(t) row from app.finance_transaction t where order_id=${f.order.id} order by id`});
   const originalEconomics=await economic(),unit=f.units[0],units=f.units.filter(row=>row.shipment_id===unit.shipment_id);assert.equal(units.length,2);
   const parcel=f.parcels.find(row=>row.shipment_id===unit.shipment_id),booking=f.bookings.find(row=>row.fulfillment_id===parcel?.id);assert.ok(parcel&&booking);
   stage='actual original buyer receipts and approved complete-quantity company-fault waiver';
   const receipt=await simulateParcelReceipt(sql,'test',{reference:randomUUID(),booking_id:booking.id,unit_ids:units.map(row=>row.id)});await run(await ingestParcelReceiptSource(sql,receipt));
   const originalReceipts=await tx`select id,fulfillment_item_id,source_id,received_at from app.buyer_receipt where fulfillment_item_id in ${tx(units.map(row=>row.id))} order by id`;
   const buyer=await commerceActor(f.client.request('/api/v1/carts'),identity);assert.ok(buyer);
   const input={items:units.map(row=>({order_item_id:row.order_item_id,delivered_fulfillment_item_id:row.id,quantity:1,reason:'defective',details:'SYNTHETIC complete original replacement quantity'})),requested_resolution:'replacement'};
   const claim=await createReturn(f.client.request(`/api/v1/orders/${f.order.id}/returns`,input),identity,buyer,f.order.id,input) as {id:string};
   const decision={decision:'approve_replacement',expected_version:1,requires_goods:false,reason:'SYNTHETIC explicit company-fault goods waiver'};
   await decideReturn(command(`/api/v1/admin/returns/${claim.id}/decisions`,decision),identity,f.principal,claim.id,decision);
   const selected=await tx`select id from app.return_item where case_id=${claim.id} order by id`;
   stage='insufficient complete stock preserves the same intent and immutable actor/key result';
   const create={return_item_ids:selected.map(row=>row.id),warehouse_id:parcel.warehouse_id,expected_version:2,reason:'SYNTHETIC complete replacement from actual available lots'},request=command(`/api/v1/admin/returns/${claim.id}/replacements`,create);
   let head=await createReplacement(request,identity,f.principal,claim.id,create);assert.equal(head.status,'awaiting_stock');assert.equal(head.items.length,2);assert.equal(head.buyer_shipping,0);assert.equal(head.cod_due,0);
   assert.deepEqual(await createReplacement(request,identity,f.principal,claim.id,create),head);
   for(const item of head.items){assert.equal(item.generation,1);assert.equal(item.quantity,1);assert.notEqual(item.id,item.original_fulfillment_item_id);}
   assert.equal((await tx`select count(*)::int n from app.stock_reservation where key=${`replacement:${head.id}`}`)[0].n,0);
   assert.equal((await tx`select count(*)::int n from app.replacement_component_allocation a join app.replacement_link link on link.id=a.replacement_link_id where link.shipment_id=${head.id}`)[0].n,0);
   const initialId=head.id,initialItems=head.items;
   stage='actual owned inventory intake recovers complete stock without a second replacement intent';
   const required=await tx`select component.stock_item_id,sum(component.quantity)::int quantity from app.replacement_link link
    join app.fulfillment_item original on original.id=link.original_fulfillment_item_id join app.order_item item on item.id=original.order_item_id
    join app.offer_component component on component.product_id=item.product_id and component.revision=item.product_revision and component.offer_id=item.offer_id
    where link.shipment_id=${head.id} group by component.stock_item_id order by component.stock_item_id`;
   let received=0;
   for(const component of required){
    const [position]=await tx`select revision,on_hand-reserved-quarantined available from app.inventory_balance where warehouse_id=${parcel.warehouse_id} and stock_item_id=${component.stock_item_id} and lot_id is null`;assert.ok(position);
    const quantity=Math.max(0,Number(component.quantity)-Number(position.available));if(!quantity)continue;
    const intake={warehouse_id:parcel.warehouse_id,stock_item_id:component.stock_item_id,kind:'receive',quantity,expected_version:position.revision,reason:'SYNTHETIC actual owned replacement replenishment'};
    const response=await handleInventory(command('/api/v1/admin/inventory/movements',intake),identity);assert.equal(response.status,201);received+=quantity;
   }
   assert.ok(received>0,'The original fixture must actually need replacement replenishment');
   const reserve={expected_version:head.version,reason:'SYNTHETIC recover original intent after actual stock intake'};
   head=await actOnReplacement(command(`/api/v1/admin/replacements/${head.id}/reservations`,reserve),identity,f.principal,head.id,reserve,'reserve');
   assert.equal(head.status,'ready');assert.equal(head.id,initialId);assert.deepEqual(head.items,initialItems);
   const act=async(action:'prepare'|'book'|'handover')=>{const body={expected_version:head.version,reason:`SYNTHETIC actual replacement ${action}`,...(action==='handover'?{handover_reference:'SYNTHETIC-CARRIER-HANDOVER'}:{})};head=await actOnReplacement(command(`/api/v1/admin/replacements/${head.id}/${action}`,body),identity,f.principal,head.id,body,action);};
   await act('prepare');assert.equal(head.status,'picking');assert.equal(head.waybill_issued_at,null);assert.equal(head.handover_at,null);
   await act('book');assert.equal(head.status,'booking_pending');assert.ok(head.booking_id);
   const replacementBooking=head.booking_id,[stored]=await tx`select creation_job_id from app.replacement_booking where id=${replacementBooking}`;
   stage='fenced original source creation, signed usable waybill and actual component handover';
   await run(stored.creation_job_id);assert.equal((await tx`select status from app.replacement_shipment where id=${head.id}`)[0].status,'booking_pending');
   const source=await simulateReplacementWaybill(sql,'test',replacementBooking);await run(await ingestReplacementWaybillEvent(sql,source));
   head={...head,...{version:Number((await tx`select revision from app.replacement_shipment where id=${head.id}`)[0].revision)}};
   await act('handover');assert.equal(head.status,'handed_over');assert.ok(head.handover_at);assert.ok(head.tracking_number);
   const [hold]=await tx`select r.status,r.expires_at from app.stock_reservation r join app.replacement_shipment s on s.stock_reservation_id=r.id where s.id=${head.id}`;assert.equal(hold.status,'consumed');assert.equal(hold.expires_at,null);
   stage='first actual occurrence receipt changes only its affected physical quantity';
   await tx`update app.local_fixture_namespace set clock=clock+interval '1 hour',revision=revision+1 where name=${f.namespace}`;
   const first=await simulateReplacementReceipt(sql,'test',{reference:randomUUID(),booking_id:replacementBooking,unit_ids:[head.items[0].id]});await run(await ingestReplacementReceiptSource(sql,first));
   assert.equal((await tx`select status from app.replacement_shipment where id=${head.id}`)[0].status,'partially_delivered');assert.equal((await tx`select status from app.return_case where id=${claim.id}`)[0].status,'replacing');
   assert.deepEqual((await tx`select claim_state from app.return_item where case_id=${claim.id} order by claim_state`).map(row=>row.claim_state),['replaced','replacing']);
   const [firstReceipt]=await tx`select id,received_at from app.replacement_buyer_receipt where replacement_link_id=${head.items[0].id}`;assert.equal(new Date(firstReceipt.received_at).toISOString(),first.occurred_at);
   stage='later signed duplicate retains first receipt time and original case history';
   await tx`update app.local_fixture_namespace set clock=clock+interval '1 hour',revision=revision+1 where name=${f.namespace}`;
   const duplicate=await simulateReplacementReceipt(sql,'test',{reference:randomUUID(),booking_id:replacementBooking,unit_ids:[head.items[0].id]});await run(await ingestReplacementReceiptSource(sql,duplicate));
   assert.equal((await tx`select receipt_count from app.replacement_receipt_result where event_id=${duplicate.id}`)[0].receipt_count,0);
   assert.deepEqual((await tx`select id,received_at from app.replacement_buyer_receipt where replacement_link_id=${head.items[0].id}`)[0],firstReceipt);
   stage='second affected receipt resolves physical delivery without changing original money or unrelated anchors';
   const second=await simulateReplacementReceipt(sql,'test',{reference:randomUUID(),booking_id:replacementBooking,unit_ids:[head.items[1].id]});await run(await ingestReplacementReceiptSource(sql,second));
   assert.equal((await tx`select status from app.replacement_shipment where id=${head.id}`)[0].status,'delivered');assert.equal((await tx`select status from app.return_case where id=${claim.id}`)[0].status,'resolved');
   assert.deepEqual(await tx`select id,fulfillment_item_id,source_id,received_at from app.buyer_receipt where fulfillment_item_id in ${tx(units.map(row=>row.id))} order by id`,originalReceipts);
   assert.equal(await economic(),originalEconomics);
   stage='new physical occurrence claim retains its original immutable financial root';
   const next={items:[{order_item_id:head.items[0].order_item_id,delivered_fulfillment_item_id:head.items[0].id,quantity:1,reason:'damaged',details:'SYNTHETIC newly received physical replacement'}],requested_resolution:'refund'};
   const later=await createReturn(f.client.request(`/api/v1/orders/${f.order.id}/returns`,next),identity,buyer,f.order.id,next) as {id:string};
   const [laterUnit]=await tx`select fulfillment_item_id,replacement_link_id,buyer_receipt_id from app.return_item where case_id=${later.id}`;
   assert.equal(laterUnit.fulfillment_item_id,head.items[0].original_fulfillment_item_id);assert.equal(laterUnit.replacement_link_id,head.items[0].id);assert.ok(originalReceipts.some(row=>row.id===laterUnit.buyer_receipt_id));
   stage='native immutable physical charge, source job and receipt guards';
   await assert.rejects(sql.begin(inner=>inner`update app.replacement_shipment set cod_due=99000 where id=${head.id}`),{code:'23514'});
   await assert.rejects(sql.begin(inner=>inner`delete from app.outbox_job where id=${stored.creation_job_id}`),{code:'23514'});
   await assert.rejects(sql.begin(inner=>inner`update app.replacement_buyer_receipt set received_at=received_at+interval '1 hour' where id=${firstReceipt.id}`),{code:'23514'});
 }catch(error){const code=error&&typeof error==='object'&&'code'in error?String(error.code):'ASSERTION';throw new Error(`Replacement lifecycle stage ${stage}; safe code ${code}; ${error instanceof Error?error.message.slice(0,300):'unknown failure'}`);
 }finally{await f.close();}
});
