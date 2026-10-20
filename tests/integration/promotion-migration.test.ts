import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';
import {configurationInput,insertVersion} from '../../src/modules/promotions/configuration.ts';
import {reservePromotions,resolvePromotionReservation} from '../../src/modules/promotions/reservations.ts';

test('candidate promotion SQL seals immutable snapshots, exact allocations and lifetime effects in a rollback-only transaction',async()=>{
  const {sql}=connectDatabase('test','owner');const rollback=new Error('ROLLBACK_OWN_PROMOTION_PROBE');
  const [before]=await sql`select count(*)::int as n from information_schema.tables where table_schema='app'`;
  try{
    await assert.rejects(sql.begin(async(tx)=>{
      const [installed]=await tx`select to_regclass('app.promotion') as relation`;
      if(!installed.relation){const ddl=await readFile(new URL('../../migrations/0012_shipping_promotion_budget.sql',import.meta.url),'utf8');
        for(const statement of ddl.split('--> statement-breakpoint').map((s)=>s.trim()).filter(Boolean)) await tx.unsafe(statement);}
      const reject=async(write:()=>Promise<unknown>,code='23514')=>{
        await tx.unsafe('SAVEPOINT negative_promotion');let failed=false;
        try{await write();await tx.unsafe('SET CONSTRAINTS ALL IMMEDIATE');}catch(error){assert.ok(error&&typeof error==='object'&&'code' in error);assert.equal(error.code,code);failed=true;}
        finally{await tx.unsafe('ROLLBACK TO SAVEPOINT negative_promotion');await tx.unsafe('RELEASE SAVEPOINT negative_promotion');}
        assert.equal(failed,true,'SQL must independently reject invalid state');
      };
      const actorId=randomUUID();const productId=randomUUID();const offerId=randomUUID();
      await tx`insert into app.auth_user (id,name,email,email_verified) values (${actorId},'Synthetic SQL owner',${`sql-${actorId}@example.invalid`},true)`;
      const [warehouse]=await tx`insert into app.warehouse (name,city) values ('Synthetic SQL Promotion','Malang') returning id`;
      const [category]=await tx`insert into app.category (name,slug,depth,attribute_definitions) values ('Synthetic SQL category',${`sql-${randomUUID()}`},1,'[]'::jsonb) returning id`;
      const [stock]=await tx`insert into app.stock_item (sku,name) values (${`SQL-${randomUUID()}`.toUpperCase()},'Synthetic SQL component') returning id`;
      await tx`insert into app.product (id,catalog_id,slug) values (${productId},${`p_${randomUUID()}`},${`sql-${randomUUID()}`})`;
      await tx`insert into app.product_revision (product_id,revision,name,description,category_id,images,facts,actor_id,reason) values (${productId},1,'Synthetic SQL offer','Synthetic only',${category.id},'[]'::jsonb,'[]'::jsonb,${actorId},'Synthetic SQL draft')`;
      await tx`insert into app.offer (id,product_id,catalog_id,sku) values (${offerId},${productId},${`v_${randomUUID()}`},${`SQL-${randomUUID()}`.toUpperCase()})`;
      await tx`insert into app.offer_revision (product_id,revision,offer_id,label,attributes,kind,weight_grams,length_mm,width_mm,height_mm,default_warehouse_id) values (${productId},1,${offerId},'Synthetic unit','[]'::jsonb,'unit',100,100,100,100,${warehouse.id})`;
      await tx`insert into app.offer_component (product_id,revision,offer_id,stock_item_id,name,quantity) values (${productId},1,${offerId},${stock.id},'Synthetic SQL component',1)`;
      await tx`update app.product set revision=1 where id=${productId}`;
      const [promotion]=await tx`insert into app.promotion default values returning id`;
      const config=configurationInput({expected_version:0,name:'Synthetic SQL promotion',active:true,starts_at:new Date(Date.now()-60000).toISOString(),ends_at:new Date(Date.now()+3600000).toISOString(),kind:'fixed',value:10001,maximum_per_order:10001,minimum_merchandise:99000,budget:20002,per_buyer_limit:1,payment_methods:['prepaid'],region_ids:[],service_ids:[],stacking:'allowed',priority:10,reason:'Synthetic SQL campaign'});
      await insertVersion(tx,promotion.id,config,actorId);
      const input={key:`checkout:${randomUUID()}`,customer_key:'a'.repeat(64),promotion_ids:[promotion.id],payment_method:'prepaid',lines:[{line_id:'line',product_id:productId,product_revision:1,offer_id:offerId,quantity:1}],shipments:[{shipment_id:'a',origin_warehouse_id:warehouse.id,shipping_fee:10000,service_id:'regular',region_ids:['malang']},{shipment_id:'b',origin_warehouse_id:warehouse.id,shipping_fee:10000,service_id:'regular',region_ids:['malang']}],expires_at:new Date(Date.now()+60000).toISOString()};
      const reserved=await reservePromotions(tx,input);assert.equal(reserved.subsidy_amount,10001);assert.deepEqual(reserved.allocations[0].shipments,[{shipment_id:'a',amount:5001},{shipment_id:'b',amount:5000}]);
      await tx.unsafe('SET CONSTRAINTS ALL IMMEDIATE');await tx.unsafe('SET CONSTRAINTS ALL DEFERRED');
      await reject(()=>tx`update app.promotion set reserved_amount=0 where id=${promotion.id}`);
      await reject(()=>tx`update app.promotion_buyer_usage set reserved_uses=0 where promotion_id=${promotion.id}`);
      await reject(()=>tx`update app.promotion_version set value=0 where promotion_id=${promotion.id}`);
      await reject(()=>tx`delete from app.promotion_movement where reservation_id=${reserved.id}`);
      await reject(()=>tx`update app.promotion_shipment_allocation set amount=5000 where reservation_id=${reserved.id}`);
      await reject(()=>tx`insert into app.promotion_shipment (reservation_id,shipment_id,origin_warehouse_id,shipping_fee,service_id,region_ids) values (${reserved.id},'late',${warehouse.id},1,'regular',ARRAY['malang'])`);
      await reject(()=>tx`update app.promotion_reservation set status='consumed',resolved_at=clock_timestamp(),resolution_reason='Missing exact effects' where id=${reserved.id}`);
      await reject(()=>tx`insert into app.promotion_version (promotion_id,revision,name,active,starts_at,ends_at,kind,value,maximum_per_order,minimum_merchandise,budget,per_buyer_limit,payment_methods,stacking,actor_id,reason)
        values (${promotion.id},2,'Underfunded',false,clock_timestamp(),clock_timestamp()+interval '1 day','fixed',0,0,0,1,1,ARRAY['prepaid'],'exclusive',${actorId},'Cannot reset budget')`);
      await reject(async()=>{await tx`insert into app.promotion default values`;});
      await reject(async()=>{await tx.unsafe('SET CONSTRAINTS ALL DEFERRED');await tx`insert into app.promotion_reservation (key,request_hash,customer_key,payment_method,merchandise_amount,shipping_amount,subsidy_amount,expires_at,created_at)
        values (${`checkout:${randomUUID()}`},${'b'.repeat(64)},${'b'.repeat(64)},'prepaid',99000,1,1,clock_timestamp()+interval '1 minute',clock_timestamp())`;});
      // Copy a new preparing snapshot and exact money effects, but shift one
      // rupiah to the wrong shipment. The independent SQL oracle must refuse it.
      await reject(async()=>{
        await tx.unsafe('SET CONSTRAINTS ALL DEFERRED');
        const [bad]=await tx`insert into app.promotion_reservation (key,request_hash,customer_key,payment_method,merchandise_amount,shipping_amount,subsidy_amount,expires_at,created_at)
          select ${`checkout:${randomUUID()}`},request_hash,${'b'.repeat(64)},payment_method,merchandise_amount,shipping_amount,subsidy_amount,clock_timestamp()+interval '1 minute',clock_timestamp() from app.promotion_reservation where id=${reserved.id} returning id`;
        await tx`insert into app.promotion_buyer_usage (promotion_id,customer_key) values (${promotion.id},${'b'.repeat(64)})`;
        await tx`insert into app.promotion_reservation_item select ${bad.id},line_id,product_id,product_revision,offer_id,quantity from app.promotion_reservation_item where reservation_id=${reserved.id}`;
        await tx`insert into app.promotion_shipment select ${bad.id},shipment_id,origin_warehouse_id,shipping_fee,service_id,region_ids from app.promotion_shipment where reservation_id=${reserved.id}`;
        await tx`insert into app.promotion_allocation select ${bad.id},promotion_id,version_id,amount from app.promotion_allocation where reservation_id=${reserved.id}`;
        await tx`insert into app.promotion_shipment_allocation select ${bad.id},promotion_id,shipment_id,amount+case when shipment_id='a' then -1 else 1 end from app.promotion_shipment_allocation where reservation_id=${reserved.id}`;
        await tx`insert into app.promotion_movement (promotion_id,customer_key,reservation_id,kind,amount,budget_revision,buyer_revision,reserved_delta,committed_delta,reserved_uses_delta,committed_uses_delta,reason)
          values (${promotion.id},${'b'.repeat(64)},${bad.id},'reserve',10001,2,1,10001,0,1,0,'Wrong shipment remainder must fail')`;
        await tx`update app.promotion set reserved_amount=reserved_amount+10001,budget_revision=2 where id=${promotion.id}`;
        await tx`update app.promotion_buyer_usage set reserved_uses=1,revision=1 where promotion_id=${promotion.id} and customer_key=${'b'.repeat(64)}`;
        try{await tx`update app.promotion_reservation set status='active' where id=${bad.id}`;}catch(error){assert.ok(error instanceof Error);assert.equal(error.message,'Incorrect deterministic shipment allocation');throw error;}
      });
      const consumed=await resolvePromotionReservation(tx,reserved.id,'consumed','Synthetic booking commitment');assert.equal(consumed.status,'consumed');
      const [head]=await tx`select reserved_amount::text,committed_amount::text from app.promotion where id=${promotion.id}`;assert.deepEqual(head,{reserved_amount:'0',committed_amount:'10001'});
      assert.equal((await resolvePromotionReservation(tx,reserved.id,'released','No invented consumed credit')).status,'consumed');
      await tx.unsafe('SET CONSTRAINTS ALL IMMEDIATE');throw rollback;
    }),(error:unknown)=>error===rollback);
    const [after]=await sql`select count(*)::int as n from information_schema.tables where table_schema='app'`;assert.equal(after.n,before.n);
  }finally{await sql.end();}
});
