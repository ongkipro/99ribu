import assert from 'node:assert/strict';
import test from 'node:test';
import {stockDiscrepancyRequest} from '../../src/modules/checkout/exceptions/policy.ts';
import {stockReportPlan} from '../../src/modules/checkout/exceptions/stock-policy.ts';

const first='10000000-0000-4000-8000-000000000001',second='10000000-0000-4000-8000-000000000002';
const component={balance_id:first,stock_item_id:second,quantity:2,revision:3,on_hand:20,reserved:6,quarantined:1};
const input={fulfillment_id:first,fulfillment_item_ids:[first,second],expected_version:2,reason:'SYNTHETIC original complete-unit count',observed_components:[{balance_id:first,stock_item_id:second,expected_balance_version:3,missing_quantity:1}]};

test('reinspection is an explicit closed case/version reference and cannot silently target the current case',()=>{
 assert.equal(stockDiscrepancyRequest(input).reinspection,null);
 assert.equal(stockDiscrepancyRequest({...input,reinspection:null}).reinspection,null);
 assert.deepEqual(stockDiscrepancyRequest({...input,reinspection:{exception_id:second,expected_version:5}}).reinspection,{exception_id:second,expected_version:5});
 for(const reinspection of [{},{exception_id:second},{exception_id:second,expected_version:0},{exception_id:second,expected_version:5,status:'resolved'},false]){
  assert.throws(()=>stockDiscrepancyRequest({...input,reinspection}),{code:'INVALID_INPUT'});
 }
});

test('every selected original balance is observed including zeroes, without substituting a stock identity',()=>{
 const parsed=stockDiscrepancyRequest(input);
 for(const components of [[],[component,{...component,balance_id:second}],[{...component,stock_item_id:first}],[{...component,balance_id:second}]]){
  assert.throws(()=>stockReportPlan(parsed,components,false),{code:'EXCEPTION_COMPONENT_SCOPE_MISMATCH'});
 }
 const extra=stockDiscrepancyRequest({...input,observed_components:[...input.observed_components,{balance_id:second,stock_item_id:first,expected_balance_version:1,missing_quantity:0}]});
 assert.deepEqual(stockReportPlan(extra,[component,{...component,balance_id:second,stock_item_id:first,revision:1}],false),{kind:'stock_report',status:'awaiting_stock',proposal_event_id:null});
});

test('stale balance or absent original hold cannot authorize a physical count',()=>{
 const parsed=stockDiscrepancyRequest(input);
 assert.throws(()=>stockReportPlan(parsed,[{...component,revision:4}],true),{code:'STOCK_VERSION_CONFLICT'});
 assert.throws(()=>stockReportPlan(parsed,[{...component,reserved:1}],true),{code:'FULFILLMENT_STOCK_INVALID'});
});

test('reported missing stock cannot exceed selected original quantities or actual captured on-hand',()=>{
 assert.throws(()=>stockReportPlan(stockDiscrepancyRequest({...input,observed_components:[{...input.observed_components[0],missing_quantity:3}]}),[component],false),{code:'EXCEPTION_SHORTAGE_EXCEEDS_SCOPE'});
 assert.throws(()=>stockReportPlan(stockDiscrepancyRequest({...input,observed_components:[{...input.observed_components[0],missing_quantity:2}]}),[{...component,on_hand:1}],false),{code:'EXCEPTION_SHORTAGE_EXCEEDS_SCOPE'});
 const large={...component,quantity:2000000,on_hand:3000000,reserved:2000000};
 assert.equal(stockReportPlan(stockDiscrepancyRequest({...input,observed_components:[{...input.observed_components[0],missing_quantity:2000000}]}),[large],false).status,'awaiting_stock');
});

test('without an accepted remedy a positive report waits and all-zero reinspection resolves only the investigation',()=>{
 const before=structuredClone(component),parsed=stockDiscrepancyRequest(input);
 assert.deepEqual(stockReportPlan(parsed,[component],false),{kind:'stock_report',status:'awaiting_stock',proposal_event_id:null});
 const zero=stockDiscrepancyRequest({...input,observed_components:[{...input.observed_components[0],missing_quantity:0}]});
 assert.throws(()=>stockReportPlan(zero,[component],false),{code:'EXCEPTION_SHORTAGE_REQUIRED'});
 assert.deepEqual(stockReportPlan(zero,[component],true),{kind:'stock_report',status:'resolved',proposal_event_id:null});
 assert.deepEqual(component,before);
});

test('accepted cancellation/refund consent remains pending staff execution through positive and zero reinspection',()=>{
 for(const action of ['cancel_affected_units','refund_original_entitlement'] as const){
  for(const missing_quantity of [1,0]){
   const parsed=stockDiscrepancyRequest({...input,reinspection:{exception_id:second,expected_version:5},observed_components:[{...input.observed_components[0],missing_quantity}]});
   assert.deepEqual(stockReportPlan(parsed,[component],true,{id:second,action}),{kind:'stock_report',status:'awaiting_source',proposal_event_id:second});
  }
 }
 const parsed=stockDiscrepancyRequest(input);
 assert.throws(()=>stockReportPlan(parsed,[component],true,{id:second,action:'continue_waiting'}),{code:'RECOVERY_PROPOSAL_NOT_CURRENT'});
 assert.throws(()=>stockReportPlan(parsed,[component],false,{id:second,action:'cancel_affected_units'}),{code:'RECOVERY_PROPOSAL_NOT_CURRENT'});
});
