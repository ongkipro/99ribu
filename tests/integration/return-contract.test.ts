import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {handleReturns} from '../../src/modules/returns/routes.ts';
import {ingestParcelReceiptSource,simulateParcelReceipt} from '../../src/modules/returns/receipt-source.ts';
import {createRefundDestinationSource,ingestRefundSourceEvent,simulateRefundOutcome} from '../../src/modules/returns/refund-source.ts';
import {refundAdapter} from '../../src/modules/returns/worker.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {returnFixture} from './return-fixture.ts';

test('cookie return adapters exercise every selected operation with private success and denial and immutable original money',async()=>{
 const f=await returnFixture('cod'),sql=f.identity.sql,samples:Exchange[]=[],root=`/api/v1/orders/${f.order.id}`;
 const call=async(path:string,body?:Record<string,unknown>,browser:'buyer'|'staff'|'anonymous'='staff',key=randomUUID())=>{
  const request=browser==='staff'?f.owner.browser.request(path,body):f.client.request(path,body,{anonymous:browser==='anonymous'});if(body)request.headers.set('idempotency-key',key);
  const response=await handleReturns(request,f.identity),payload=await response.json(),headers=Object.fromEntries(response.headers);
  assert.equal(headers['cache-control'],'no-store');assert.equal(headers['referrer-policy'],'no-referrer');assert.equal(headers['x-content-type-options'],'nosniff');
  samples.push({url:request.url,method:request.method,request_headers:Object.fromEntries(request.headers),...(body?{request_body:JSON.stringify(body),body_bytes:Buffer.byteLength(JSON.stringify(body))}:{}),request_valid:true,status:response.status,headers,payload});
  return {status:response.status,payload};
 };
 const expected=async(result:ReturnType<typeof call>,status:number)=>{const value=await result;assert.equal(value.status,status,`Safe return adapter code ${value.payload.code??'none'}`);return value.payload;};
 const commandProof=async(subjectId:string)=>{
  const request=f.owner.browser.request('/api/v1/me/reauthentication-proofs',{password:f.owner.password,action:'finance.refund',subject_id:subjectId});request.headers.set('idempotency-key',randomUUID());const response=await handleAccess(request,f.identity);assert.equal(response.status,201);return (await response.json()).proof as string;
 };
 const run=async(jobId:string)=>{assert.equal(await runOneJob(sql,{'refund.create':refundAdapter(sql,'test')},jobId),true);assert.equal((await sql`select status from app.outbox_job where id=${jobId}`)[0].status,'completed');};
 try{
  const dummy=randomUUID(),dummyUnit=f.units[0],claim={items:[{order_item_id:dummyUnit.order_item_id,delivered_fulfillment_item_id:dummyUnit.id,quantity:1,reason:'damaged',details:'SYNTHETIC cookie return contract'}],requested_resolution:'refund'};
  const endpoints:[string,Record<string,unknown>|undefined][]=[
   [`${root}/returns`,claim],[`${root}/returns`,undefined],[`${root}/returns/${dummy}`,undefined],[`${root}/returns/eligibility`,undefined],
   [`${root}/refunds/${dummy}`,undefined],[`${root}/refunds/${dummy}/destinations`,{destination_source_id:dummy,expected_version:1}],
   ['/api/v1/admin/returns',undefined],[`/api/v1/admin/returns/${dummy}`,undefined],[`/api/v1/admin/returns/${dummy}/decisions`,{decision:'approve_refund',expected_version:1,reason:'SYNTHETIC denied'}],
   [`/api/v1/admin/returns/${dummy}/inspections`,{expected_version:1,result:'accepted',reason:'SYNTHETIC denied',items:[{return_item_id:dummy,goods:[]}]}],
   ['/api/v1/admin/refunds',{return_case_id:dummy,expected_version:1,reason:'SYNTHETIC denied',reauthentication_proof:'SYNTHETIC-NOT-ISSUED'}],
   [`/api/v1/admin/refunds/${dummy}`,undefined],[`/api/v1/admin/refunds/${dummy}/reconciliations`,{action:'reconcile',expected_version:1,reason:'SYNTHETIC denied',reauthentication_proof:'SYNTHETIC-NOT-ISSUED'}]
  ];
  for(const [path,body] of endpoints)await expected(call(path,body,'anonymous'),401);
  const before=await expected(call(`${root}/returns/eligibility`,undefined,'buyer'),200);assert.equal(before.data.every((row:{state:string})=>row.state==='not_received'),true);
  for(const booking of f.bookings){const parcel=f.parcels.find(row=>row.id===booking.fulfillment_id);assert.ok(parcel);const source=await simulateParcelReceipt(sql,'test',{reference:randomUUID(),booking_id:booking.id,unit_ids:f.units.filter(row=>row.shipment_id===parcel.shipment_id).map(row=>row.id)});await run(await ingestParcelReceiptSource(sql,source));}
  const key=randomUUID(),created=await expected(call(`${root}/returns`,claim,'buyer',key),201);assert.deepEqual(await expected(call(`${root}/returns`,claim,'buyer',key),201),created);
  const caseRoot=`/api/v1/admin/returns/${created.id}`;
  assert.equal((await expected(call(`${root}/returns`,undefined,'buyer'),200)).data[0].id,created.id);assert.equal((await expected(call(`${root}/returns/${created.id}`,undefined,'buyer'),200)).id,created.id);
  assert.ok((await expected(call('/api/v1/admin/returns'),200)).data.some((row:{id:string})=>row.id===created.id));
  const detail=await expected(call(caseRoot),200);assert.equal(detail.items_complete,true);assert.equal(detail.can_decide,true);
  await expected(call(`${caseRoot}/decisions`,{decision:'approve_refund',expected_version:1,reason:'SYNTHETIC current original claim'}),201);
  const [component]=await sql`select balance_id,quantity from app.fulfillment_component_allocation where fulfillment_item_id=${dummyUnit.id} order by balance_id limit 1`;
  await expected(call(`${caseRoot}/inspections`,{expected_version:2,result:'accepted',reason:'SYNTHETIC actual original quarantine intake',items:[{return_item_id:detail.items[0].id,goods:[{expected_balance_id:component.balance_id,quantity:component.quantity,identity_confirmed:true}]}]}),201);
  const queue={return_case_id:created.id,expected_version:3,reason:'SYNTHETIC current original refund obligation',reauthentication_proof:await commandProof(created.id)},refund=await expected(call('/api/v1/admin/refunds',queue),202),refundRoot=`/api/v1/admin/refunds/${refund.id}`;
  assert.equal(refund.status,'awaiting_destination');assert.equal((await expected(call(`${root}/refunds/${refund.id}`,undefined,'buyer'),200)).version,refund.version);await expected(call(refundRoot),200);
  const destination=await createRefundDestinationSource(sql,'test',refund.id);await expected(call(`${root}/refunds/${refund.id}/destinations`,{destination_source_id:destination.id,expected_version:refund.version},'buyer'),201);
  await run((await sql`select current_job_id from app.refund where id=${refund.id}`)[0].current_job_id);
  const failed=await simulateRefundOutcome(sql,'test',refund.id,'failed');await run(await ingestRefundSourceEvent(sql,failed));
  const current=await expected(call(refundRoot),200);await expected(call(`${refundRoot}/reconciliations`,{action:'retry',expected_version:current.version,reason:'SYNTHETIC explicit retry after signed zero-money failure',reauthentication_proof:await commandProof(refund.id)}),202);
  await run((await sql`select current_job_id from app.refund where id=${refund.id}`)[0].current_job_id);await run(await ingestRefundSourceEvent(sql,await simulateRefundOutcome(sql,'test',refund.id,'succeeded')));
  assert.equal((await expected(call(`${root}/refunds/${refund.id}`,undefined,'buyer'),200)).status,'succeeded');assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_cash'`)[0].n,1);
  for(const header of ['authorization','x-cart-token','x-order-token']){const request=f.client.request(`${root}/returns`);request.headers.set(header,'SYNTHETIC-UNSUPPORTED');const response=await handleReturns(request,f.identity);assert.equal(response.status,401);assert.equal((await response.json()).code,'UNSUPPORTED_AUTH_TRANSPORT');}
  const operation=(method:string,address:string)=>`${method} ${new URL(address).pathname.split('/').map(part=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(part)?':id':part).join('/')}`;
  const expectedOperations=new Set(endpoints.map(([path,body])=>operation(body?'POST':'GET',`http://127.0.0.1:3099${path}`)));
  assert.deepEqual(new Set(samples.filter(sample=>sample.status<400).map(sample=>operation(sample.method,sample.url))),expectedOperations);
  assert.deepEqual(new Set(samples.filter(sample=>sample.status>=400).map(sample=>operation(sample.method,sample.url))),expectedOperations);
  validateExchanges(samples,'returns');
 }finally{await f.close();}
});
