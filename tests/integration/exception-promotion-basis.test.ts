import assert from 'node:assert/strict';
import test from 'node:test';
import {cancelledPromotionAmounts,cancelledPromotionDelta} from '../../src/modules/promotions/reservations.ts';

const a='a0000000-0000-4000-8000-000000000001',b='b0000000-0000-4000-8000-000000000002';
const first='10000000-0000-4000-8000-000000000001',second='10000000-0000-4000-8000-000000000002';
const campaigns=[{promotion_id:a,amount:61},{promotion_id:b,amount:40}];
const units=[{id:first,line_id:a,unit_index:1,subsidy_amount:51},{id:second,line_id:a,unit_index:2,subsidy_amount:50}];

test('cancellation releases the original integer subsidy without repricing a surviving unit',()=>{
 const before=structuredClone({campaigns,units});
 assert.deepEqual(cancelledPromotionAmounts(campaigns,units,[first]),[{promotion_id:a,amount:51}]);
 assert.deepEqual(cancelledPromotionAmounts(campaigns,units,[second]),[{promotion_id:a,amount:10},{promotion_id:b,amount:40}]);
 assert.deepEqual(cancelledPromotionAmounts(campaigns,units,[first,second]),campaigns);
 assert.deepEqual(cancelledPromotionAmounts(campaigns,units,[]),[]);
 assert.deepEqual({campaigns,units},before);
});

test('original ordering is stable across query order and normalized identifiers',()=>{
 assert.deepEqual(cancelledPromotionAmounts([...campaigns].reverse(),[...units].reverse(),[second]),cancelledPromotionAmounts(campaigns,units,[second]));
 assert.deepEqual(cancelledPromotionAmounts([{promotion_id:a.toUpperCase(),amount:101}],units,[first]),[{promotion_id:a,amount:51}]);
 const split=[{...units[0],line_id:b,unit_index:1},{...units[1],line_id:a,unit_index:9}];
 assert.deepEqual(cancelledPromotionAmounts(campaigns,split,[second]),[{promotion_id:a,amount:50}]);
});

test('multiple campaigns conserve both original unit and campaign amounts for every cancellation subset',()=>{
 for(let firstAmount=1;firstAmount<=9;firstAmount++)for(let secondAmount=1;secondAmount<=9;secondAmount++){
  const total=firstAmount+secondAmount;
  for(let cut=0;cut<=total;cut++){
   const original=[{...units[0],subsidy_amount:cut},{...units[1],subsidy_amount:total-cut}];
   const definitions=[{promotion_id:a,amount:firstAmount},{promotion_id:b,amount:secondAmount}];
   const left=cancelledPromotionAmounts(definitions,original,[first]);
   const right=cancelledPromotionAmounts(definitions,original,[second]);
   assert.equal(left.reduce((n,row)=>n+row.amount,0),cut);
   assert.equal(right.reduce((n,row)=>n+row.amount,0),total-cut);
   for(const campaign of definitions)assert.equal((left.find(row=>row.promotion_id===campaign.promotion_id)?.amount??0)+(right.find(row=>row.promotion_id===campaign.promotion_id)?.amount??0),campaign.amount);
  }
 }
});

test('zero original benefit, absent units and duplicate identities cannot invent a subsidy release',()=>{
 assert.deepEqual(cancelledPromotionAmounts([],units.map(row=>({...row,subsidy_amount:0})),[second]),[]);
 for(const [definitions,original,selected] of [
  [campaigns,units,[a]],
  [campaigns,units,[first,first]],
  [[...campaigns,{...campaigns[0],promotion_id:a.toUpperCase()}],units,[]],
  [campaigns,[units[0],{...units[1],id:first}],[]],
 ] as const)assert.throws(()=>cancelledPromotionAmounts(definitions,original,selected),{code:'INVALID_INPUT'});
 assert.throws(()=>cancelledPromotionAmounts(campaigns,[{...units[0],subsidy_amount:50},units[1]],[first]),{code:'PROMOTION_UNIT_ALLOCATION_INVALID'});
});

test('safe-integer money remains exact at the shared ceiling and overflows fail',()=>{
 const total=Number.MAX_SAFE_INTEGER;
 assert.deepEqual(cancelledPromotionAmounts([{promotion_id:a,amount:total}],[{...units[0],subsidy_amount:total-1},{...units[1],subsidy_amount:1}],[first]),[{promotion_id:a,amount:total-1}]);
 assert.throws(()=>cancelledPromotionAmounts([{promotion_id:a,amount:total},{promotion_id:b,amount:1}],[{...units[0],subsidy_amount:total},{...units[1],subsidy_amount:1}],[first]),{code:'PROMOTION_UNIT_ALLOCATION_INVALID'});
 for(const amount of [-1,0.5,Number.POSITIVE_INFINITY])assert.throws(()=>cancelledPromotionAmounts(campaigns,[{...units[0],subsidy_amount:amount},units[1]],[first]),{code:'INVALID_INPUT'});
});

test('partial reserved cancellation retains its held use and committed cancellation never restores a spent use',()=>{
 assert.deepEqual(cancelledPromotionDelta(3,10,false),{reserved:-3,committed:0,held:0,used:0});
 assert.deepEqual(cancelledPromotionDelta(7,7,false),{reserved:-7,committed:0,held:-1,used:0});
 assert.deepEqual(cancelledPromotionDelta(3,0,true),{reserved:0,committed:-3,held:0,used:0});
 assert.deepEqual(cancelledPromotionDelta(Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,false),{reserved:-Number.MAX_SAFE_INTEGER,committed:0,held:-1,used:0});
 assert.throws(()=>cancelledPromotionDelta(11,10,false),{code:'PROMOTION_CANCELLATION_CAPACITY_EXCEEDED'});
 assert.throws(()=>cancelledPromotionDelta(1,10,true),{code:'PROMOTION_CANCELLATION_CAPACITY_EXCEEDED'});
 assert.throws(()=>cancelledPromotionDelta(0,10,false),{code:'INVALID_INPUT'});
});
