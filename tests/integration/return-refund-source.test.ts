import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import test from 'node:test';
import {localSigningKey} from '../../src/modules/access/local-key.ts';
import {verifyRefundDestinationSource,verifyRefundSourceEvent,type RefundDestinationSource,type RefundSourceEvent} from '../../src/modules/returns/refund-source.ts';

const code=(expected:string)=>(error:unknown)=>error instanceof Error&&'code' in error&&error.code===expected;
function signDestination(event:RefundDestinationSource){
 const tuple=['99ribu-refund-destination-simulator-v1',event.environment,event.id,event.refund_id,event.buyer_scope,event.destination_reference,event.occurred_at];
 return {...event,signature:createHmac('sha256',localSigningKey(event.environment)).update(JSON.stringify(tuple)).digest('hex')};
}
function signRefund(event:RefundSourceEvent){
 const tuple=['99ribu-refund-simulator-v1','company_bank_debit',event.environment,event.id,event.operation_id,event.refund_id,event.rail,event.original_payment_operation_id,event.destination_source_id,event.expected_amount,event.status,event.amount,event.currency,event.clock_namespace,event.bank_reference,event.occurred_at];
 return {...event,signature:createHmac('sha256',localSigningKey(event.environment)).update(JSON.stringify(tuple)).digest('hex')};
}
const destination=()=>signDestination({id:randomUUID(),refund_id:randomUUID(),environment:'test',buyer_scope:`guest:${randomUUID()}`,destination_reference:`synthetic:${randomUUID()}`,occurred_at:'2026-10-18T02:03:04.005Z',signature:''});
const refund=(rail:'prepaid_original'|'cod_verified_destination'='prepaid_original')=>signRefund({id:randomUUID(),operation_id:randomUUID(),refund_id:randomUUID(),environment:'test',rail,original_payment_operation_id:rail==='prepaid_original'?randomUUID():null,destination_source_id:rail==='cod_verified_destination'?randomUUID():null,expected_amount:106501,status:'succeeded',amount:106501,currency:'IDR',clock_namespace:null,bank_reference:`LOCAL-REFUND-${randomUUID().replaceAll('-','').toUpperCase()}`,occurred_at:'2026-10-18T02:03:04.005Z',signature:''});

test('synthetic destination evidence binds this exact refund, original buyer, verified recipient, environment and time',()=>{
 const event=destination();assert.deepEqual(verifyRefundDestinationSource(event),event);
 for(const change of [{id:randomUUID()},{refund_id:randomUUID()},{environment:'local'},{buyer_scope:`user:${randomUUID()}`},{destination_reference:`synthetic:${randomUUID()}`},{occurred_at:'2026-10-18T02:03:04.006Z'},{signature:'0'.repeat(64)}])assert.throws(()=>verifyRefundDestinationSource({...event,...change}),code('INVALID_REFUND_EVIDENCE'));
 for(const change of [{account_number:'SYNTHETIC-NOT-BANK-PROOF'},{verified:true},{environment:'production'},{buyer_scope:'guest:../other'},{destination_reference:'synthetic:------------------------------------'},{occurred_at:'2026-10-18T02:03:04Z'}])assert.throws(()=>verifyRefundDestinationSource({...event,...change}),code('INVALID_INPUT'));
});

test('refund bank evidence binds original request, destination or original payer, exact amount, bank instruction and clock',()=>{
 for(const rail of ['prepaid_original','cod_verified_destination'] as const){
  const event=refund(rail);assert.deepEqual(verifyRefundSourceEvent(event),event);
  const recipient=rail==='prepaid_original'?{original_payment_operation_id:randomUUID()}:{destination_source_id:randomUUID()};
  for(const change of [{id:randomUUID()},{operation_id:randomUUID()},{refund_id:randomUUID()},{environment:'local'},recipient,{expected_amount:106502},{amount:106502},{status:'failed'},{clock_namespace:'return-source'},{bank_reference:`LOCAL-REFUND-${'A'.repeat(32)}`},{occurred_at:'2026-10-18T02:03:04.006Z'},{signature:'0'.repeat(64)}])assert.throws(()=>verifyRefundSourceEvent({...event,...change}),code('INVALID_REFUND_EVIDENCE'));
 }
});

test('authenticated failed instructions have zero money and successful instructions must equal the original expected amount',()=>{
 const original=refund(),failed=signRefund({...original,status:'failed',amount:0});assert.deepEqual(verifyRefundSourceEvent(failed),failed);
 assert.throws(()=>verifyRefundSourceEvent(signRefund({...original,amount:106500})),code('REFUND_SOURCE_AMOUNT_MISMATCH'));
 assert.throws(()=>verifyRefundSourceEvent(signRefund({...failed,amount:1})),code('REFUND_SOURCE_AMOUNT_MISMATCH'));
 const maximum=signRefund({...original,expected_amount:Number.MAX_SAFE_INTEGER,amount:Number.MAX_SAFE_INTEGER});assert.equal(verifyRefundSourceEvent(maximum).amount,Number.MAX_SAFE_INTEGER);
});

test('refund evidence rejects unsupported targets, clocks, currencies, raw success flags and mismatched recipient rails',()=>{
 const event=refund();
 for(const change of [{paid:true},{currency:'USD'},{environment:'production'},{clock_namespace:'../other'},{clock_namespace:undefined},{expected_amount:0},{amount:-1},{amount:0.5},{amount:Number.MAX_SAFE_INTEGER+1},{original_payment_operation_id:null},{destination_source_id:randomUUID()},{bank_reference:'not-a-bank-instruction'},{occurred_at:'2026-10-18T02:03:04Z'}])assert.throws(()=>verifyRefundSourceEvent({...event,...change}),code('INVALID_INPUT'));
 for(const signature of ['',null,'A'.repeat(64),'0'.repeat(63)])assert.throws(()=>verifyRefundSourceEvent({...event,signature}),code('INVALID_REFUND_EVIDENCE'));
});
