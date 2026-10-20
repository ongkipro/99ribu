import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {readCatalogRevision} from '../../src/modules/catalog/catalog.ts';
import {evaluateContribution,lockContributionSources} from '../../src/modules/finance/contribution.ts';
import {denied,shippingFixture} from './shipping-fixture.ts';

test('trusted rate-cost primitive changes only prospective commission contribution and retains the original published review',async()=>{
 const f=await shippingFixture();
 try{
  const productId=f.seeded.products['fixture-offer-shirt'],offerId=f.seeded.offers['fixture-offer-shirt'];
  const [before]=await f.identity.sql`select to_jsonb(v)::text snapshot from app.publication_version v where id=${f.seeded.publications['fixture-offer-shirt'].id}`;
  await f.identity.sql.begin(async tx=>{
   const draft=await readCatalogRevision(tx,productId);await lockContributionSources(tx,draft);
   const [clock]=await tx`select clock_timestamp()::text now`;
   const original=await evaluateContribution(tx,draft,clock.now);
   // Explicit trusted primitive input does not prove an issued/effective rate
   // stream or attribution. Those require the reviewed0022 runtime cases.
   const higher=await evaluateContribution(tx,draft,clock.now,{basis_points:3000,policy_version_id:original.policy_version_id});
   const zero=await evaluateContribution(tx,draft,clock.now,{basis_points:0,policy_version_id:original.policy_version_id});
   const base=original.offers.find(row=>row.offer_id===offerId),actual=higher.offers.find(row=>row.offer_id===offerId),none=zero.offers.find(row=>row.offer_id===offerId);
   assert.ok(base&&actual&&none);assert.equal(base.complete,true);assert.ok(base.estimated_contribution!==null);
   assert.equal(actual.commission_idr,29700);assert.equal(none.commission_idr,0);
   assert.equal(actual.estimated_contribution,base.estimated_contribution+base.commission_idr-29700);
   assert.equal(none.estimated_contribution,base.estimated_contribution+base.commission_idr);
   assert.deepEqual(actual.components,base.components);assert.deepEqual(actual.assumptions,base.assumptions);assert.equal(actual.estimated_hpp,base.estimated_hpp);
   await assert.rejects(evaluateContribution(tx,draft,clock.now,{basis_points:3000,policy_version_id:randomUUID()}),denied('FINANCIAL_REVIEW_REQUIRED'));
  });
  const [after]=await f.identity.sql`select to_jsonb(v)::text snapshot from app.publication_version v where id=${f.seeded.publications['fixture-offer-shirt'].id}`;
  assert.ok(after.snapshot===before.snapshot,'The original published review remains byte-identical');
 }finally{await f.close();}
});
