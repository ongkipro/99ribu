import assert from 'node:assert/strict';
import test from 'node:test';
import {allocateSettlement,settlementTotals} from '../../src/modules/finance/settlements/allocation.ts';

const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
const line=(receivable_transaction_id:string,gross_amount:number)=>({receivable_transaction_id,gross_amount});
function conserved(result:ReturnType<typeof allocateSettlement>){
 for(const key of ['gross_amount','net_amount','carrier_fee','provider_fee'] as const)assert.equal([...result.allocations,result.remaining].reduce((sum,row)=>sum+BigInt(row[key]),0n),BigInt(result.totals[key]));
 for(const row of [...result.allocations,result.remaining]){assert.equal(row.gross_amount,row.net_amount+row.carrier_fee+row.provider_fee);assert.ok([row.gross_amount,row.net_amount,row.carrier_fee,row.provider_fee].every(n=>Number.isSafeInteger(n)&&n>=0));}
}
test('statement allocation conserves original gross, observed bank net and both actual fee categories',()=>{
 const result=allocateSettlement(98000,{gross_amount:114000,carrier_fee:15000,provider_fee:1000},[line(a,57000),line(b,57000)]);conserved(result);
 assert.deepEqual(result.allocations.map(r=>[r.gross_amount,r.net_amount,r.carrier_fee,r.provider_fee]),[[57000,49000,7500,500],[57000,49000,7500,500]]);assert.equal(result.remaining.gross_amount,0);
});
test('partial reconciliation retains an explicit unmatched gross, cash and fee remainder',()=>{
 const result=allocateSettlement(80,{gross_amount:100,carrier_fee:10,provider_fee:10},[line(a,50)]);conserved(result);
 assert.deepEqual(result.remaining,{gross_amount:50,net_amount:40,carrier_fee:5,provider_fee:5});assert.equal(result.allocations[0].net_amount,40);
});
test('zero-net deductions never overdraw a tiny original portion when both fee categories round',()=>{
 const result=allocateSettlement(0,{gross_amount:2,carrier_fee:1,provider_fee:1},[line(a,1),line(b,1)]);conserved(result);
 assert.deepEqual(result.allocations.map(r=>[r.net_amount,r.carrier_fee,r.provider_fee]),[[0,1,0],[0,0,1]]);
});
test('stable IDs control ties regardless of request order and zero unmatched cash does not erase unmatched gross',()=>{
 const totals={gross_amount:3,carrier_fee:1,provider_fee:1},forward=allocateSettlement(1,totals,[line(a,1),line(b,1)]),reverse=allocateSettlement(1,totals,[line(b,1),line(a,1)]);conserved(forward);assert.deepEqual(forward,reverse);
 assert.equal(forward.remaining.net_amount,0);assert.equal(forward.remaining.gross_amount,1);assert.equal(forward.allocations[0].net_amount,1);
});
test('maximum safe integer IDR allocation preserves exact money without oversized unit arrays',()=>{
 const maximum=Number.MAX_SAFE_INTEGER,result=allocateSettlement(1,{gross_amount:maximum,carrier_fee:1,provider_fee:maximum-2},[line(a,maximum-1),line(b,1)]);conserved(result);
 assert.equal(result.allocations[0].net_amount,1);assert.equal(result.allocations[1].provider_fee,1);
 assert.throws(()=>allocateSettlement(0,{gross_amount:maximum,carrier_fee:maximum,provider_fee:maximum},[line(a,maximum)]),{code:'SETTLEMENT_TOTAL_MISMATCH'});
});
test('unknown statement facts remain unknown; malformed, duplicate, excess or mismatched allocations fail closed',()=>{
 assert.deepEqual(settlementTotals({gross_amount:null,carrier_fee:null,provider_fee:5}),{gross_amount:null,carrier_fee:null,provider_fee:5});
 assert.throws(()=>allocateSettlement(10,{gross_amount:null,carrier_fee:null,provider_fee:5},[line(a,10)]),{code:'SETTLEMENT_STATEMENT_INCOMPLETE'});
 const totals={gross_amount:10,carrier_fee:0,provider_fee:0};
 assert.throws(()=>allocateSettlement(10,totals,[line(a,5),line(a,5)]),{code:'DUPLICATE_SETTLEMENT_ALLOCATION'});
 assert.throws(()=>allocateSettlement(10,totals,[line(a,11)]),{code:'SETTLEMENT_GROSS_EXCEEDED'});
 for(const value of [1.5,-1,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>allocateSettlement(10,totals,[line(a,value)]),{code:'INVALID_INPUT'});
 assert.throws(()=>allocateSettlement(10,totals,[line('forged',10)]),{code:'INVALID_INPUT'});
 assert.throws(()=>allocateSettlement(9,totals,[line(a,10)]),{code:'SETTLEMENT_TOTAL_MISMATCH'});
});
