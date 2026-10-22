import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError,type Principal} from '../access/policy.ts';
import {id,integer,invalid,object} from '../catalog/validation.ts';
import {actorScope,type CommerceActor} from '../checkout/access.ts';
import {intentHash,mutationKey} from '../checkout/carts.ts';
import {authorizeOrder} from '../checkout/orders.ts';
import {financeInstant} from '../finance/ledger.ts';
import {fulfillmentClock} from '../fulfillment/core.ts';
import {lockPaymentOrder} from '../payments/attempts.ts';
import {assertReturnReview,returnAuthority} from './authority.ts';
import {assertReturnWindow,returnEntitlement,returnRequest,returnText} from './policy.ts';
import {readReturnOccurrences,verifyOccurrenceReceipt} from './occurrences.ts';
import {enqueueCommissionClaim} from '../commissions/jobs.ts';

export type ReturnHead={id:string;order_id:string;operation_id:string;revision:number;status:string;requested_resolution:'refund'|'replacement';resolution:'refund'|'replacement'|null;requires_goods:boolean|null;created_at:string};
export type ReturnUnit={id:string;case_id:string;fulfillment_item_id:string;replacement_link_id:string|null;order_item_id:string;shipment_id:string;warehouse_id:string;reason:string;details:string;claim_state:string;inspection_status:string;merchandise_amount:string;buyer_shipping:string;payment_charge:string;deadline_at:string};
export type ReturnUnitState={id:string;claim_state:string;inspection_status:string};
export type ReturnCause={source_kind:'operation'|'refund'|'replacement'|'recovery';source_id:string;actor_id:string|null;reason:string;occurred_at:string};

export async function returnUnits(tx:TransactionSql,caseId:string){
 const [installed]=await tx`select to_regclass('app.replacement_link') is not null installed`;
 if(!installed.installed)return tx<ReturnUnit[]>`select r.*,null::uuid replacement_link_id,f.order_item_id,f.shipment_id,s.warehouse_id from app.return_item r join app.fulfillment_item f on f.id=r.fulfillment_item_id join app.order_shipment s on s.id=f.shipment_id where r.case_id=${caseId} order by r.id`;
 return tx<ReturnUnit[]>`select r.*,f.order_item_id,coalesce(parcel.id,f.shipment_id) shipment_id,coalesce(parcel.warehouse_id,s.warehouse_id) warehouse_id
  from app.return_item r join app.fulfillment_item f on f.id=r.fulfillment_item_id join app.order_shipment s on s.id=f.shipment_id
  left join app.replacement_link link on link.id=r.replacement_link_id left join app.replacement_shipment parcel on parcel.id=link.shipment_id where r.case_id=${caseId} order by r.id`;
}

export async function insertReturnOperation(tx:TransactionSql,actor:CommerceActor,key:string,action:string,subjectId:string,orderId:string,requestHash:string,proofDigest:string|null=null){
 const operationId=randomUUID();
 const [stored]=await tx`insert into app.return_operation (id,order_id,occurred_at,actor_scope,actor_id,session_id,guest_id,key,action,subject_id,request_hash,proof_digest,response)
  values (${operationId},${id(orderId)},clock_timestamp(),${actorScope(actor)},${actor.kind==='user'?actor.id:null},${actor.kind==='user'?actor.principal.sessionId:null},${actor.kind==='guest'?actor.id:null},${key},${action},${subjectId},${requestHash},${proofDigest},'{}'::jsonb) returning id,occurred_at`;
 return {id:String(stored.id),occurred_at:new Date(stored.occurred_at).toISOString()};
}

export async function finishReturnOperation(tx:TransactionSql,operationId:string,response:unknown,actorId:string|null,action:string,subjectId:string,details:Record<string,unknown>){
 await tx`update app.return_operation set response=${JSON.stringify(response)}::jsonb where id=${operationId}`;
 await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details,created_at) values (${actorId},${action},${subjectId},'allowed','Committed scoped original return/refund operation',${JSON.stringify({operation_id:operationId,...details})}::jsonb,clock_timestamp())`;
 await tx`set constraints all immediate`;return response;
}

async function appendReturnEvent(tx:TransactionSql,head:ReturnHead,revision:number,kind:string,status:string,resolution:ReturnHead['resolution'],requiresGoods:boolean|null,cause:ReturnCause,states:readonly ReturnUnitState[]){
 const eventId=randomUUID();
 await tx`insert into app.return_event (id,case_id,revision,kind,status,resolution,requires_goods,source_kind,source_id,actor_id,reason,occurred_at)
  values (${eventId},${head.id},${revision},${kind},${status},${resolution},${requiresGoods},${cause.source_kind},${cause.source_id},${cause.actor_id},${returnText(cause.reason)},${financeInstant(cause.occurred_at)})`;
 for(const state of states){
  const [stored]=await tx`update app.return_item set claim_state=${state.claim_state},inspection_status=${state.inspection_status} where id=${state.id} and case_id=${head.id} returning id`;
  if(!stored)throw new AccessError(404,'NOT_FOUND');
  await tx`insert into app.return_item_event (case_id,event_id,return_item_id,claim_state,inspection_status) values (${head.id},${eventId},${state.id},${state.claim_state},${state.inspection_status})`;
  await enqueueCommissionClaim(tx,head.order_id,state.id,state.claim_state);
 }
 return eventId;
}

export async function advanceReturn(tx:TransactionSql,head:ReturnHead,change:{kind:string;status:string;resolution:ReturnHead['resolution'];requires_goods:boolean|null;cause:ReturnCause;states:readonly ReturnUnitState[]}){
 if(head.revision===2147483647)throw new AccessError(409,'RETURN_VERSION_EXHAUSTED');
 const revision=head.revision+1,eventId=await appendReturnEvent(tx,head,revision,change.kind,change.status,change.resolution,change.requires_goods,change.cause,change.states);
 const [current]=await tx<ReturnHead[]>`update app.return_case set revision=${revision},status=${change.status},resolution=${change.resolution},requires_goods=${change.requires_goods} where id=${head.id} returning *`;
 return {head:current,eventId};
}

export async function lockStaffReturn(tx:TransactionSql,principal:Principal,caseId:string){
 await returnAuthority(tx,principal);const selected=id(caseId),[before]=await tx`select order_id from app.return_case where id=${selected}`;
 if(!before)throw new AccessError(404,'NOT_FOUND');
 const order=await lockPaymentOrder(tx,before.order_id),[head]=await tx<ReturnHead[]>`select * from app.return_case where id=${selected} for update`;
 const access=await returnAuthority(tx,principal),items=await returnUnits(tx,selected);
 return {head,order,access,items};
}

const buyerMessages:Record<string,string>={requested:'Permintaan retur tersimpan dan menunggu pemeriksaan.',reviewing:'Tim kami sedang memeriksa informasi retur.',approved:'Retur disetujui. Proses berikutnya sedang disiapkan.',rejected:'Permintaan retur belum dapat disetujui.',awaiting_goods:'Retur disetujui. Kami menunggu barang yang perlu dikembalikan.',inspecting:'Barang retur sedang diperiksa.',refunding:'Pengembalian dana sedang diproses.',replacing:'Penggantian barang sedang disiapkan.',resolved:'Proses retur selesai.'};
// Caller owns original-order authorization. Keep one case version and its
// child refund facts stable until the surrounding transaction finishes.
export async function projectBuyerReturn(tx:TransactionSql,caseId:string){
 const [head]=await tx<ReturnHead[]>`select * from app.return_case where id=${id(caseId)} for share`;if(!head)throw new AccessError(404,'NOT_FOUND');
 const items=await returnUnits(tx,head.id),refunds=await tx`select id,amount from app.refund where case_id=${head.id} order by id`;
 const [publicDecision]=['rejected','reviewing'].includes(head.status)?await tx`select reason from app.return_event where case_id=${head.id} and kind='decision' order by revision desc limit 1`:[];
 const [replacementSchema]=await tx`select to_regclass('app.replacement_shipment') is not null installed`;
 const replacements=replacementSchema.installed?await tx`select id from app.replacement_shipment where case_id=${head.id} order by id`:[];
 const [retired]=head.status==='replacing'?await tx`select id from app.return_event where case_id=${head.id} and kind='replacement_cancelled' limit 1`:[];
 return {id:head.id,order_id:head.order_id,status:head.status,items:items.map(item=>({order_item_id:item.order_item_id,quantity:1,reason:item.reason,details:item.details,delivered_fulfillment_item_id:item.replacement_link_id??item.fulfillment_item_id})),requested_resolution:head.requested_resolution,
  explanation:publicDecision?.reason??(retired?'Ada penggantian barang yang dibatalkan. Penanganan retur masih berjalan.':buyerMessages[head.status]),replacement_shipment_ids:replacements.map(row=>String(row.id)),...(refunds.length?{refund_amount:Number(refunds[0].amount)}:{}),created_at:new Date(head.created_at).toISOString(),version:head.revision,refund_ids:refunds.map(row=>String(row.id))};
}

export async function createReturn(request:Request,identity:LocalAuth,actor:CommerceActor|null,orderId:string,value:unknown){
 const selected=id(orderId),input=returnRequest(value),key=mutationKey(request),hash=await intentHash(identity,'return.create',{order_id:selected,...input});
 return identity.sql.begin(async tx=>{
  let order=await authorizeOrder(tx,request,identity,actor,selected);await lockPaymentOrder(tx,selected);order=await authorizeOrder(tx,request,identity,actor,selected);
  if(!actor&&!order.owner_guest_id)throw new AccessError(401,'UNAUTHENTICATED');
  const currentActor:CommerceActor=actor??{kind:'guest',id:order.owner_guest_id as string};
  const [previous]=await tx`select action,request_hash,response from app.return_operation where actor_scope=${actorScope(currentActor)} and key=${key}`;
  if(previous){if(previous.action!=='return.create'||previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return previous.response;}
  const unitIds=input.items.map(item=>item.delivered_fulfillment_item_id),originals=await readReturnOccurrences(tx,selected,{ids:unitIds});
  if(originals.length!==input.items.length||originals.some(unit=>!input.items.some(item=>item.delivered_fulfillment_item_id===unit.id&&item.order_item_id===unit.order_item_id)))throw new AccessError(404,'NOT_FOUND');
  await tx`select id from app.fulfillment_item where id in ${tx([...new Set(originals.map(unit=>unit.fulfillment_item_id))])} order by id for update`;
  const now=await fulfillmentClock(tx,order.clock_namespace),prepared=[];
  for(const original of originals){
   const received=await verifyOccurrenceReceipt(tx,original,order.clock_namespace);
   const deadline=assertReturnWindow(received,now),amounts=returnEntitlement(Number(original.unit_price),Number(original.buyer_shipping),Number(original.payment_charge)),line=input.items.find(item=>item.delivered_fulfillment_item_id===original.id);
   if(!line)throw invalid();
   const claims=original.replacement_link_id===null
    ?await tx`select id from app.return_item where fulfillment_item_id=${original.fulfillment_item_id} and claim_state<>'released'`
    :await tx`select id from app.return_item where replacement_link_id=${original.replacement_link_id} and claim_state<>'released'`;
   if(claims.length)throw new AccessError(409,'RETURN_QUANTITY_ALREADY_CLAIMED');
   prepared.push({id:randomUUID(),original,line,deadline,amounts,received});
  }
  // Receipt/source lookups may wait. Current authority and the original seven
  // elapsed-day window must still hold when the case is actually submitted.
  await authorizeOrder(tx,request,identity,actor,selected);const submitted=await fulfillmentClock(tx,order.clock_namespace);
  for(const item of prepared)assertReturnWindow(item.received,submitted);
  const caseId=randomUUID(),{id:operationId}=await insertReturnOperation(tx,currentActor,key,'return.create',caseId,selected,hash);
  const [head]=await tx<ReturnHead[]>`insert into app.return_case (id,order_id,operation_id,revision,status,requested_resolution,created_at) values (${caseId},${selected},${operationId},1,'requested',${input.requested_resolution},${submitted}) returning *`;
  // The native creation guard owns submission time. Use its returned stamp,
  // including a boundary crossed after the final application-side clock read.
  const acceptedAt=new Date(head.created_at).toISOString();
  for(const item of prepared)assertReturnWindow(item.received,acceptedAt);
  for(const item of prepared){
   if(item.original.replacement_link_id===null)await tx`insert into app.return_item (id,case_id,fulfillment_item_id,buyer_receipt_id,reason,details,deadline_at,merchandise_amount,buyer_shipping,payment_charge) values (${item.id},${caseId},${item.original.fulfillment_item_id},${item.original.buyer_receipt_id},${item.line.reason},${item.line.details},${item.deadline},${item.amounts.merchandise_amount},${item.amounts.buyer_shipping},${item.amounts.payment_charge})`;
   else await tx`insert into app.return_item (id,case_id,fulfillment_item_id,replacement_link_id,buyer_receipt_id,reason,details,deadline_at,merchandise_amount,buyer_shipping,payment_charge) values (${item.id},${caseId},${item.original.fulfillment_item_id},${item.original.replacement_link_id},${item.original.buyer_receipt_id},${item.line.reason},${item.line.details},${item.deadline},${item.amounts.merchandise_amount},${item.amounts.buyer_shipping},${item.amounts.payment_charge})`;
  }
  await appendReturnEvent(tx,head,1,'create','requested',null,null,{source_kind:'operation',source_id:operationId,actor_id:currentActor.kind==='user'?currentActor.id:null,reason:'Buyer submitted original received complete offers within the claim window',occurred_at:acceptedAt},prepared.map(item=>({id:item.id,claim_state:'held',inspection_status:'pending'})));
  const response=await projectBuyerReturn(tx,caseId);
  return finishReturnOperation(tx,operationId,response,currentActor.kind==='user'?currentActor.id:null,'return.create',caseId,{units:prepared.length,version:1});
 });
}

export async function decideReturn(request:Request,identity:LocalAuth,principal:Principal,caseId:string,value:unknown){
 const input=object(value,['decision','reason','expected_version','requires_goods']);
 if(!['approve_refund','approve_replacement','reject','request_evidence'].includes(String(input.decision)))throw invalid();
 const approved=String(input.decision).startsWith('approve_');
 if(input.requires_goods!==undefined&&(!approved||typeof input.requires_goods!=='boolean'))throw invalid();
 const normalized={case_id:id(caseId),decision:String(input.decision),reason:returnText(input.reason),expected_version:integer(input.expected_version,1),requires_goods:approved?(input.requires_goods??true):null},key=mutationKey(request),hash=await intentHash(identity,'return.decide',normalized);
 return identity.sql.begin(async tx=>{
  const {head,order,access,items}=await lockStaffReturn(tx,principal,normalized.case_id);assertReturnReview(access,items.map(item=>item.warehouse_id));
  const actor:CommerceActor={kind:'user',id:principal.id,principal:access.principal},[previous]=await tx`select action,request_hash,response from app.return_operation where actor_scope=${actorScope(actor)} and key=${key}`;
  if(previous){if(previous.action!=='return.decide'||previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return previous.response;}
  if(head.revision!==normalized.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  if(!['requested','reviewing','approved','awaiting_goods','inspecting'].includes(head.status)||(await tx`select id from app.refund where case_id=${head.id}`).length)throw new AccessError(409,'RETURN_DECISION_NOT_CURRENT');
  const resolution=normalized.decision==='approve_refund'?'refund':normalized.decision==='approve_replacement'?'replacement':head.resolution;
  if(approved&&resolution!==head.requested_resolution)throw new AccessError(409,'RETURN_RESOLUTION_CHANGED');
  const states=items.map(item=>({id:item.id,claim_state:normalized.decision==='reject'?'released':item.claim_state,inspection_status:approved?(normalized.requires_goods?(item.inspection_status==='waived'?'pending':item.inspection_status):item.inspection_status==='accepted'?'accepted':'waived'):item.inspection_status}));
  const ready=states.every(state=>['accepted','waived'].includes(state.inspection_status));
  const status=normalized.decision==='reject'?'rejected':normalized.decision==='request_evidence'?'reviewing':ready?(resolution==='refund'?'approved':'replacing'):'awaiting_goods';
  const {id:operationId,occurred_at:occurredAt}=await insertReturnOperation(tx,actor,key,'return.decide',head.id,order.id,hash),changed=await advanceReturn(tx,head,{kind:'decision',status,resolution,requires_goods:approved?normalized.requires_goods as boolean:head.requires_goods,cause:{source_kind:'operation',source_id:operationId,actor_id:principal.id,reason:normalized.reason,occurred_at:occurredAt},states});
  const response={case_id:head.id,version:changed.head.revision,status:changed.head.status};
  return finishReturnOperation(tx,operationId,response,principal.id,'return.decide',head.id,{decision:normalized.decision,version:changed.head.revision});
 });
}
