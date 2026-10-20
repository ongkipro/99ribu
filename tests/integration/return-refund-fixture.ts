import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {runOneJob} from '../../src/jobs/worker.ts';
import {createReturn,decideReturn} from '../../src/modules/returns/cases.ts';
import {simulateParcelReceipt,ingestParcelReceiptSource} from '../../src/modules/returns/receipt-source.ts';
import {acceptRefundDestination,type projectBuyerRefund,queueRefund} from '../../src/modules/returns/refunds.ts';
import {createRefundDestinationSource} from '../../src/modules/returns/refund-source.ts';
import {returnFixture} from './return-fixture.ts';

export async function approvedRefundFixture(method:'cod'|'prepaid'='prepaid'){
 const f=await returnFixture(method),sql=f.identity.sql;
 try{
  const unit=f.units[0],parcel=f.parcels.find(row=>row.shipment_id===unit.shipment_id),booking=f.bookings.find(row=>row.fulfillment_id===parcel?.id);assert.ok(booking);
  const receipt=await simulateParcelReceipt(sql,'test',{reference:randomUUID(),booking_id:booking.id,unit_ids:[unit.id]});assert.equal(await runOneJob(sql,{},await ingestParcelReceiptSource(sql,receipt)),true);
  const buyer=await commerceActor(f.client.request('/api/v1/carts'),f.identity);assert.ok(buyer);
  const claim={items:[{order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'damaged',details:'SYNTHETIC original received refund recovery fixture'}],requested_resolution:'refund'},created=await createReturn(f.client.request(`/api/v1/orders/${f.order.id}/returns`,claim),f.identity,buyer,f.order.id,claim) as {id:string};
  const decision={decision:'approve_refund',expected_version:1,requires_goods:false,reason:'SYNTHETIC explicit company-fault physical return waiver'},decisionRequest=f.owner.browser.request(`/api/v1/admin/returns/${created.id}/decisions`,decision);decisionRequest.headers.set('idempotency-key',randomUUID());await decideReturn(decisionRequest,f.identity,f.principal,created.id,decision);
  const proof=async(subjectId:string)=>{const request=f.finance.browser.request('/api/v1/me/reauthentication-proofs',{password:f.finance.password,action:'finance.refund',subject_id:subjectId});request.headers.set('idempotency-key',randomUUID());const response=await handleAccess(request,f.identity);assert.equal(response.status,201);return (await response.json()).proof as string;};
  const financeRequest=(path:string,body:Record<string,unknown>,key=randomUUID())=>{const request=f.finance.browser.request(path,body);request.headers.set('idempotency-key',key);return request;};
  const input={return_case_id:created.id,expected_version:2,reason:'SYNTHETIC exact original-unit recovery obligation',reauthentication_proof:await proof(created.id)};
  let refund=await queueRefund(financeRequest('/api/v1/admin/refunds',input),f.identity,f.financePrincipal,input) as Awaited<ReturnType<typeof projectBuyerRefund>>;
  if(method==='cod'){
   const destination=await createRefundDestinationSource(sql,'test',refund.id),body={destination_source_id:destination.id,expected_version:refund.version};
   refund=await acceptRefundDestination(f.client.request(`/api/v1/orders/${f.order.id}/refunds/${refund.id}/destinations`,body),f.identity,buyer,f.order.id,refund.id,body) as typeof refund;
  }
  const [head]=await sql`select current_job_id from app.refund where id=${refund.id}`;assert.ok(head.current_job_id);
  return {...f,buyer,unit,caseId:created.id,refund,jobId:String(head.current_job_id),proof,financeRequest};
 }catch(error){await f.close();throw error;}
}
