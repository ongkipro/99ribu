import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import test from 'node:test';
import {localSigningKey} from '../../src/modules/access/local-key.ts';
import {verifyWaybillCancellationEvent} from '../../src/modules/fulfillment/cancellation-source.ts';
import {waybillRequestBasis} from '../../src/modules/fulfillment/local.ts';

const first='10000000-0000-4000-8000-000000000001',second='10000000-0000-4000-8000-000000000002';
const base={id:first,operation_id:second,cancellation_id:'20000000-0000-4000-8000-000000000001',booking_id:'30000000-0000-4000-8000-000000000001',environment:'test',status:'acknowledged',source_operation_id:null,source_status:null,tracking_number:null,failure_code:null,occurred_at:'2026-10-19T00:00:00.000Z'};
function signed(fields:Record<string,unknown>,tag='99ribu-waybill-cancel-simulator-v1'){
 const bytes=JSON.stringify([tag,fields.environment,fields.id,fields.operation_id,fields.cancellation_id,fields.booking_id,fields.status,fields.source_operation_id,fields.source_status,fields.tracking_number,fields.failure_code,fields.occurred_at]);
 return {...fields,signature:createHmac('sha256',localSigningKey('test')).update(bytes).digest('hex')};
}

test('signed acknowledgement records no claim of original-source absence or completed cancellation',()=>{
 assert.deepEqual(verifyWaybillCancellationEvent(signed(base)),signed(base));
 for(const change of [{source_status:'absent'},{source_operation_id:first},{tracking_number:`LOCAL-${'A'.repeat(32)}`},{failure_code:'CANCELLATION_REJECTED'}]){
  assert.throws(()=>verifyWaybillCancellationEvent(signed({...base,...change})),{code:'INVALID_INPUT'});
 }
});

test('terminal cancellation retains exact original absent, pending, issued or failed source identity',()=>{
 for(const source_status of ['absent','acknowledged','issued','failed']){
  const event=signed({...base,status:'cancelled',source_status,source_operation_id:source_status==='absent'?null:first,tracking_number:source_status==='issued'?`LOCAL-${'A'.repeat(32)}`:null});
  assert.deepEqual(verifyWaybillCancellationEvent(event),event);
 }
});

test('known failed cancellation is a separate signed result with a finite original-source observation',()=>{
 for(const failure_code of ['CANCELLATION_REJECTED','TEMPORARY_UNAVAILABLE']){
  const event=signed({...base,status:'failed',source_status:'issued',source_operation_id:first,tracking_number:`LOCAL-${'A'.repeat(32)}`,failure_code});
  assert.deepEqual(verifyWaybillCancellationEvent(event),event);
 }
 for(const change of [{status:'cancelled',failure_code:'CANCELLATION_REJECTED'},{status:'failed',failure_code:null},{status:'failed',failure_code:'UNKNOWN_OUTCOME'},{status:'cancelled'}]){
  assert.throws(()=>verifyWaybillCancellationEvent(signed({...base,...change})),{code:'INVALID_INPUT'});
 }
});

test('incomplete or inconsistent original-source evidence never verifies even with an authentic signature',()=>{
 const terminal={...base,status:'cancelled',source_status:'issued',source_operation_id:first,tracking_number:`LOCAL-${'A'.repeat(32)}`};
 for(const change of [{source_status:null},{source_status:'absent'},{source_operation_id:null},{tracking_number:null},{tracking_number:'provider-123'},{source_status:'failed'},{source_status:['issued']},{status:['cancelled']},{environment:['test']},{failure_code:['CANCELLATION_REJECTED']}]){
  assert.throws(()=>verifyWaybillCancellationEvent(signed({...terminal,...change})),{code:'INVALID_INPUT'});
 }
 for(const field of Object.keys(base)){
  const incomplete:Record<string,unknown>={...terminal};delete incomplete[field];
  assert.throws(()=>verifyWaybillCancellationEvent(signed(incomplete)),{code:'INVALID_INPUT'});
 }
 assert.throws(()=>verifyWaybillCancellationEvent(signed({...terminal,extra:'untrusted'})),{code:'INVALID_INPUT'});
});

test('signature binds cancellation, original booking, source effect, environment and original time',()=>{
 const event=signed({...base,status:'cancelled',source_status:'issued',source_operation_id:first,tracking_number:`LOCAL-${'A'.repeat(32)}`});
 for(const change of [{id:second},{operation_id:first},{cancellation_id:first},{booking_id:second},{environment:'local'},{source_operation_id:second},{tracking_number:`LOCAL-${'B'.repeat(32)}`},{occurred_at:'2026-10-19T00:00:01.000Z'},{status:'failed',failure_code:'CANCELLATION_REJECTED'}]){
  assert.throws(()=>verifyWaybillCancellationEvent({...event,...change}),{code:'INVALID_WAYBILL_CANCELLATION_SIGNATURE'});
 }
 assert.throws(()=>verifyWaybillCancellationEvent(signed(base,'99ribu-waybill-simulator-v1')),{code:'INVALID_WAYBILL_CANCELLATION_SIGNATURE'});
});

test('a surviving-unit reissue freezes only its original unit entitlement and COD due',()=>{
 const units=[{id:second,unit_price:99000,buyer_shipping:15001},{id:first,unit_price:99000,buyer_shipping:15000}],before=structuredClone(units);
 assert.deepEqual(waybillRequestBasis(units,'cod'),{unit_ids:[first,second],cod_due:228001});
 assert.deepEqual(waybillRequestBasis([units[0]],'cod'),{unit_ids:[second],cod_due:114001});
 assert.deepEqual(waybillRequestBasis([units[0]],'prepaid'),{unit_ids:[second],cod_due:0});
 assert.deepEqual(units,before);
 for(const method of ['cod','prepaid'] as const)assert.throws(()=>waybillRequestBasis([],method),{code:'SHIPPING_SOURCE_NOT_ELIGIBLE'});
 assert.throws(()=>waybillRequestBasis([units[0],units[0]],'cod'),{code:'COLLECTION_UNIT_SCOPE_INVALID'});
 assert.throws(()=>waybillRequestBasis([{...units[0],buyer_shipping:Number.MAX_SAFE_INTEGER}],'cod'),{code:'COLLECTION_AMOUNT_LIMIT_EXCEEDED'});
});
