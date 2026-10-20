import assert from 'node:assert/strict';
import test from 'node:test';
import {originalWaybillProgress} from '../../src/modules/fulfillment/core.ts';

const issued={booking_id:'10000000-0000-4000-8000-000000000001',booking_status:'issued',creation_status:'completed',tracking_number:'LOCAL-10000000000040008000000000000001',cancellation_pending:false};

test('only current issued tracking is usable; cancellation and rebooking keep historical labels inactive',()=>{
 assert.deepEqual(originalWaybillProgress(issued),{status:'packed',tracking_number:issued.tracking_number});
 assert.deepEqual(originalWaybillProgress({...issued,cancellation_pending:true}),{status:'booking_cancellation_pending',tracking_number:null});
 assert.deepEqual(originalWaybillProgress({...issued,booking_status:'cancelled'}),{status:'booking_cancelled',tracking_number:null});
 for(const [booking_status,creation_status,status] of [['queued','pending','booking_pending'],['queued','unknown','booking_unknown'],['acknowledged','completed','booked'],['failed','completed','booking_failed']]){
  assert.deepEqual(originalWaybillProgress({...issued,booking_status,creation_status}),{status,tracking_number:null});
 }
 assert.deepEqual(originalWaybillProgress(),{status:'unbooked',tracking_number:null});
 assert.deepEqual(originalWaybillProgress({...issued,tracking_number:null}),{status:'booking_pending',tracking_number:null});
});

test('provider cancellation failure restores the still-issued original; source issuance survives lost creation acknowledgement',()=>{
 assert.deepEqual(originalWaybillProgress({...issued,cancellation_pending:false}),{status:'packed',tracking_number:issued.tracking_number});
 assert.deepEqual(originalWaybillProgress({...issued,creation_status:'unknown'}),{status:'packed',tracking_number:issued.tracking_number});
 assert.deepEqual(originalWaybillProgress({...issued,booking_status:'cancelled',creation_status:'unknown'}),{status:'booking_cancelled',tracking_number:null});
});
