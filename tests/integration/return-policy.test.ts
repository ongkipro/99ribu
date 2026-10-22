import assert from 'node:assert/strict';
import test from 'node:test';
import {assertReturnWindow,returnDeadline,returnEntitlement,returnRequest,returnReasons,returnInspectionRequest} from '../../src/modules/returns/policy.ts';

const code=(expected:string)=>(error:unknown)=>error instanceof Error&&'code' in error&&error.code===expected;
const first='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002',item='00000000-0000-4000-8000-000000000003';
const line=(unit=first,reason='damaged')=>({order_item_id:item,quantity:1,reason,delivered_fulfillment_item_id:unit,details:'One damaged component in the original complete offer'});

test('seven elapsed days begin at actual receipt across Jakarta midnight, weekends and holidays, including the exact deadline',()=>{
 const received='2026-12-24T17:00:00.000Z',deadline='2026-12-31T17:00:00.000Z';
 assert.equal(returnDeadline(received),deadline);
 assert.equal(assertReturnWindow(received,received),deadline);
 assert.equal(assertReturnWindow(received,deadline),deadline);
 assert.throws(()=>assertReturnWindow(received,'2026-12-31T17:00:00.001Z'),code('RETURN_WINDOW_EXPIRED'));
 assert.throws(()=>assertReturnWindow(received,'2026-12-24T16:59:59.999Z'),code('RETURN_NOT_RECEIVED'));
 assert.equal(returnDeadline('2028-02-25T03:04:05.006Z'),'2028-03-03T03:04:05.006Z');
 for(const invalid of ['2026-12-24T17:00:00Z','2026-12-24T17:00:00.000+00:00','2026-02-30T17:00:00.000Z','9999-12-30T00:00:00.000Z'])assert.throws(()=>returnDeadline(invalid),code('INVALID_INPUT'));
});

test('a partial order refund keeps whole purchased offers and their frozen shipping shares without crediting company subsidy',()=>{
 const a=returnEntitlement(99000,7501),b=returnEntitlement(99000,7500);
 assert.deepEqual(a,{merchandise_amount:99000,buyer_shipping:7501,payment_charge:0,amount:106501});
 assert.deepEqual(b,{merchandise_amount:99000,buyer_shipping:7500,payment_charge:0,amount:106500});
 assert.deepEqual(returnEntitlement(99000,7500,3547),{merchandise_amount:99000,buyer_shipping:7500,payment_charge:3547,amount:110047});
 assert.equal(a.amount+b.amount,213001);
 assert.equal(returnEntitlement(99000,0).amount,99000);
 assert.equal(returnEntitlement(99000,Number.MAX_SAFE_INTEGER-99000).amount,Number.MAX_SAFE_INTEGER);
 assert.throws(()=>returnEntitlement(99000,Number.MAX_SAFE_INTEGER-98999),code('REFUND_AMOUNT_LIMIT_EXCEEDED'));
 for(const value of [49500,198000,-1,99000.5])assert.throws(()=>returnEntitlement(value,0),code('INVALID_INPUT'));
 for(const value of [-1,null,1.5,'7500'])assert.throws(()=>returnEntitlement(99000,value),code('INVALID_INPUT'));
});

test('claims name distinct original offer occurrences, normalize retry order and accept every selected fault reason',()=>{
 const forward=returnRequest({items:[line(first),line(second)],requested_resolution:'refund'}),reverse=returnRequest({items:[line(second),line(first)],requested_resolution:'refund',evidence_ids:[]});
 assert.deepEqual(forward,reverse);
 assert.equal(returnReasons.length,7);
 for(const reason of returnReasons)assert.equal(returnRequest({items:[line(first,reason)],requested_resolution:'replacement'}).items[0].reason,reason);
 assert.throws(()=>returnRequest({items:[line(),line()],requested_resolution:'refund'}),code('DUPLICATE_RETURN_QUANTITY'));
 for(const quantity of [0,2,0.5])assert.throws(()=>returnRequest({items:[{...line(),quantity}],requested_resolution:'refund'}),code('INVALID_INPUT'));
 for(const reason of ['change_of_mind','wrong_size_selected','unknown'])assert.throws(()=>returnRequest({items:[line(first,reason)],requested_resolution:'refund'}),code('RETURN_REASON_NOT_ELIGIBLE'));
});

test('untrusted claim fields cannot supply refund money, pretend validated uploads, or hide control characters',()=>{
 const base={items:[line()],requested_resolution:'refund'};
 for(const extra of [{amount:1},{paid:true},{received_at:'2026-01-01T00:00:00.000Z'},{component_price:49500}])assert.throws(()=>returnRequest({...base,...extra}),code('INVALID_INPUT'));
 assert.throws(()=>returnRequest({...base,evidence_ids:[first]}),code('RETURN_EVIDENCE_NOT_VALIDATED'));
 assert.throws(()=>returnRequest({...base,items:[{...line(),bank_account:'synthetic'}]}),code('INVALID_INPUT'));
 for(const details of ['bad\u202Ehidden','bad\u0007control','bad\u0085control','bad\ud800unicode','a'.repeat(2001)])assert.throws(()=>returnRequest({...base,items:[{...line(),details}]}),code('INVALID_INPUT'));
 assert.equal(returnRequest({...base,items:[{...line(),details:'First line\nSecond line\tposition'}]}).items[0].details,'First line\nSecond line\tposition');
 assert.throws(()=>returnRequest({...base,items:Array.from({length:101},()=>line())}),code('INVALID_INPUT'));
});

test('inspection names original unit/position identities, distinguishes unidentified goods and normalizes retry order',()=>{
 const a={return_item_id:first,goods:[{expected_balance_id:second,quantity:1,identity_confirmed:false},{expected_balance_id:item,quantity:2,identity_confirmed:true}]},b={return_item_id:second,goods:[]};
 const base={expected_version:1,result:'accepted',reason:'SYNTHETIC actual physical inspection'};
 assert.deepEqual(returnInspectionRequest({...base,items:[a,b]}),returnInspectionRequest({...base,items:[b,{...a,goods:[...a.goods].reverse()}]}));
 assert.equal(returnInspectionRequest({...base,result:'record_goods',items:[a]}).items[0].goods[0].identity_confirmed,false);
 assert.throws(()=>returnInspectionRequest({...base,result:'record_goods',items:[a,b]}),code('RETURN_GOODS_REQUIRED'));
 assert.throws(()=>returnInspectionRequest({...base,items:[a,a]}),code('DUPLICATE_RETURN_QUANTITY'));
 assert.throws(()=>returnInspectionRequest({...base,items:[{...a,goods:[a.goods[0],a.goods[0]]}]}),code('DUPLICATE_RETURN_GOODS'));
 // Classification may inspect previously received goods; persistence verifies
 // actual intake before accepting, rather than inventing a new physical receipt.
 assert.equal(returnInspectionRequest({...base,items:[b]}).items[0].goods.length,0);
});

test('inspection cannot supply stock deltas, buyer refund money or unbounded goods work',()=>{
 const row={expected_balance_id:second,quantity:1,identity_confirmed:true},base={expected_version:1,result:'record_goods',reason:'SYNTHETIC original goods intake',items:[{return_item_id:first,goods:[row]}]};
 for(const extra of [{on_hand:10},{amount:99000},{warehouse_id:item},{paid:true}])assert.throws(()=>returnInspectionRequest({...base,...extra}),code('INVALID_INPUT'));
 for(const extra of [{stock_item_id:item},{on_hand_delta:1},{quarantined_delta:0},{unit_price:1}])assert.throws(()=>returnInspectionRequest({...base,items:[{return_item_id:first,goods:[{...row,...extra}]}]}),code('INVALID_INPUT'));
 for(const quantity of [0,-1,1.5,1000001])assert.throws(()=>returnInspectionRequest({...base,items:[{return_item_id:first,goods:[{...row,quantity}]}]}),code('INVALID_INPUT'));
 assert.throws(()=>returnInspectionRequest({...base,items:[{return_item_id:first,goods:[{...row,identity_confirmed:'yes'}]}]}),code('INVALID_INPUT'));
 const goods=Array.from({length:51},(_,n)=>({...row,expected_balance_id:`00000000-0000-4000-8000-${String(n+100).padStart(12,'0')}`}));
 assert.throws(()=>returnInspectionRequest({...base,items:[{return_item_id:first,goods},{return_item_id:second,goods}]}),code('INVALID_INPUT'));
});
