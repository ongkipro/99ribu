import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runOneJob} from '../../src/jobs/worker.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {handleInventory} from '../../src/modules/inventory/routes.ts';
import {createReturn,decideReturn} from '../../src/modules/returns/cases.ts';
import {simulateParcelReceipt,ingestParcelReceiptSource} from '../../src/modules/returns/receipt-source.ts';
import {createReplacement,actOnReplacement,readAdminReplacement} from '../../src/modules/returns/replacements.ts';
import {replacementShippingAdapter} from '../../src/modules/returns/replacement-shipping.ts';
import {returnFixture} from './return-fixture.ts';


// Real app-role original order/collection/receipt/claim/waiver and owned stock
// intake. The returned replacement is ready; nothing is booked or delivered.
export async function replacementFixture(method:'cod'|'prepaid'='cod'){
 const f=await returnFixture(method),sql=f.identity.sql,tx=sql,identity=f.identity;let stage='replacement fixture';
 try{
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
   const act=async(action:'prepare'|'book'|'handover')=>{head=await readAdminReplacement(identity,f.principal,head.id);const body={expected_version:head.version,reason:`SYNTHETIC actual replacement ${action}`,...(action==='handover'?{handover_reference:'SYNTHETIC-CARRIER-HANDOVER'}:{})};head=await actOnReplacement(command(`/api/v1/admin/replacements/${head.id}/${action}`,body),identity,f.principal,head.id,body,action);};
  return {...f,sql,command,run,act,claim,create,createRequest:request,originalReceipts,economic,originalEconomics,get head(){return head;}};
 }catch(error){await f.close();throw error;}
}
