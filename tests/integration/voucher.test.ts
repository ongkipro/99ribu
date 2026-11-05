import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {handlePromotions} from '../../src/modules/promotions/routes.ts';
import {capability,commerceActor,prefix} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {checkoutFixture,CommerceClient} from './checkout-fixture.ts';
import {promotionFixture} from './promotion-fixture.ts';

// S177 stage 2A: a voucher is a code-gated shipping promotion. Marketing proposes, owner/admin decide; the quote
// applies a code with a stable reason when it cannot; the order reserves exactly the voucher the quote showed.
const unique=(prefix:string)=>`${prefix}-${randomUUID().slice(0,8)}`.toUpperCase();

test('marketing proposes vouchers, only owner/admin approve or reject; codes are unique and immutable; running terms are locked',async()=>{
 const f=await promotionFixture();
 try{
  const marketing=await actor(f.identity,'marketing',[]);f.users.push(marketing);await enroll(marketing.browser,marketing.password);
  const code=unique('hemat');
  const send=async(path:string,body:Record<string,unknown>,user=f.owner)=>{const response=await f.call(path,body,randomUUID(),user);return {status:response.status,body:await response.json()};};
  // Marketing cannot run anything: an active write is refused; an inactive one is a proposal.
  assert.equal((await send('',f.config({code}),marketing)).body.code,'PROMOTION_APPROVAL_REQUIRED');
  const proposal=await send('',f.config({code:` ${code.toLowerCase()} `,active:false}),marketing);
  assert.equal(proposal.status,201,JSON.stringify(proposal.body));assert.equal(proposal.body.code,code);assert.equal(proposal.body.proposed,true);assert.equal(proposal.body.active,false);assert.equal(proposal.body.has_run,false);
  assert.equal((await send('',f.config({code,active:false}),marketing)).body.code,'VOUCHER_CODE_TAKEN');
  assert.equal((await send(`/${proposal.body.id}/decisions`,{expected_version:1,decision:'approve',reason:'Synthetic'},marketing)).status,403);
  assert.equal((await send(`/${proposal.body.id}/decisions`,{expected_version:9,decision:'approve',reason:'Synthetic'})).body.code,'VERSION_CONFLICT');
  const approved=await send(`/${proposal.body.id}/decisions`,{expected_version:1,decision:'approve',reason:'Synthetic campaign approved'});
  assert.equal(approved.status,201,JSON.stringify(approved.body));assert.equal(approved.body.active,true);assert.equal(approved.body.proposed,false);assert.equal(approved.body.version,2);assert.equal(approved.body.has_run,true);
  assert.match(approved.body.reason,/^Disetujui: /);
  const [audit]=await f.identity.sql`select actor_id from app.audit_event where action='promotion.approve' and subject_id=${proposal.body.id}`;assert.equal(audit.actor_id,f.owner.id);
  assert.equal((await send(`/${proposal.body.id}/decisions`,{expected_version:2,decision:'reject',reason:'Synthetic'})).body.code,'PROPOSAL_REQUIRED');
  // A running voucher: marketing cannot touch it; owner may extend/raise/end but not change terms or the code.
  const running={...f.config({code}),starts_at:approved.body.starts_at,ends_at:approved.body.ends_at,expected_version:2};
  assert.equal((await send(`/${proposal.body.id}/versions`,{...running,active:false},marketing)).body.code,'PROMOTION_APPROVAL_REQUIRED');
  assert.equal((await send(`/${proposal.body.id}/versions`,{...running,value:5000,maximum_per_order:5000})).body.code,'VOUCHER_TERMS_LOCKED');
  assert.equal((await send(`/${proposal.body.id}/versions`,{...running,budget:1})).body.code,'VOUCHER_TERMS_LOCKED');
  assert.equal((await send(`/${proposal.body.id}/versions`,{...running,code:unique('lain')})).body.code,'VOUCHER_CODE_IMMUTABLE');
  const extended=await send(`/${proposal.body.id}/versions`,{...running,ends_at:new Date(Date.now()+172800000).toISOString(),budget:200000,reason:'Synthetic extension'});
  assert.equal(extended.status,201,JSON.stringify(extended.body));assert.equal(extended.body.code,code);
  // Stopping keeps the terms it ran with: no stop, edit, restart under the same code.
  const extendedTerms={...running,ends_at:extended.body.ends_at,budget:200000,expected_version:3};
  assert.equal((await send(`/${proposal.body.id}/versions`,{...extendedTerms,active:false,reason:'Synthetic stop'})).status,201);
  assert.equal((await send(`/${proposal.body.id}/versions`,{...extendedTerms,expected_version:4,active:false,value:9000,maximum_per_order:9000})).body.code,'VOUCHER_TERMS_LOCKED');
  assert.equal((await send(`/${proposal.body.id}/versions`,{...extendedTerms,expected_version:4,active:false,value:9000,maximum_per_order:9000},marketing)).body.code,'VOUCHER_TERMS_LOCKED');
  // Reject: the proposal stays inactive and is no longer pending.
  const second=await send('',f.config({code:unique('tolak'),active:false}),marketing);
  const rejected=await send(`/${second.body.id}/decisions`,{expected_version:1,decision:'reject',reason:'Synthetic: budget too high'});
  assert.equal(rejected.status,201);assert.equal(rejected.body.active,false);assert.equal(rejected.body.proposed,false);
  // Automatic promotions follow the same rule (no code): proposal first.
  const automatic=await send('',f.config({active:false}),marketing);assert.equal(automatic.body.code,null);assert.equal(automatic.body.proposed,true);
  // Roles outside promotions see nothing.
  const warehouse=await actor(f.identity,'warehouse',[f.wh]);f.users.push(warehouse);await enroll(warehouse.browser,warehouse.password);
  assert.equal((await f.call('',undefined,randomUUID(),warehouse)).status,403);
 }finally{await f.close();}
});

test('checkout applies a voucher code, explains every refusal, keeps the better benefit and the order reserves exactly the voucher',async()=>{
 const f=await checkoutFixture();const owned:{id:string;config:Record<string,unknown>}[]=[];
 const write=async(path:string,body:Record<string,unknown>)=>{const request=f.owner.browser.request(`/api/v1/admin/shipping-promotions${path}`,body);request.headers.set('idempotency-key',randomUUID());const response=await handlePromotions(request,f.identity);const payload=await response.json();assert.equal(response.status,201,JSON.stringify(payload));return payload;};
 try{
  // Every quote with a code counts against the per-address voucher bucket (S177); earlier runs share 127.0.0.1.
  await f.identity.sql`delete from app.auth_rate_limit where key like 'rl:voucher-code:%'`;
  // Start after every active fixture campaign so only the promotions created here can apply.
  const [window]=await f.identity.sql`select max(v.ends_at)::text ends from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision where v.active`;
  const target=Math.max(Date.now(),Date.parse(window.ends??new Date().toISOString()))+1000;let clock=await readFixtureClock('test',f.namespace);
  while(Date.parse(clock.now)<target) clock=await advanceFixtureClock('test',f.namespace,Math.min(31622400,Math.ceil((target-Date.parse(clock.now))/1000)),clock.version);
  const promo=async(overrides:Record<string,unknown>)=>{const config={expected_version:0,name:'SYNTHETIC voucher',active:true,starts_at:clock.now,ends_at:new Date(Date.parse(clock.now)+3600000).toISOString(),kind:'fixed',value:2000,maximum_per_order:2000,minimum_merchandise:1,budget:100000,per_buyer_limit:1,payment_methods:['prepaid','cod'],region_ids:[],service_ids:[],stacking:'exclusive',priority:10,reason:'Synthetic voucher',...overrides};const saved=await write('',config);owned.push({id:saved.id,config});return saved;};
  assert.equal((await f.client.call('/api/v1/carts',{})).response.status,401);
  const request=f.client.request('/api/v1/carts',{}),buyer=await commerceActor(request,f.identity);assert.ok(buyer?.kind==='guest');
  const created=await f.identity.sql.begin(tx=>createCart(tx,request,f.identity,buyer,{lines:[f.line('fixture-offer-shirt',2)]},{clock_namespace:f.namespace}));
  const p=await prefix(f.identity),token=await capability(f.identity,'cart',created.cart.id,buyer.id,created.cart.cap_issued_at as string);f.client.cookies.set(`${p}.cart_access:/`,{name:`${p}.cart_access`,value:`${created.cart.id}.${token}`,path:'/'});
  const contact=f.contact();
  const quote=async(voucher_code?:string,payment_method='prepaid')=>{const reply=await f.client.call('/api/v1/checkout/quotes',{cart_id:created.cart.id,address:f.address,contact,payment_method,...(voucher_code===undefined?{}:{voucher_code})},{version:1});assert.equal(reply.response.status,201,JSON.stringify(reply.payload));return reply.payload;};
  const code=unique('ongkir'),prepaid=unique('muka'),far=unique('jauh'),big=unique('besar'),later=unique('nanti');
  const courier=unique('kurir');await promo({code});await promo({code:prepaid,payment_methods:['prepaid']});await promo({code:far,region_ids:['test-elsewhere']});await promo({code:courier,service_ids:['no-such-service']});
  await promo({code:big,minimum_merchandise:9000000000});
  await promo({code:later,starts_at:new Date(Date.parse(clock.now)+600000).toISOString()});
  // A proposal (inactive) answers like an unknown code.
  const proposal=unique('usul');owned.push({id:(await write('',{expected_version:0,name:'SYNTHETIC proposal',active:false,starts_at:clock.now,ends_at:new Date(Date.parse(clock.now)+3600000).toISOString(),kind:'fixed',value:2000,maximum_per_order:2000,minimum_merchandise:1,budget:100000,per_buyer_limit:1,payment_methods:['prepaid'],region_ids:[],service_ids:[],stacking:'exclusive',priority:10,reason:'Synthetic',code:proposal})).id,config:{}});
  assert.equal((await quote()).voucher,null);
  for(const [typed,reason] of [[unique('tidakada'),'NOT_FOUND'],[proposal,'NOT_FOUND'],[far,'DESTINATION_NOT_ELIGIBLE'],[courier,'SHIPPING_METHOD_NOT_ELIGIBLE'],[later,'NOT_STARTED']] as const){
   const q=await quote(typed);assert.deepEqual({status:q.voucher.status,reason:q.voucher.reason,subsidy:q.subsidy_total},{status:'refused',reason,subsidy:0},typed);
  }
  const short=await quote(big);assert.equal(short.voucher.reason,'MIN_SUBTOTAL');assert.equal(short.voucher.minimum_merchandise,9000000000);
  const cod=await quote(prepaid,'cod');assert.equal(cod.voucher.reason,'METHOD_NOT_ELIGIBLE');assert.deepEqual(cod.voucher.payment_methods,['prepaid']);
  assert.equal((await f.client.call('/api/v1/checkout/quotes',{cart_id:created.cart.id,address:f.address,contact,payment_method:'prepaid',voucher_code:'x'},{version:1})).response.status,400);
  // Applied: typed in lower case, normalized; the voucher is the quote's only promotion.
  const applied=await quote(code.toLowerCase());
  assert.deepEqual({status:applied.voucher.status,code:applied.voucher.code,amount:applied.voucher.amount,subsidy:applied.subsidy_total},{status:'applied',code,amount:2000,subsidy:2000});
  // An automatic campaign that saves more wins (no stacking); a bigger voucher replaces it.
  const auto=await promo({name:'SYNTHETIC automatic',value:3000,maximum_per_order:3000,per_buyer_limit:10,stacking:'allowed'});
  const weaker=await quote(code);assert.deepEqual({reason:weaker.voucher.reason,subsidy:weaker.subsidy_total},{reason:'STACKING_CONFLICT',subsidy:3000});
  const strong=unique('kuat');await promo({code:strong,value:4000,maximum_per_order:4000});
  const best=await quote(strong);assert.deepEqual({status:best.voucher.status,subsidy:best.subsidy_total},{status:'applied',subsidy:4000});
  // The order reserves exactly that voucher; the same WhatsApp number then meets the per-buyer limit.
  // A courier re-selection keeps the applied voucher.
  const reselected=await f.client.call(`/api/v1/checkout/quotes/${best.id}/selection`,{packages:best.packages.map((p:{id:string;selected_option_id:string})=>({package_id:p.id,shipping_option_id:p.selected_option_id}))},{version:1});
  assert.equal(reselected.response.status,201,JSON.stringify(reselected.payload));assert.deepEqual({status:reselected.payload.voucher.status,code:reselected.payload.voucher.code,subsidy:reselected.payload.subsidy_total},{status:'applied',code:strong,subsidy:4000});
  // A voucher changed after the quote (new version) is never ordered on the old terms.
  const strongRow=owned.at(-1) as {id:string;config:Record<string,unknown>};
  await write(`/${strongRow.id}/versions`,{...strongRow.config,expected_version:1,ends_at:new Date(Date.parse(clock.now)+7200000).toISOString(),reason:'Synthetic extension after quote'});
  const stale=await f.client.call('/api/v1/orders',{quote_id:reselected.payload.id},{version:1});assert.equal(stale.payload.code,'PROMOTION_REVIEW_REQUIRED');
  const fresh=await quote(strong);assert.equal(fresh.voucher.status,'applied');
  const order=await f.client.call('/api/v1/orders',{quote_id:fresh.id},{version:1});assert.equal(order.response.status,201,JSON.stringify(order.payload));
  const [held]=await f.identity.sql`select a.promotion_id,a.amount::int amount from app.commerce_order o join app.promotion_allocation a on a.reservation_id=o.promotion_reservation_id where o.id=${order.payload.order.id}`;
  const [voucherRow]=await f.identity.sql`select id from app.promotion where code=${strong}`;assert.deepEqual(held,{promotion_id:voucherRow.id,amount:4000});
  void auto;
 }finally{
  for(const {id} of owned){const [current]=await f.identity.sql`select v.*,p.code from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision where p.id=${id}`;
   if(!current.active)continue;
   await write(`/${id}/versions`,{expected_version:current.revision,name:current.name,active:false,starts_at:new Date(current.starts_at).toISOString(),ends_at:new Date(current.ends_at).toISOString(),kind:current.kind,value:Number(current.value),maximum_per_order:Number(current.maximum_per_order),minimum_merchandise:Number(current.minimum_merchandise),budget:Number(current.budget),per_buyer_limit:current.per_buyer_limit,payment_methods:current.payment_methods,region_ids:current.region_ids,service_ids:current.service_ids,stacking:current.stacking,priority:current.priority,reason:'Synthetic voucher scenario finished',code:current.code}).catch(()=>{});}
  await f.close();
 }
});

test('two buyers ordering with the last voucher budget at once: exactly one order holds it, the other is refused',async()=>{
 const f=await checkoutFixture();let voucherId='';let config:Record<string,unknown>={};
 const write=async(path:string,body:Record<string,unknown>)=>{const request=f.owner.browser.request(`/api/v1/admin/shipping-promotions${path}`,body);request.headers.set('idempotency-key',randomUUID());const response=await handlePromotions(request,f.identity);const payload=await response.json();assert.equal(response.status,201,JSON.stringify(payload));return payload;};
 try{
  const [window]=await f.identity.sql`select max(v.ends_at)::text ends from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision where v.active`;
  const target=Math.max(Date.now(),Date.parse(window.ends??new Date().toISOString()))+1000;let clock=await readFixtureClock('test',f.namespace);
  while(Date.parse(clock.now)<target) clock=await advanceFixtureClock('test',f.namespace,Math.min(31622400,Math.ceil((target-Date.parse(clock.now))/1000)),clock.version);
  await f.identity.sql`delete from app.auth_rate_limit where key like 'rl:voucher-code:%'`;
  const code=unique('terakhir');
  // Budget for exactly one use.
  config={expected_version:0,name:'SYNTHETIC last quota',active:true,starts_at:clock.now,ends_at:new Date(Date.parse(clock.now)+3600000).toISOString(),kind:'fixed',value:2000,maximum_per_order:2000,minimum_merchandise:1,budget:2000,per_buyer_limit:1,payment_methods:['prepaid','cod'],region_ids:[],service_ids:[],stacking:'exclusive',priority:10,reason:'Synthetic race',code};
  voucherId=(await write('',config)).id;
  const buyer=async()=>{
   const client=new CommerceClient(f.identity);assert.equal((await client.call('/api/v1/carts',{})).response.status,401);
   const request=client.request('/api/v1/carts',{}),guest=await commerceActor(request,f.identity);assert.ok(guest?.kind==='guest');
   const created=await f.identity.sql.begin(tx=>createCart(tx,request,f.identity,guest,{lines:[f.line('fixture-offer-shirt',1)]},{clock_namespace:f.namespace}));
   const p=await prefix(f.identity),token=await capability(f.identity,'cart',created.cart.id,guest.id,created.cart.cap_issued_at as string);client.cookies.set(`${p}.cart_access:/`,{name:`${p}.cart_access`,value:`${created.cart.id}.${token}`,path:'/'});
   const quote=await client.call('/api/v1/checkout/quotes',{cart_id:created.cart.id,address:f.address,contact:f.contact(),payment_method:'prepaid',voucher_code:code},{version:1});
   assert.equal(quote.payload.voucher?.status,'applied',JSON.stringify(quote.payload));return {client,quote:quote.payload};
  };
  const [a,b]=[await buyer(),await buyer()];
  const results=await Promise.all([a,b].map(x=>x.client.call('/api/v1/orders',{quote_id:x.quote.id},{version:1})));
  const statuses=results.map(r=>r.response.status).sort();
  assert.deepEqual(statuses,[201,409],JSON.stringify(results.map(r=>r.payload)));
  assert.equal(results.find(r=>r.response.status===409)?.payload.code,'PROMOTION_BUDGET_EXHAUSTED');
  const [head]=await f.identity.sql`select reserved_amount::int reserved,committed_amount::int committed from app.promotion where id=${voucherId}`;assert.equal(head.reserved+head.committed,2000);
 }finally{
  if(voucherId)await write(`/${voucherId}/versions`,{...config,expected_version:1,active:false,reason:'Synthetic race finished'}).catch(()=>{});
  await f.close();
 }
});
