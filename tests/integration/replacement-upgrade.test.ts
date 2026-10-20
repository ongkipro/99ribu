import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';
import {runOneJob} from '../../src/jobs/worker.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {initializeFulfillments} from '../../src/modules/fulfillment/core.ts';
import {simulateWaybillIssue,ingestWaybillEvent} from '../../src/modules/fulfillment/local.ts';
import {handleFulfillment} from '../../src/modules/fulfillment/routes.ts';
import {shippingAdapter} from '../../src/modules/fulfillment/worker.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {createAttempt} from '../../src/modules/payments/attempts.ts';
import {simulateCollection,ingestProviderEvent} from '../../src/modules/payments/local.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {createReturn,decideReturn} from '../../src/modules/returns/cases.ts';
import {simulateParcelReceipt,ingestParcelReceiptSource} from '../../src/modules/returns/receipt-source.ts';
import {ingestRefundSourceEvent,simulateRefundOutcome} from '../../src/modules/returns/refund-source.ts';
import {queueRefund} from '../../src/modules/returns/refunds.ts';
import {createReplacement,actOnReplacement} from '../../src/modules/returns/replacements.ts';
import {replacementShippingAdapter,simulateReplacementWaybill,ingestReplacementWaybillEvent} from '../../src/modules/returns/replacement-shipping.ts';
import {simulateReplacementReceipt,ingestReplacementReceiptSource} from '../../src/modules/returns/replacement-receipts.ts';
import {refundAdapter} from '../../src/modules/returns/worker.ts';
import {paymentFixture} from './payment-fixture.ts';
import {closeFulfillmentActor,installFulfillmentCalendars} from './fulfillment-fixture.ts';

// Each process owns a separate private Unix-socket cluster and actual migration
// history. Existing test/local databases, credentials and applied files are untouched.
// Keep the original browser authority alive across the real additive upgrade.
test('pre-signal buyer and an approved legacy replacement survive0022 then refund the received replacement without Purchase backfill',{timeout:90000},async()=>{
 const source=resolve('.'),root=mkdtempSync(join(tmpdir(),'99ribu-replacement-upgrade-')),journal=JSON.parse(readFileSync(join(source,'migrations/meta/_journal.json'),'utf8'));
 assert.equal(journal.entries.length,23);
 const sourceJournalHash=createHash('sha256').update(readFileSync(join(source,'migrations/meta/_journal.json'))).digest('hex');
 const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
 const original=new Map<string,string>();
 mkdirSync(join(root,'src/db'),{recursive:true});mkdirSync(join(root,'migrations/meta'),{recursive:true});
 copyFileSync(join(source,'compose.yaml'),join(root,'compose.yaml'));copyFileSync(join(source,'src/db/bootstrap.sql'),join(root,'src/db/bootstrap.sql'));
 for(const entry of journal.entries){for(const path of [`migrations/${entry.tag}.sql`,`migrations/meta/${String(entry.idx).padStart(4,'0')}_snapshot.json`])original.set(path,hash(join(source,path)));copyFileSync(join(source,`migrations/${entry.tag}.sql`),join(root,`migrations/${entry.tag}.sql`));}
 const savePrefix=(length:number)=>writeFileSync(join(root,'migrations/meta/_journal.json'),JSON.stringify({...journal,entries:journal.entries.slice(0,length)},null,2));
 const execute=(script:string,...args:string[])=>execFileSync(process.execPath,[`--env-file=${join(source,'.env.example')}`,join(source,script),...args],{cwd:root,stdio:'pipe',timeout:75000});
 let f:Awaited<ReturnType<typeof paymentFixture>>|undefined;let startAttempted=false;let stage='private prefix16 installation';
 process.chdir(root);
 try{
  savePrefix(17);startAttempted=true;execute('scripts/database.ts','up');execute('scripts/migrate.ts','test');
  const prior=connectDatabase('test','owner');try{assert.equal((await prior.sql`select count(*)::int n from drizzle.__drizzle_migrations`)[0].n,17);}finally{await prior.sql.end();}
  f=await paymentFixture();
  stage='explicit fresh-cluster owner commercial policy and guarded publication';
  const policyProofRequest=f.owner.browser.request('/api/v1/me/reauthentication-proofs',{password:f.owner.password,action:'company_policy.version',subject_id:'company-commercial'});policyProofRequest.headers.set('idempotency-key',randomUUID());
  const policyProof=await handleAccess(policyProofRequest,f.identity);assert.equal(policyProof.status,201);
  const policyRequest=f.owner.browser.request('/api/v1/admin/policy-versions',{kind:'commercial',warehouse_id:null,expected_version:0,effective_at:null,values:{default_commission_bps:1000,minimum_payout_idr:99000},reason:'SYNTHETIC explicit isolated upgrade publication baseline',reauthentication_proof:(await policyProof.json()).proof});policyRequest.headers.set('idempotency-key',randomUUID());assert.equal((await handleAccess(policyRequest,f.identity)).status,201);
  const seeded=await seedCommerce(f.request(),f.identity,'test',f.namespace);Object.assign(f.seeded,seeded);assert.ok(f.seeded.publications['fixture-offer-shirt'].id);
  await installFulfillmentCalendars(f.identity,f.owner,f.namespace);
  const {client,order}=await f.order(1),sql=f.identity.sql;
  const adapters={'payment.create':paymentAdapter(sql,'test'),'shipping.create':shippingAdapter(sql,'test'),'refund.create':refundAdapter(sql,'test'),'replacement.shipping.create':replacementShippingAdapter(sql,'test')};
  const run=async(jobId:string)=>{assert.equal(await runOneJob(sql,adapters,jobId),true);assert.equal((await sql`select status from app.outbox_job where id=${jobId}`)[0].status,'completed',stage);};
  stage='genuine original prefix16 payment and buyer cookies';
  assert.equal((await sql`select to_regclass('app.commerce_event') absent`)[0].absent,null);
  const attempt=await sql.begin(tx=>createAttempt(tx,order.id,randomUUID(),{method_id:'local-prepaid'}));await run((await sql`select creation_job_id from app.payment_attempt where id=${attempt.id}`)[0].creation_job_id);
  await run(await ingestProviderEvent(sql,await simulateCollection(sql,'test',attempt.id)));
  const [receipt]=await sql`select * from app.economic_receipt where order_id=${order.id}`;assert.ok(receipt);assert.equal((await sql`select payment_status from app.commerce_order where id=${order.id}`)[0].payment_status,'confirmed');
  const [funding]=await sql`select * from app.finance_transaction where id=${receipt.transaction_id}`;
  stage='exact additive prefix17 through21 upgrade';
  savePrefix(22);execute('scripts/migrate.ts','test');
  const current=connectDatabase('test','owner');try{const applied=await current.sql`select hash from drizzle.__drizzle_migrations order by id`;assert.deepEqual(applied.map(row=>row.hash),journal.entries.slice(0,22).map((entry:{tag:string})=>hash(join(source,`migrations/${entry.tag}.sql`))));assert.equal((await current.sql`select count(*)::int n from pg_tables where schemaname='app'`)[0].n,124);}finally{await current.sql.end();}
  assert.equal((await sql`select count(*)::int n from app.commerce_event where order_id=${order.id}`)[0].n,0);
  assert.deepEqual((await sql`select * from app.economic_receipt where id=${receipt.id}`)[0],receipt);assert.deepEqual((await sql`select * from app.finance_transaction where id=${funding.id}`)[0],funding);
  await sql.begin(tx=>initializeFulfillments(tx,order.id));
  const [parcel]=await sql`select f.* from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${order.id}`;assert.ok(parcel);
  const staff=async(path:string,body:Record<string,unknown>,status=201)=>{assert.ok(f);const request=f.owner.browser.request(path,body);request.headers.set('idempotency-key',randomUUID());const response=await handleFulfillment(request,f.identity);assert.equal(response.status,status,stage);return response.json();};
  stage='actual physical original parcel and immutable buyer receipt';
  await staff(`/api/v1/admin/fulfillments/${parcel.id}/preparations`,{expected_version:1});const booked=await staff('/api/v1/admin/shipments',{fulfillment_id:parcel.id,expected_version:2},202),[booking]=await sql`select * from app.shipment_booking where id=${booked.operation_id}`;
  await run(booking.creation_job_id);for(const event of await sql`select callback_job_id from app.waybill_provider_event where booking_id=${booking.id}`)await run(event.callback_job_id);
  await run(await ingestWaybillEvent(sql,await simulateWaybillIssue(sql,'test',booking.id)));
  await staff(`/api/v1/admin/fulfillments/${parcel.id}/packing`,{expected_version:4});await staff(`/api/v1/admin/fulfillments/${parcel.id}/handover`,{expected_version:5,shipment_id:parcel.shipment_id,handover_reference:'SYNTHETIC original pre-signal buyer parcel'});
  const [unit]=await sql`select f.* from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where i.order_id=${order.id}`;
  await run(await ingestParcelReceiptSource(sql,await simulateParcelReceipt(sql,'test',{reference:randomUUID(),booking_id:booking.id,unit_ids:[unit.id]})));
  const buyer=await commerceActor(client.request('/api/v1/carts'),f.identity);assert.ok(buyer);
  const input={items:[{order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'damaged',details:'SYNTHETIC actual pre-signal legacy replacement claim'}],requested_resolution:'replacement'},claim=await createReturn(client.request(`/api/v1/orders/${order.id}/returns`,input),f.identity,buyer,order.id,input) as {id:string};
  const command=(path:string,body:Record<string,unknown>)=>{assert.ok(f);const request=f.owner.browser.request(path,body);request.headers.set('idempotency-key',randomUUID());return request;};
  const decision={decision:'approve_replacement',expected_version:1,requires_goods:false,reason:'SYNTHETIC original company-fault legacy replacement waiver'};await decideReturn(command(`/api/v1/admin/returns/${claim.id}/decisions`,decision),f.identity,f.principal,claim.id,decision);
  const originalItems=await sql`select to_jsonb(r) row from app.return_item r where case_id=${claim.id} order by id`,[selected]=await sql`select id from app.return_item where case_id=${claim.id}`;
  const [originalCase]=await sql`select to_jsonb(c) row from app.return_case c where id=${claim.id}`;
  assert.equal((await sql`select to_regclass('app.replacement_shipment') absent`)[0].absent,null);
  stage='exact isolated0022 upgrade preserves the original approved case and buyer authority';
  savePrefix(23);execute('scripts/migrate.ts','test');
  const upgraded=connectDatabase('test','owner');try{
   assert.deepEqual((await upgraded.sql`select hash from drizzle.__drizzle_migrations order by id`).map(row=>row.hash),journal.entries.map((entry:{tag:string})=>hash(join(source,`migrations/${entry.tag}.sql`))));
   assert.equal((await upgraded.sql`select count(*)::int n from pg_tables where schemaname='app'`)[0].n,140);
  }finally{await upgraded.sql.end();}
  assert.deepEqual(await sql`select to_jsonb(r)-'replacement_link_id' row from app.return_item r where case_id=${claim.id} order by id`,originalItems);
  assert.equal((await sql`select count(*)::int n from app.return_item where case_id=${claim.id} and replacement_link_id is not null`)[0].n,0);
  assert.deepEqual((await sql`select to_jsonb(c) row from app.return_case c where id=${claim.id}`)[0],originalCase);
  assert.equal((await sql`select current_user actor`)[0].actor,'99ribu_test_app');
  const [origin]=await sql`select warehouse_id from app.order_shipment where id=${parcel.shipment_id}`;
  const replacementInput={return_item_ids:[selected.id],warehouse_id:origin.warehouse_id,expected_version:2,reason:'SYNTHETIC dispatch the pre0022 approved quantity'};
  let replacement=await createReplacement(command(`/api/v1/admin/returns/${claim.id}/replacements`,replacementInput),f.identity,f.principal,claim.id,replacementInput);
  assert.equal(replacement.status,'ready');assert.equal(replacement.items.length,1);assert.equal(replacement.items[0].original_fulfillment_item_id,unit.id);
  const act=async(action:'prepare'|'book'|'handover')=>{assert.ok(f);const body={expected_version:replacement.version,reason:`SYNTHETIC legacy replacement ${action}`,...(action==='handover'?{handover_reference:'SYNTHETIC legacy replacement pickup'}:{})};replacement=await actOnReplacement(command(`/api/v1/admin/replacements/${replacement.id}/${action}`,body),f.identity,f.principal,replacement.id,body,action);};
  stage='independently committed original replacement booking, waybill and physical handover';
  await act('prepare');await act('book');const replacementBooking=replacement.booking_id;assert.ok(replacementBooking);
  const [creation]=await sql`select creation_job_id from app.replacement_booking where id=${replacementBooking}`;await run(creation.creation_job_id);
  await run(await ingestReplacementWaybillEvent(sql,await simulateReplacementWaybill(sql,'test',replacementBooking)));
  replacement={...replacement,version:Number((await sql`select revision from app.replacement_shipment where id=${replacement.id}`)[0].revision)};
  await act('handover');assert.equal(replacement.cod_due,0);assert.equal(replacement.buyer_shipping,0);
  await sql`update app.local_fixture_namespace set clock=clock+interval '1 hour',revision=revision+1 where name=${f.namespace}`;
  const replacedUnit=replacement.items[0],replacementReceipt=await simulateReplacementReceipt(sql,'test',{reference:randomUUID(),booking_id:replacementBooking,unit_ids:[replacedUnit.id]});await run(await ingestReplacementReceiptSource(sql,replacementReceipt));
  assert.equal((await sql`select status from app.return_case where id=${claim.id}`)[0].status,'resolved');
  stage='original buyer claims the received replacement using its distinct physical anchor';
  const laterInput={items:[{order_item_id:unit.order_item_id,delivered_fulfillment_item_id:replacedUnit.id,quantity:1,reason:'defective',details:'SYNTHETIC upgraded replacement received defective'}],requested_resolution:'refund'},later=await createReturn(client.request(`/api/v1/orders/${order.id}/returns`,laterInput),f.identity,buyer,order.id,laterInput) as {id:string};
  const [laterItem]=await sql`select fulfillment_item_id,replacement_link_id,deadline_at from app.return_item where case_id=${later.id}`;
  assert.equal(laterItem.fulfillment_item_id,unit.id);assert.equal(laterItem.replacement_link_id,replacedUnit.id);assert.equal(new Date(laterItem.deadline_at).getTime(),Date.parse(replacementReceipt.occurred_at)+168*60*60*1000);
  const refundDecision={decision:'approve_refund',expected_version:1,requires_goods:false,reason:'SYNTHETIC explicit company-fault replacement refund waiver'};await decideReturn(command(`/api/v1/admin/returns/${later.id}/decisions`,refundDecision),f.identity,f.principal,later.id,refundDecision);
  stage='original authenticated collection funds exactly one refund without Purchase backfill';
  const proofResponse=await handleAccess(command('/api/v1/me/reauthentication-proofs',{password:f.owner.password,action:'finance.refund',subject_id:later.id}),f.identity);assert.equal(proofResponse.status,201);
  const queue={return_case_id:later.id,expected_version:2,reason:'SYNTHETIC preserved pre-signal replacement refund',reauthentication_proof:(await proofResponse.json()).proof},refund=await queueRefund(command('/api/v1/admin/refunds',queue),f.identity,f.principal,queue) as {id:string;amount:number};
  assert.equal(refund.amount,99000+Number(unit.buyer_shipping));assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${order.id} and kind='refund_cash'`)[0].n,0);
  await run((await sql`select current_job_id from app.refund where id=${refund.id}`)[0].current_job_id);await run(await ingestRefundSourceEvent(sql,await simulateRefundOutcome(sql,'test',refund.id,'succeeded')));
  const [intent]=await sql`select receipt_id,purchase_event_id,dispatch_reason,merchandise_refunded,retained_merchandise from app.refund_adjustment_intent where refund_id=${refund.id}`;
  assert.equal(intent.receipt_id,receipt.id);assert.equal(intent.purchase_event_id,null);assert.equal(intent.dispatch_reason,'original_purchase_missing');assert.equal(Number(intent.merchandise_refunded),99000);assert.equal(Number(intent.retained_merchandise),0);
  assert.equal((await sql`select status from app.refund where id=${refund.id}`)[0].status,'succeeded');assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${order.id} and kind='refund_cash'`)[0].n,1);
  assert.equal((await sql`select count(*)::int n from app.commerce_event where order_id=${order.id}`)[0].n,0);assert.equal((await sql`select count(*)::int n from app.ad_event_outbox`)[0].n,0);assert.equal((await sql`select count(*)::int n from app.local_ad_sink`)[0].n,0);
  assert.deepEqual((await sql`select * from app.economic_receipt where id=${receipt.id}`)[0],receipt);assert.deepEqual((await sql`select * from app.finance_transaction where id=${funding.id}`)[0],funding);
 }catch(error){if(error instanceof Error)error.message=`${stage}: ${error.message}`;throw error;}
 finally{
  try{if(f){try{await closeFulfillmentActor(f.identity,f.owner);}finally{await f.identity.sql.end();}}}finally{try{if(startAttempted)execute('scripts/database.ts','stop');}finally{process.chdir(source);for(const [path,expected]of original)assert.equal(hash(join(source,path)),expected,path);assert.equal(hash(join(source,'migrations/meta/_journal.json')),sourceJournalHash,'Source migration journal must remain untouched');}}
 }
});
