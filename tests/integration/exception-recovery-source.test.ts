import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import test from 'node:test';
import {localSigningKey} from '../../src/modules/access/local-key.ts';
import {verifyRecoveryDestinationSource,verifyRecoverySourceEvent} from '../../src/modules/checkout/exceptions/refund-source.ts';

const one='10000000-0000-4000-8000-000000000001',two='10000000-0000-4000-8000-000000000002',three='10000000-0000-4000-8000-000000000003';
const target={id:one,refund_id:two,environment:'test',buyer_scope:`guest:${three}`,destination_reference:`LOCAL-RECOVERY-DEST-${'A'.repeat(32)}`,occurred_at:'2026-10-19T00:00:00.000Z'};
const bank={id:one,operation_id:two,refund_id:three,environment:'test',rail:'prepaid_original',original_payment_operation_id:two,destination_source_id:null,source_transaction_id:one,expected_amount:114001,status:'succeeded',amount:114001,currency:'IDR',clock_namespace:'recovery-source',bank_reference:`LOCAL-RECOVERY-${'B'.repeat(32)}`,occurred_at:'2026-10-19T00:00:00.000Z'};
function signDestination(value:Record<string,unknown>,purpose='99ribu-recovery-destination-simulator-v1'){
 const tuple=JSON.stringify([purpose,value.environment,value.id,value.refund_id,value.buyer_scope,value.destination_reference,value.occurred_at]);
 return {...value,signature:createHmac('sha256',localSigningKey('test')).update(tuple).digest('hex')};
}
function signBank(value:Record<string,unknown>,purpose='99ribu-recovery-refund-simulator-v1'){
 const tuple=JSON.stringify([purpose,'company_bank_debit',value.environment,value.id,value.operation_id,value.refund_id,value.rail,value.original_payment_operation_id,value.destination_source_id,value.source_transaction_id,value.expected_amount,value.status,value.amount,value.currency,value.clock_namespace,value.bank_reference,value.occurred_at]);
 return {...value,signature:createHmac('sha256',localSigningKey('test')).update(tuple).digest('hex')};
}

test('recovery destination binds its exact original buyer, refund, recipient, time and purpose',()=>{
 const signed=signDestination(target);assert.deepEqual(verifyRecoveryDestinationSource(signed),signed);
 assert.deepEqual(verifyRecoveryDestinationSource(signDestination({...target,buyer_scope:'user:buyer_123'})),signDestination({...target,buyer_scope:'user:buyer_123'}));
 for(const change of [{id:two},{refund_id:three},{environment:'local'},{buyer_scope:`guest:${one}`},{destination_reference:`LOCAL-RECOVERY-DEST-${'C'.repeat(32)}`},{occurred_at:'2026-10-19T00:00:01.000Z'}]){
  assert.throws(()=>verifyRecoveryDestinationSource({...signed,...change}),{code:'INVALID_RECOVERY_REFUND_EVIDENCE'});
 }
 assert.throws(()=>verifyRecoveryDestinationSource(signDestination(target,'99ribu-refund-destination-simulator-v1')),{code:'INVALID_RECOVERY_REFUND_EVIDENCE'});
});

test('recovery destination rejects raw bank details, malformed scope, incomplete and coerced fields',()=>{
 for(const change of [{bank_account:'synthetic-only'},{buyer_scope:`guest:${'a'.repeat(36)}`},{buyer_scope:'user:'},{buyer_scope:'owner:123'},{destination_reference:'synthetic:123'},{environment:['test']},{signature:null}]){
  assert.throws(()=>verifyRecoveryDestinationSource({...signDestination({...target,...change}),...('signature' in change?{signature:change.signature}:{})}));
 }
 for(const name of Object.keys(target)){const missing:Record<string,unknown>={...target};delete missing[name];assert.throws(()=>verifyRecoveryDestinationSource(signDestination(missing)),{code:'INVALID_INPUT'});}
});

test('recovery bank verifies original prepaid and independently verified COD rails',()=>{
 for(const value of [bank,{...bank,rail:'cod_verified_destination',original_payment_operation_id:null,destination_source_id:two}, {...bank,clock_namespace:null}]){
  const signed=signBank(value);assert.deepEqual(verifyRecoverySourceEvent(signed),signed);
 }
});

test('signed rejection proves zero bank debit and successful evidence proves the full immutable obligation',()=>{
 const rejected=signBank({...bank,status:'failed',amount:0});assert.deepEqual(verifyRecoverySourceEvent(rejected),rejected);
 for(const change of [{amount:bank.amount-1},{amount:bank.amount+1},{amount:0},{status:'failed',amount:1},{status:'failed',amount:bank.amount}]){
  assert.throws(()=>verifyRecoverySourceEvent(signBank({...bank,...change})),{code:'RECOVERY_REFUND_SOURCE_AMOUNT_MISMATCH'});
 }
});

test('recovery bank cannot substitute collection, recipient, instruction, environment, amount or clock',()=>{
 const signed=signBank(bank);
 for(const change of [{id:two},{operation_id:three},{refund_id:one},{source_transaction_id:two},{original_payment_operation_id:three},{environment:'local'},
  {expected_amount:114002,amount:114002},{status:'failed',amount:0},{clock_namespace:'other-clock'},{bank_reference:`LOCAL-RECOVERY-${'A'.repeat(32)}`},{occurred_at:'2026-10-19T00:00:01.000Z'},
  {rail:'cod_verified_destination',original_payment_operation_id:null,destination_source_id:three}]){
  assert.throws(()=>verifyRecoverySourceEvent({...signed,...change}),{code:'INVALID_RECOVERY_REFUND_EVIDENCE'});
 }
 const cod=signBank({...bank,rail:'cod_verified_destination',original_payment_operation_id:null,destination_source_id:two});
 assert.throws(()=>verifyRecoverySourceEvent({...cod,destination_source_id:three}),{code:'INVALID_RECOVERY_REFUND_EVIDENCE'});
 assert.throws(()=>verifyRecoverySourceEvent(signBank(bank,'99ribu-refund-simulator-v1')),{code:'INVALID_RECOVERY_REFUND_EVIDENCE'});
});

test('recovery bank rejects incomplete, unsafe, coerced or mixed rail evidence before money use',()=>{
 for(const name of Object.keys(bank)){const missing:Record<string,unknown>={...bank};delete missing[name];assert.throws(()=>verifyRecoverySourceEvent(signBank(missing)),{code:'INVALID_INPUT'});}
 for(const change of [{extra:true},{environment:['test']},{rail:['prepaid_original']},{status:['succeeded']},{original_payment_operation_id:null},{destination_source_id:two},
  {rail:'cod_verified_destination',original_payment_operation_id:null,destination_source_id:null},{expected_amount:0},{expected_amount:1.5},{expected_amount:Number.MAX_SAFE_INTEGER+1},
  {expected_amount:'114001'},{amount:-1},{amount:0.5},{amount:'114001'},{currency:'USD'},{clock_namespace:'UPPER'},{bank_reference:'LOCAL-REFUND-123'}]){
  assert.throws(()=>verifyRecoverySourceEvent(signBank({...bank,...change})),{code:'INVALID_INPUT'});
 }
 for(const signature of [null,'','f'.repeat(63),'F'.repeat(64),['f'.repeat(64)]])assert.throws(()=>verifyRecoverySourceEvent({...signBank(bank),signature}),{code:'INVALID_RECOVERY_REFUND_EVIDENCE'});
});
