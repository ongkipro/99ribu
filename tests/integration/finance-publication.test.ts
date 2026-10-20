import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {setTimeout} from "node:timers/promises";
import test from "node:test";
import {createLocalAuth} from "../../src/modules/access/auth.ts";
import {getPrincipal} from "../../src/modules/access/policy.ts";
import {handleAccess} from "../../src/modules/access/routes.ts";
import {handleCatalog} from "../../src/modules/catalog/routes.ts";
import {publishProduct,readPublicationState,salePublication} from "../../src/modules/catalog/publication.ts";
import {readContribution} from "../../src/modules/finance/contribution.ts";
import {appendCostVersion} from "../../src/modules/finance/costs.ts";
import {handleInventory} from "../../src/modules/inventory/routes.ts";
import {actor,cleanup,enroll} from "../contract/access-fixture.ts";
import {totp} from "./totp-fixture.ts";

type Actor=Awaited<ReturnType<typeof actor>>;
const rejected=(code:string)=>(error:unknown)=>error instanceof Error&&'code' in error&&error.code===code;
async function setup(){
  const identity=createLocalAuth('test');const users:Actor[]=[];const owner=await actor(identity,'owner',[]);users.push(owner);await enroll(owner.browser,owner.password);
  const [wh]=await identity.sql`insert into app.warehouse (name,city) values ('Synthetic Publication','Malang') returning id`;
  const catalogue=async(path:string,body:Record<string,unknown>,method='POST')=>{
    const req=owner.browser.request(`/api/v1/admin${path}`,body);req.headers.set('idempotency-key',randomUUID());
    const response=await handleCatalog(new Request(req,{method}),identity);assert.equal(response.status,method==='PATCH'?200:201);return response.json();
  };
  const issue=async(action:string,subject_id:string)=>{
    const req=owner.browser.request('/api/v1/me/reauthentication-proofs',{password:owner.password,action,subject_id});req.headers.set('idempotency-key',randomUUID());
    const response=await handleAccess(req,identity);assert.equal(response.status,201);return (await response.json()).proof as string;
  };
  let historyResponse=await owner.browser.access('/admin/policy-versions?kind=commercial');assert.equal(historyResponse.status,200);let history=await historyResponse.json();
  if(history.latest_version===0){
    const req=owner.browser.request('/api/v1/admin/policy-versions',{kind:'commercial',warehouse_id:null,expected_version:0,effective_at:null,
      values:{default_commission_bps:1000,minimum_payout_idr:99000},reason:'Synthetic explicit publication baseline',reauthentication_proof:await issue('company_policy.version','company-commercial')});req.headers.set('idempotency-key',randomUUID());
    assert.equal((await handleAccess(req,identity)).status,201);
    historyResponse=await owner.browser.access('/admin/policy-versions?kind=commercial');history=await historyResponse.json();
  }
  assert.ok(history.current,'A current owner-configured commercial baseline is required before financial publication; future-only schedules cannot be silently replaced.');
  const category=await catalogue('/categories',{name:'Synthetic publication category',slug:`synthetic-${randomUUID()}`,parent_id:null,
    attribute_definitions:[{key:'units',label:'Units',value_type:'number',required:true,allowed_values:[]}]});
  const stock=await catalogue('/stock-items',{sku:`PUB-${randomUUID()}`.toUpperCase(),name:'Synthetic publication component'});
  const product=await catalogue('/products',{name:'Synthetic publication draft',description:'',images:[],category_id:category.id,variants:[{
    sku:`PUB-${randomUUID()}`.toUpperCase(),label:'Synthetic unit',attributes:[],offer_kind:'unit',weight_grams:100,length_mm:100,width_mm:100,height_mm:100,
    default_warehouse_id:wh.id,contents:[{stock_item_id:stock.id,name:stock.name,quantity:1}]}]});
  const principal=async(user:Actor)=>getPrincipal(user.browser.request('/api/v1/me'),identity);
  const publish=async(user:Actor,body:Record<string,unknown>,key:string=randomUUID())=>{
    const req=user.browser.request(`/api/v1/admin/products/${product.id}/publications`,body);req.headers.set('idempotency-key',key);
    return publishProduct(req,identity,await principal(user),product.id,body);
  };
  const prepare=async()=>{
    const revised=await catalogue(`/products/${product.id}`,{expected_version:1,reason:'Synthetic complete product facts/media',description:'Synthetic complete product description',
      images:[{url:'https://example.invalid/synthetic.webp',alt:'Synthetic fixture',width:100,height:100}],facts:[{key:'units',label:'Units',values:['1']}]},'PATCH');
    const req=owner.browser.request('/api/v1/admin/inventory/movements',{warehouse_id:wh.id,stock_item_id:stock.id,kind:'receive',quantity:3,expected_version:0,reason:'Synthetic publication stock'});req.headers.set('idempotency-key',randomUUID());
    assert.equal((await handleInventory(req,identity)).status,201);return revised;
  };
  const cost=async(unit_cost:number|null,expected_version:number)=>{
    const body={unit_cost,expected_version,effective_from:null,source:'Synthetic supplier estimate',reason:'Synthetic publication HPP'};
    const req=owner.browser.request(`/api/v1/admin/stock-items/${stock.id}/cost-versions`,body);req.headers.set('idempotency-key',randomUUID());
    return appendCostVersion(req,identity,await principal(owner),'component',stock.id,body);
  };
  const assumptions=async()=>{
    const body={expected_version:0,effective_from:null,source:'Synthetic conservative variable costs',reason:'Synthetic publication assumptions',packaging_idr:2000,provider_fee_idr:1000,subsidy_idr:5000,returns_reserve_idr:1000};
    const req=owner.browser.request(`/api/v1/admin/offers/${product.variants[0].id}/cost-assumption-versions`,body);req.headers.set('idempotency-key',randomUUID());
    return appendCostVersion(req,identity,await principal(owner),'assumption',product.variants[0].id,body);
  };
  const state=async(user=owner)=>readPublicationState(identity,await principal(user),product.id);
  const sale=(publicationId?:string)=>identity.sql.begin(async(tx)=>{
    // Historical content/approval assertions use the actual persisted evaluation
    // instant; a separately scheduled policy may legitimately become current.
    const [clock]=publicationId?await tx`select evaluated_at::text as now from app.publication_version where id=${publicationId}`:await tx`select clock_timestamp()::text as now`;
    return salePublication(tx,product.id,clock.now);
  });
  const close=async()=>{await cleanup(identity,users);await identity.sql`update app.warehouse set active=false where id=${wh.id}`;await identity.sql.end();};
  return {identity,users,owner,wh:wh.id,product,stock,catalogue,issue,principal,publish,prepare,cost,assumptions,state,sale,close};
}

test('actual publication blocks missing facts/stock/costs, freezes live content and invalidates new sales when cost sources change',async()=>{
  const f=await setup();
  try{
    const initial=await f.state();assert.equal(initial.ready,false);assert.ok(initial.blockers.some((b)=>b.code==='MEDIA_REQUIRED'));assert.ok(initial.blockers.some((b)=>b.code==='REQUIRED_FACT_MISSING'));
    await assert.rejects(f.publish(f.owner,{expected_version:1,expected_publication_version:0,reason:'Incomplete catalogue'}),rejected('MEDIA_REQUIRED'));
    const draft=await f.prepare();const body={expected_version:draft.version,expected_publication_version:0,reason:'Synthetic reviewed publication'};
    await assert.rejects(f.publish(f.owner,body),rejected('UNKNOWN_HPP'));
    await f.cost(50000,0);await assert.rejects(f.publish(f.owner,body),rejected('UNKNOWN_PACKAGING_IDR'));await f.assumptions();
    const estimate=await readContribution(f.identity,await f.principal(f.owner),f.product.id);const commission=Math.floor((99000*estimate.commission_bps+5000)/10000);
    assert.equal(estimate.offers[0].estimated_hpp,50000);assert.equal(estimate.offers[0].estimated_contribution,99000-50000-9000-commission);assert.equal(estimate.offers[0].complete,true);
    assert.equal((await f.state()).ready,true);const key=randomUUID();const published=await f.publish(f.owner,body,key);assert.equal(published.version,1);assert.equal(published.exception_applied,false);
    assert.deepEqual(await f.publish(f.owner,body,key),published);assert.equal((await f.sale(published.id))?.product_revision,2);
    const edited=await f.catalogue(`/products/${f.product.id}`,{expected_version:2,reason:'Synthetic next draft only',name:'Synthetic future title'},'PATCH');assert.equal(edited.version,3);
    const live=await f.sale(published.id);assert.equal(live?.draft.version,2);assert.equal(live?.draft.name,'Synthetic publication draft');
    await f.cost(60000,1);assert.equal(await f.sale(),null);assert.equal((await f.state()).current_review_state,'requires_review');
    const [old]=await f.identity.sql`select estimated_hpp from app.publication_offer where publication_id=${published.id}`;assert.equal(Number(old.estimated_hpp),50000);
    const next=await f.publish(f.owner,{...body,expected_version:3,expected_publication_version:1});assert.equal(next.version,2);assert.equal((await f.sale(next.id))?.draft.name,'Synthetic future title');
    assert.deepEqual(await f.publish(f.owner,body,key),published);await assert.rejects(f.publish(f.owner,{...body,reason:'Changed business intent'},key),rejected('IDEMPOTENCY_CONFLICT'));
    const safe=await f.state();for(const field of ['unit_cost','estimated_hpp','estimated_contribution','exception_reason']) assert.ok(!JSON.stringify(safe).includes(field));
  } finally {await f.close();}
});

test('only a fresh product/session/purpose-bound owner proof accepts explicit unknown HPP and cannot override catalogue facts',async()=>{
  const f=await setup();
  try{
    const correct=await f.issue('catalog_publication.exception',f.product.id);const exception={reason:'Synthetic owner accepts explicitly unknown acquisition cost',reauthentication_proof:correct};
    await assert.rejects(f.publish(f.owner,{expected_version:1,expected_publication_version:0,reason:'Cannot override missing catalogue',exception}),rejected('MEDIA_REQUIRED'));
    const [unused]=await f.identity.sql`select consumed_at from app.access_proof where digest=${createHash('sha256').update(correct).digest('hex')}`;assert.equal(unused.consumed_at,null);
    await f.prepare();await f.assumptions();const body={expected_version:2,expected_publication_version:0,reason:'Synthetic explicit financial exception',exception};
    const otherPurpose=await f.issue('company_policy.version','company-commercial');await assert.rejects(f.publish(f.owner,{...body,exception:{...exception,reauthentication_proof:otherPurpose}}),rejected('REAUTHENTICATION_REQUIRED'));
    const otherProduct=await f.issue('catalog_publication.exception',randomUUID());await assert.rejects(f.publish(f.owner,{...body,exception:{...exception,reauthentication_proof:otherProduct}}),rejected('REAUTHENTICATION_REQUIRED'));
    const ecommerce=await actor(f.identity,'ecommerce_admin',[f.wh]);f.users.push(ecommerce);await enroll(ecommerce.browser,ecommerce.password);
    await assert.rejects(f.publish(ecommerce,body),rejected('FORBIDDEN'));await assert.rejects(f.publish(ecommerce,{expected_version:2,expected_publication_version:0,reason:'No silent unknown approval'}),rejected('UNKNOWN_HPP'));
    const peer=await actor(f.identity,'owner',[]);f.users.push(peer);await enroll(peer.browser,peer.password);
    await assert.rejects(f.publish(peer,body),rejected('REAUTHENTICATION_REQUIRED'));
    const key=randomUUID();const accepted=await f.publish(f.owner,body,key);assert.equal(accepted.exception_applied,true);assert.ok(await f.sale(accepted.id));
    const [snapshot]=await f.identity.sql`select estimated_hpp,estimated_contribution,complete from app.publication_offer where publication_id=${accepted.id}`;assert.deepEqual(snapshot,{estimated_hpp:null,estimated_contribution:null,complete:false});
    assert.deepEqual(await f.publish(f.owner,body,key),accepted);
    await assert.rejects(f.publish(f.owner,{...body,expected_publication_version:1}),rejected('REAUTHENTICATION_REQUIRED'));
    const [head]=await f.identity.sql`select revision from app.publication_head where product_id=${f.product.id}`;assert.equal(head.revision,1);
    await f.cost(150000,0);
    await assert.rejects(f.publish(ecommerce,{expected_version:2,expected_publication_version:1,reason:'Negative contribution needs owner'}),rejected('BELOW_MARGIN_FLOOR'));
    const renewed=await f.issue('catalog_publication.exception',f.product.id);
    const negative=await f.publish(f.owner,{...body,expected_publication_version:1,exception:{reason:'Synthetic deliberate negative margin promotion',reauthentication_proof:renewed}});
    const [negativeSnapshot]=await f.identity.sql`select estimated_contribution,complete from app.publication_offer where publication_id=${negative.id}`;
    assert.ok(Number(negativeSnapshot.estimated_contribution)<0);assert.equal(negativeSnapshot.complete,true);assert.ok(await f.sale(negative.id));
  } finally {await f.close();}
});

test('two real publication reviewers wait on one product and only one publication version commits',async()=>{
  const f=await setup();
  try{
    await f.prepare();await f.cost(50000,0);await f.assumptions();const peer=await actor(f.identity,'owner',[]);f.users.push(peer);await enroll(peer.browser,peer.password);
    const body={expected_version:2,expected_publication_version:0,reason:'Synthetic publication contention'};
    let release=()=>{};let ready=()=>{};const held=new Promise<void>((r)=>{release=r;});const locked=new Promise<void>((r)=>{ready=r;});
    const blocker=f.identity.sql.begin(async(tx)=>{await tx`select id from app.product where id=${f.product.id} for update`;ready();await held;});
    let pending:Promise<PromiseSettledResult<Awaited<ReturnType<typeof f.publish>>>[]>|undefined;
    try{
      await locked;pending=Promise.allSettled([f.owner,peer].map((user)=>f.publish(user,body)));let waiting=0;
      for(let i=0;i<100;i++){
        const [row]=await f.identity.sql`select count(*)::int as n from pg_stat_activity where datname='99ribu_test' and usename='99ribu_test_app' and wait_event_type='Lock' and query like '%select id from app.product where id=%for update%'`;
        waiting=row.n;if(waiting===2) break;await setTimeout(20);
      }
      assert.equal(waiting,2);release();await blocker;const results=await pending;assert.equal(results.filter((r)=>r.status==='fulfilled').length,1);
      for(const result of results) if(result.status==='rejected') assert.ok(rejected('PUBLICATION_VERSION_CONFLICT')(result.reason));
    } finally {release();await Promise.allSettled([blocker,pending].filter((p)=>p!==undefined));}
    const [count]=await f.identity.sql`select count(*)::int as n from app.publication_version where product_id=${f.product.id}`;assert.equal(count.n,1);
  } finally {await f.close();}
});

test('publication discovery and committed retry respect both current draft and historical warehouse scope after actual role replacement',async()=>{
  const f=await setup();let otherWarehouse='';
  try{
    await f.prepare();await f.cost(50000,0);await f.assumptions();
    const staff=await actor(f.identity,'ecommerce_admin',[f.wh]);f.users.push(staff);const factor=await enroll(staff.browser,staff.password);
    const body={expected_version:2,expected_publication_version:0,reason:'Synthetic scoped publication'};const key=randomUUID();const published=await f.publish(staff,body,key);
    const [wh]=await f.identity.sql`insert into app.warehouse (name,city) values ('Synthetic Reassigned Publication','Surabaya') returning id`;otherWarehouse=wh.id;
    await f.catalogue(`/products/${f.product.id}`,{expected_version:2,reason:'Synthetic draft warehouse reassignment',variant_changes:[{
      operation:'update',variant_id:f.product.variants[0].id,update:{label:'Synthetic unit',attributes:[],offer_kind:'unit',weight_grams:100,length_mm:100,width_mm:100,height_mm:100,
        default_warehouse_id:wh.id,contents:[{stock_item_id:f.stock.id,name:f.stock.name,quantity:1}]}}]},'PATCH');
    const proof=await f.issue('staff_roles.replace',staff.id);
    const grant=f.owner.browser.request('/api/v1/admin/role-grants',{user_id:staff.id,roles:['ecommerce_admin'],warehouse_ids:[wh.id],permissions:[],expected_version:1,
      reason:'Synthetic publication current-scope change',reauthentication_proof:proof});grant.headers.set('idempotency-key',randomUUID());assert.equal((await handleAccess(grant,f.identity)).status,201);
    assert.equal((await staff.browser.auth('/sign-in/email',{email:staff.email,password:staff.password})).status,200);
    assert.equal((await staff.browser.auth('/two-factor/verify-totp',{code:totp(factor.totpURI)})).status,200);
    const state=await f.state(staff);assert.equal(state.latest_version,1);assert.equal(state.current,null);assert.equal(state.current_review_state,null);assert.equal(state.draft_version,3);
    await assert.rejects(f.publish(staff,body,key),rejected('NOT_FOUND'));
    assert.equal((await f.sale(published.id))?.publication_id,published.id,'A later editing draft does not silently replace approved live content');
  } finally {if(otherWarehouse) await f.identity.sql`update app.warehouse set active=false where id=${otherWarehouse}`;await f.close();}
});
