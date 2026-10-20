import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {createReturn,decideReturn} from '../../src/modules/returns/cases.ts';
import {simulateParcelReceipt,ingestParcelReceiptSource} from '../../src/modules/returns/receipt-source.ts';
import {readAdminRefund,readAdminReturns,readBuyerEligibility,readBuyerRefund,readBuyerReturns} from '../../src/modules/returns/reads.ts';
import {queueRefund} from '../../src/modules/returns/refunds.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor} from './fulfillment-fixture.ts';
import {returnFixture} from './return-fixture.ts';

type StaffCase={id:string;items_complete:boolean;can_decide:boolean;items:{id:string;fulfillment_item_id:string;warehouse_id:string;can_inspect:boolean}[]};
type StaffList={data:StaffCase[];pagination:{next_cursor:string|null}};
const url=(path:string)=>new URL(`http://127.0.0.1:3099${path}`);

test('current quantity-scoped readers hide other warehouses and preserve separate finance-read/CS/inspection authority',async()=>{
 const f=await returnFixture('cod'),sql=f.identity.sql,users:Awaited<ReturnType<typeof actor>>[]=[];
 try{
  for(const booking of f.bookings){
   const parcel=f.parcels.find(row=>row.id===booking.fulfillment_id);assert.ok(parcel);
   const source=await simulateParcelReceipt(sql,'test',{reference:randomUUID(),booking_id:booking.id,unit_ids:f.units.filter(row=>row.shipment_id===parcel.shipment_id).map(row=>row.id)});
   assert.equal(await runOneJob(sql,{},await ingestParcelReceiptSource(sql,source)),true);
  }
  const buyer=await commerceActor(f.client.request('/api/v1/carts'),f.identity);assert.ok(buyer);
  const left=f.units.find(row=>row.shipment_id===f.parcels[0].shipment_id),right=f.units.find(row=>row.shipment_id===f.parcels[1].shipment_id);assert.ok(left&&right);
  const hidden=f.units.find(row=>row.shipment_id===right.shipment_id&&row.id!==right.id);assert.ok(hidden);
  const root=`/api/v1/orders/${f.order.id}`,create=async(units:readonly (typeof f.units)[number][])=>{
   const body={items:units.map(unit=>({order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'damaged',details:`SYNTHETIC private claim ${unit.id}`})),requested_resolution:'refund'};
   return await createReturn(f.client.request(`${root}/returns`,body),f.identity,buyer,f.order.id,body) as {id:string;version:number};
  };
  const mixed=await create([left,right]),other=await create([hidden]);
  const currentBuyer=await readBuyerReturns(f.client.request(`${root}/returns`),f.identity,buyer,f.order.id,url(`${root}/returns?limit=1`)) as {data:{id:string}[];pagination:{next_cursor:string|null}};
  assert.equal(currentBuyer.data.length,1);assert.ok(currentBuyer.pagination.next_cursor);
  const next=await readBuyerReturns(f.client.request(`${root}/returns`),f.identity,buyer,f.order.id,url(`${root}/returns?limit=1&cursor=${currentBuyer.pagination.next_cursor}`)) as {data:{id:string}[]};assert.equal(next.data.length,1);assert.notEqual(next.data[0].id,currentBuyer.data[0].id);
  const eligibility=await readBuyerEligibility(f.client.request(`${root}/returns/eligibility`),f.identity,buyer,f.order.id,url(`${root}/returns/eligibility?limit=4`));assert.equal(eligibility.data.length,4);assert.equal(eligibility.data.filter(row=>row.state==='already_claimed').length,3);
  await assert.rejects(readBuyerReturns(f.client.request(`${root}/returns`,undefined,{anonymous:true}),f.identity,null,f.order.id,url(`${root}/returns`)),{code:'UNAUTHENTICATED'});
  for(const query of ['limit=0','limit=101','limit=01','limit=1&limit=2','unknown=1','cursor=not-a-uuid'])await assert.rejects(readBuyerReturns(f.client.request(`${root}/returns`),f.identity,buyer,f.order.id,url(`${root}/returns?${query}`)),{code:'INVALID_INPUT'});
  const cs=await actor(f.identity,'customer_service',[f.parcels[0].warehouse_id]);users.push(cs);await enroll(cs.browser,cs.password);
  const csPrincipal=await getPrincipal(cs.browser.request('/api/v1/me'),f.identity),path=`/api/v1/admin/returns/${mixed.id}`;
  const partial=await readAdminReturns(f.identity,csPrincipal,url(path),mixed.id) as StaffCase;
  assert.equal(partial.items_complete,false);assert.equal(partial.can_decide,false);assert.equal(partial.items.length,1);assert.equal(partial.items[0].fulfillment_item_id,left.id);assert.equal(partial.items[0].can_inspect,false);
  const serialized=JSON.stringify(partial);for(const secret of [right.id,right.shipment_id,f.parcels[1].warehouse_id,`SYNTHETIC private claim ${right.id}`])assert.equal(serialized.includes(secret),false);
  const listed=await readAdminReturns(f.identity,csPrincipal,url('/api/v1/admin/returns?limit=100')) as StaffList;assert.ok(listed.data.some(row=>row.id===mixed.id));assert.ok(listed.data.every(row=>row.id!==other.id));
  await assert.rejects(readAdminReturns(f.identity,csPrincipal,url(`/api/v1/admin/returns?cursor=${other.id}`)),{code:'INVALID_INPUT'});
  await assert.rejects(readAdminReturns(f.identity,csPrincipal,url(`/api/v1/admin/returns/${other.id}`),other.id),{code:'NOT_FOUND'});
  const finance=await actor(f.identity,'finance',[f.parcels[0].warehouse_id]);users.push(finance);await enroll(finance.browser,finance.password);
  await sql`update app.role_grant set roles=${['finance','customer_service','warehouse']},permissions=${['finance.refunds.read']},revision=revision+1 where user_id=${finance.id}`;
  const financePrincipal=await getPrincipal(finance.browser.request('/api/v1/me'),f.identity),whole=await readAdminReturns(f.identity,financePrincipal,url(path),mixed.id) as StaffCase;
  assert.equal(whole.items_complete,true);assert.equal(whole.items.length,2);assert.equal(whole.can_decide,false);assert.equal(whole.items.find(row=>row.fulfillment_item_id===left.id)?.can_inspect,true);assert.equal(whole.items.find(row=>row.fulfillment_item_id===right.id)?.can_inspect,false);
  const decision={decision:'approve_refund',expected_version:other.version,requires_goods:false,reason:'SYNTHETIC explained original company-fault waiver'};
  const decisionRequest=f.owner.browser.request(`/api/v1/admin/returns/${other.id}/decisions`,decision);decisionRequest.headers.set('idempotency-key',randomUUID());await decideReturn(decisionRequest,f.identity,f.principal,other.id,decision);
  const proofRequest=f.finance.browser.request('/api/v1/me/reauthentication-proofs',{password:f.finance.password,action:'finance.refund',subject_id:other.id});proofRequest.headers.set('idempotency-key',randomUUID());const proofResponse=await handleAccess(proofRequest,f.identity);assert.equal(proofResponse.status,201);
  const queue={return_case_id:other.id,expected_version:2,reason:'SYNTHETIC scoped reader obligation',reauthentication_proof:(await proofResponse.json()).proof},queueRequest=f.finance.browser.request('/api/v1/admin/refunds',queue);queueRequest.headers.set('idempotency-key',randomUUID());
  const refund=await queueRefund(queueRequest,f.identity,f.financePrincipal,queue) as {id:string};
  const read=await readAdminRefund(f.identity,financePrincipal,refund.id);assert.equal(read.status,'awaiting_destination');assert.equal(typeof read.amount,'number');
  const buyerRefund=await readBuyerRefund(f.client.request(`${root}/refunds/${refund.id}`),f.identity,buyer,f.order.id,refund.id);assert.deepEqual(buyerRefund,read);
  await assert.rejects(queueRefund(queueRequest,f.identity,financePrincipal,queue),{code:'FORBIDDEN'});
  for(const field of ['signature','recipient','proof','original_payment_operation_id','destination_source_id','obligation_transaction_id'])assert.equal(JSON.stringify(read).includes(`"${field}"`),false);
  const admin=await actor(f.identity,'ecommerce_admin',[f.parcels[0].warehouse_id,f.parcels[1].warehouse_id]);users.push(admin);await enroll(admin.browser,admin.password);const adminPrincipal=await getPrincipal(admin.browser.request('/api/v1/me'),f.identity);
  await assert.rejects(readAdminReturns(f.identity,adminPrincipal,url(path),mixed.id),{code:'FORBIDDEN'});await assert.rejects(readAdminRefund(f.identity,adminPrincipal,refund.id),{code:'FORBIDDEN'});
  await sql`delete from app.warehouse_membership where user_id=${cs.id}`;await assert.rejects(readAdminReturns(f.identity,csPrincipal,url(path),mixed.id),{code:'NOT_FOUND'});
  await sql`update app.auth_user set email_verified=false where id=${finance.id}`;await assert.rejects(readAdminRefund(f.identity,financePrincipal,refund.id),{code:'FORBIDDEN'});
  assert.ok((await sql`select id from app.audit_event where actor_id=${finance.id} and action='refund.read' and subject_id=${refund.id}`).length);
 }finally{for(const user of users)await closeFulfillmentActor(f.identity,user);await f.close();}
});
