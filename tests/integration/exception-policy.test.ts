import assert from 'node:assert/strict';
import test from 'node:test';
import {buyerRecoveryRequest,exceptionDecisionRequest,exceptionIntakeRequest,recoveryFinanceRequest,stockDiscrepancyRequest} from '../../src/modules/checkout/exceptions/policy.ts';

const first='00000000-0000-4000-8000-00000000000a',second='00000000-0000-4000-8000-00000000000b';
const reason='SYNTHETIC physical investigation';
const component={balance_id:first,stock_item_id:second,expected_balance_version:0,missing_quantity:1};
const report={fulfillment_id:first,fulfillment_item_ids:[second,first.toUpperCase()],expected_version:1,reason,observed_components:[component]};

test('stock observations retain complete unit references and normalize identities before duplicate detection',()=>{
 assert.deepEqual(stockDiscrepancyRequest(report),{...report,fulfillment_item_ids:[first,second],reinspection:null});
 assert.throws(()=>stockDiscrepancyRequest({...report,fulfillment_item_ids:[first,first.toUpperCase()]}),{code:'DUPLICATE_EXCEPTION_QUANTITY'});
 assert.throws(()=>stockDiscrepancyRequest({...report,observed_components:[component,{...component,balance_id:first.toUpperCase(),missing_quantity:0}]}),{code:'DUPLICATE_STOCK_OBSERVATION'});
 // Zero is a valid reinspection observation, not proof that a new case exists.
 assert.equal(stockDiscrepancyRequest({...report,observed_components:[{...component,missing_quantity:0}]}).observed_components[0].missing_quantity,0);
 // Two complete units may each require a million components from one balance.
 const aggregate=stockDiscrepancyRequest({...report,observed_components:[{...component,missing_quantity:2000000}]});
 assert.deepEqual(aggregate.fulfillment_item_ids,[first,second]);
 assert.equal(aggregate.observed_components[0].missing_quantity,2000000);
 assert.equal(stockDiscrepancyRequest({...report,observed_components:[{...component,missing_quantity:2147483647}]}).observed_components[0].missing_quantity,2147483647);
});

test('stock reports cannot supply balances, money, a received state or a business clock',()=>{
 for(const extra of [{on_hand:100},{amount:99000},{paid:true},{received_at:'2026-10-19T00:00:00.000Z'},{clock_namespace:'synthetic'}])assert.throws(()=>stockDiscrepancyRequest({...report,...extra}),{code:'INVALID_INPUT'});
 for(const extra of [{on_hand:100},{reserved:0},{quarantined:0}])assert.throws(()=>stockDiscrepancyRequest({...report,observed_components:[{...component,...extra}]}),{code:'INVALID_INPUT'});
 for(const missing_quantity of [-1,1.5,2147483648,'1'])assert.throws(()=>stockDiscrepancyRequest({...report,observed_components:[{...component,missing_quantity}]}),{code:'INVALID_INPUT'});
});

test('report volume and expected revisions are bounded without accepting incomplete empty selections',()=>{
 for(const fulfillment_item_ids of [[],Array(101).fill(first)])assert.throws(()=>stockDiscrepancyRequest({...report,fulfillment_item_ids}),{code:'INVALID_INPUT'});
 for(const observed_components of [[],Array(501).fill(component)])assert.throws(()=>stockDiscrepancyRequest({...report,observed_components}),{code:'INVALID_INPUT'});
 for(const expected_version of [0,1.5,2147483648,'1'])assert.throws(()=>stockDiscrepancyRequest({...report,expected_version}),{code:'INVALID_INPUT'});
 assert.throws(()=>stockDiscrepancyRequest({...report,observed_components:[{...component,expected_balance_version:-1}]}),{code:'INVALID_INPUT'});
});

test('operational decisions are proposals or escalation and cannot manufacture financial completion',()=>{
 for(const decision of ['propose_cancellation','propose_refund','keep_waiting','escalate'])assert.equal(exceptionDecisionRequest({expected_version:1,decision,reason}).decision,decision);
 for(const decision of ['paid','refunded','resolved',{},null])assert.throws(()=>exceptionDecisionRequest({expected_version:1,decision,reason}),{code:'INVALID_INPUT'});
 assert.throws(()=>exceptionDecisionRequest({expected_version:1,decision:'propose_refund',reason,amount:99000}),{code:'INVALID_INPUT'});
});

test('identified and unidentified intake stay separate and duplicate component lines cannot inflate an intake',()=>{
 const known={exception_unit_id:first,stock_item_id:second,expected_balance_id:first,quantity:1,identity_confirmed:true};
 const unknown={...known,stock_item_id:null,expected_balance_id:null,identity_confirmed:false};
 const input={expected_version:1,physical_outcome_id:second,lines:[unknown,known],reason};
 assert.deepEqual(exceptionIntakeRequest(input).lines,[known,unknown]);
 assert.throws(()=>exceptionIntakeRequest({...input,lines:[{...known,identity_confirmed:false}]}),{code:'INVALID_INPUT'});
 assert.throws(()=>exceptionIntakeRequest({...input,lines:[{...known,stock_item_id:null}]}),{code:'INVALID_INPUT'});
 assert.throws(()=>exceptionIntakeRequest({...input,lines:[known,{...known,expected_balance_id:first.toUpperCase(),quantity:2}]}),{code:'DUPLICATE_EXCEPTION_GOODS'});
 assert.throws(()=>exceptionIntakeRequest({...input,lines:[unknown,unknown]}),{code:'DUPLICATE_EXCEPTION_GOODS'});
 assert.throws(()=>exceptionIntakeRequest({...input,lines:[{...known,quantity:0}]}),{code:'INVALID_INPUT'});
});

test('finance input preserves ephemeral proof and rejects client-selected money or success',()=>{
 const input={expected_version:1,reason,reauthentication_proof:'SYNTHETIC-proof'};
 assert.deepEqual(recoveryFinanceRequest(input),input);
 for(const extra of [{amount:99000},{source_amount:99000},{status:'succeeded'},{bank_account:'SYNTHETIC unverified'}])assert.throws(()=>recoveryFinanceRequest({...input,...extra}),{code:'INVALID_INPUT'});
 for(const reauthentication_proof of ['',null,'x'.repeat(101)])assert.throws(()=>recoveryFinanceRequest({...input,reauthentication_proof}),{code:'INVALID_INPUT'});
 assert.throws(()=>recoveryFinanceRequest({...input,expected_version:0}),{code:'INVALID_INPUT'});
});

test('buyer proposal and verified-destination choices are disjoint and accept only opaque owned references',()=>{
 const proposal={exception_id:first,expected_version:1,action:'accept_proposal',proposal_id:second};
 assert.deepEqual(buyerRecoveryRequest(proposal),proposal);
 assert.equal(buyerRecoveryRequest({...proposal,action:'decline_proposal'}).action,'decline_proposal');
 const destination={exception_id:first,expected_version:1,action:'accept_destination',refund_id:first,destination_source_id:second};
 assert.deepEqual(buyerRecoveryRequest(destination),destination);
 for(const extra of [{refund_id:first},{destination_source_id:second},{bank_account:'SYNTHETIC unverified'},{paid:true}])assert.throws(()=>buyerRecoveryRequest({...proposal,...extra}),{code:'INVALID_INPUT'});
 assert.throws(()=>buyerRecoveryRequest({...destination,proposal_id:first}),{code:'INVALID_INPUT'});
 assert.throws(()=>buyerRecoveryRequest({...proposal,action:{toString:()=> 'accept_proposal'}}),{code:'INVALID_INPUT'});
});

test('reasons reject hidden controls and no mutation accepts a stale-shaped revision',()=>{
 for(const unsafe of ['',reason+'\u202e',reason+'\u0001','x'.repeat(501)]){
  assert.throws(()=>stockDiscrepancyRequest({...report,reason:unsafe}),{code:'INVALID_INPUT'});
  assert.throws(()=>exceptionDecisionRequest({expected_version:1,decision:'keep_waiting',reason:unsafe}),{code:'INVALID_INPUT'});
 }
 assert.throws(()=>exceptionIntakeRequest({expected_version:0,physical_outcome_id:second,lines:[{exception_unit_id:first,stock_item_id:second,expected_balance_id:first,quantity:1,identity_confirmed:true}],reason}),{code:'INVALID_INPUT'});
 assert.throws(()=>buyerRecoveryRequest({exception_id:first,expected_version:2147483648,action:'accept_proposal',proposal_id:second}),{code:'INVALID_INPUT'});
});
