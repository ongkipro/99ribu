import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import test from 'node:test';
import {localSigningKey} from '../../src/modules/access/local-key.ts';
import {type SettlementSourceEvent,settlementStatement,verifySettlementEvent} from '../../src/modules/finance/settlements/local.ts';

const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002',c='00000000-0000-0000-0000-000000000003';
function fixture():SettlementSourceEvent{
 const event:SettlementSourceEvent={id:a,operation_id:b,statement_id:c,statement_revision:1,provider:'local.cod',environment:'test',reference:'TEST-SETTLEMENT-1',direction:'credit',net_amount:98000,clock_namespace:'settlement-test',occurred_at:'2026-10-16T00:00:00.123Z',source_reported_at:'2026-10-16T01:00:00.456Z',statement:{gross_amount:114000,carrier_fee:15000,provider_fee:1000,allocation_claims:[{receivable_transaction_id:a,gross_amount:114000,reopens_allocation_id:null}],reverses_reference:null},signature:''};
 // Golden wire order is the owned local protocol, independent of the producer.
 const payload=JSON.stringify(['99ribu-settlement-simulator-v1','test',a,b,c,1,'local.cod','TEST-SETTLEMENT-1','credit',98000,'settlement-test','2026-10-16T00:00:00.123Z','2026-10-16T01:00:00.456Z',event.statement]);
 event.signature=createHmac('sha256',localSigningKey('test')).update(payload).digest('hex');return event;
}
test('authenticated wire binds source identity, original money time, version, direction and complete allocation facts',()=>{
 const event=fixture();assert.deepEqual(verifySettlementEvent(event),event);
 const changes:Partial<SettlementSourceEvent>[]=[{id:b},{operation_id:a},{statement_id:a},{statement_revision:2},{provider:'local.payment'},{environment:'local'},{reference:'OTHER'},{direction:'debit'},{net_amount:98001},{clock_namespace:null},{occurred_at:'2026-10-16T00:00:00.124Z'},{source_reported_at:'2026-10-16T01:00:00.457Z'},{statement:{...event.statement,carrier_fee:15001}},{statement:{...event.statement,allocation_claims:[{receivable_transaction_id:b,gross_amount:114000,reopens_allocation_id:null}]}},{statement:{...event.statement,reverses_reference:'OTHER'}}];
 for(const change of changes)assert.throws(()=>verifySettlementEvent({...event,...change}),{code:'INVALID_SETTLEMENT_SIGNATURE'});
});
test('source statements preserve unknown and inconsistent facts for reconciliation instead of inventing zero or discarding bank money',()=>{
 assert.deepEqual(settlementStatement({gross_amount:null,carrier_fee:null,provider_fee:1000,allocation_claims:null,reverses_reference:null}),{gross_amount:null,carrier_fee:null,provider_fee:1000,allocation_claims:null,reverses_reference:null});
 assert.equal(settlementStatement({gross_amount:1,carrier_fee:5,provider_fee:0,allocation_claims:[],reverses_reference:null}).carrier_fee,5);
 assert.deepEqual(settlementStatement({gross_amount:10,carrier_fee:0,provider_fee:0,allocation_claims:[{receivable_transaction_id:b,gross_amount:5},{receivable_transaction_id:a,gross_amount:5}],reverses_reference:null}).allocation_claims?.map(x=>x.receivable_transaction_id),[a,b]);
});
test('closed source boundary rejects malformed signatures, unsafe money, foreign fields and impossible statement time',()=>{
 const event=fixture();
 for(const change of [{signature:'0'},{signature:'G'.repeat(64)},{net_amount:1.1},{net_amount:-1},{net_amount:Number.MAX_SAFE_INTEGER+1},{environment:'production'},{statement_revision:0},{clock_namespace:'../private'},{source_reported_at:'2026-10-15T00:00:00.000Z'},{raw_postings:[]}])assert.throws(()=>verifySettlementEvent({...event,...change}),{code:'INVALID_INPUT'});
 for(const change of [{gross_amount:0},{carrier_fee:-1},{provider_fee:0.5},{allocation_claims:[{receivable_transaction_id:'unknown',gross_amount:1}]},{allocation_claims:Array.from({length:101},()=>({receivable_transaction_id:a,gross_amount:1}))},{reverses_reference:'unsafe bank reference'},{company_cash_received:true}])assert.throws(()=>settlementStatement({...event.statement,...change}),{code:'INVALID_INPUT'});
});
