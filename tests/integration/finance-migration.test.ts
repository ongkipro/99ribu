import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { connectDatabase } from "../../src/db/client.ts";
import { postMovement } from "../../src/modules/inventory/state.ts";

test('cost/publication candidate SQL preserves unknowns, immutable sources, exact arithmetic and sealed snapshots in a rollback-only probe',async()=>{
  const {sql}=connectDatabase('test','owner'); const rollback=new Error('ROLLBACK_OWN_FINANCE_PROBE');
  const [before]=await sql`select count(*)::int as n from information_schema.tables where table_schema='app'`;
  try{
    await assert.rejects(sql.begin(async(tx)=>{
      const [installed]=await tx`select to_regclass('app.component_cost_version') as relation`;
      if(!installed.relation){
        const ddl=await readFile(new URL('../../migrations/0011_prospective_costs_and_publication.sql',import.meta.url),'utf8');
        for(const statement of ddl.split('--> statement-breakpoint').map((s)=>s.trim()).filter(Boolean)){
          try{await tx.unsafe(statement);}catch(error){throw new Error(`Candidate DDL ${statement.split('\n')[0]}: ${error instanceof Error?error.message:'failed'}`);}
        }
      }
      async function rejects(write:()=>Promise<unknown>,code='23514'){
        await tx.unsafe('SAVEPOINT finance_negative');let failed=false;
        try{await write();}catch(error){assert.ok(error&&typeof error==='object'&&'code' in error);assert.equal(error.code,code);failed=true;}
        finally{await tx.unsafe('ROLLBACK TO SAVEPOINT finance_negative');await tx.unsafe('RELEASE SAVEPOINT finance_negative');}
        assert.equal(failed,true,'The database must reject invalid financial/publication state');
      }
      const actorId=randomUUID();
      await tx`insert into app.auth_user (id,name,email,email_verified) values (${actorId},'Synthetic SQL owner',${`sql-${actorId}@example.invalid`},true)`;
      await tx`insert into app.role_grant (user_id,roles) values (${actorId},ARRAY['owner']::text[])`;
      const [warehouse]=await tx`insert into app.warehouse (name,city) values ('Synthetic Finance SQL','Malang') returning id`;
      const [stock]=await tx`insert into app.stock_item (sku,name) values (${`SQL-${randomUUID()}`.toUpperCase()},'Synthetic SQL component') returning id`;
      const [other]=await tx`insert into app.stock_item (sku,name) values (${`SQL-${randomUUID()}`.toUpperCase()},'Synthetic foreign component') returning id`;
      const [category]=await tx`insert into app.category (name,slug,depth,attribute_definitions) values ('Synthetic SQL category',${`sql-${randomUUID()}`},1,'[]'::jsonb) returning id`;
      const productId=randomUUID(); const offerId=randomUUID();
      await tx`insert into app.product (id,catalog_id,slug) values (${productId},${`p_${randomUUID()}`},${`sql-${randomUUID()}`})`;
      const images=JSON.stringify([{url:'https://example.invalid/synthetic.webp',alt:'Synthetic',width:100,height:100}]);
      await tx`insert into app.product_revision (product_id,revision,name,description,category_id,images,facts,actor_id,reason)
        values (${productId},1,'Synthetic SQL listing','Synthetic only',${category.id},${images}::jsonb,'[]'::jsonb,${actorId},'Synthetic SQL draft')`;
      await tx`insert into app.offer (id,product_id,catalog_id,sku) values (${offerId},${productId},${`v_${randomUUID()}`},${`SQL-${randomUUID()}`.toUpperCase()})`;
      await tx`insert into app.offer_revision (product_id,revision,offer_id,label,attributes,kind,weight_grams,length_mm,width_mm,height_mm,default_warehouse_id)
        values (${productId},1,${offerId},'Synthetic two-piece pack','[]'::jsonb,'multipack',100,100,100,100,${warehouse.id})`;
      await tx`insert into app.offer_component (product_id,revision,offer_id,stock_item_id,name,quantity) values (${productId},1,${offerId},${stock.id},'Synthetic SQL component',2)`;
      await tx`update app.product set revision=1 where id=${productId}`;
      const [balance]=await tx`insert into app.inventory_balance (warehouse_id,stock_item_id) values (${warehouse.id},${stock.id}) returning id`;
      await postMovement(tx,{balanceId:balance.id,kind:'receive',quantity:10,onHand:10,reserved:0,quarantined:0,sourceRef:randomUUID(),actorId,reason:'Synthetic SQL physical supply'});
      const [cost]=await tx`insert into app.component_cost_version (stock_item_id,revision,unit_cost,effective_at,source,reason,actor_id)
        values (${stock.id},1,10000,null,'Synthetic supplier reference','Synthetic SQL cost',${actorId}) returning id,unit_cost`;
      assert.equal(cost.unit_cost,10000);
      await rejects(()=>tx`update app.component_cost_version set unit_cost=0 where id=${cost.id}`);
      await rejects(()=>tx`delete from app.component_cost_version where id=${cost.id}`);
      await rejects(()=>tx`insert into app.component_cost_version (stock_item_id,revision,unit_cost,effective_at,source,reason,actor_id)
        values (${stock.id},3,0,null,'Synthetic','Skip version',${actorId})`);
      await rejects(()=>tx`insert into app.component_cost_version (stock_item_id,revision,unit_cost,effective_at,source,reason,actor_id)
        values (${stock.id},2,-1,null,'Synthetic','Negative acquisition cost',${actorId})`);
      for(const offset of [-1,367]) await rejects(()=>tx`insert into app.component_cost_version (stock_item_id,revision,unit_cost,effective_at,source,reason,actor_id)
        values (${stock.id},2,0,clock_timestamp()+${offset}*interval '1 day','Synthetic','Invalid effective time',${actorId})`,'22007');
      const [assumption]=await tx`insert into app.offer_cost_assumption_version (offer_id,revision,effective_at,packaging_idr,provider_fee_idr,subsidy_idr,returns_reserve_idr,source,reason,actor_id)
        values (${offerId},1,null,2000,1000,5000,1000,'Synthetic estimates','Synthetic SQL assumptions',${actorId}) returning id`;
      await tx`insert into app.policy_head (kind,warehouse_id) values ('commercial',null) on conflict do nothing`;
      const [policyHead]=await tx`select id,revision from app.policy_head where kind='commercial' and warehouse_id is null for update`;
      let [policy]=await tx`select * from app.policy_version where head_id=${policyHead.id} and effective_at<=clock_timestamp() order by effective_at desc,revision desc limit 1`;
      if(!policy){
        [policy]=await tx`insert into app.policy_version (head_id,revision,effective_at,"values",actor_id,reason)
          values (${policyHead.id},${policyHead.revision+1},clock_timestamp(),'{"default_commission_bps":1000,"minimum_payout_idr":99000}'::jsonb,${actorId},'Synthetic rollback-only policy') returning *`;
        await tx`update app.policy_head set revision=revision+1 where id=${policyHead.id}`;
      }
      await tx`insert into app.publication_head (product_id) values (${productId})`;
      const commission=Math.floor((99000*policy.values.default_commission_bps+5000)/10000); const contribution=99000-20000-9000-commission;
      async function publish(hpp:number|null,amount:number|null,complete:boolean,exception:string|null,selectedCostId:string,wrongQuantity=false){
        await tx.unsafe('SET CONSTRAINTS app.publication_sealed DEFERRED');
        const [head]=await tx`select revision from app.publication_head where product_id=${productId}`;
        const publicationId=randomUUID();
        await tx`insert into app.publication_version (id,product_id,revision,product_revision,policy_version_id,minimum_contribution_idr,commission_bps,evaluated_at,exception_reason,actor_id,reason)
          values (${publicationId},${productId},${head.revision+1},1,${policy.id},${policy.values.minimum_contribution_idr??0},${policy.values.default_commission_bps},clock_timestamp(),${exception},${actorId},'Synthetic SQL publication')`;
        await tx`insert into app.publication_offer (publication_id,product_id,product_revision,offer_id,assumption_version_id,estimated_hpp,estimated_contribution,complete)
          values (${publicationId},${productId},1,${offerId},${assumption.id},${hpp},${amount},${complete})`;
        await tx`insert into app.publication_component_cost (publication_id,offer_id,stock_item_id,quantity,cost_version_id)
          values (${publicationId},${offerId},${stock.id},${wrongQuantity?1:2},${selectedCostId})`;
        await tx`update app.publication_head set revision=revision+1 where product_id=${productId}`;
        await tx.unsafe('SET CONSTRAINTS app.publication_sealed IMMEDIATE'); return publicationId;
      }
      await rejects(()=>publish(0,99000,true,'Synthetic explicit owner review',cost.id));
      await rejects(()=>publish(20000,contribution,true,'Synthetic explicit owner review',cost.id,true));
      await rejects(async()=>{
        await tx`update app.role_grant set roles=ARRAY['finance']::text[] where user_id=${actorId}`;
        await publish(20000,contribution,true,'Non-owner cannot approve exceptions',cost.id);
      });
      const first=await publish(20000,contribution,true,'Synthetic explicit owner review',cost.id);
      await rejects(()=>tx`update app.publication_offer set estimated_hpp=0 where publication_id=${first}`);
      await rejects(()=>tx`insert into app.publication_component_cost (publication_id,offer_id,stock_item_id,quantity)
        values (${first},${offerId},${other.id},1)`);
      const [unknown]=await tx`insert into app.component_cost_version (stock_item_id,revision,unit_cost,effective_at,source,reason,actor_id)
        values (${stock.id},2,null,null,'Synthetic missing supplier value','Unknown stays unknown',${actorId}) returning id,unit_cost`;
      assert.equal(unknown.unit_cost,null);
      await rejects(()=>publish(0,99000,true,'Unknown cannot become zero',unknown.id));
      await rejects(()=>publish(null,null,false,null,unknown.id));
      const second=await publish(null,null,false,'Synthetic owner accepts explicit missing HPP',unknown.id);
      const [frozen]=await tx`select estimated_hpp,estimated_contribution,complete from app.publication_offer where publication_id=${first}`;
      assert.equal(Number(frozen.estimated_hpp),20000);assert.equal(Number(frozen.estimated_contribution),contribution);assert.equal(frozen.complete,true);
      const [missing]=await tx`select estimated_hpp,estimated_contribution,complete from app.publication_offer where publication_id=${second}`;
      assert.deepEqual(missing,{estimated_hpp:null,estimated_contribution:null,complete:false});
      const [expensive]=await tx`insert into app.component_cost_version (stock_item_id,revision,unit_cost,effective_at,source,reason,actor_id)
        values (${stock.id},3,100000,null,'Synthetic expensive supplier','Negative contribution case',${actorId}) returning id`;
      const negative=99000-200000-9000-commission;
      await rejects(()=>publish(200000,negative,true,null,expensive.id));
      await publish(200000,negative,true,'Synthetic owner accepts negative contribution',expensive.id);
      const [future]=await tx`insert into app.component_cost_version (stock_item_id,revision,unit_cost,effective_at,source,reason,actor_id)
        values (${stock.id},4,10000,clock_timestamp()+interval '1 day','Synthetic scheduled cost','Future is not yet effective',${actorId}) returning id`;
      await rejects(()=>publish(20000,contribution,true,'Cannot choose future cost early',future.id));
      await rejects(async()=>{
        await tx.unsafe('SET CONSTRAINTS app.publication_sealed DEFERRED');
        const [head]=await tx`select revision from app.publication_head where product_id=${productId}`;
        await tx`insert into app.publication_version (product_id,revision,product_revision,policy_version_id,minimum_contribution_idr,commission_bps,evaluated_at,actor_id,reason)
          values (${productId},${head.revision+1},1,${policy.id},${policy.values.minimum_contribution_idr??0},${policy.values.default_commission_bps},clock_timestamp(),${actorId},'Unsealed publication')`;
        await tx.unsafe('SET CONSTRAINTS app.publication_sealed IMMEDIATE');
      });
      throw rollback;
    }),(error:unknown)=>error===rollback);
    const [after]=await sql`select count(*)::int as n from information_schema.tables where table_schema='app'`;
    assert.equal(after.n,before.n,'Candidate DDL and every synthetic row roll back');
  } finally {await sql.end();}
});
