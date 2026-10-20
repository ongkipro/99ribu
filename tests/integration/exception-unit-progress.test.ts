import assert from 'node:assert/strict';
import test from 'node:test';
import {originalParcelReceiptProgress} from '../../src/modules/fulfillment/core.ts';

const early='2026-10-19T01:00:00.000Z',late='2026-10-19T02:00:00.000Z';

test('original delivery requires every surviving unit actual receipt, independently of retirement',()=>{
 assert.deepEqual(originalParcelReceiptProgress([{received_at:early},{received_at:null}]),{received_quantity:1,active_quantity:2,active_received_quantity:1,delivered_at:null});
 assert.deepEqual(originalParcelReceiptProgress([{received_at:early},{received_at:null,cancelled:true}]),{received_quantity:1,active_quantity:1,active_received_quantity:1,delivered_at:early});
 assert.deepEqual(originalParcelReceiptProgress([{received_at:null},{received_at:null,cancelled:true}]),{received_quantity:0,active_quantity:1,active_received_quantity:0,delivered_at:null});
});

test('empty or completely retired scopes cannot manufacture a delivered parcel',()=>{
 for(const units of [[],[{received_at:null,cancelled:true}],[{received_at:late,cancelled:true}]]){
  const progress=originalParcelReceiptProgress(units);assert.equal(progress.active_quantity,0);assert.equal(progress.active_received_quantity,0);assert.equal(progress.delivered_at,null);
 }
});

test('commercial retirement preserves actual historical receipts without moving the surviving delivery anchor',()=>{
 const units=[{received_at:late,cancelled:true},{received_at:early,cancelled:false}],before=structuredClone(units);
 assert.deepEqual(originalParcelReceiptProgress(units),{received_quantity:2,active_quantity:1,active_received_quantity:1,delivered_at:early});
 assert.deepEqual(units,before);
});

test('original delivery time follows the latest actual surviving receipt regardless of source delivery order',()=>{
 for(const units of [[{received_at:late},{received_at:early}],[{received_at:early},{received_at:late}]]){
  assert.deepEqual(originalParcelReceiptProgress(units),{received_quantity:2,active_quantity:2,active_received_quantity:2,delivered_at:late});
 }
});
