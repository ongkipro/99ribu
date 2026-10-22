import {createHash,randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {enqueueJob} from '../../jobs/outbox.ts';
import type {LocalAuth} from '../access/auth.ts';
import {consumeAccessProof} from '../access/grants.ts';
import {AccessError,type Principal} from '../access/policy.ts';
import {id,integer,invalid,object} from '../catalog/validation.ts';
import {actorScope,type CommerceActor} from '../checkout/access.ts';
import {intentHash,mutationKey} from '../checkout/carts.ts';
import {authorizeOrder} from '../checkout/orders.ts';
import {financeAuthority} from '../finance/costs.ts';
import {appendFinanceTransaction,financeInstant} from '../finance/ledger.ts';
import {fulfillmentClock} from '../fulfillment/core.ts';
import {lockPaymentOrder} from '../payments/attempts.ts';
import {advanceReturn,finishReturnOperation,insertReturnOperation,returnUnits,type ReturnHead} from './cases.ts';
import {lockRefundCollectionBasis} from './financial-basis.ts';
import {returnText} from './policy.ts';
import {readRefundDestinationSource,verifyRefundDestinationSource} from './refund-source.ts';
import {returnAuthority} from './authority.ts';

export type RefundHead={id:string;case_id:string;order_id:string;operation_id:string;revision:number;status:string;amount:string;obligation_transaction_id:string;cash_transaction_id:string|null;current_job_id:string|null;current_operation_id:string|null;destination_source_id:string|null;created_at:string};
type RefundState={status:string;current_job_id:string|null;current_operation_id:string|null;destination_source_id:string|null;cash_transaction_id:string|null};
type RefundCause={kind:string;source_kind:'operation'|'job'|'provider';source_id:string;reason:string;occurred_at:string};

export async function refundFinanceAuthority(tx:TransactionSql,principal:Principal,freshMfa=false){
 await returnAuthority(tx,principal);
 await financeAuthority(tx,principal,'finance.refunds.read',freshMfa);await financeAuthority(tx,principal,'finance.refunds.write',freshMfa);
}

export async function appendRefundEvent(tx:TransactionSql,refundId:string,revision:number,state:RefundState,cause:RefundCause){
 const eventId=randomUUID();
 await tx`insert into app.refund_event (id,refund_id,revision,kind,status,source_kind,source_id,provider_operation_id,job_id,destination_source_id,cash_transaction_id,reason,occurred_at)
  values (${eventId},${refundId},${revision},${cause.kind},${state.status},${cause.source_kind},${cause.source_id},${state.current_operation_id},${state.current_job_id},${state.destination_source_id},${state.cash_transaction_id},${returnText(cause.reason)},${financeInstant(cause.occurred_at)})`;
 return eventId;
}

export async function advanceRefund(tx:TransactionSql,head:RefundHead,state:RefundState,cause:RefundCause){
 if(head.revision===2147483647)throw new AccessError(409,'REFUND_VERSION_EXHAUSTED');
 const revision=head.revision+1,eventId=await appendRefundEvent(tx,head.id,revision,state,cause);
 const [current]=await tx<RefundHead[]>`update app.refund set revision=${revision},status=${state.status},current_job_id=${state.current_job_id},current_operation_id=${state.current_operation_id},destination_source_id=${state.destination_source_id},cash_transaction_id=${state.cash_transaction_id} where id=${head.id} returning *`;
 return {head:current,eventId};
}

export async function projectBuyerRefund(tx:TransactionSql,refundId:string){
 const [head]=await tx<(RefundHead&{job_status:string|null})[]>`select r.*,j.status job_status from app.refund r left join app.outbox_job j on j.id=r.current_job_id where r.id=${id(refundId)}`;if(!head)throw new AccessError(404,'NOT_FOUND');
 let status=head.status;
 if(['queued','processing'].includes(status)&&head.job_status==='unknown')status='unknown';
 if(status==='queued'&&head.job_status==='failed')status='failed';
 const messages:Record<string,string>={awaiting_destination:'Dana belum dikirim. Tujuan pengembalian dana masih perlu diverifikasi.',queued:'Pengembalian dana masuk antrean.',processing:'Pengiriman dana sedang diproses.',unknown:'Hasil pengiriman dana sedang diperiksa.',succeeded:'Pengembalian dana sudah dikonfirmasi.',failed:'Pengiriman dana belum berhasil. Tim keuangan sedang memeriksanya.'};
 return {id:head.id,order_id:head.order_id,return_case_id:head.case_id,version:head.revision,amount:Number(head.amount),status,created_at:new Date(head.created_at).toISOString(),explanation:messages[status]};
}

export async function queueRefund(request:Request,identity:LocalAuth,principal:Principal,value:unknown){
 const input=object(value,['return_case_id','expected_version','reason','reauthentication_proof']);
 if(typeof input.reauthentication_proof!=='string'||input.reauthentication_proof.length<1||input.reauthentication_proof.length>100)throw invalid();
 const normalized={return_case_id:id(input.return_case_id),expected_version:integer(input.expected_version,1),reason:returnText(input.reason,500)},key=mutationKey(request),hash=await intentHash(identity,'refund.queue',normalized),proof=input.reauthentication_proof;
 return identity.sql.begin(async tx=>{
  await refundFinanceAuthority(tx,principal,true);
  const [priorCase]=await tx`select order_id from app.return_case where id=${normalized.return_case_id}`;if(!priorCase)throw new AccessError(404,'NOT_FOUND');
  const order=await lockPaymentOrder(tx,priorCase.order_id),[head]=await tx<ReturnHead[]>`select * from app.return_case where id=${normalized.return_case_id} for update`;
  await refundFinanceAuthority(tx,principal,true);
  const actor:CommerceActor={kind:'user',id:principal.id,principal},[previous]=await tx`select action,request_hash,response from app.return_operation where actor_scope=${actorScope(actor)} and key=${key}`;
  if(previous){if(previous.action!=='refund.queue'||previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return previous.response;}
  if(head.revision!==normalized.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  const items=await returnUnits(tx,head.id);
  if(head.status!=='approved'||head.resolution!=='refund'||!items.length||items.some(item=>item.claim_state!=='held'||!['accepted','waived'].includes(item.inspection_status))||(await tx`select id from app.refund where case_id=${head.id}`).length)throw new AccessError(409,'REFUND_CASE_NOT_APPROVED');
  const basis=await lockRefundCollectionBasis(tx,order.id,items.map(item=>item.fulfillment_item_id));
  if((await tx`select a.return_item_id from app.refund_allocation a join app.return_item r on r.id=a.return_item_id where r.fulfillment_item_id in ${tx(items.map(item=>item.fulfillment_item_id))}`).length)throw new AccessError(409,'REFUND_QUANTITY_ALREADY_ALLOCATED');
  for(const unit of basis.units){
   const item=items.find(item=>item.fulfillment_item_id===unit.fulfillment_item_id);
   if(!item||Number(item.merchandise_amount)!==unit.merchandise_amount||Number(item.buyer_shipping)!==unit.buyer_shipping||Number(item.payment_charge)!==unit.payment_charge)throw new AccessError(409,'REFUND_ORIGINAL_ALLOCATION_MISMATCH');
  }
  // No proof is consumed while collection, version or quantity eligibility is
  // unresolved. Recheck current authority after every original-journal wait.
  await refundFinanceAuthority(tx,principal,true);
  const refundId=randomUUID(),proofDigest=createHash('sha256').update(proof).digest('hex'),{id:operationId,occurred_at:occurredAt}=await insertReturnOperation(tx,actor,key,'refund.queue',head.id,order.id,hash,proofDigest);
  await consumeAccessProof(tx,principal,'finance.refund',head.id,proof);
  const obligation=await appendFinanceTransaction(tx,{kind:'refund_obligation',source:'local.refund.obligation',environment:basis.environment,effect_reference:refundId,order_id:order.id,reason:normalized.reason,occurred_at:occurredAt,postings:[{account:'buyer_funds_liability',side:'debit',amount:basis.amount},{account:'refund_payable',side:'credit',amount:basis.amount}]});
  const jobId=order.payment_method==='prepaid'?await enqueueJob(tx,'refund.create',`refund-create:${refundId}:1`,{refundId,attempt:1}):null,status=jobId?'queued':'awaiting_destination';
  const [refund]=await tx<RefundHead[]>`insert into app.refund (id,case_id,order_id,operation_id,revision,status,amount,obligation_transaction_id,current_job_id,created_at) values (${refundId},${head.id},${order.id},${operationId},1,${status},${basis.amount},${obligation.id},${jobId},${occurredAt}) returning *`;
  for(const unit of basis.units){
   const item=items.find(item=>item.fulfillment_item_id===unit.fulfillment_item_id);if(!item)throw invalid();
   await tx`insert into app.refund_allocation (refund_id,return_item_id,receipt_id,purchase_event_id,merchandise_amount,buyer_shipping,payment_charge,amount) values (${refundId},${item.id},${unit.receipt_id},${unit.purchase_event_id},${unit.merchandise_amount},${unit.buyer_shipping},${unit.payment_charge},${unit.amount})`;
  }
  await appendRefundEvent(tx,refundId,1,refund,{kind:'queue',source_kind:'operation',source_id:operationId,reason:normalized.reason,occurred_at:occurredAt});
  await advanceReturn(tx,head,{kind:'refund_queue',status:'refunding',resolution:'refund',requires_goods:head.requires_goods,cause:{source_kind:'operation',source_id:operationId,actor_id:principal.id,reason:normalized.reason,occurred_at:occurredAt},states:[]});
  const response=await projectBuyerRefund(tx,refundId);
  return finishReturnOperation(tx,operationId,response,principal.id,'refund.queue',head.id,{refund_id:refundId,units:items.length,version:1});
 });
}

export async function acceptRefundDestination(request:Request,identity:LocalAuth,actor:CommerceActor|null,orderId:string,refundId:string,value:unknown){
 const input=object(value,['destination_source_id','expected_version']),normalized={order_id:id(orderId),refund_id:id(refundId),destination_source_id:id(input.destination_source_id),expected_version:integer(input.expected_version,1)},key=mutationKey(request),hash=await intentHash(identity,'refund.destination',normalized);
 return identity.sql.begin(async tx=>{
  let order=await authorizeOrder(tx,request,identity,actor,normalized.order_id);await lockPaymentOrder(tx,order.id);order=await authorizeOrder(tx,request,identity,actor,order.id);
  const [head]=await tx<RefundHead[]>`select * from app.refund where id=${normalized.refund_id} and order_id=${order.id} for update`;if(!head)throw new AccessError(404,'NOT_FOUND');
  if(!actor&&!order.owner_guest_id)throw new AccessError(401,'UNAUTHENTICATED');const currentActor:CommerceActor=actor??{kind:'guest',id:order.owner_guest_id as string};
  const [previous]=await tx`select action,request_hash,response from app.return_operation where actor_scope=${actorScope(currentActor)} and key=${key}`;
  if(previous){if(previous.action!=='refund.destination'||previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return previous.response;}
  if(head.revision!==normalized.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  if(order.payment_method!=='cod'||head.status!=='awaiting_destination'||head.destination_source_id!==null||head.current_job_id!==null||head.current_operation_id!==null)throw new AccessError(409,'REFUND_DESTINATION_NOT_CURRENT');
  const stored=await readRefundDestinationSource(tx,normalized.destination_source_id);if(!stored)throw new AccessError(404,'NOT_FOUND');const source=verifyRefundDestinationSource(stored);
  const [database]=await tx`select current_database() name`,environment=database.name==='99ribu_test'?'test':database.name==='99ribu_local'?'local':null,buyerScope=order.owner_user_id?`user:${order.owner_user_id}`:`guest:${order.owner_guest_id}`,now=await fulfillmentClock(tx,order.clock_namespace);
  if(source.refund_id!==head.id||source.environment!==environment||source.buyer_scope!==buyerScope||Date.parse(source.occurred_at)<new Date(head.created_at).getTime()||Date.parse(source.occurred_at)>Date.parse(now))throw new AccessError(409,'REFUND_DESTINATION_UNVERIFIED');
  await authorizeOrder(tx,request,identity,actor,order.id);
  const {id:operationId,occurred_at:occurredAt}=await insertReturnOperation(tx,currentActor,key,'refund.destination',head.id,order.id,hash),jobId=await enqueueJob(tx,'refund.create',`refund-create:${head.id}:1`,{refundId:head.id,attempt:1});
  const changed=await advanceRefund(tx,head,{...head,status:'queued',destination_source_id:source.id,current_job_id:jobId},{kind:'destination',source_kind:'operation',source_id:operationId,reason:'Original buyer accepted the independently verified synthetic recipient',occurred_at:occurredAt});
  return finishReturnOperation(tx,operationId,await projectBuyerRefund(tx,head.id),currentActor.kind==='user'?currentActor.id:null,'refund.destination',head.id,{version:changed.head.revision});
 });
}
