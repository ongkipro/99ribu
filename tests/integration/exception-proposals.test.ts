import assert from 'node:assert/strict';
import test from 'node:test';
import type {ExceptionKind,ExceptionProposal} from '../../src/modules/checkout/exceptions/core.ts';
import {exceptionChoicePlan,exceptionProposalPlan} from '../../src/modules/checkout/exceptions/policy.ts';

const first='10000000-0000-4000-8000-000000000001',second='10000000-0000-4000-8000-000000000002';
const proposal:ExceptionProposal={id:'20000000-0000-4000-8000-000000000001',action:'cancel_affected_units',unit_ids:[first,second],explanation:'Batalkan dua unit yang terdampak.',created_at:'2026-10-19T00:00:00.000Z'};
const head={kind:'stock_discrepancy' as const,status:'awaiting_buyer' as const,revision:4,proposal_event_id:proposal.id};

test('CS proposals and escalation have closed nonfinancial transition results',()=>{
 const expected={propose_cancellation:'cancel_affected_units',propose_refund:'refund_original_entitlement',keep_waiting:'continue_waiting'};
 for(const decision of ['propose_cancellation','propose_refund','keep_waiting'] as const){
  assert.deepEqual(exceptionProposalPlan(head,decision),{kind:'propose',status:'awaiting_buyer',proposal_event_id:null,proposal_action:expected[decision]});
 }
 assert.deepEqual(exceptionProposalPlan(head,'escalate'),{kind:'escalate',status:'escalated',proposal_event_id:null});
});

test('late money cannot propose cancelling already expired goods and uncertain booking cannot promise a refund',()=>{
 for(const kind of ['late_collection','unallocated_collection','waybill_uncertain'] as const){
  assert.throws(()=>exceptionProposalPlan({...head,kind},'propose_cancellation'),{code:'EXCEPTION_REMEDY_NOT_ELIGIBLE'});
 }
 assert.throws(()=>exceptionProposalPlan({...head,kind:'waybill_uncertain'},'propose_refund'),{code:'EXCEPTION_REMEDY_NOT_ELIGIBLE'});
 for(const status of ['preparing','refunding','resolved'] as const){
  for(const decision of ['propose_cancellation','propose_refund','keep_waiting','escalate'] as const){
   assert.throws(()=>exceptionProposalPlan({...head,status},decision),{code:'EXCEPTION_DECISION_NOT_CURRENT'});
  }
 }
});

test('buyer choices require current version, exact proposal and complete unique exception-unit scope',()=>{
 assert.throws(()=>exceptionChoicePlan(head,3,proposal,[first,second],true),{code:'VERSION_CONFLICT'});
 for(const changed of [{...head,status:'awaiting_source' as const},{...head,proposal_event_id:null},{...head,proposal_event_id:first}]){
  assert.throws(()=>exceptionChoicePlan(changed,4,proposal,[first,second],true),{code:'RECOVERY_PROPOSAL_NOT_CURRENT'});
 }
 for(const units of [[first],[first,first],[first,second,proposal.id]]){
  assert.throws(()=>exceptionChoicePlan(head,4,proposal,units,true),{code:'RECOVERY_PROPOSAL_NOT_CURRENT'});
 }
 assert.throws(()=>exceptionChoicePlan(head,4,{...proposal,unit_ids:[first,first]},[first,second],true),{code:'RECOVERY_PROPOSAL_NOT_CURRENT'});
 assert.deepEqual(exceptionChoicePlan(head,4,{...proposal,unit_ids:[second,first]},[first,second],true),{kind:'buyer_accept',status:'awaiting_source',proposal_event_id:proposal.id});
});

test('accepting cancellation or refund preserves exact consent for later execution and creates no completion',()=>{
 const before=structuredClone(proposal);
 for(const action of ['cancel_affected_units','refund_original_entitlement'] as const){
  assert.deepEqual(exceptionChoicePlan(head,4,{...proposal,action},[first,second],true),{kind:'buyer_accept',status:'awaiting_source',proposal_event_id:proposal.id});
 }
 assert.deepEqual(exceptionChoicePlan({...head,kind:'unallocated_collection'},4,{...proposal,action:'refund_original_entitlement',unit_ids:[]},[],true),{kind:'buyer_accept',status:'awaiting_source',proposal_event_id:proposal.id});
 assert.deepEqual(exceptionChoicePlan(head,4,proposal,[first,second],false),{kind:'buyer_decline',status:'escalated',proposal_event_id:null});
 assert.deepEqual(proposal,before);
});

test('accepted waiting consumes its choice and preserves the actual stock, parcel or source task',()=>{
 const expected:Record<ExceptionKind,string>={stock_discrepancy:'awaiting_stock',replacement_stock:'awaiting_stock',cod_refusal:'awaiting_return',delivery_failure:'awaiting_return',late_collection:'awaiting_source',unallocated_collection:'awaiting_source',waybill_uncertain:'awaiting_source'};
 for(const kind of Object.keys(expected) as ExceptionKind[]){
  assert.deepEqual(exceptionChoicePlan({...head,kind},4,{...proposal,action:'continue_waiting'},[first,second],true),{kind:'buyer_accept',status:expected[kind],proposal_event_id:null});
 }
});
