import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {createReturn} from '../../src/modules/returns/cases.ts';
import {ingestParcelReceiptSource,simulateParcelReceipt} from '../../src/modules/returns/receipt-source.ts';
import {handleReturns} from '../../src/modules/returns/routes.ts';
import {deletePrivateArtifact,savePrivateArtifact} from '../../src/storage/private.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor} from './fulfillment-fixture.ts';
import {returnFixture} from './return-fixture.ts';

type Item={id:string;warehouse_id:string;product_name:string;variant_label:string|null;warehouse_name:string;can_inspect:boolean;components?:{balance_id:string;name:string;quantity:number}[]};
type Case={id:string;order_number:string;version:number;status:string;items_complete:boolean;items:Item[];events?:{kind:string;status:string;actor:string;actor_name:string|null;reason:string}[];evidence?:{id:string;content_type:string}[];replacement_ids?:string[];refund_ids?:string[]};
type Requester={request:(path:string,body?:Record<string,unknown>)=>Request};
// 1x1 transparent PNG.
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');

// S101: the staff decision screen's reads and its end-to-end path over the existing return APIs:
// names instead of ids, the state filter, the history (audit trail), inspection components,
// evidence bytes under the whole-case scope, and the audit rows each step writes.
test('staff return screens read names, history and evidence under scope and decide a refund end to end with audit rows',{timeout:180000},async()=>{
 const f=await returnFixture('cod'),sql=f.identity.sql,users:Awaited<ReturnType<typeof actor>>[]=[];let artifact:string|null=null;
 try{
  for(const booking of f.bookings){
   const parcel=f.parcels.find(row=>row.id===booking.fulfillment_id);assert.ok(parcel);
   const source=await simulateParcelReceipt(sql,'test',{reference:randomUUID(),booking_id:booking.id,unit_ids:f.units.filter(row=>row.shipment_id===parcel.shipment_id).map(row=>row.id)});
   assert.equal(await runOneJob(sql,{},await ingestParcelReceiptSource(sql,source)),true);
  }
  const buyer=await commerceActor(f.client.request('/api/v1/carts'),f.identity);assert.ok(buyer);
  const left=f.units.find(row=>row.shipment_id===f.parcels[0].shipment_id),right=f.units.find(row=>row.shipment_id===f.parcels[1].shipment_id);assert.ok(left&&right);
  const root=`/api/v1/orders/${f.order.id}`,create=async(units:readonly (typeof f.units)[number][],resolution:'refund'|'replacement')=>{
   const body={items:units.map(unit=>({order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'damaged',details:`SYNTHETIC staff screen claim ${unit.id}`})),requested_resolution:resolution};
   return await createReturn(f.client.request(`${root}/returns`,body),f.identity,buyer,f.order.id,body) as {id:string;version:number};
  };
  const mixed=await create([left,right],'refund');
  const call=async(browser:Requester,path:string,body?:Record<string,unknown>)=>{
   const request=browser.request(path,body);if(body)request.headers.set('idempotency-key',randomUUID());
   return handleReturns(request,f.identity);
  };
  // Evidence exchanges for the return-evidence contract proof group (binary success, Problem denials).
  const evidenceSamples:Exchange[]=[];
  const evidence=async(browser:Requester,path:string)=>{
   const request=browser.request(path),response=await handleReturns(request,f.identity),headers=Object.fromEntries(response.headers);
   const binary=response.status<400,body=Buffer.from(await response.clone().arrayBuffer());
   evidenceSamples.push({url:request.url,method:'GET',request_headers:{},request_valid:true,status:response.status,headers,payload:binary?'':JSON.parse(body.toString('utf8'))});
   return response;
  };
  const json=async(browser:Requester,path:string,body?:Record<string,unknown>,status=body?201:200)=>{
   const response=await call(browser,path,body);const payload=await response.json();assert.equal(response.status,status,JSON.stringify(payload));return payload;
  };
  const [order]=await sql`select number from app.commerce_order where id=${f.order.id}`;

  // List: names and the state filter.
  const decide=await json(f.owner.browser,'/api/v1/admin/returns?state=decide&limit=100') as {data:Case[]};
  const listed=decide.data.find(row=>row.id===mixed.id);assert.ok(listed);assert.equal(listed.order_number,order.number);
  assert.equal(listed.events,undefined,'history is a detail-only field');assert.equal(listed.items[0].components,undefined);
  assert.ok(listed.items.every(item=>item.product_name.length>0&&item.warehouse_name.length>0));
  assert.ok(!(await json(f.owner.browser,'/api/v1/admin/returns?state=done&limit=100') as {data:Case[]}).data.some(row=>row.id===mixed.id));
  for(const query of ['state=bogus','state=decide&state=done','state=']) assert.equal((await call(f.owner.browser,`/api/v1/admin/returns?${query}`)).status,400,query);
  assert.equal((await call(f.owner.browser,`/api/v1/admin/returns/${mixed.id}?state=decide`)).status,400);

  // Detail: history, inspection components for the inspecting principal, empty remedies.
  const detail=await json(f.owner.browser,`/api/v1/admin/returns/${mixed.id}`) as Case;
  assert.equal(detail.items_complete,true);assert.deepEqual(detail.replacement_ids,[]);assert.deepEqual(detail.evidence,[]);
  assert.deepEqual(detail.events?.map(e=>[e.kind,e.status,e.actor,e.actor_name]),[['create','requested','buyer',null]]);
  assert.ok(detail.items.every(item=>item.can_inspect&&(item.components?.length??0)>0));

  // Evidence: attached bytes for whole-case readers only; unknown and pending ids are 404.
  artifact=await savePrivateArtifact(PNG);const evidenceId=randomUUID();
  await sql`insert into app.return_evidence (id,case_id,order_id,uploader_scope,content_type,byte_size,sha256,storage_key,status,expires_at)
   values (${evidenceId},${mixed.id},${f.order.id},'SYNTHETIC','image/png',${PNG.byteLength},${'0'.repeat(64)},${artifact},'attached',clock_timestamp()+interval '1 hour')`;
  const withEvidence=await json(f.owner.browser,`/api/v1/admin/returns/${mixed.id}`) as Case;
  assert.deepEqual(withEvidence.evidence?.map(e=>[e.id,e.content_type]),[[evidenceId,'image/png']]);
  const bytes=await evidence(f.owner.browser,`/api/v1/admin/returns/${mixed.id}/evidence/${evidenceId}`);
  assert.equal(bytes.status,200);assert.equal(bytes.headers.get('content-type'),'image/png');assert.equal(bytes.headers.get('cache-control'),'no-store');
  assert.equal(bytes.headers.get('x-content-type-options'),'nosniff');assert.match(bytes.headers.get('content-security-policy')??'',/sandbox/);
  assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),PNG);
  assert.ok((await sql`select 1 from app.audit_event where actor_id=${f.principal.id} and action='return.evidence.read' and subject_id=${mixed.id}`).length);
  assert.equal((await evidence(f.owner.browser,`/api/v1/admin/returns/${mixed.id}/evidence/${randomUUID()}`)).status,404);
  assert.equal((await call(f.owner.browser,`/api/v1/admin/returns/${mixed.id}/evidence/${evidenceId}?x=1`)).status,400);

  // A CS agent scoped to one parcel's warehouse: partial case, no evidence, no components, evidence bytes refused.
  const cs=await actor(f.identity,'customer_service',[f.parcels[0].warehouse_id]);users.push(cs);await enroll(cs.browser,cs.password);
  const partial=await json(cs.browser,`/api/v1/admin/returns/${mixed.id}`) as Case;
  assert.equal(partial.items_complete,false);assert.deepEqual(partial.evidence,[]);assert.equal(partial.items.length,1);assert.equal(partial.items[0].components,undefined);
  assert.equal(JSON.stringify(partial).includes(`SYNTHETIC staff screen claim ${right.id}`),false);
  assert.equal((await evidence(cs.browser,`/api/v1/admin/returns/${mixed.id}/evidence/${evidenceId}`)).status,404);
  assert.equal((await evidence(f.client,`/api/v1/admin/returns/${mixed.id}/evidence/${evidenceId}`)).status,401);
  validateExchanges(evidenceSamples,'return-evidence');

  // Decide (owner, goods required) → awaiting_goods; the decision appears in the history with the staff name.
  const decided=await json(f.owner.browser,`/api/v1/admin/returns/${mixed.id}/decisions`,{decision:'approve_refund',requires_goods:true,expected_version:detail.version,reason:'SYNTHETIC staff screen approval'});
  assert.equal(decided.status,'awaiting_goods');
  const awaiting=await json(f.owner.browser,'/api/v1/admin/returns?state=goods&limit=100') as {data:Case[]};assert.ok(awaiting.data.some(row=>row.id===mixed.id));
  const afterDecision=await json(f.owner.browser,`/api/v1/admin/returns/${mixed.id}`) as Case;
  const decisionEvent=afterDecision.events?.at(-1);assert.equal(decisionEvent?.kind,'decision');assert.equal(decisionEvent?.actor,'staff');assert.equal(decisionEvent?.actor_name,'Synthetic Access');assert.equal(decisionEvent?.reason,'SYNTHETIC staff screen approval');

  // Inspect every unit with the components the detail lists → approved.
  const inspected=await json(f.owner.browser,`/api/v1/admin/returns/${mixed.id}/inspections`,{expected_version:afterDecision.version,result:'accepted',reason:'SYNTHETIC staff screen inspection',
   items:afterDecision.items.map(item=>({return_item_id:item.id,goods:(item.components??[]).map(c=>({expected_balance_id:c.balance_id,quantity:c.quantity,identity_confirmed:true}))}))});
  assert.equal(inspected.status,'approved');

  // Finance queues the refund with a case-bound proof → refunding; the list moves it to progress.
  const proofRequest=f.finance.browser.request('/api/v1/me/reauthentication-proofs',{password:f.finance.password,action:'finance.refund',subject_id:mixed.id});proofRequest.headers.set('idempotency-key',randomUUID());
  const proof=await handleAccess(proofRequest,f.identity);assert.equal(proof.status,201);
  const refund=await json(f.finance.browser,'/api/v1/admin/refunds',{return_case_id:mixed.id,expected_version:inspected.version,reason:'SYNTHETIC staff screen refund',reauthentication_proof:(await proof.json()).proof},202);
  assert.equal(refund.status,'awaiting_destination');
  const progress=await json(f.owner.browser,'/api/v1/admin/returns?state=progress&limit=100') as {data:Case[]};
  const moved=progress.data.find(row=>row.id===mixed.id);assert.equal(moved?.status,'refunding');assert.deepEqual(moved?.refund_ids,[refund.id]);
  const final=await json(f.owner.browser,`/api/v1/admin/returns/${mixed.id}`) as Case;
  assert.deepEqual(final.events?.map(e=>e.kind),['create','decision','inspection','refund_queue']);

  // Audit rows of each staff step.
  for(const [actorId,action] of [[f.principal.id,'return.decide'],[f.principal.id,'return.inspect'],[f.finance.id,'refund.queue'],[f.principal.id,'return.read'],[f.principal.id,'return.list']] as const)
   assert.ok((await sql`select 1 from app.audit_event where actor_id=${actorId} and action=${action} and subject_id is not distinct from ${action==='return.list'?null:mixed.id}`).length,action);
 }finally{
  if(artifact)await deletePrivateArtifact(artifact).catch(()=>undefined);
  for(const user of users)await closeFulfillmentActor(f.identity,user);await f.close();
 }
});
