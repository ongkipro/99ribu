import {AccessError} from '../../access/policy.ts';
import {array,id,integer,invalid,object} from '../../catalog/validation.ts';
import {returnText} from '../../returns/policy.ts';
import type {ExceptionHead,ExceptionProposal,ExceptionStatus,ProposalAction} from './core.ts';

// These inputs identify permitted observations/choices. Current authority,
// physical source truth and original monetary capacity remain transaction guards.
export function stockDiscrepancyRequest(value:unknown){
 const input=object(value,['fulfillment_id','fulfillment_item_ids','expected_version','reason','observed_components','reinspection']);
 const prior=input.reinspection===undefined||input.reinspection===null?null:object(input.reinspection,['exception_id','expected_version']);
 const reinspection=prior===null?null:{exception_id:id(prior.exception_id),expected_version:integer(prior.expected_version,1)};
 const units=array(input.fulfillment_item_ids,id,1,100).sort();
 if(new Set(units).size!==units.length)throw new AccessError(422,'DUPLICATE_EXCEPTION_QUANTITY');
 const components=array(input.observed_components,value=>{
  const line=object(value,['balance_id','stock_item_id','expected_balance_version','missing_quantity']);
  return {balance_id:id(line.balance_id),stock_item_id:id(line.stock_item_id),expected_balance_version:integer(line.expected_balance_version,0),missing_quantity:integer(line.missing_quantity,0)};
 },1,500).sort((a,b)=>a.balance_id.localeCompare(b.balance_id));
 if(new Set(components.map(line=>line.balance_id)).size!==components.length)throw new AccessError(422,'DUPLICATE_STOCK_OBSERVATION');
 return {fulfillment_id:id(input.fulfillment_id),fulfillment_item_ids:units,expected_version:integer(input.expected_version,1),reason:returnText(input.reason,500),observed_components:components,reinspection};
}

export function exceptionDecisionRequest(value:unknown){
 const input=object(value,['expected_version','decision','reason']),decision=input.decision;
 if(typeof decision!=='string'||!['propose_cancellation','propose_refund','keep_waiting','escalate'].includes(decision))throw invalid();
 return {expected_version:integer(input.expected_version,1),decision:decision as 'propose_cancellation'|'propose_refund'|'keep_waiting'|'escalate',reason:returnText(input.reason,500)};
}

export function exceptionIntakeRequest(value:unknown){
 const input=object(value,['expected_version','physical_outcome_id','lines','reason']);
 const lines=array(input.lines,value=>{
  const line=object(value,['exception_unit_id','stock_item_id','expected_balance_id','quantity','identity_confirmed']);
  if(typeof line.identity_confirmed!=='boolean')throw invalid();
  if(!line.identity_confirmed&&(line.stock_item_id!==null||line.expected_balance_id!==null))throw invalid();
  return {exception_unit_id:id(line.exception_unit_id),stock_item_id:line.identity_confirmed?id(line.stock_item_id):null,
   expected_balance_id:line.identity_confirmed?id(line.expected_balance_id):null,quantity:integer(line.quantity,1,1000000),identity_confirmed:line.identity_confirmed};
 },1,500).sort((a,b)=>`${a.exception_unit_id}:${a.expected_balance_id??'unidentified'}`.localeCompare(`${b.exception_unit_id}:${b.expected_balance_id??'unidentified'}`));
 if(new Set(lines.map(line=>`${line.exception_unit_id}:${line.expected_balance_id??'unidentified'}`)).size!==lines.length)throw new AccessError(422,'DUPLICATE_EXCEPTION_GOODS');
 return {expected_version:integer(input.expected_version,1),physical_outcome_id:id(input.physical_outcome_id),lines,reason:returnText(input.reason,500)};
}

export function recoveryFinanceRequest(value:unknown){
 const input=object(value,['expected_version','reason','reauthentication_proof']),proof=input.reauthentication_proof;
 if(typeof proof!=='string'||!proof.isWellFormed()||Array.from(proof).length<1||Array.from(proof).length>100)throw invalid();
 // Preserve exact ephemeral proof bytes; the writer stores only its digest and
 // excludes this field from the immutable normalized request/response.
 return {expected_version:integer(input.expected_version,1),reason:returnText(input.reason,500),reauthentication_proof:proof};
}

export function buyerRecoveryRequest(value:unknown){
 const action=object(value,['exception_id','expected_version','action','proposal_id','refund_id','destination_source_id']).action;
 if(action==='accept_proposal'||action==='decline_proposal'){
  const input=object(value,['exception_id','expected_version','action','proposal_id']);
  return {exception_id:id(input.exception_id),expected_version:integer(input.expected_version,1),action,proposal_id:id(input.proposal_id)};
 }
 if(action==='accept_destination'){
  const input=object(value,['exception_id','expected_version','action','refund_id','destination_source_id']);
  return {exception_id:id(input.exception_id),expected_version:integer(input.expected_version,1),action,refund_id:id(input.refund_id),destination_source_id:id(input.destination_source_id)};
 }
 throw invalid();
}

// A proposal and a buyer choice record authority for a later guarded remedy.
// Neither transition executes cancellation, stock adjustment or a transfer.
export function exceptionProposalPlan(head:Pick<ExceptionHead,'kind'|'status'>,decision:ReturnType<typeof exceptionDecisionRequest>['decision']){
 if(['preparing','refunding','resolved'].includes(head.status))throw new AccessError(409,'EXCEPTION_DECISION_NOT_CURRENT');
 if(decision==='escalate')return {kind:'escalate' as const,status:'escalated' as const,proposal_event_id:null};
 if((decision==='propose_cancellation'&&!['stock_discrepancy','cod_refusal','delivery_failure','replacement_stock'].includes(head.kind))
   ||(decision==='propose_refund'&&head.kind==='waybill_uncertain'))throw new AccessError(409,'EXCEPTION_REMEDY_NOT_ELIGIBLE');
 const proposal_action:ProposalAction=decision==='propose_cancellation'?'cancel_affected_units':decision==='propose_refund'?'refund_original_entitlement':'continue_waiting';
 return {kind:'propose' as const,status:'awaiting_buyer' as const,proposal_event_id:null,proposal_action};
}

export function exceptionChoicePlan(head:Pick<ExceptionHead,'kind'|'status'|'revision'|'proposal_event_id'>,expectedVersion:number,proposal:ExceptionProposal,unitIds:readonly string[],accept:boolean){
 if(head.revision!==expectedVersion)throw new AccessError(409,'VERSION_CONFLICT');
 if(head.status!=='awaiting_buyer'||head.proposal_event_id!==proposal.id
   ||!['cancel_affected_units','refund_original_entitlement','continue_waiting'].includes(proposal.action)
   ||new Set(unitIds).size!==unitIds.length||new Set(proposal.unit_ids).size!==proposal.unit_ids.length
   ||JSON.stringify([...unitIds].sort())!==JSON.stringify([...proposal.unit_ids].sort()))throw new AccessError(409,'RECOVERY_PROPOSAL_NOT_CURRENT');
 if(!accept)return {kind:'buyer_decline' as const,status:'escalated' as const,proposal_event_id:null};
 const waiting=proposal.action==='continue_waiting';
 const status:ExceptionStatus=waiting&&['stock_discrepancy','replacement_stock'].includes(head.kind)?'awaiting_stock'
  :waiting&&['cod_refusal','delivery_failure'].includes(head.kind)?'awaiting_return':'awaiting_source';
 return {kind:'buyer_accept' as const,status,proposal_event_id:waiting?null:proposal.id};
}

export function exceptionApplicationRequest(value:unknown){
 const input=object(value,['expected_version','proposal_id','reason']);
 return {expected_version:integer(input.expected_version,1),proposal_id:id(input.proposal_id),reason:returnText(input.reason,500)};
}
// Only a current authenticated acceptance can authorize later execution. Facts
// such as carrier effect, stock and money are independently locked/requalified.
export function exceptionApplicationConsent(head:Pick<ExceptionHead,'status'|'revision'|'proposal_event_id'>,input:ReturnType<typeof exceptionApplicationRequest>,proposal:ExceptionProposal|null,unitIds:readonly string[],consent:{id:string;proposal_id:string;accepted:boolean}|null){
 if(head.revision!==input.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
 if(!['awaiting_source','escalated'].includes(head.status)||!proposal||head.proposal_event_id!==proposal.id||input.proposal_id!==proposal.id
  ||!['cancel_affected_units','refund_original_entitlement'].includes(proposal.action)||!consent?.accepted||consent.proposal_id!==proposal.id
  ||new Set(unitIds).size!==unitIds.length||new Set(proposal.unit_ids).size!==proposal.unit_ids.length
  ||JSON.stringify([...unitIds].sort())!==JSON.stringify([...proposal.unit_ids].sort()))throw new AccessError(409,'RECOVERY_ACCEPTANCE_NOT_CURRENT');
 return {proposal_id:proposal.id,consent_event_id:id(consent.id)};
}
