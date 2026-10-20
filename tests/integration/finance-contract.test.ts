import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {createLocalAuth} from "../../src/modules/access/auth.ts";
import {handleAccess} from "../../src/modules/access/routes.ts";
import {handleCatalog} from "../../src/modules/catalog/routes.ts";
import {handleFinance} from "../../src/modules/finance/routes.ts";
import {handleInventory} from "../../src/modules/inventory/routes.ts";
import {actor,BrowserSession,cleanup,enroll} from "../contract/access-fixture.ts";
import {type Exchange,validateExchanges} from "../contract/openapi-probe.ts";

test('seven finance/publication operations validate actual MFA cookie requests, safe DTOs, denial and committed replay against OpenAPI',async()=>{
  const identity=createLocalAuth('test');const users:Awaited<ReturnType<typeof actor>>[]=[];const samples:Exchange[]=[];let warehouseId='';
  const req=(user:{browser:BrowserSession},path:string,body?:Record<string,unknown>,key:string=randomUUID())=>{
    const request=user.browser.request(`/api/v1/admin${path}`,body);request.headers.set('idempotency-key',key);return request;
  };
  const observe=async(request:Request,expected:number,valid?:boolean)=>{
    const body=request.body?await request.clone().text():undefined;
    const response=await (new URL(request.url).pathname.endsWith('/publications')?handleCatalog:handleFinance)(request,identity);
    const payload=await response.json();assert.equal(response.status,expected,JSON.stringify(payload));
    samples.push({url:request.url,method:request.method,request_headers:Object.fromEntries([...request.headers].filter(([key])=>['content-type','idempotency-key'].includes(key))),
      request_body:body,body_bytes:body?Buffer.byteLength(body):undefined,request_valid:valid,status:response.status,headers:Object.fromEntries(response.headers),payload});return payload;
  };
  try{
    const dummy=randomUUID();const guest={browser:new BrowserSession(identity)};
    for(const path of [`/stock-items/${dummy}/cost-versions`,`/offers/${dummy}/cost-assumption-versions`,`/products/${dummy}/contribution-reviews`,`/products/${dummy}/publications`]) await observe(req(guest,path),401);
    for(const path of [`/stock-items/${dummy}/cost-versions`,`/offers/${dummy}/cost-assumption-versions`,`/products/${dummy}/publications`]) await observe(req(guest,path,{}),401);
    const owner=await actor(identity,'owner',[]);users.push(owner);await enroll(owner.browser,owner.password);
    let response=await owner.browser.access('/admin/policy-versions?kind=commercial');assert.equal(response.status,200);let policy=await response.json();
    if(policy.latest_version===0){
      const proofRequest=owner.browser.request('/api/v1/me/reauthentication-proofs',{password:owner.password,action:'company_policy.version',subject_id:'company-commercial'});proofRequest.headers.set('idempotency-key',randomUUID());
      const proof=await handleAccess(proofRequest,identity);assert.equal(proof.status,201);
      const baseline=owner.browser.request('/api/v1/admin/policy-versions',{kind:'commercial',warehouse_id:null,expected_version:0,effective_at:null,
        values:{default_commission_bps:1000,minimum_payout_idr:99000},reason:'Synthetic explicit contract baseline',reauthentication_proof:(await proof.json()).proof});baseline.headers.set('idempotency-key',randomUUID());
      assert.equal((await handleAccess(baseline,identity)).status,201);response=await owner.browser.access('/admin/policy-versions?kind=commercial');policy=await response.json();
    }
    assert.ok(policy.current,'An actual current commercial policy is required.');
    const catalog=async(path:string,body:Record<string,unknown>)=>{const response=await handleCatalog(req(owner,path,body),identity);assert.equal(response.status,201);return response.json();};
    const [wh]=await identity.sql`insert into app.warehouse (name,city) values ('Synthetic Finance Contract','Malang') returning id`;warehouseId=wh.id;
    const stock=await catalog('/stock-items',{name:'Synthetic finance contract component',sku:`FC-${randomUUID()}`.toUpperCase()});
    const category=await catalog('/categories',{name:'Synthetic contract category',slug:`synthetic-${randomUUID()}`,parent_id:null,attribute_definitions:[]});
    const product=await catalog('/products',{name:'Synthetic contract offer',description:'Synthetic complete contract description',category_id:category.id,
      images:[{url:'https://example.invalid/synthetic.webp',alt:'Synthetic fixture',width:100,height:100}],variants:[{sku:`FC-${randomUUID()}`.toUpperCase(),label:'Synthetic unit',attributes:[],offer_kind:'unit',
        weight_grams:100,length_mm:100,width_mm:100,height_mm:100,default_warehouse_id:wh.id,contents:[{stock_item_id:stock.id,name:stock.name,quantity:1}]}]});
    assert.equal((await handleInventory(req(owner,'/inventory/movements',{warehouse_id:wh.id,stock_item_id:stock.id,kind:'receive',quantity:5,expected_version:0,reason:'Synthetic contract stock'}),identity)).status,201);
    const costPath=`/stock-items/${stock.id}/cost-versions`;const assumptionPath=`/offers/${product.variants[0].id}/cost-assumption-versions`;const publicationPath=`/products/${product.id}/publications`;
    const body={unit_cost:null,expected_version:0,effective_from:null,source:'Synthetic supplier reference',reason:'Synthetic unknown HPP'};
    for(const input of [{...body,unit_cost:-1},{...body,profit:99000},{...body,effective_from:'2026-02-30T00:00:00.000Z'}]) await observe(req(owner,costPath,input),400,false);
    const missingKey=req(owner,costPath,body);missingKey.headers.delete('idempotency-key');await observe(missingKey,400,false);
    const media=req(owner,costPath,body);media.headers.set('content-type','text/plain');await observe(media,415,false);
    await observe(req(owner,costPath,{...body,source:'x'.repeat(17000)}),413,false);
    const key=randomUUID();const saved=await observe(req(owner,costPath,body,key),201,true);assert.equal(saved.unit_cost,null);
    assert.deepEqual(await observe(req(owner,costPath,body,key),201,true),saved);await observe(req(owner,costPath,{...body,unit_cost:0},key),409,true);
    const unknown=await observe(req(owner,costPath),200,true);assert.equal(unknown.current.unit_cost,null);assert.equal(unknown.latest_version,1);
    const blocked=await observe(req(owner,publicationPath),200,true);assert.equal(blocked.ready,false);assert.ok(blocked.blockers.some((b:{code:string})=>b.code==='UNKNOWN_HPP'));
    const incomplete=await observe(req(owner,`/products/${product.id}/contribution-reviews`),200,true);
    assert.equal(incomplete.offers[0].estimated_hpp,null);assert.equal(incomplete.offers[0].estimated_contribution,null);assert.equal(incomplete.offers[0].complete,false);
    await observe(req(owner,publicationPath,{expected_version:1,expected_publication_version:0,reason:'Cannot silently publish unknown cost'}),422,true);
    await observe(req(owner,costPath,{...body,unit_cost:50000,expected_version:1}),201,true);
    const assumptions={expected_version:0,effective_from:null,packaging_idr:2000,provider_fee_idr:1000,subsidy_idr:5000,returns_reserve_idr:1000,source:'Synthetic conservative estimates',reason:'Synthetic complete assumptions'};
    await observe(req(owner,assumptionPath,assumptions),201,true);const profiles=await observe(req(owner,assumptionPath),200,true);assert.equal(profiles.current.packaging_idr,2000);
    const contribution=await observe(req(owner,`/products/${product.id}/contribution-reviews`),200,true);assert.equal(contribution.offers[0].estimated_hpp,50000);assert.equal(contribution.offers[0].complete,true);
    const publicationBody={expected_version:1,expected_publication_version:0,reason:'Synthetic authorized contract publication'};const publicationKey=randomUUID();
    const published=await observe(req(owner,publicationPath,publicationBody,publicationKey),201,true);assert.equal(published.exception_applied,false);
    assert.deepEqual(await observe(req(owner,publicationPath,publicationBody,publicationKey),201,true),published);
    const state=await observe(req(owner,publicationPath),200,true);assert.equal(state.current.id,published.id);assert.equal(state.ready,true);
    await observe(req(owner,publicationPath,publicationBody),409,true);
    await observe(req(owner,`${costPath}?limit=1&limit=2`),400,false);await observe(req(owner,`${costPath}?cursor=2147483648`),400,false);
    await observe(req(owner,`${publicationPath}?as_of=2030`),400,false);
    const mixed=req(owner,costPath);mixed.headers.set('x-order-token','synthetic-unsupported');await observe(mixed,401);
    const finance=await actor(identity,'finance',[]);users.push(finance);await enroll(finance.browser,finance.password);
    await observe(req(finance,costPath),403,true);await observe(req(finance,publicationPath),403,true);
    validateExchanges(samples.filter((s)=>!s.url.includes('/publications')),'finance');
    validateExchanges(samples.filter((s)=>s.url.includes('/publications')),'publication');
  } finally {await cleanup(identity,users);if(warehouseId) await identity.sql`update app.warehouse set active=false where id=${warehouseId}`;await identity.sql.end();}
});
