import assert from 'node:assert/strict';
import test from 'node:test';
import {recoveryRefundQueueRequest} from '../../src/modules/checkout/exceptions/refunds.ts';

const input={expected_version:7,reason:'SYNTHETIC original-source compensation',reauthentication_proof:'synthetic-subject-proof'};

test('finance queue keeps the opaque proof outside persisted normalized intent',()=>{
 const before=structuredClone(input),parsed=recoveryRefundQueueRequest(input);
 assert.deepEqual(parsed,{normalized:{expected_version:7,reason:input.reason},proof:input.reauthentication_proof});
 assert.equal(Object.hasOwn(parsed.normalized,'reauthentication_proof'),false);assert.deepEqual(input,before);
});

test('finance queue never accepts asserted money, source, destination, job or completion fields',()=>{
 for(const field of ['amount','source_transaction_id','receipt_id','unit_ids','destination_source_id','cash_transaction_id','job_id','status','occurred_at'])assert.throws(()=>recoveryRefundQueueRequest({...input,[field]:'client-asserted'}),{code:'INVALID_INPUT'});
});

test('finance queue requires an exact bounded integer case revision',()=>{
 for(const expected_version of [0,-1,1.5,'7',2147483648,null,undefined])assert.throws(()=>recoveryRefundQueueRequest({...input,expected_version}),{code:'INVALID_INPUT'});
});

test('finance queue requires a bounded opaque proof without treating it as stored input',()=>{
 for(const reauthentication_proof of ['',null,undefined,123,'x'.repeat(101)])assert.throws(()=>recoveryRefundQueueRequest({...input,reauthentication_proof}),{code:'INVALID_INPUT'});
});

test('finance queue retains a safe normalized operational reason',()=>{
 assert.equal(recoveryRefundQueueRequest({...input,reason:'  SYNTHETIC original-source compensation  '}).normalized.reason,input.reason);
 for(const reason of ['',null,'x'.repeat(501),'unsafe\u202e','unsafe\u0001'])assert.throws(()=>recoveryRefundQueueRequest({...input,reason}),{code:'INVALID_INPUT'});
});
