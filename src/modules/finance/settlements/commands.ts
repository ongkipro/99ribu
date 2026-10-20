import {createHash,randomUUID} from 'node:crypto';
import type {LocalAuth} from '../../access/auth.ts';
import {consumeAccessProof} from '../../access/grants.ts';
import {AccessError,type Principal} from '../../access/policy.ts';
import {array,id,integer,invalid,object,text} from '../../catalog/validation.ts';
import {financeAuthority} from '../costs.ts';
import {settlementClaims} from './allocation.ts';
import {advanceSettlement,applySettlementFees,createSettlementMatch,lockSettlement,reverseSettlementMatch,settlementClock,type SettlementCause} from './core.ts';
import {projectSettlementItem} from './reads.ts';

export async function reconcileSettlement(request:Request,identity:LocalAuth,principal:Principal,settlementId:string,value:unknown){
 const selected=id(settlementId),input=object(value,['action','expected_version','expected_match_id','source_reference','reason','allocations','reauthentication_proof']);
 if(!['match','unmatch','escalate'].includes(String(input.action))||!Object.hasOwn(input,'expected_match_id'))throw invalid();
 const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key))throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');
 const action=input.action as 'match'|'unmatch'|'escalate',lines=action==='match'?settlementClaims(input.allocations):array(input.allocations,()=>{throw invalid();},0,0);
 if(action==='match'&&lines.length===0)throw invalid();
 const normalized={id:selected,action,expected_version:integer(input.expected_version,1),expected_match_id:input.expected_match_id===null?null:id(input.expected_match_id),source_reference:id(input.source_reference),reason:text(input.reason,500),allocations:lines},proof=text(input.reauthentication_proof,100),hash=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
 return identity.sql.begin(async tx=>{
  await financeAuthority(tx,principal,'finance.reconciliation.read');await financeAuthority(tx,principal,'finance.reconciliation.write');
  const {head,source}=await lockSettlement(tx,selected);
  // Root/parent waits must not turn an expired session into a protected replay.
  await financeAuthority(tx,principal,'finance.reconciliation.read');await financeAuthority(tx,principal,'finance.reconciliation.write');
  const [previous]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='finance.reconcile' and key=${key}`;
  if(previous){if(previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return previous.response;}
  if(head.revision!==normalized.expected_version||head.current_match_id!==normalized.expected_match_id)throw new AccessError(409,'VERSION_CONFLICT');
  if(source.statement_id!==normalized.source_reference)throw new AccessError(409,'SETTLEMENT_SOURCE_CHANGED');
  const [latest]=await tx`select id from app.local_settlement_statement where operation_id=${source.operation_id} order by revision desc limit 1`;
  if(latest.id!==source.statement_id)throw new AccessError(409,'SETTLEMENT_SOURCE_PROCESSING_PENDING');
  await consumeAccessProof(tx,principal,'finance.reconcile',selected,proof);
  const operationId=randomUUID(),cause:SettlementCause={source_kind:'operation',source_id:operationId,actor_id:principal.id,reason:normalized.reason,occurred_at:await settlementClock(tx,source.clock_namespace)};
  // The linked reversal FK needs its exact operation before money is staged;
  // final response/audit and every native seal commit in this same transaction.
  await tx`insert into app.access_operation (id,actor_id,action,key,request_hash,response) values (${operationId},${principal.id},'finance.reconcile',${key},${hash},'{}'::jsonb)`;
  let matchId=head.current_match_id,status='exception',problem:string|null='SETTLEMENT_FINANCE_REVIEW',feeId=head.fee_transaction_id,appliedFee=head.applied_fee_statement_id;
  if(action==='match'){
   const fees=await applySettlementFees(tx,head,source,cause,true);if(fees.problem)throw new AccessError(409,fees.problem);
   if(head.current_match_id)await reverseSettlementMatch(tx,head,source,cause);
   const matched=await createSettlementMatch(tx,head,source,lines,cause);matchId=matched.match_id;status=matched.status;problem=null;feeId=fees.fee_transaction_id;appliedFee=fees.applied_fee_statement_id;
  }else if(action==='unmatch'){
   await reverseSettlementMatch(tx,head,source,cause);matchId=null;status='pending';problem='SETTLEMENT_MANUAL_REVIEW_REQUIRED';
  }
  await advanceSettlement(tx,head,source,cause,{kind:action,fee_transaction_id:feeId,applied_fee_statement_id:appliedFee,match_id:matchId,status,problem});
  const response=await projectSettlementItem(tx,selected);
  await tx`update app.access_operation set response=${JSON.stringify(response)}::jsonb where id=${operationId}`;
  await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details) values (${principal.id},'finance.reconcile',${selected},'allowed',${normalized.reason},${JSON.stringify({operation_id:operationId,action,version:response.version,source_reference:source.statement_id,current_match_id:matchId})}::jsonb)`;
  await tx`set constraints all immediate`;return response;
 });
}
