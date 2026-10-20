import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import test from 'node:test';
import {localSigningKey} from '../../src/modules/access/local-key.ts';
import {verifyReplacementWaybillEvent,type ReplacementWaybillEvent} from '../../src/modules/returns/replacement-shipping.ts';

function source(status:'issued'|'failed'='issued',domain='99ribu-replacement-waybill-simulator-v1'){
 const operationId=randomUUID(),event:ReplacementWaybillEvent={id:randomUUID(),operation_id:operationId,booking_id:randomUUID(),environment:'test',status,tracking_number:status==='issued'?`LOCAL-REPLACEMENT-${operationId.replaceAll('-','').toUpperCase()}`:null,occurred_at:'2026-10-19T01:02:03.004Z',signature:''};
 event.signature=createHmac('sha256',localSigningKey('test')).update(JSON.stringify([domain,event.environment,event.id,event.operation_id,event.booking_id,event.status,event.tracking_number,event.occurred_at])).digest('hex');return event;
}

test('replacement usable-waybill or terminal-failure evidence authenticates the original booking and distinct protocol',()=>{
 for(const status of ['issued','failed'] as const){
  const event=source(status);assert.deepEqual(verifyReplacementWaybillEvent(event),event);
  for(const change of [{id:randomUUID()},{operation_id:randomUUID()},{booking_id:randomUUID()},{environment:'local'},{occurred_at:'2026-10-19T01:02:03.005Z'},{signature:'0'.repeat(64)}])assert.throws(()=>verifyReplacementWaybillEvent({...event,...change}),{code:'INVALID_REPLACEMENT_WAYBILL_EVIDENCE'});
 }
 assert.throws(()=>verifyReplacementWaybillEvent(source('issued','99ribu-waybill-simulator-v1')),{code:'INVALID_REPLACEMENT_WAYBILL_EVIDENCE'});
});

test('replacement waybill input cannot assert receipt/payment or substitute missing or original-sale tracking',()=>{
 const event=source();
 for(const change of [{tracking_number:null},{tracking_number:`LOCAL-${event.operation_id.replaceAll('-','').toUpperCase()}`},{status:'acknowledged'},{status:'delivered'},{environment:'production'},{cod_due:99000},{received_at:event.occurred_at},{occurred_at:'2026-10-19T01:02:03Z'},{signature:null},{signature:'A'.repeat(64)}])assert.throws(()=>verifyReplacementWaybillEvent({...event,...change}),{code:'INVALID_INPUT'});
 assert.throws(()=>verifyReplacementWaybillEvent({...source('failed'),tracking_number:event.tracking_number}),{code:'INVALID_INPUT'});
});
