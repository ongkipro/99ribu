import assert from 'node:assert/strict';
import test from 'node:test';
import {recoveryReplacementClaimPlan} from '../../src/modules/checkout/exceptions/refund-claims.ts';
import {replacementCaseComplete} from '../../src/modules/returns/replacement-core.ts';

const one='10000000-0000-4000-8000-000000000001',two='10000000-0000-4000-8000-000000000002',three='10000000-0000-4000-8000-000000000003';
const held={id:one,claim_state:'held',inspection_status:'accepted'},delivered={id:two,claim_state:'replaced',inspection_status:'waived'};

test('a confirmed refund can finish a mixed original claim only after other replacements actually completed',()=>{
 const items=[held,delivered,{id:three,claim_state:'refunded',inspection_status:'waived'}],original=structuredClone(items);
 assert.deepEqual(recoveryReplacementClaimPlan(items,[one]),{resolved:true,states:[{...held,claim_state:'refunded'}]});assert.deepEqual(items,original);
});

test('a paid subset preserves other held and replacing original claims without inventing receipt or release',()=>{
 for(const claim_state of ['held','replacing','released']){
  const plan=recoveryReplacementClaimPlan([held,{...delivered,claim_state}],[one]);assert.equal(plan.resolved,false);assert.deepEqual(plan.states,[{...held,claim_state:'refunded'}]);
 }
});

test('recovery confirmation rejects uninspected, completed, duplicate or foreign original claim scope',()=>{
 for(const claim_state of ['replacing','replaced','refunded','released'])assert.throws(()=>recoveryReplacementClaimPlan([{...held,claim_state}],[one]),{code:'RECOVERY_CLAIM_NOT_CURRENT'});
 for(const inspection_status of ['pending','rejected'])assert.throws(()=>recoveryReplacementClaimPlan([{...held,inspection_status}],[one]),{code:'RECOVERY_CLAIM_NOT_CURRENT'});
 for(const ids of [[],[one,one],[two]])assert.throws(()=>recoveryReplacementClaimPlan([held],ids),{code:'RECOVERY_CLAIM_NOT_CURRENT'});
 assert.deepEqual(recoveryReplacementClaimPlan([{...held,inspection_status:'waived'}],[one]),{resolved:true,states:[{...held,inspection_status:'waived',claim_state:'refunded'}]});
});

test('refund-then-receipt and receipt-then-refund both finish the same mixed original claim',()=>{
 const initial=[held,{...delivered,claim_state:'replacing'}];
 const firstRefund=recoveryReplacementClaimPlan(initial,[one]);assert.equal(firstRefund.resolved,false);
 const afterRefund=initial.map(item=>firstRefund.states.find(state=>state.id===item.id)??item);
 assert.equal(replacementCaseComplete(afterRefund,[two]),true);
 assert.equal(replacementCaseComplete(initial,[two]),false);
 const afterReceipt=initial.map(item=>item.id===two?{...item,claim_state:'replaced'}:item);
 assert.equal(recoveryReplacementClaimPlan(afterReceipt,[one]).resolved,true);
 assert.deepEqual(initial,[held,{...delivered,claim_state:'replacing'}]);
});

test('replacement completion retains unresolved units and never resolves an empty original scope',()=>{
 assert.equal(replacementCaseComplete([],[]),false);
 for(const claim_state of ['held','replacing','released'])assert.equal(replacementCaseComplete([held,{...delivered,claim_state}],[one]),false);
 assert.equal(replacementCaseComplete([{...held,claim_state:'refunded'},delivered],[]),true);
});
