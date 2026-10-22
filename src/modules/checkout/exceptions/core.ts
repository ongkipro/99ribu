import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {AccessError} from '../../access/policy.ts';
import {id,invalid} from '../../catalog/validation.ts';
import {actorScope,type CommerceActor} from '../access.ts';
import {financeInstant} from '../../finance/ledger.ts';
import {lockPaymentOrder} from '../../payments/attempts.ts';
import {returnText} from '../../returns/policy.ts';

export type ExceptionKind='late_collection'|'unallocated_collection'|'stock_discrepancy'|'cod_refusal'|'delivery_failure'|'replacement_stock'|'waybill_uncertain';
export type ExceptionStatus='open'|'awaiting_source'|'awaiting_buyer'|'awaiting_stock'|'awaiting_return'|'ready_for_refund'|'refunding'|'unknown'|'resolved'|'escalated';
export type ExceptionHead={id:string;order_id:string;kind:ExceptionKind;revision:number;status:'preparing'|ExceptionStatus;source_kind:string;source_id:string;proposal_event_id:string|null;reason:string;occurred_at:string;created_at:string};
export type ExceptionUnit={id:string;exception_id:string;kind:ExceptionKind;fulfillment_item_id:string;replacement_link_id:string|null;active:boolean;order_item_id:string;unit_index:number;financial_shipment_id:string;shipment_id:string;warehouse_id:string};
export type ExceptionAction='report'|'decide'|'apply'|'intake'|'buyer_accept'|'buyer_decline'|'destination'|'refund_queue'|'refund_reconcile'|'refund_retry';
export type ProposalAction='cancel_affected_units'|'refund_original_entitlement'|'continue_waiting';
export type ExceptionProposal={id:string;action:ProposalAction;unit_ids:string[];explanation:string;created_at:string};
type Change={kind:'open'|'stock_report'|'propose'|'buyer_accept'|'buyer_decline'|'escalate'|'cancel'|'intake'|'refund_queue'|'refund_confirmed'|'refund_failed'|'source_reconciled'|'resolved';status:ExceptionStatus;source_kind:'operation'|'payment'|'cod'|'parcel'|'job'|'refund'|'replacement';source_id:string;actor_id:string|null;reason:string;occurred_at:string;proposal_event_id:string|null;proposal_action?:ProposalAction;application?:{proposal_id:string;consent_event_id:string;cancellation_ids:string[]}};

// Internal primitives. Callers own current source/actor authorization and the
// complete surrounding transaction; a case reference grants no access or money.
export async function lockException(tx:TransactionSql,exceptionId:string){
 const selected=id(exceptionId),[before]=await tx`select order_id from app.commerce_exception where id=${selected}`;
 if(!before)throw new AccessError(404,'NOT_FOUND');
 const order=await lockPaymentOrder(tx,before.order_id),[head]=await tx<ExceptionHead[]>`select * from app.commerce_exception where id=${selected} for update`;
 return {head,order};
}

export async function exceptionUnits(tx:TransactionSql,exceptionId:string){
 return tx<ExceptionUnit[]>`select u.*,f.order_item_id,f.unit_index,f.shipment_id financial_shipment_id,
   coalesce(replacement.id,original.id) shipment_id,coalesce(replacement.warehouse_id,original.warehouse_id) warehouse_id
  from app.exception_unit u join app.fulfillment_item f on f.id=u.fulfillment_item_id
  join app.order_shipment original on original.id=f.shipment_id
  left join app.replacement_link link on link.id=u.replacement_link_id
  left join app.replacement_shipment replacement on replacement.id=link.shipment_id
  where u.exception_id=${id(exceptionId)} order by u.id`;
}

export async function exceptionProposal(tx:TransactionSql,head:ExceptionHead):Promise<ExceptionProposal|null>{
 if(head.proposal_event_id===null)return null;
 const [event]=await tx<{id:string;reason:string;occurred_at:string;proposal:{action:ProposalAction;unit_ids:string[]}}[]>`
  select id,reason,occurred_at,snapshot->'proposal' proposal from app.exception_event
   where id=${head.proposal_event_id} and exception_id=${head.id} and kind='propose'`;
 if(!event?.proposal)throw new AccessError(409,'RECOVERY_PROPOSAL_NOT_CURRENT');
 return {id:event.id,action:event.proposal.action,unit_ids:event.proposal.unit_ids,explanation:event.reason,created_at:new Date(event.occurred_at).toISOString()};
}

export async function insertExceptionOperation(tx:TransactionSql,head:ExceptionHead,actor:CommerceActor,key:string,action:ExceptionAction,subjectId:string,requestHash:string,input:Record<string,unknown>,proofDigest:string|null=null,operationId=randomUUID()){
 if(['password','reauthentication_proof','bank_account','signature'].some(field=>Object.hasOwn(input,field)))throw invalid();
 const [stored]=await tx`insert into app.exception_operation
  (id,exception_id,subject_id,actor_scope,actor_id,guest_id,session_id,action,key,request_hash,proof_digest,input,response,occurred_at)
  select ${operationId},${head.id},${id(subjectId)},${actorScope(actor)},${actor.kind==='user'?actor.id:null},${actor.kind==='guest'?actor.id:null},${actor.kind==='user'?actor.principal.sessionId:null},
   ${action},${key},${requestHash},${proofDigest},${JSON.stringify(input)}::jsonb,'{}'::jsonb,date_trunc('milliseconds',app.reservation_clock(o.clock_namespace))
  from app.commerce_order o where o.id=${head.order_id} returning id,occurred_at`;
 if(!stored)throw new AccessError(404,'NOT_FOUND');
 return {id:String(stored.id),occurred_at:new Date(stored.occurred_at).toISOString()};
}

export async function advanceException(tx:TransactionSql,head:ExceptionHead,change:Change){
 if(head.revision===2147483647)throw new AccessError(409,'EXCEPTION_VERSION_EXHAUSTED');
 const eventId=randomUUID(),revision=head.revision+1,units=await exceptionUnits(tx,head.id);
 const choice=change.kind==='buyer_accept'||change.kind==='buyer_decline';
 if(choice&&head.proposal_event_id===null)throw new AccessError(409,'RECOVERY_PROPOSAL_NOT_CURRENT');
 if(change.kind==='propose'?(change.status!=='awaiting_buyer'||!change.proposal_action):change.proposal_action!==undefined)throw invalid();
 const proposalId=change.status==='resolved'?null:change.kind==='propose'?eventId:change.proposal_event_id;
 const snapshot={proposal_event_id:proposalId,units:units.map(unit=>({id:unit.id,fulfillment_item_id:unit.fulfillment_item_id,replacement_link_id:unit.replacement_link_id,active:change.status==='resolved'?false:unit.active})),
  proposal:change.kind==='propose'?{action:change.proposal_action,unit_ids:units.filter(unit=>unit.active).map(unit=>unit.id)}:null,application:change.application??null};
 await tx`insert into app.exception_event (id,exception_id,revision,kind,status,source_kind,source_id,actor_id,cause_event_id,reason,snapshot,occurred_at)
  values (${eventId},${head.id},${revision},${change.kind},${change.status},${change.source_kind},${id(change.source_id)},${change.actor_id},${choice?head.proposal_event_id:null},${returnText(change.reason,500)},${JSON.stringify(snapshot)}::jsonb,${financeInstant(change.occurred_at)})`;
 if(change.status==='resolved')await tx`update app.exception_unit set active=false where exception_id=${head.id} and active`;
 const [current]=await tx<ExceptionHead[]>`update app.commerce_exception set revision=${revision},status=${change.status},proposal_event_id=${proposalId} where id=${head.id} and revision=${head.revision} returning *`;
 if(!current)throw new AccessError(409,'VERSION_CONFLICT');
 return {head:current,eventId};
}

export async function finishExceptionOperation(tx:TransactionSql,operationId:string,response:Record<string,unknown>){
 if(['password','reauthentication_proof','bank_account','signature'].some(field=>Object.hasOwn(response,field)))throw invalid();
 const [operation]=await tx`update app.exception_operation set response=${JSON.stringify(response)}::jsonb
  where id=${id(operationId)} and response='{}'::jsonb and created_xid=pg_current_xact_id()::text returning actor_id,action,subject_id,exception_id`;
 if(!operation)throw new AccessError(409,'EXCEPTION_OPERATION_NOT_CURRENT');
 await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details,created_at)
  values (${operation.actor_id},${`commerce_exception.${operation.action}`},${operation.subject_id},'allowed','Committed scoped commerce exception operation',${JSON.stringify({operation_id:operationId,exception_id:operation.exception_id})}::jsonb,clock_timestamp())`;
 await tx`set constraints all immediate`;return response;
}
