import {randomUUID} from 'node:crypto';
import {CommerceClient} from '../../src/modules/local/synthetic-session.ts';
import {readFixtureClock,advanceFixtureClock} from '../../src/modules/local/fixtures.ts';
import {handlePromotions} from '../../src/modules/promotions/routes.ts';
import {shippingFixture} from './shipping-fixture.ts';
export {CommerceClient};
export async function checkoutFixture(){
 const shipping=await shippingFixture();const client=new CommerceClient(shipping.identity);
 const line=(key='fixture-offer-shirt',quantity=1)=>{const l=shipping.line(key,quantity);return {variant_id:l.offer_id,quantity,expected_publication_id:l.publication_id};};
 const contact=()=>({phone:`+62812${String(Math.floor(Math.random()*1e8)).padStart(8,'0')}`});
 const address={recipient_name:'SYNTHETIC Recipient',phone:'+6281200000000',address_line:'SYNTHETIC shipping address',destination_id:'test-malang',postal_code:'00001'};
 return {...shipping,client,line,contact,address};
}


// Own a positive campaign in a business-time window beyond every pre-existing
// active fixture rule; never change another fixture's configuration or counters.
export async function ownShippingCampaign(f:Awaited<ReturnType<typeof checkoutFixture>>,paymentMethods:('prepaid'|'cod')[]){
 const call=async(id:string|null,body:Record<string,unknown>)=>{const request=f.owner.browser.request(`/api/v1/admin/shipping-promotions${id?`/${id}/versions`:''}`,body);request.headers.set('idempotency-key',randomUUID());const response=await handlePromotions(request,f.identity);if(response.status!==201) throw new Error('Owned checkout campaign fixture rejected');return response.json();};
 const [window]=await f.identity.sql`select max(v.ends_at)::text ends from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision where v.active`;
 const target=Math.max(Date.now(),Date.parse(window.ends??new Date().toISOString()))+1000;let clock=await readFixtureClock('test',f.namespace);
 while(Date.parse(clock.now)<target) clock=await advanceFixtureClock('test',f.namespace,Math.min(31622400,Math.ceil((target-Date.parse(clock.now))/1000)),clock.version);
 const config={expected_version:0,name:'SYNTHETIC owned checkout campaign',active:true,starts_at:clock.now,ends_at:new Date(Date.parse(clock.now)+3600000).toISOString(),kind:'fixed',value:3000,maximum_per_order:3000,minimum_merchandise:99000,budget:100000,per_buyer_limit:10,payment_methods:paymentMethods,region_ids:['test-malang'],service_ids:[],stacking:'exclusive',priority:10000,reason:'Owned deterministic stock and expiry proof'};
 const saved=await call(null,config);
 return {id:saved.id as string,amount:3000,close:()=>call(saved.id,{...config,expected_version:1,active:false,reason:'Owned scenario finished; retain budget/history'})};
}
