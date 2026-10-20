import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import test from 'node:test';
import {localSigningKey} from '../../src/modules/access/local-key.ts';
import {verifyReplacementReceiptSource,type ReplacementReceiptSource} from '../../src/modules/returns/replacement-receipts.ts';

function source(domain='99ribu-replacement-receipt-simulator-v1'){
 const event:ReplacementReceiptSource={id:randomUUID(),reference:`synthetic-replacement:${randomUUID()}`,environment:'test',booking_id:randomUUID(),shipment_id:randomUUID(),clock_namespace:null,unit_ids:[randomUUID(),randomUUID()].sort(),occurred_at:'2026-10-19T01:02:03.004Z',signature:''};
 // Independent producer signs the documented replacement-specific tuple.
 event.signature=createHmac('sha256',localSigningKey('test')).update(JSON.stringify([domain,event.environment,event.id,event.reference,event.booking_id,event.shipment_id,event.clock_namespace,event.unit_ids,event.occurred_at])).digest('hex');
 return event;
}

test('replacement evidence authenticates the exact physical occurrence and cannot reuse original-parcel receipt signatures',()=>{
 const event=source();assert.deepEqual(verifyReplacementReceiptSource(event),event);
 for(const change of [{id:randomUUID()},{reference:`synthetic-other:${randomUUID()}`},{environment:'local'},{booking_id:randomUUID()},{shipment_id:randomUUID()},{clock_namespace:'replacement-proof'},{unit_ids:[randomUUID()]},{occurred_at:'2026-10-19T01:02:03.005Z'},{signature:'0'.repeat(64)}])assert.throws(()=>verifyReplacementReceiptSource({...event,...change}),{code:'INVALID_REPLACEMENT_RECEIPT_EVIDENCE'});
 assert.throws(()=>verifyReplacementReceiptSource(source('99ribu-parcel-receipt-simulator-v1')),{code:'INVALID_REPLACEMENT_RECEIPT_EVIDENCE'});
 assert.deepEqual(verifyReplacementReceiptSource({...event,unit_ids:[...event.unit_ids].reverse()}),event);
});

test('replacement receipt input rejects duplicate/unbounded units, asserted payment/status and noncanonical times',()=>{
 const event=source();
 for(const change of [{unit_ids:[]},{unit_ids:[event.unit_ids[0],event.unit_ids[0]]},{unit_ids:Array.from({length:101},()=>randomUUID())},{environment:'production'},{occurred_at:'2026-10-19T01:02:03Z'},{clock_namespace:'../other'},{clock_namespace:undefined},{delivered:true},{buyer_paid:true},{amount:99000},{signature:null},{signature:'A'.repeat(64)}])assert.throws(()=>verifyReplacementReceiptSource({...event,...change}),{code:'INVALID_INPUT'});
});
