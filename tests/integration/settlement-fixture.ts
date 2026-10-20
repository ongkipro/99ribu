import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runOneJob} from '../../src/jobs/worker.ts';
import {simulateSettlement,ingestSettlementEvent} from '../../src/modules/finance/settlements/local.ts';
import {simulateCodCollection,ingestCodEvent} from '../../src/modules/payments/cod-local.ts';
import {fulfillmentFixture} from './fulfillment-fixture.ts';

export async function settlementFixture(){
 const f=await fulfillmentFixture('cod');
 try{
  for(const parcel of f.parcels)await f.run(await ingestCodEvent(f.identity.sql,await simulateCodCollection(f.identity.sql,'test',parcel.shipment_id)));
  const receipts=await f.identity.sql`select * from app.economic_receipt where order_id=${f.order.id} order by shipment_id`;
  const source=await simulateSettlement(f.identity.sql,'test',{provider:'local.cod',reference:randomUUID(),direction:'credit',net_amount:9,clock_namespace:f.namespace,statement:{gross_amount:11,carrier_fee:1,provider_fee:1,allocation_claims:[{receivable_transaction_id:randomUUID(),gross_amount:11}],reverses_reference:null}});
  const job=await ingestSettlementEvent(f.identity.sql,source);assert.equal(await runOneJob(f.identity.sql,{},job),true);
  const [head]=await f.identity.sql`select * from app.provider_settlement where operation_id=${source.operation_id}`;assert.equal(head.status,'mismatched');
  return {...f,receipts,source,head,root:`/api/v1/admin/reconciliation/${head.id}`};
 }catch(error){await f.close();throw error;}
}
