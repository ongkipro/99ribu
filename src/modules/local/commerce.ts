import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {TransactionSql} from 'postgres';
import {connectDatabase} from '../../db/client.ts';
import {readLocalConfig} from '../../config/local.ts';
import type {LocalAuth} from '../access/auth.ts';
import {assertCurrentOwner} from '../access/grants.ts';
import {assertOrigin} from '../access/http.ts';
import {AccessError,getPrincipal,type Principal} from '../access/policy.ts';
import {createCategory,createProduct,createStockItem,readCatalogRevision} from '../catalog/catalog.ts';
import {publishProduct,readPublicationState} from '../catalog/publication.ts';
import {array,integer,invalid,object,text} from '../catalog/validation.ts';
import {appendCostVersion} from '../finance/costs.ts';
import {readReservation,reserveOffers} from '../inventory/reservations.ts';
import {ensurePosition,postMovement} from '../inventory/state.ts';
import {seedLocal} from './fixtures.ts';

type Target='local'|'test';
const fixtureId=(value:unknown)=>{const result=text(value,40);if(!/^fixture-[a-z0-9-]{1,32}$/.test(result)) throw invalid();return result;};
function recipe(){
  const source=JSON.parse(readFileSync(new URL('../../../docs/spec/fixtures/localhost-commerce.json',import.meta.url),'utf8'));
  if(source.format!==1||source.synthetic!==true||source.environment!=='local'||source.real_external_effects!==false||source.currency!=='IDR') throw invalid();
  const stock=array(source.stock_items,(value)=>{const v=object(value,['id','name','hpp_idr']);return {id:fixtureId(v.id),name:text(v.name,200),hpp:v.hpp_idr===null?null:integer(v.hpp_idr,0)};},1);
  const offers=array(source.offers,(value)=>{const v=object(value,['id','price_idr','components']);if(v.price_idr!==99000) throw invalid();return {id:fixtureId(v.id),components:array(v.components,(value)=>{const c=object(value,['stock_item_id','quantity']);return {stock_id:fixtureId(c.stock_item_id),quantity:integer(c.quantity,1,1000000)};},1)};},1);
  const inventory=array(source.inventory,(value)=>{const v=object(value,['warehouse_id','stock_item_id','on_hand','reserved','quarantine']);return {warehouse_id:fixtureId(v.warehouse_id),stock_id:fixtureId(v.stock_item_id),on_hand:integer(v.on_hand,0),reserved:integer(v.reserved,0),quarantine:integer(v.quarantine,0)};},1);
  if(new Set(stock.map((s)=>s.id)).size!==stock.length||new Set(offers.map((o)=>o.id)).size!==offers.length||new Set(inventory.map((i)=>`${i.warehouse_id}:${i.stock_id}`)).size!==inventory.length||
    offers.some((o)=>new Set(o.components.map((c)=>c.stock_id)).size!==o.components.length||o.components.some((c)=>!stock.some((s)=>s.id===c.stock_id)))||
    inventory.some((i)=>i.reserved+i.quarantine>i.on_hand||!stock.some((s)=>s.id===i.stock_id))) throw invalid();
  return {stock,offers,inventory};
}
async function owner(tx:TransactionSql,principal:Principal){await tx`select id from app.auth_user where id=${principal.id} for update`;await assertCurrentOwner(tx,principal);}

// Host-only synthetic harness. Uses real cookie/session/MFA and domain writers;
// this function is not exposed by an application route. Historical orders,
// economic receipts, ads or provider effects in the fixture are not imported.
export async function seedCommerce(request:Request,identity:LocalAuth,target:Target,namespace:string,signal?:AbortSignal){
  signal?.throwIfAborted();const config=readLocalConfig(process.env);assertOrigin(request);
  if(!['local','test'].includes(target)||!/^[a-z][a-z0-9-]{0,23}$/.test(namespace)||['authorization','x-cart-token','x-order-token'].some((h)=>request.headers.has(h))) throw invalid();
  const [database]=await identity.sql`select current_database() as name`;if(database.name!==`99ribu_${target}`) throw invalid();
  const principal=await getPrincipal(request,identity);await identity.sql.begin((tx)=>owner(tx,principal));
  const input=recipe();const seeded=await identity.sql.begin(async(tx)=>{await owner(tx,principal);return seedLocal(target,namespace);});
  if(input.inventory.some((i)=>!seeded.warehouses[i.warehouse_id])) throw invalid();
  // Dedicated lock connection never occupies the domain pool. Transactional
  // advisory locking releases automatically on error/disconnect; the database
  // client bounds lock waits with its actual10s statement timeout.
  const lockDatabase=connectDatabase(target).sql;const lock=`99ribu:fixture-commerce:${namespace}`;
  try{return await lockDatabase.begin(async(connection)=>{
    await connection`select set_config('application_name',${`99ribu-seed-${namespace}`},true)`;
    await connection`select pg_advisory_xact_lock(hashtextextended(${lock},0))`;signal?.throwIfAborted();
    await identity.sql.begin((tx)=>owner(tx,principal));
    const stocks:Record<string,string>={};const offers:Record<string,string>={};const products:Record<string,string>={};const positions:Record<string,string>={};const reservations:Record<string,string>={};
    const key=(step:string)=>createHash('sha256').update(`fixture:${namespace}:${step}`).digest('hex');
    const command=(step:string)=>{const req=new Request(`${config.origin}/api/v1/admin/local-fixture-command`,{method:'POST',headers:request.headers});req.headers.set('idempotency-key',key(step));return req;};
    const slug=`fixture-${namespace}`;let [category]=await identity.sql`select id from app.category where slug=${slug}`;
    if(!category) category=await createCategory(command('category'),identity,principal,{name:`SYNTHETIC fixture [${namespace}]`,slug,parent_id:null,attribute_definitions:[]});
    for(const item of input.stock){
      signal?.throwIfAborted();
      const sku=`FX_${namespace}_${item.id}`.toUpperCase();let [stored]=await identity.sql`select id from app.stock_item where sku=${sku}`;
      if(!stored) stored=await createStockItem(command(`stock:${item.id}`),identity,principal,{sku,name:item.name});
      stocks[item.id]=stored.id;
      if(!(await identity.sql`select id from app.component_cost_version where stock_item_id=${stored.id} limit 1`).length)
        await appendCostVersion(command(`cost:${item.id}`),identity,principal,'component',stored.id,{expected_version:0,unit_cost:item.hpp,effective_from:null,source:'TEST-ONLY synthetic fixture estimate',reason:'Initialize synthetic component HPP; unknown remains unknown'});
    }
    const primaryWarehouse=seeded.warehouses['fixture-malang'];if(!primaryWarehouse) throw invalid();
    for(const item of input.offers){
      signal?.throwIfAborted();
      const sku=`FX_${namespace}_${item.id}`.toUpperCase();let [stored]=await identity.sql`select id,product_id from app.offer where sku=${sku}`;
      if(!stored){
        const contents=[];for(const component of item.components){const [stock]=await identity.sql`select name from app.stock_item where id=${stocks[component.stock_id]}`;contents.push({stock_item_id:stocks[component.stock_id],name:stock.name,quantity:component.quantity});}
        const kind=contents.length>1?'bundle':contents[0].quantity>1?'multipack':'unit';
        const asset=item.id==='fixture-offer-shirt'?'shirt':item.id==='fixture-offer-bag'?'bag':item.id==='fixture-offer-cream-pack'?'cream':'mixed';
        const product=await createProduct(command(`product:${item.id}`),identity,principal,{name:`SYNTHETIC ${item.id.replace('fixture-offer-','')} [${namespace}]`,description:'Synthetic localhost commerce fixture. Not a real product listing.',category_id:category.id,
          images:[{url:`${config.origin}/fixtures/${asset}.svg`,alt:`Synthetic ${asset} fixture`,width:480,height:600}],variants:[{sku,label:'Synthetic complete offer',attributes:[],offer_kind:kind,
            weight_grams:500,length_mm:200,width_mm:150,height_mm:100,default_warehouse_id:primaryWarehouse,contents}]});
        stored={id:product.variants[0].id,product_id:product.id};
      }
      products[item.id]=stored.product_id;offers[item.id]=stored.id;
      if(!(await identity.sql`select id from app.offer_cost_assumption_version where offer_id=${stored.id} limit 1`).length)
        await appendCostVersion(command(`assumption:${item.id}`),identity,principal,'assumption',stored.id,{expected_version:0,effective_from:null,packaging_idr:1000,provider_fee_idr:1000,subsidy_idr:5000,returns_reserve_idr:1000,source:'TEST-ONLY conservative fixture assumptions',reason:'Initialize synthetic per-offer variable cost estimates'});
    }
    for(const item of input.inventory){
      signal?.throwIfAborted();
      const warehouseId=seeded.warehouses[item.warehouse_id];const stockId=stocks[item.stock_id];
      positions[`${item.warehouse_id}:${item.stock_id}`]=await identity.sql.begin(async(tx)=>{
        await owner(tx,principal);const balanceId=await ensurePosition(tx,warehouseId,stockId,null);
        const [balance]=await tx`select revision from app.inventory_balance where id=${balanceId} for update`;
        if(balance.revision===0){
          const sourceRef=`fixture:${namespace}:${item.warehouse_id}:${item.stock_id}`;
          if(item.on_hand) await postMovement(tx,{balanceId,kind:'receive',quantity:item.on_hand,onHand:item.on_hand,reserved:0,quarantined:0,sourceRef,actorId:principal.id,reason:'Initialize synthetic physical supply'});
          if(item.quarantine) await postMovement(tx,{balanceId,kind:'quarantine',quantity:item.quarantine,onHand:0,reserved:0,quarantined:item.quarantine,sourceRef,actorId:principal.id,reason:'Initialize synthetic quarantined supply'});
          if(item.on_hand) await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason) values (${principal.id},'local_fixture.inventory',${balanceId},'allowed','Initialize synthetic position through actual movements')`;
        }
        return balanceId as string;
      });
    }
    for(const item of input.inventory.filter((i)=>i.reserved>0)){
      signal?.throwIfAborted();
      const unit=input.offers.find((o)=>o.components.length===1&&o.components[0].stock_id===item.stock_id&&o.components[0].quantity===1);if(!unit) throw new AccessError(409,'FIXTURE_RESERVATION_UNSUPPORTED');
      const reservationKey=`checkout:fixture-${namespace}-${item.warehouse_id}-${item.stock_id}`;
      reservations[`${item.warehouse_id}:${item.stock_id}`]=await identity.sql.begin(async(tx)=>{
        await owner(tx,principal);const [prior]=await tx`select id from app.stock_reservation where key=${reservationKey}`;
        if(prior){const existing=await readReservation(tx,prior.id);if(existing.header.clock_namespace!==namespace) throw new AccessError(409,'CLOCK_CONTEXT_MISMATCH');return prior.id as string;}
        const [clock]=await tx`select clock from app.local_fixture_namespace where name=${namespace} for share`;
        const draft=await readCatalogRevision(tx,products[unit.id]);const hold=await reserveOffers(tx,{key:reservationKey,
          lines:[{line_id:unit.id,product_id:draft.id,product_revision:draft.version,offer_id:offers[unit.id],warehouse_id:seeded.warehouses[item.warehouse_id],quantity:item.reserved}],
          expires_at:new Date(new Date(clock.clock).getTime()+3600000).toISOString(),clock_namespace:namespace,actor_id:principal.id});
        return hold.header.id;
      });
    }
    const publications:Record<string,{id:string|null;blockers:string[]}>={};
    for(const item of input.offers){
      signal?.throwIfAborted();
      const state=await readPublicationState(identity,principal,products[item.id]);
      // A withdrawn fixture publication (test-run teardown) is republished through the same guard.
      if(!state.current&&state.ready){
        const published=await publishProduct(command(`publication:${item.id}:${state.latest_version}`),identity,principal,products[item.id],{expected_version:state.draft_version,expected_publication_version:state.latest_version,reason:'Guarded synthetic publication; no exception'});
        publications[item.id]={id:published.id,blockers:[]};
      }else publications[item.id]={id:state.current?.id??null,blockers:[...new Set(state.blockers.map((b)=>b.code))]};
    }
    signal?.throwIfAborted();await identity.sql.begin(async(tx)=>{await owner(tx,principal);await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},'local_fixture.commerce',${namespace},'allowed','Non-destructive synthetic commerce seed through real domain guards',${JSON.stringify({stocks:Object.keys(stocks).length,offers:Object.keys(offers).length})}::jsonb)`;});
    return {namespace,scope:'catalog-stock-cost',stocks,offers,products,positions,reservations,publications};
  });}finally{await lockDatabase.end();}
}
