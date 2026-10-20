import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {setTimeout} from "node:timers/promises";
import test from "node:test";
import {createLocalAuth} from "../../src/modules/access/auth.ts";
import {getPrincipal} from "../../src/modules/access/policy.ts";
import {handleAccess} from "../../src/modules/access/routes.ts";
import {handleCatalog} from "../../src/modules/catalog/routes.ts";
import {appendCostVersion,listCostVersions} from "../../src/modules/finance/costs.ts";
import {actor,cleanup,enroll} from "../contract/access-fixture.ts";
import {totp} from "./totp-fixture.ts";

type Actor=Awaited<ReturnType<typeof actor>>;
const denied=(code:string)=>(error:unknown)=>error instanceof Error&&'code' in error&&error.code===code;
async function setup(){
  const identity=createLocalAuth('test');const users:Actor[]=[];const owner=await actor(identity,'owner',[]);users.push(owner);await enroll(owner.browser,owner.password);
  const [wh]=await identity.sql`insert into app.warehouse (name,city) values ('Synthetic Finance Cost','Malang') returning id`;
  const catalog=async(path:string,body:Record<string,unknown>)=>{const req=owner.browser.request(`/api/v1/admin${path}`,body);req.headers.set('idempotency-key',randomUUID());
    const response=await handleCatalog(req,identity);assert.equal(response.status,201);return response.json();};
  const stock=await catalog('/stock-items',{name:'Synthetic finance stock',sku:`F-${randomUUID()}`.toUpperCase()});
  const category=await catalog('/categories',{name:'Synthetic finance category',slug:`synthetic-${randomUUID()}`,parent_id:null,attribute_definitions:[]});
  const product=await catalog('/products',{name:'Synthetic finance offer',description:'Synthetic only',images:[],category_id:category.id,variants:[{
    sku:`F-${randomUUID()}`.toUpperCase(),label:'Synthetic unit',attributes:[],offer_kind:'unit',weight_grams:100,length_mm:100,width_mm:100,height_mm:100,
    default_warehouse_id:wh.id,contents:[{stock_item_id:stock.id,name:stock.name,quantity:1}]}]});
  const append=async(user:Actor,body:Record<string,unknown>,key:string=randomUUID(),kind:'component'|'assumption'='component')=>{
    const scope=kind==='component'?stock.id:product.variants[0].id;
    const request=user.browser.request(`/api/v1/admin/${kind==='component'?'stock-items':'offers'}/${scope}/cost-versions`,body);request.headers.set('idempotency-key',key);
    return appendCostVersion(request,identity,await getPrincipal(request,identity),kind,scope,body);
  };
  const list=async(user:Actor,kind:'component'|'assumption'='component')=>{
    const request=user.browser.request('/api/v1/admin/cost-versions');return listCostVersions(identity,await getPrincipal(request,identity),kind,kind==='component'?stock.id:product.variants[0].id,new URL(request.url));
  };
  const cost=(unit_cost:number|null,expected_version:number)=>({unit_cost,expected_version,effective_from:null,source:'Synthetic supplier estimate',reason:'Synthetic prospective HPP'});
  const close=async()=>{await cleanup(identity,users);await identity.sql`update app.warehouse set active=false where id=${wh.id}`;await identity.sql.end();};
  return {identity,users,owner,wh:wh.id,stock,product,append,list,cost,close};
}

test('actual finance writers preserve null/zero/history, effective schedules and cross-stream idempotent intent',async()=>{
  const f=await setup();
  try{
    for(const body of [{...f.cost(-1,0)},{...f.cost(1,0),unit_cost:undefined},{...f.cost(1,0),effective_from:'2026-02-30T00:00:00.000Z'},{...f.cost(1,0),profit:99000}]) await assert.rejects(f.append(f.owner,body),denied('INVALID_INPUT'));
    const key=randomUUID();const first=await f.append(f.owner,f.cost(null,0),key);assert.equal(first.unit_cost,null);
    assert.deepEqual(await f.append(f.owner,f.cost(null,0),key),first);
    await assert.rejects(f.append(f.owner,f.cost(0,0),key),denied('IDEMPOTENCY_CONFLICT'));
    const empty=await f.list(f.owner);assert.ok(empty.current&&'unit_cost' in empty.current);assert.equal(empty.current.unit_cost,null);assert.equal(empty.latest_version,1);
    const known=await f.append(f.owner,f.cost(50000,1));assert.equal(known.unit_cost,50000);
    const zero=await f.append(f.owner,f.cost(0,2));assert.equal(zero.unit_cost,0);
    const future=await f.append(f.owner,{...f.cost(60000,3),effective_from:new Date(Date.now()+60000).toISOString()});assert.equal(future.version,4);
    const history=await f.list(f.owner);assert.equal(history.latest_version,4);assert.ok(history.current&&'unit_cost' in history.current);assert.equal(history.current.version,3);assert.equal(history.current.unit_cost,0);
    const oldUnknown=history.data.find((r)=>r.version===1);const oldKnown=history.data.find((r)=>r.version===2);
    assert.ok(oldUnknown&&'unit_cost' in oldUnknown);assert.ok(oldKnown&&'unit_cost' in oldKnown);assert.equal(oldUnknown.unit_cost,null);assert.equal(oldKnown.unit_cost,50000);
    await assert.rejects(f.append(f.owner,f.cost(100,4)),denied('SCHEDULE_CONFLICT'));
    await assert.rejects(f.append(f.owner,f.cost(100,1)),denied('VERSION_CONFLICT'));
    await assert.rejects(f.append(f.owner,{...f.cost(100,4),effective_from:new Date(Date.now()-86400000).toISOString()}),denied('RETROACTIVE_COST_FORBIDDEN'));
    await assert.rejects(f.append(f.owner,{...f.cost(100,4),effective_from:new Date(Date.now()+367*86400000).toISOString()}),denied('COST_SCHEDULE_TOO_DISTANT'));
    const assumptions={packaging_idr:null,provider_fee_idr:0,subsidy_idr:0,returns_reserve_idr:0,expected_version:0,effective_from:null,source:'Synthetic conservative assumptions',reason:'Unknown packaging remains null'};
    await assert.rejects(f.append(f.owner,assumptions,key,'assumption'),denied('IDEMPOTENCY_CONFLICT'));
    const profile=await f.append(f.owner,assumptions,randomUUID(),'assumption');assert.equal(profile.packaging_idr,null);assert.equal(profile.provider_fee_idr,0);
    const profiles=await f.list(f.owner,'assumption');assert.equal(profiles.latest_version,1);assert.ok(profiles.current&&'packaging_idr' in profiles.current);assert.equal(profiles.current.packaging_idr,null);
  } finally {await f.close();}
});

test('finance cost permissions and revoked sessions are rechecked by actual writers and saved-result recovery',async()=>{
  const f=await setup();
  try{
    const finance=await actor(f.identity,'finance',[]);f.users.push(finance);const factor=await enroll(finance.browser,finance.password);
    await assert.rejects(f.append(finance,f.cost(10000,0)),denied('FORBIDDEN'));await assert.rejects(f.list(finance),denied('FORBIDDEN'));
    const replace=async(permissions:string[],expected_version:number)=>{
      const proof=f.owner.browser.request('/api/v1/me/reauthentication-proofs',{password:f.owner.password,action:'staff_roles.replace',subject_id:finance.id});proof.headers.set('idempotency-key',randomUUID());
      const issued=await handleAccess(proof,f.identity);assert.equal(issued.status,201);
      const grant=f.owner.browser.request('/api/v1/admin/role-grants',{user_id:finance.id,roles:['finance'],warehouse_ids:[],permissions,expected_version,reason:'Synthetic finance permission change',reauthentication_proof:(await issued.json()).proof});grant.headers.set('idempotency-key',randomUUID());
      assert.equal((await handleAccess(grant,f.identity)).status,201);
      assert.equal((await finance.browser.auth('/sign-in/email',{email:finance.email,password:finance.password})).status,200);
      assert.equal((await finance.browser.auth('/two-factor/verify-totp',{code:totp(factor.totpURI)})).status,200);
    };
    await replace(['finance.costs.read','finance.costs.write'],1);const key=randomUUID();const body=f.cost(40000,0);
    const saved=await f.append(finance,body,key);assert.equal(saved.unit_cost,40000);const visible=await f.list(finance);assert.ok(visible.current&&'unit_cost' in visible.current);assert.equal(visible.current.unit_cost,40000);
    const cachedRequest=finance.browser.request('/api/v1/admin/cost-versions',body);cachedRequest.headers.set('idempotency-key',key);
    const cached=await getPrincipal(cachedRequest,f.identity);
    await replace([],2);
    await assert.rejects(appendCostVersion(cachedRequest,f.identity,cached,'component',f.stock.id,body),denied('FORBIDDEN'));
    await assert.rejects(f.append(finance,body,key),denied('FORBIDDEN'));await assert.rejects(f.list(finance),denied('FORBIDDEN'));
    const ecommerce=await actor(f.identity,'ecommerce_admin',[f.wh]);f.users.push(ecommerce);await enroll(ecommerce.browser,ecommerce.password);
    await assert.rejects(f.append(ecommerce,f.cost(1,1)),denied('FORBIDDEN'));await assert.rejects(f.list(ecommerce),denied('FORBIDDEN'));
  } finally {await f.close();}
});

test('two real cost editors wait on the same physical SKU and only one expected revision appends',async()=>{
  const f=await setup();
  try{
    const peer=await actor(f.identity,'owner',[]);f.users.push(peer);await enroll(peer.browser,peer.password);
    let release=()=>{};let ready=()=>{};const held=new Promise<void>((r)=>{release=r;});const locked=new Promise<void>((r)=>{ready=r;});
    const blocker=f.identity.sql.begin(async(tx)=>{await tx`select id from app.stock_item where id=${f.stock.id} for update`;ready();await held;});
    let pending:Promise<PromiseSettledResult<Awaited<ReturnType<typeof f.append>>>[]>|undefined;
    try{
      await locked;pending=Promise.allSettled([f.owner,peer].map((user,i)=>f.append(user,f.cost(1000+i,0))));let waiting=0;
      for(let i=0;i<100;i++){
        const [row]=await f.identity.sql`select count(*)::int as n from pg_stat_activity where datname='99ribu_test' and usename='99ribu_test_app' and wait_event_type='Lock' and query like '%select id from app.stock_item where id=%for update%'`;
        waiting=row.n;if(waiting===2) break;await setTimeout(20);
      }
      assert.equal(waiting,2);release();await blocker;const results=await pending;assert.equal(results.filter((r)=>r.status==='fulfilled').length,1);
      for(const result of results) if(result.status==='rejected') assert.ok(denied('VERSION_CONFLICT')(result.reason));
    } finally {release();await Promise.allSettled([blocker,pending].filter((p)=>p!==undefined));}
    const [count]=await f.identity.sql`select count(*)::int as n,max(revision)::int as revision from app.component_cost_version where stock_item_id=${f.stock.id}`;
    assert.deepEqual(count,{n:1,revision:1});
  } finally {await f.close();}
});
