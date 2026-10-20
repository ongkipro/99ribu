import assert from 'node:assert/strict';
import test from 'node:test';
import {offerCommissionIdr,rateVersionInput} from '../../src/modules/affiliates/rates.ts';

const input={basis_points:1000,effective_at:null,expected_version:0,reason:'SYNTHETIC prospective owner rate',reauthentication_proof:'SYNTHETIC-OPAQUE-PROOF'};

test('affiliate rate versions require exact basis points, optimistic revision and a bound proof input',()=>{
 assert.deepEqual(rateVersionInput(input),input);
 const scheduled={...input,effective_at:'2026-10-20T00:00:00.000Z',basis_points:1750,expected_version:2};
 assert.deepEqual(rateVersionInput(scheduled),scheduled);
 for(const basis_points of [-1,10001,1.5,'1000',null])assert.throws(()=>rateVersionInput({...input,basis_points}),{code:'INVALID_INPUT'});
 for(const expected_version of [-1,0.5,'0',2147483648])assert.throws(()=>rateVersionInput({...input,expected_version}),{code:'INVALID_INPUT'});
 for(const extra of [{affiliate_id:'forged'},{commission_idr:0},{retroactive:true},{actor_id:'forged'}])assert.throws(()=>rateVersionInput({...input,...extra}),{code:'INVALID_INPUT'});
 for(const reauthentication_proof of ['', 'x'.repeat(101),' SYNTHETIC-OPAQUE-PROOF','SYNTHETIC\nPROOF'])assert.throws(()=>rateVersionInput({...input,reauthentication_proof}),{code:'INVALID_INPUT'});
});

test('rate intake rejects invalid or noncanonical dates and hidden control text before database authority',()=>{
 for(const effective_at of [undefined,'2026-02-30T00:00:00.000Z','2026-10-20','2026-10-20T07:00:00+07:00',0])assert.throws(()=>rateVersionInput({...input,effective_at}),{code:'INVALID_INPUT'});
 for(const reason of ['', 'SYNTHETIC\u202e hidden', 'x'.repeat(501)])assert.throws(()=>rateVersionInput({...input,reason}),{code:'INVALID_INPUT'});
});

test('commission uses safe integer rates and half-up rounding separately for each IDR99000 original offer',()=>{
 for(const [bps,expected]of [[0,0],[1,10],[5,50],[1000,9900],[1750,17325],[3333,32997],[9999,98990],[10000,99000]])assert.equal(offerCommissionIdr(bps),expected);
 assert.equal(offerCommissionIdr(5)*2,100);
 for(const bps of [-1,10001,0.5,Number.NaN,Number.POSITIVE_INFINITY])assert.throws(()=>offerCommissionIdr(bps),{code:'INVALID_INPUT'});
});
