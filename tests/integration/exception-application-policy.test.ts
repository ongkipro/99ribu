import assert from 'node:assert/strict';
import test from 'node:test';
import type {ExceptionProposal} from '../../src/modules/checkout/exceptions/core.ts';
import {exceptionApplicationConsent,exceptionApplicationRequest} from '../../src/modules/checkout/exceptions/policy.ts';

const first='10000000-0000-4000-8000-000000000001',second='10000000-0000-4000-8000-000000000002';
const proposal:ExceptionProposal={id:'20000000-0000-4000-8000-000000000001',action:'cancel_affected_units',unit_ids:[first,second],explanation:'Batalkan unit terdampak.',created_at:'2026-10-19T00:00:00.000Z'};
const input={expected_version:5,proposal_id:proposal.id,reason:'Apply the accepted original remedy'},head={status:'awaiting_source' as const,revision:5,proposal_event_id:proposal.id};
const consent={id:'30000000-0000-4000-8000-000000000001',proposal_id:proposal.id,accepted:true};

test('staff application input supplies current proposal/version/reason without quantity, money or consent claims',()=>{
 assert.deepEqual(exceptionApplicationRequest({...input,proposal_id:proposal.id.toUpperCase()}),input);
 for(const field of ['unit_ids','refund_amount','accepted','carrier_cancelled','stock_released'])assert.throws(()=>exceptionApplicationRequest({...input,[field]:true}),{code:'INVALID_INPUT'});
 for(const expected_version of [0,-1,1.5,'5'])assert.throws(()=>exceptionApplicationRequest({...input,expected_version}),{code:'INVALID_INPUT'});
});

test('an application retains exact current saved buyer acceptance and complete unit scope',()=>{
 for(const action of ['cancel_affected_units','refund_original_entitlement'] as const){
  assert.deepEqual(exceptionApplicationConsent(head,input,{...proposal,action},[second,first],consent),{proposal_id:proposal.id,consent_event_id:consent.id});
 }
 assert.deepEqual(exceptionApplicationConsent(head,input,{...proposal,action:'refund_original_entitlement',unit_ids:[]},[],consent),{proposal_id:proposal.id,consent_event_id:consent.id});
 assert.deepEqual(exceptionApplicationConsent({...head,status:'escalated'},input,proposal,[first,second],consent),{proposal_id:proposal.id,consent_event_id:consent.id});
 assert.throws(()=>exceptionApplicationConsent({...head,status:'escalated',proposal_event_id:null},input,proposal,[first,second],consent),{code:'RECOVERY_ACCEPTANCE_NOT_CURRENT'});
});

test('stale versions, proposals, unsigned acceptance and accepted waiting cannot authorize execution',()=>{
 assert.throws(()=>exceptionApplicationConsent(head,{...input,expected_version:4},proposal,[first,second],consent),{code:'VERSION_CONFLICT'});
 for(const current of [null,{...consent,accepted:false},{...consent,proposal_id:first}])assert.throws(()=>exceptionApplicationConsent(head,input,proposal,[first,second],current),{code:'RECOVERY_ACCEPTANCE_NOT_CURRENT'});
 for(const status of ['awaiting_buyer','awaiting_stock','ready_for_refund','refunding','resolved'] as const)assert.throws(()=>exceptionApplicationConsent({...head,status},input,proposal,[first,second],consent),{code:'RECOVERY_ACCEPTANCE_NOT_CURRENT'});
 assert.throws(()=>exceptionApplicationConsent({...head,proposal_event_id:null},input,proposal,[first,second],consent),{code:'RECOVERY_ACCEPTANCE_NOT_CURRENT'});
 assert.throws(()=>exceptionApplicationConsent(head,{...input,proposal_id:first},proposal,[first,second],consent),{code:'RECOVERY_ACCEPTANCE_NOT_CURRENT'});
 assert.throws(()=>exceptionApplicationConsent(head,input,{...proposal,action:'continue_waiting'},[first,second],consent),{code:'RECOVERY_ACCEPTANCE_NOT_CURRENT'});
});

test('partial, duplicate, foreign or changed proposal unit sets cannot reuse buyer consent',()=>{
 for(const units of [[first],[first,first],[first,second,consent.id]])assert.throws(()=>exceptionApplicationConsent(head,input,proposal,units,consent),{code:'RECOVERY_ACCEPTANCE_NOT_CURRENT'});
 assert.throws(()=>exceptionApplicationConsent(head,input,{...proposal,unit_ids:[first,first]},[first,second],consent),{code:'RECOVERY_ACCEPTANCE_NOT_CURRENT'});
 assert.throws(()=>exceptionApplicationConsent(head,input,null,[first,second],consent),{code:'RECOVERY_ACCEPTANCE_NOT_CURRENT'});
});
