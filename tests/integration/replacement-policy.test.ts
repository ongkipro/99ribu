import assert from 'node:assert/strict';
import test from 'node:test';
import {replacementActionRequest,replacementReceiptRequest,replacementRequest} from '../../src/modules/returns/replacement-policy.ts';

const first='00000000-0000-4000-8000-00000000000a',second='00000000-0000-4000-8000-00000000000b';
const request={return_item_ids:[second,first.toUpperCase()],warehouse_id:first,expected_version:2,reason:'SYNTHETIC approved faulty complete offer'};

test('replacement requests select distinct complete claim identities and cannot supply money, content or a clock',()=>{
 assert.deepEqual(replacementRequest(request),{...request,return_item_ids:[first,second]});
 for(const extra of [{amount:99000},{cod_due:99000},{unit_price:0},{contents:[]},{stock_reservation_id:first},{received_at:'2026-10-19T00:00:00.000Z'},{clock_namespace:'synthetic'}]){
  assert.throws(()=>replacementRequest({...request,...extra}),{code:'INVALID_INPUT'});
 }
 assert.throws(()=>replacementRequest({...request,return_item_ids:[first,first.toUpperCase()]}),{code:'DUPLICATE_REPLACEMENT_QUANTITY'});
 for(const return_item_ids of [[],Array(101).fill(first),['invalid']])assert.throws(()=>replacementRequest({...request,return_item_ids}),{code:'INVALID_INPUT'});
});

test('replacement actions retain expected revision and human reason without accepting a manufactured outcome',()=>{
 const base={expected_version:3,reason:'SYNTHETIC current physical operation'};
 assert.deepEqual(replacementActionRequest(base,'reserve'),base);
 assert.deepEqual(replacementActionRequest(base,'prepare'),base);
 assert.deepEqual(replacementActionRequest(base,'book'),base);
 assert.deepEqual(replacementActionRequest({...base,handover_reference:'SYNTHETIC-HANDOVER'},'handover'),{...base,handover_reference:'SYNTHETIC-HANDOVER'});
 for(const extra of [{status:'delivered'},{tracking_number:'forged'},{buyer_shipping:0},{handover_reference:'forged'}])assert.throws(()=>replacementActionRequest({...base,...extra},'book'),{code:'INVALID_INPUT'});
 for(const expected_version of [0,1.5,'3',2147483648])assert.throws(()=>replacementActionRequest({...base,expected_version},'reserve'),{code:'INVALID_INPUT'});
 assert.throws(()=>replacementActionRequest(base,'handover'),{code:'INVALID_INPUT'});
 for(const reason of ['', 'SYNTHETIC\u202e hidden', 'x'.repeat(501)])assert.throws(()=>replacementActionRequest({...base,reason},'reserve'),{code:'INVALID_INPUT'});
});

test('host replacement receipt intake has explicit unit scope and canonical time; it cannot assert provider success',()=>{
 const input={reference:'SYNTHETIC-replacement-receipt',booking_id:first,unit_ids:[second,first],occurred_at:'2026-10-19T00:00:00.000Z'};
 assert.deepEqual(replacementReceiptRequest(input),{...input,unit_ids:[first,second]});
 const {occurred_at:_unused,...automatic}=input;assert.deepEqual(replacementReceiptRequest(automatic),{...automatic,unit_ids:[first,second]});
 for(const occurred_at of ['2026-02-30T00:00:00.000Z','2026-10-19T07:00:00+07:00',null])assert.throws(()=>replacementReceiptRequest({...input,occurred_at}),{code:'INVALID_INPUT'});
 assert.throws(()=>replacementReceiptRequest({...input,unit_ids:[first,first.toUpperCase()]}),{code:'DUPLICATE_REPLACEMENT_QUANTITY'});
 assert.throws(()=>replacementReceiptRequest({...input,status:'delivered'}),{code:'INVALID_INPUT'});
});
