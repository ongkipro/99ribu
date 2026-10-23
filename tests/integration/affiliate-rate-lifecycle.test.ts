import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {appendAffiliateRate,readEffectiveAffiliateRate} from '../../src/modules/affiliates/rates.ts';
import {bootstrapGuest,capability,commerceActor,prefix,setCookie} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {createQuote} from '../../src/modules/checkout/quotes.ts';
import {submitOrder} from '../../src/modules/checkout/orders.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {CommerceClient} from './checkout-fixture.ts';
import {closeFulfillmentActor} from './fulfillment-fixture.ts';
import {shippingFixture} from './shipping-fixture.ts';

// Installed schema and application-role transactions; no DDL or outer rollback.
test('app-role effective affiliate versions govern quote cost and preserve committed order recovery',async()=>{
 const f=await shippingFixture(),affiliate=await actor(f.identity,'affiliate',[]),rateOwner=await actor(f.identity,'owner',[]),sql=f.identity.sql,tx=sql,identity=f.identity;let stage='installed app-role precondition';
 try{
  await enroll(rateOwner.browser,rateOwner.password);
  const ratePrincipal=await getPrincipal(rateOwner.browser.request('/api/v1/me'),identity);
  assert.equal((await sql`select current_user actor`)[0].actor,'99ribu_test_app');
  assert.notEqual((await sql`select to_regclass('app.affiliate_account') installed`)[0].installed,null);
   const [account]=await tx`insert into app.affiliate_account (user_id) values (${affiliate.id}) returning id`;
   const rate=async(expected:number,basisPoints:number)=>{
    const proofRequest=rateOwner.browser.request('/api/v1/me/reauthentication-proofs',{password:rateOwner.password,action:'affiliate_rate.version',subject_id:account.id});proofRequest.headers.set('idempotency-key',randomUUID());
    const proofResponse=await handleAccess(proofRequest,identity);assert.equal(proofResponse.status,201);const proof=String((await proofResponse.json()).proof);
    const body={basis_points:basisPoints,effective_at:null,expected_version:expected,reason:'SYNTHETIC prospective actual affiliate rate',reauthentication_proof:proof},request=rateOwner.browser.request(`/api/v1/admin/affiliates/${account.id}/rates`,body);request.headers.set('idempotency-key',randomUUID());
    const result=await appendAffiliateRate(request,identity,ratePrincipal,account.id,body) as {id:string;version:number;basis_points:number};
    assert.deepEqual(await appendAffiliateRate(request,identity,ratePrincipal,account.id,body),result);return result;
   };
   stage='fresh owner/proof/CAS appends one actual zero-rate version and current default fallback';
   const first=await rate(0,0);assert.equal(first.version,1);
   const [now]=await tx`select date_trunc('milliseconds',clock_timestamp()) now`;
   const effective=await sql.begin(inner=>readEffectiveAffiliateRate(inner,account.id,new Date(now.now).toISOString()));assert.equal(effective.rate_version_id,first.id);assert.equal(effective.commission_idr,0);
   const fallback=await sql.begin(inner=>readEffectiveAffiliateRate(inner,null,new Date(now.now).toISOString()));assert.equal(fallback.rate_version_id,null);assert.ok('default_commission_bps'in fallback.policy.values);assert.equal(fallback.basis_points,fallback.policy.values.default_commission_bps);
   const client=new CommerceClient(identity),response=new Response(null);await bootstrapGuest(identity, response, new Request("http://127.0.0.1:3099/api/v1/carts", { method: "POST" }));client.absorb(response);
   const buyer=await commerceActor(client.request('/api/v1/carts'),identity);assert.ok(buyer);
   const line=f.line('fixture-offer-shirt');
   const quote=async()=>{
    const request=client.request('/api/v1/carts',{}),created=await sql.begin(inner=>createCart(inner,request,identity,buyer,{lines:[{variant_id:line.offer_id,quantity:1,expected_publication_id:line.publication_id}]},{clock_namespace:f.namespace}));
    const token=await capability(identity,'cart',created.cart.id,buyer.id,created.cart.cap_issued_at as string),cookies=new Response(null);setCookie(cookies,`${await prefix(identity)}.cart_access`,`${created.cart.id}.${token}`);client.absorb(cookies);
    const input={cart_id:created.cart.id,address:{recipient_name:'SYNTHETIC rate buyer',phone:'+6281200000000',address_line:'SYNTHETIC rate address',destination_id:'test-malang',postal_code:'00001'},contact:{phone:'+6281200000000'},payment_method:'prepaid'};
    const result=await sql.begin(inner=>createQuote(inner,client.request('/api/v1/checkout/quotes',input,{version:1}),identity,buyer,input,{affiliate_id:account.id})) as {id:string};
    return {id:result.id,cart_id:created.cart.id,token};
   };
   stage='actual attributed quote and order preserve private zero-rate costs and unchanged buyer price';
   const frozen=await quote(),body={quote_id:frozen.id},request=client.request('/api/v1/orders',body,{version:1}),submitted=await sql.begin(inner=>submitOrder(inner,request,identity,buyer,body));
   assert.equal(submitted.order.merchandise_amount,'99000');
   const [saved]=await tx`select document from app.checkout_quote where id=${frozen.id}`;assert.equal(saved.document.affiliate_id,account.id);assert.equal(saved.document.financial_sources[0].rate_version_id,first.id);assert.equal(saved.document.financial_sources[0].commission_idr,0);
   assert.ok(!JSON.stringify(submitted.response).includes('commission_bps'));assert.ok(!JSON.stringify(submitted.response).includes('affiliate_id'));
   stage='later version invalidates an unsubmitted quote without rewriting committed order recovery';
   const stale=await quote(),second=await rate(1,100);assert.equal(second.version,2);
   await assert.rejects(sql.begin(inner=>submitOrder(inner,client.request('/api/v1/orders',{quote_id:stale.id},{version:1}),identity,buyer,{quote_id:stale.id})),{code:'FINANCIAL_REVIEW_REQUIRED'});
   assert.equal((await tx`select count(*)::int n from app.commerce_order where cart_id=${stale.cart_id}`)[0].n,0);
   const cookies=new Response(null);setCookie(cookies,`${await prefix(identity)}.cart_access`,`${frozen.cart_id}.${frozen.token}`);client.absorb(cookies);
   const recovered=await sql.begin(inner=>submitOrder(inner,request,identity,buyer,body));assert.deepEqual(recovered.response,submitted.response);
   assert.deepEqual((await tx`select document from app.checkout_quote where id=${frozen.id}`)[0].document,saved.document);
   stage='native cost seal independently refuses the stale override before ordinary quote operation sealing';
   await assert.rejects(sql.begin(inner=>inner`insert into app.checkout_quote (cart_id,cart_revision,operation_id,document,payment_method,merchandise_amount,shipping_amount,subsidy_amount,buyer_total,created_at,expires_at)
    select cart_id,cart_revision,gen_random_uuid(),document,payment_method,merchandise_amount,shipping_amount,subsidy_amount,buyer_total,created_at,expires_at from app.checkout_quote where id=${stale.id}`),error=>!!error&&typeof error==='object'&&'code'in error&&error.code==='23514'&&error instanceof Error&&error.message.startsWith('Attributed checkout freezes independently derived'));
   stage='actual higher commission cannot borrow an older owner exception or charge the buyer more';
   const third=await rate(2,10000);assert.equal(third.version,3);
   await assert.rejects(quote(),{code:'AFFILIATE_CONTRIBUTION_REVIEW_REQUIRED'});
   assert.equal((await tx`select count(*)::int n from app.affiliate_rate_version where affiliate_id=${account.id}`)[0].n,3);
   await assert.rejects(sql.begin(inner=>inner`update app.affiliate_rate_version set basis_points=0 where id=${second.id}`),{code:'23514'});
 }catch(error){const code=error&&typeof error==='object'&&'code'in error?String(error.code):'ASSERTION';throw new Error(`Rate lifecycle stage ${stage}; safe code ${code}; ${error instanceof Error?error.message.slice(0,300):'unknown failure'}`);
 }finally{try{await closeFulfillmentActor(f.identity,rateOwner);await closeFulfillmentActor(f.identity,affiliate);}finally{await f.close();}}
});
