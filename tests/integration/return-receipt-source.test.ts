import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import test from 'node:test';
import {localSigningKey} from '../../src/modules/access/local-key.ts';
import {verifyParcelReceiptSource,type ParcelReceiptSource} from '../../src/modules/returns/receipt-source.ts';

const code=(expected:string)=>(error:unknown)=>error instanceof Error&&'code' in error&&error.code===expected;
function source(){
 const event:ParcelReceiptSource={id:randomUUID(),reference:`synthetic-receipt:${randomUUID()}`,environment:'test',booking_id:randomUUID(),shipment_id:randomUUID(),clock_namespace:null,unit_ids:[randomUUID(),randomUUID()].sort(),occurred_at:'2026-10-18T01:02:03.004Z',signature:''};
 // Independent producer fixture uses the documented simulator tuple directly.
 const message=JSON.stringify(['99ribu-parcel-receipt-simulator-v1',event.environment,event.id,event.reference,event.booking_id,event.shipment_id,event.clock_namespace,event.unit_ids,event.occurred_at]);
 event.signature=createHmac('sha256',localSigningKey('test')).update(message).digest('hex');return event;
}

test('parcel receipt evidence binds original booking, exact offer units, source identity, environment, clock and receipt time',()=>{
 const event=source();assert.deepEqual(verifyParcelReceiptSource(event),event);
 for(const change of [{id:randomUUID()},{reference:`synthetic-other:${randomUUID()}`},{environment:'local'},{booking_id:randomUUID()},{shipment_id:randomUUID()},{clock_namespace:'return-source'},{unit_ids:[randomUUID()]},{occurred_at:'2026-10-18T01:02:03.005Z'},{signature:'0'.repeat(64)}])assert.throws(()=>verifyParcelReceiptSource({...event,...change}),code('INVALID_PARCEL_RECEIPT_EVIDENCE'));
 // Item ordering is canonical intent, not an opportunity to change quantities.
 assert.deepEqual(verifyParcelReceiptSource({...event,unit_ids:[...event.unit_ids].reverse()}),event);
});

test('parcel receipt validation rejects duplicate or unbounded units, unrecognized fields, noncanonical time and unsupported targets',()=>{
 const event=source();
 for(const change of [{unit_ids:[]},{unit_ids:[event.unit_ids[0],event.unit_ids[0]]},{unit_ids:Array.from({length:101},()=>randomUUID())},{unit_ids:['not-a-unit']},{environment:'production'},{occurred_at:'2026-10-18T01:02:03Z'},{clock_namespace:'../other'},{clock_namespace:undefined},{delivered:true},{buyer_paid:true},{bank_reference:'invented'}])assert.throws(()=>verifyParcelReceiptSource({...event,...change}),code('INVALID_INPUT'));
 for(const signature of ['',null,'bad','0'.repeat(63),'A'.repeat(64)])assert.throws(()=>verifyParcelReceiptSource({...event,signature}),code('INVALID_PARCEL_RECEIPT_EVIDENCE'));
});
