import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {handleCatalog} from '../../src/modules/catalog/routes.ts';
import {handlePromotions} from '../../src/modules/promotions/routes.ts';
import {readConfiguration} from '../../src/modules/promotions/configuration.ts';
import {reservePromotions,resolvePromotionReservation} from '../../src/modules/promotions/reservations.ts';
import {advanceFixtureClock,readFixtureClock,seedLocal} from '../../src/modules/local/fixtures.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
export const denied=(code:string)=>(error:unknown)=>error instanceof Error&&'code' in error&&error.code===code;
export async function retireFixturePromotions(identity:ReturnType<typeof createLocalAuth>,owner:Awaited<ReturnType<typeof actor>>,promotionIds:readonly string[]){
  let retired=0;
  for(const promotionId of promotionIds){
    const current=await identity.sql.begin(tx=>readConfiguration(tx,promotionId));if(!current.active)continue;
    const [times]=await identity.sql`select starts_at,ends_at from app.promotion_version where id=${current.version_id}`;
    const values=Object.fromEntries(['name','starts_at','ends_at','kind','value','maximum_per_order','minimum_merchandise','budget','per_buyer_limit','payment_methods','region_ids','service_ids','stacking','priority'].map(key=>[key,current[key as keyof typeof current]]));
    values.starts_at=new Date(times.starts_at).toISOString();values.ends_at=new Date(times.ends_at).toISOString();
    const request=owner.browser.request(`/api/v1/admin/shipping-promotions/${promotionId}/versions`,{...values,expected_version:current.version,active:false,reason:'SYNTHETIC fixture teardown; retain budget, commitments and history'});request.headers.set('idempotency-key',randomUUID());
    const response=await handlePromotions(request,identity);assert.equal(response.status,201,'Owned fixture campaign teardown must use current authorized configuration writers');retired++;
  }
  return retired;
}
export async function promotionFixture(namespace:string|null=null){
  const identity=createLocalAuth('test');let warehouseIds:string[];
  if(namespace){warehouseIds=Object.values((await seedLocal('test',namespace)).warehouses);let clock=await readFixtureClock('test',namespace);
    while(Date.parse(clock.now)<Date.now()) clock=await advanceFixtureClock('test',namespace,Math.min(31622400,Math.ceil((Date.now()-Date.parse(clock.now))/1000)),clock.version);}
  else {const [wh]=await identity.sql`insert into app.warehouse (name,city) values ('Synthetic Promotion','Malang') returning id`;warehouseIds=[wh.id];}
  const owner=await actor(identity,'owner',[]);const factor=await enroll(owner.browser,owner.password);const users=[owner];
  const wh=warehouseIds[0];
  const request=(path:string,body?:Record<string,unknown>,key:string=randomUUID(),user=owner)=>{const req=user.browser.request(`/api/v1/admin/shipping-promotions${path}`,body);req.headers.set('idempotency-key',key);return req;};
  const call=async(path:string,body?:Record<string,unknown>,key?:string,user=owner)=>handlePromotions(request(path,body,key,user),identity);
  const catalog=async(path:string,body:Record<string,unknown>)=>{const req=owner.browser.request(`/api/v1/admin${path}`,body);req.headers.set('idempotency-key',randomUUID());const response=await handleCatalog(req,identity);assert.equal(response.status,201);return response.json();};
  const stock=await catalog('/stock-items',{name:'Synthetic promotion component',sku:`P-${randomUUID()}`.toUpperCase()});
  const category=await catalog('/categories',{name:'Synthetic promotion category',slug:`synthetic-${randomUUID()}`,parent_id:null,attribute_definitions:[]});
  const product=await catalog('/products',{name:'Synthetic promotion offer',description:'Synthetic only',category_id:category.id,images:[],variants:[{sku:`P-${randomUUID()}`.toUpperCase(),label:'Synthetic unit',attributes:[],offer_kind:'unit',weight_grams:100,length_mm:100,width_mm:100,height_mm:100,default_warehouse_id:wh,contents:[{stock_item_id:stock.id,name:stock.name,quantity:1}]}]});
  const config=(overrides:Record<string,unknown>={})=>({expected_version:0,name:'Synthetic shipping promotion',active:true,starts_at:new Date(Date.now()-86400000).toISOString(),ends_at:new Date(Date.now()+86400000).toISOString(),kind:'fixed',value:10001,maximum_per_order:10001,minimum_merchandise:99000,budget:100010,per_buyer_limit:10,payment_methods:['prepaid','cod'],region_ids:[],service_ids:[],stacking:'allowed',priority:10,reason:'Synthetic campaign settings',...overrides});
  const campaign=async(overrides:Record<string,unknown>={})=>{const response=await call('',config(overrides));const body=await response.json();assert.equal(response.status,201,JSON.stringify(body));return body as {id:string;version_id:string;version:number};};
  const input=async(promotionIds:string[],customerKey='a'.repeat(64))=>{
    const now=namespace?(await readFixtureClock('test',namespace)).now:new Date().toISOString();
    return {key:`checkout:${randomUUID()}`,customer_key:customerKey,promotion_ids:promotionIds,payment_method:'prepaid',lines:[{line_id:'line',product_id:product.id,product_revision:1,offer_id:product.variants[0].id,quantity:1}],shipments:[{shipment_id:'a',origin_warehouse_id:wh,shipping_fee:10000,service_id:'regular',region_ids:['malang']},{shipment_id:'b',origin_warehouse_id:wh,shipping_fee:10000,service_id:'regular',region_ids:['malang']}],expires_at:new Date(Date.parse(now)+120000).toISOString(),clock_namespace:namespace};};
  const reservations:string[]=[];
  const reserve=async(value:Awaited<ReturnType<typeof input>>)=>{const result=await identity.sql.begin((tx)=>reservePromotions(tx,value));reservations.push(result.id);return result;};
  const close=async()=>{
    try{
      for(const reservationId of [...new Set(reservations)]){await identity.sql.begin((tx)=>resolvePromotionReservation(tx,reservationId,'released','Synthetic fixture cleanup'));await identity.sql`delete from app.outbox_job where kind='promotion.reservation.expire' and payload->>'reservationId'=${reservationId}`;}
      // Creation provenance also covers contract tests that send request()
      // directly through the real handler instead of the call() convenience.
      const ownedPromotions=await identity.sql`select promotion_id from app.promotion_version where revision=1 and actor_id in ${identity.sql(users.map(user=>user.id))}`;
      if(ownedPromotions.length){
        let cleaner=owner;const [grant]=await identity.sql`select roles from app.role_grant where user_id=${owner.id}`;
        // Permission-denial cases can demote the original actor. Use a new
        // authorized fixture owner; never restore the tested actor's authority.
        if(!grant?.roles.some((role:string)=>['owner','ecommerce_admin'].includes(role))){cleaner=await actor(identity,'owner',[]);users.push(cleaner);await enroll(cleaner.browser,cleaner.password);}
        await retireFixturePromotions(identity,cleaner,ownedPromotions.map(row=>String(row.promotion_id)));
      }
    }finally{
      try{await cleanup(identity,users);for(const warehouseId of warehouseIds)await identity.sql`update app.warehouse set active=false where id=${warehouseId}`;}
      finally{await identity.sql.end();}
    }
  };
  return {identity,owner,factor,users,wh,product,request,call,config,campaign,input,reserve,reservations,close};
}
