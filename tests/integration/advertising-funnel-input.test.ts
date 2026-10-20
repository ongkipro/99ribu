import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {funnelInput} from '../../src/modules/advertising/funnel.ts';

test('observed funnel input rejects Purchase, value/identity injection, malformed dates and conflicting order identity',()=>{
 const key=randomUUID(),order=randomUUID(),body={client_event_id:key,name:'product_viewed',occurred_at:'2026-10-16T12:00:00.123+07:00',consent_receipt_id:randomUUID(),product_id:randomUUID()};
 assert.equal(funnelInput(body,key).occurred_at,'2026-10-16T05:00:00.123Z');assert.equal(funnelInput({...body,occurred_at:'2026-10-16T05:00:00Z'},key).occurred_at,'2026-10-16T05:00:00.000Z');
 for(const bad of [{...body,name:'Purchase'},{...body,value:99000},{...body,paid:true},{...body,principal_id:'forged'},{...body,occurred_at:'2026-02-30T12:00:00Z'},{...body,occurred_at:'2026-10-16T25:00:00Z'}])assert.throws(()=>funnelInput(bad,key),{code:'INVALID_INPUT'});
 assert.throws(()=>funnelInput(body,randomUUID()),{code:'INVALID_INPUT'});assert.throws(()=>funnelInput({...body,order_id:randomUUID()},key,order),{code:'INVALID_INPUT'});assert.equal(funnelInput(body,key,order).order_id,order);
});
