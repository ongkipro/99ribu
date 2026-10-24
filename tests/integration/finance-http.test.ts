import {resetBrowserAuthLimits} from './storefront-http-fixture.ts';
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import test from "node:test";
import {chromium} from "@playwright/test";
import {connectDatabase} from "../../src/db/client.ts";
import {type Exchange,validateExchanges} from "../contract/openapi-probe.ts";
import {totp} from "./totp-fixture.ts";
import {activateOverHttp} from './http-activation.ts';

test('built finance/publication APIs enforce real browser MFA cookies, private cost schemas and product-bound owner exception',async()=>{
 await resetBrowserAuthLimits();
  const {sql}=connectDatabase('local');const email=`finance-browser-${randomUUID()}@example.invalid`;const password=randomBytes(24).toString('base64url');
  let userId='';let warehouseId='';const samples:Exchange[]=[];
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  try{
    const context=await browser.newContext();const page=await context.newPage();assert.equal((await page.goto('http://127.0.0.1:3099'))?.status(),200);
    // Only isolated loopback synthetic auth buckets; production limits stay on.
    const paths=['/sign-up/email','/sign-in/email','/two-factor/enable','/two-factor/verify-totp'];
    await sql`delete from app.auth_rate_limit where key in ${sql(paths.map((p)=>`127.0.0.1|${p}`))}`;
    const call=async(path:string,body?:Record<string,unknown>,headers:Record<string,string>={})=>{
      const result=await page.evaluate(async({path,body,headers})=>{
        const response=await fetch(path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
        return {status:response.status,payload:await response.json(),headers:Object.fromEntries(response.headers)};
      },{path,body,headers});
      if(/\/(cost-versions|cost-assumption-versions|contribution-reviews|publications)(?:\?|$)/.test(path)) samples.push({url:`http://127.0.0.1:3099${path}`,method:body?'POST':'GET',
        request_headers:{'content-type':'application/json',...headers},request_body:body?JSON.stringify(body):undefined,body_bytes:body?Buffer.byteLength(JSON.stringify(body)):undefined,...result});
      return result;
    };
    const root='/api/v1/admin';const dummy=randomUUID();const key=()=>({'idempotency-key':randomUUID()});
    for(const path of [`/stock-items/${dummy}/cost-versions`,`/offers/${dummy}/cost-assumption-versions`,`/products/${dummy}/contribution-reviews`,`/products/${dummy}/publications`]) assert.equal((await call(root+path)).status,401);
    for(const path of [`/stock-items/${dummy}/cost-versions`,`/offers/${dummy}/cost-assumption-versions`,`/products/${dummy}/publications`]) assert.equal((await call(root+path,{},key())).status,401);
    assert.equal((await call('/api/auth/sign-up/email',{name:'Synthetic Finance Browser Owner',email})).status,200);
    const [user]=await sql`select id from app.auth_user where email=${email}`;userId=user.id;
    await activateOverHttp(sql,context.request,email,password);
    await sql`insert into app.role_grant (user_id,roles) values (${userId},ARRAY['owner']::text[])`;
    assert.equal((await call('/api/auth/sign-in/email',{email,password})).status,200);
    assert.equal((await call(`${root}/stock-items/${dummy}/cost-versions`)).status,403);
    const factor=await call('/api/auth/two-factor/enable',{password});assert.equal(factor.status,200);
    assert.equal((await call('/api/auth/two-factor/verify-totp',{code:totp(factor.payload.totpURI)})).status,200);
    let history=await call(`${root}/policy-versions?kind=commercial`);assert.equal(history.status,200);
    if(history.payload.latest_version===0){
      const proof=await call('/api/v1/me/reauthentication-proofs',{password,action:'company_policy.version',subject_id:'company-commercial'},key());assert.equal(proof.status,201);
      assert.equal((await call(`${root}/policy-versions`,{kind:'commercial',warehouse_id:null,expected_version:0,effective_at:null,values:{default_commission_bps:1000,minimum_payout_idr:99000},reason:'Synthetic explicit browser baseline',reauthentication_proof:proof.payload.proof},key())).status,201);
      history=await call(`${root}/policy-versions?kind=commercial`);
    }
    assert.ok(history.payload.current,'A current owner-configured commercial policy is required.');
    const [wh]=await sql`insert into app.warehouse (name,city) values ('Synthetic Finance Browser','Malang') returning id`;warehouseId=wh.id;
    const stock=await call(`${root}/stock-items`,{sku:`FB-${randomUUID()}`.toUpperCase(),name:'Synthetic finance browser component'},key());assert.equal(stock.status,201);
    const category=await call(`${root}/categories`,{name:'Synthetic finance browser category',slug:`synthetic-${randomUUID()}`,parent_id:null,attribute_definitions:[]},key());assert.equal(category.status,201);
    const product=await call(`${root}/products`,{name:'Synthetic finance browser offer',description:'Synthetic complete browser fixture',images:[{url:'https://example.invalid/synthetic.webp',alt:'Synthetic fixture',width:100,height:100}],category_id:category.payload.id,variants:[{
      sku:`FB-${randomUUID()}`.toUpperCase(),label:'Synthetic unit',attributes:[],offer_kind:'unit',weight_grams:100,length_mm:100,width_mm:100,height_mm:100,default_warehouse_id:warehouseId,
      contents:[{stock_item_id:stock.payload.id,name:stock.payload.name,quantity:1}]}]},key());assert.equal(product.status,201);
    assert.equal((await call(`${root}/inventory/movements`,{warehouse_id:warehouseId,stock_item_id:stock.payload.id,kind:'receive',quantity:3,expected_version:0,reason:'Synthetic finance browser stock'},key())).status,201);
    const costPath=`${root}/stock-items/${stock.payload.id}/cost-versions`;const assumptionPath=`${root}/offers/${product.payload.variants[0].id}/cost-assumption-versions`;const publicationPath=`${root}/products/${product.payload.id}/publications`;
    const cost={unit_cost:50000,expected_version:0,effective_from:null,source:'Synthetic supplier reference',reason:'Synthetic browser HPP'};const costKey=key();
    const saved=await call(costPath,cost,costKey);assert.equal(saved.status,201);assert.deepEqual((await call(costPath,cost,costKey)).payload,saved.payload);
    assert.equal((await call(costPath)).payload.current.unit_cost,50000);
    assert.equal((await call(assumptionPath,{expected_version:0,effective_from:null,packaging_idr:2000,provider_fee_idr:1000,subsidy_idr:5000,returns_reserve_idr:1000,source:'Synthetic conservative estimates',reason:'Synthetic browser assumptions'},key())).status,201);
    assert.equal((await call(assumptionPath)).status,200);
    const estimate=await call(`${root}/products/${product.payload.id}/contribution-reviews`);assert.equal(estimate.status,200);assert.equal(estimate.payload.offers[0].estimated_hpp,50000);
    assert.equal((await call(publicationPath)).payload.ready,true);
    const publicationBody={expected_version:1,expected_publication_version:0,reason:'Synthetic browser publication'};const publicationKey=key();
    const published=await call(publicationPath,publicationBody,publicationKey);assert.equal(published.status,201);
    assert.deepEqual((await call(publicationPath,publicationBody,publicationKey)).payload,published.payload);
    assert.equal((await call(publicationPath)).payload.current.id,published.payload.id);
    assert.equal((await call(costPath,{...cost,expected_version:1,unit_cost:null},key())).status,201);
    const changed=await call(publicationPath);assert.equal(changed.payload.current_review_state,'requires_review');assert.equal(changed.payload.ready,false);
    const unknownEstimate=await call(`${root}/products/${product.payload.id}/contribution-reviews`);assert.equal(unknownEstimate.status,200);
    assert.equal(unknownEstimate.payload.offers[0].estimated_hpp,null);assert.equal(unknownEstimate.payload.offers[0].estimated_contribution,null);
    const proof=await call('/api/v1/me/reauthentication-proofs',{password,action:'catalog_publication.exception',subject_id:product.payload.id},key());assert.equal(proof.status,201);
    const exception={...publicationBody,expected_publication_version:1,exception:{reason:'Synthetic explicit owner unknown-cost exception',reauthentication_proof:proof.payload.proof}};
    const approved=await call(publicationPath,exception,key());assert.equal(approved.status,201);assert.equal(approved.payload.exception_applied,true);
    const current=await call(publicationPath);assert.equal(current.payload.current.id,approved.payload.id);assert.equal(current.payload.current.exception_applied,true);assert.equal(current.payload.ready,false);
    assert.equal((await call(costPath,undefined,{authorization:'Bearer synthetic-unsupported'})).status,401);
    assert.ok(!(await page.evaluate(()=>document.cookie)).includes('session_token'));
    assert.equal((await call('/api/auth/sign-out',{})).status,200);assert.equal((await call(costPath)).status,401);
    validateExchanges(samples.filter((s)=>!s.url.includes('/publications')),'finance');validateExchanges(samples.filter((s)=>s.url.includes('/publications')),'publication');
  } finally {
    await browser.close();
    await sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
    await sql`delete from app.local_delivery where recipient=${email}`;
    if(userId){await sql`delete from app.auth_verification where value=${userId}`;await sql`delete from app.access_operation where actor_id=${userId}`;await sql`delete from app.auth_rate_limit where key=${`access-proof:${userId}`}`;await sql`delete from app.auth_user where id=${userId}`;}
    if(warehouseId) await sql`update app.warehouse set active=false where id=${warehouseId}`;await sql.end();
  }
});
