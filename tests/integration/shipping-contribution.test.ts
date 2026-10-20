import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {appendCostVersion} from '../../src/modules/finance/costs.ts';
import {allocate,type Rule} from '../../src/modules/promotions/allocation.ts';
import {handlePromotions} from '../../src/modules/promotions/routes.ts';
import {checkShippingBenefit} from '../../src/modules/shipping/contribution.ts';
import type {ShippingPlan} from '../../src/modules/shipping/quotes.ts';
import {shippingFixture,denied} from './shipping-fixture.ts';
async function promotion(f:Awaited<ReturnType<typeof shippingFixture>>,serviceIds:string[]=[]){
 const request=f.owner.browser.request('/api/v1/admin/shipping-promotions',{expected_version:0,name:'Synthetic actual subsidy',active:true,starts_at:new Date(Date.now()-60000).toISOString(),ends_at:new Date(Date.now()+3600000).toISOString(),kind:'fixed',value:8000,maximum_per_order:8000,minimum_merchandise:99000,budget:100000,per_buyer_limit:10,payment_methods:['prepaid','cod'],region_ids:[],service_ids:serviceIds,stacking:'exclusive',priority:10,reason:'Synthetic financial quote boundary'});request.headers.set('idempotency-key',randomUUID());
 const response=await handlePromotions(request,f.identity);assert.equal(response.status,201);const saved=await response.json();
 const [rule]=await f.identity.sql<Rule[]>`select * from app.promotion_version where id=${saved.version_id}`;return rule;
}
function benefits(plan:ShippingPlan,rule:Rule){
 const selected=allocate([rule],plan.packages.map((p)=>({shipment_id:p.id,origin_warehouse_id:p.warehouse_id,shipping_fee:p.shipping_amount,
  service_id:p.options.find((r)=>r.id===p.selected_option_id)?.service_id??'',region_ids:[plan.destination_id]})));
 return selected.flatMap((a)=>a.shipments);
}

test('actual configured promotion allocations pass current contribution only when actual per-unit financial facts permit the benefit',async()=>{
 const f=await shippingFixture();try{
  const plan=(await f.plans([f.line('fixture-offer-shirt')]))[0];const rule=await promotion(f);const subsidy=benefits(plan,rule);assert.equal(subsidy.reduce((sum,a)=>sum+a.amount,0),8000);
  const checked=await f.identity.sql.begin((tx)=>checkShippingBenefit(tx,plan,subsidy));assert.equal(checked.eligible,true);assert.equal(checked.sources[0].allocated_subsidy,8000);assert.equal(checked.sources[0].exception_applied,false);
  await assert.rejects(f.identity.sql.begin((tx)=>checkShippingBenefit(tx,plan,[{shipment_id:plan.packages[0].id,amount:plan.packages[0].shipping_amount+1}])),denied('INVALID_SHIPPING_BENEFIT'));
  const request=f.request();request.headers.set('idempotency-key',randomUUID());await appendCostVersion(request,f.identity,f.principal,'component',f.seeded.stocks['fixture-shirt'],{expected_version:1,unit_cost:31000,effective_from:null,source:'Synthetic changed quote cost',reason:'Old benefit source must be reviewed'});
  await assert.rejects(f.identity.sql.begin((tx)=>checkShippingBenefit(tx,plan,subsidy)),denied('PUBLICATION_REVIEW_REQUIRED'));
 }finally{await f.close();}
});

test('unknown-HPP owner approval binds each actual unit/parcel subsidy; another unit cannot extend its allowance',async()=>{
 const f=await shippingFixture();try{
  const productId=f.seeded.products['fixture-offer-bag'];
  const proofRequest=f.owner.browser.request('/api/v1/me/reauthentication-proofs',{password:f.owner.password,action:'catalog_publication.exception',subject_id:productId});proofRequest.headers.set('idempotency-key',randomUUID());
  const proof=await handleAccess(proofRequest,f.identity);assert.equal(proof.status,201);
  const published=await f.catalog(`/products/${productId}/publications`,{expected_version:1,expected_publication_version:0,reason:'Synthetic explicit unknown-HPP approval',exception:{reason:'Synthetic owner accepts frozen unknown HPP with known5000 subsidy allowance',reauthentication_proof:(await proof.json()).proof}});
  f.seeded.publications['fixture-offer-bag'].id=published.id;
  const one=(await f.plans([f.line('fixture-offer-bag')]))[0];
  const bounded=await f.identity.sql.begin((tx)=>checkShippingBenefit(tx,one,[{shipment_id:one.packages[0].id,amount:5000}]));assert.equal(bounded.sources[0].exception_applied,true);
  await assert.rejects(f.identity.sql.begin((tx)=>checkShippingBenefit(tx,one,[{shipment_id:one.packages[0].id,amount:5001}])),denied('PROMOTIONAL_CONTRIBUTION_REVIEW_REQUIRED'));
  const split=(await f.plans([f.line('fixture-offer-bag',2)])).find((p)=>p.packages.length===2);assert.ok(split);
  // Choose an actually returned regular rate on parcel2. Only parcel1 then
  // qualifies for the real economy-only rule:8k on one unit,0 on another.
  const selected=structuredClone(split);const second=selected.packages[1];const regular=second.options.find((r)=>r.service_id==='test-regular');assert.ok(regular);
  second.selected_option_id=regular.id;second.shipping_amount=regular.shipping_amount;selected.shipping_total=selected.packages.reduce((sum,p)=>sum+p.shipping_amount,0);
  const rule=await promotion(f,['test-economy']);const subsidy=benefits(selected,rule);assert.equal(subsidy.reduce((sum,a)=>sum+a.amount,0),8000);assert.equal(subsidy.length,1);
  assert.ok(8000<=2*5000,'Aggregate allowance alone would incorrectly approve the8k unit');
  await assert.rejects(f.identity.sql.begin((tx)=>checkShippingBenefit(tx,selected,subsidy)),denied('PROMOTIONAL_CONTRIBUTION_REVIEW_REQUIRED'));
 }finally{await f.close();}
});
