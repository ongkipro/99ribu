import assert from 'node:assert/strict';
import test from 'node:test';
import {actorScope,commerceActor} from '../../src/modules/checkout/access.ts';
import {initialCartIntent,mutateBrowserCart,readBrowserCart,type CartIntent} from '../../src/modules/storefront/cart.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {actor} from '../contract/access-fixture.ts';
import {checkoutFixture,CommerceClient} from './checkout-fixture.ts';

type Fixture=Awaited<ReturnType<typeof checkoutFixture>>;
const intent=(f:Fixture,offer='fixture-offer-shirt')=>{const publication=f.seeded.publications[offer].id;assert.ok(publication);return initialCartIntent({product:f.seeded.products[offer],variant:f.seeded.offers[offer],publication});};
const mutate=(f:Fixture,input:CartIntent,headers:Record<string,string>={})=>mutateBrowserCart(f.client.request('/cart',{}, {headers}),f.identity,input);
function absorb(client:CommerceClient,cookies:string[]){const response=new Response();for(const cookie of cookies)response.headers.append('set-cookie',cookie);client.absorb(response);}

test('acknowledged guest plus stable empty-cart initialization recovers lost creation and add acknowledgement once',async()=>{
 const f=await checkoutFixture();try{
  const curated=await prepareStorefront(f.request(),f.identity,'test',f.namespace,f.seeded),bundle=curated.products['shirt-cream'];assert.ok(bundle.publication_id);
  const input=initialCartIntent({product:bundle.id,variant:bundle.offer_id,publication:bundle.publication_id}),bootstrap=await mutate(f,input);assert.equal(bootstrap.state.phase,'bootstrap');absorb(f.client,bootstrap.cookies);
  assert.equal((await f.client.call('/api/v1/carts/current')).response.status,404);
  const saved=await mutate(f,input);assert.equal(saved.state.phase,'success');assert.equal(saved.state.total,99000);assert.equal(saved.state.count,1);
  // Drop the complete creation/add reply, including its cart cookie. The
  // previously acknowledged guest and exact original intent remain.
  const recovered=await mutate(f,input);assert.equal(recovered.state.phase,'success');assert.equal(recovered.state.intent.cart,saved.state.intent.cart);assert.equal(recovered.state.total,99000);assert.equal(recovered.state.count,1);absorb(f.client,recovered.cookies);
  const bodyLost=await mutate(f,input);assert.equal(bodyLost.state.phase,'success');assert.equal(bodyLost.state.count,1);
  const actor=await commerceActor(f.client.request('/cart'),f.identity);assert.ok(actor?.kind==='guest');
  const [counts]=await f.identity.sql`select (select count(*)::int from app.cart where owner_guest_id=${actor.id}) carts,(select count(*)::int from app.commerce_operation where actor_scope=${actorScope(actor)}) operations`;
  assert.deepEqual(counts,{carts:1,operations:2});
  const current=await f.client.call('/api/v1/carts/current');assert.equal(current.response.status,200);assert.equal(current.payload.lines.length,1);assert.equal(current.payload.lines[0].quantity,1);
  assert.equal(current.payload.lines[0].offer_kind,'bundle');assert.equal(current.payload.lines[0].line_total,99000);assert.equal(current.payload.lines[0].contents.reduce((n:number,c:{quantity:number})=>n+c.quantity,0),3);
  const [unknown]=await f.identity.sql`select unit_cost from app.component_cost_version where stock_item_id=${f.seeded.stocks['fixture-bag']} order by revision desc limit 1`;assert.equal(unknown.unit_cost,null);
  const pointer=[...f.client.cookies.values()].find(c=>c.name.endsWith('.cart_access'));assert.ok(pointer);const missingGuest=await readBrowserCart(new Request('http://127.0.0.1:3099/cart',{headers:{cookie:`${pointer.name}=${pointer.value}`}}),f.identity);assert.equal(missingGuest.kind,'denied');assert.equal(missingGuest.cart,null);
  const line=current.payload.lines[0],remove=initialCartIntent({kind:'remove',product:line.product_id,variant:line.variant_id,publication:line.publication_id,quantity:String(line.quantity),cart:current.payload.id,version:String(current.payload.version),line:line.id});
  const removed=await mutate(f,remove);assert.equal(removed.state.phase,'success');assert.equal(removed.state.total,0);assert.equal(removed.state.count,0);assert.match(removed.state.message,/Contoh Paket Kaos dan Krim/);
  const removedReplay=await mutate(f,remove);assert.equal(removedReplay.state.phase,'success');assert.equal(removedReplay.state.message,removed.state.message);assert.equal(removedReplay.state.total,0);
 }finally{await f.close();}
});

test('two first add intents share one cart and require review of a stale version before the second add',async()=>{
 const f=await checkoutFixture();try{
  const first=intent(f,'fixture-offer-shirt'),second=intent(f,'fixture-offer-cream-pack');
  const bootstrap=await mutate(f,first);assert.equal(bootstrap.state.phase,'bootstrap');absorb(f.client,bootstrap.cookies);
  const results=await Promise.all([mutate(f,first),mutate(f,second)]);
  const success=results.find(r=>r.state.phase==='success'),conflict=results.find(r=>r.state.code==='CART_VERSION_CONFLICT');assert.ok(success);assert.ok(conflict);
  assert.equal(success.state.count,1);assert.equal(conflict.state.count,1);assert.equal(conflict.state.intent.cart,success.state.intent.cart);
  for(const result of results)absorb(f.client,result.cookies);
  const retried=await mutate(f,conflict.state.intent);assert.equal(retried.state.phase,'success');assert.equal(retried.state.total,198000);assert.equal(retried.state.count,2);absorb(f.client,retried.cookies);
  const current=await f.client.call('/api/v1/carts/current');assert.equal(current.response.status,200);assert.equal(current.payload.lines.length,2);assert.equal(current.payload.merchandise_total,198000);
 }finally{await f.close();}
});

test('the UI bridge preserves origin and cart capability checks instead of trusting form identifiers',async()=>{
 const f=await checkoutFixture(),other=await checkoutFixture();try{
  const input=intent(f,'fixture-offer-shirt'),bootstrap=await mutate(f,input);assert.equal(bootstrap.state.phase,'bootstrap');absorb(f.client,bootstrap.cookies);
  const blocked=await mutate(f,input,{origin:'https://outside.invalid'});assert.equal(blocked.state.phase,'error');assert.equal(blocked.state.code,'INVALID_ORIGIN');assert.deepEqual(blocked.cookies,[]);
  const saved=await mutate(f,input);assert.equal(saved.state.phase,'success');absorb(f.client,saved.cookies);
  const otherInput=intent(other,'fixture-offer-shirt'),otherBootstrap=await mutate(other,otherInput);assert.equal(otherBootstrap.state.phase,'bootstrap');absorb(other.client,otherBootstrap.cookies);
  const otherSaved=await mutate(other,otherInput);assert.equal(otherSaved.state.phase,'success');absorb(other.client,otherSaved.cookies);
  const foreign=await mutate(f,{...intent(f,'fixture-offer-cream-pack'),cart:otherSaved.state.intent.cart,version:otherSaved.state.intent.version});
  assert.equal(foreign.state.phase,'error');assert.equal(foreign.state.code,'NOT_FOUND');
  for(const client of [f.client,other.client]){const current=await client.call('/api/v1/carts/current');assert.equal(current.response.status,200);assert.equal(current.payload.lines.length,1);assert.equal(current.payload.lines[0].quantity,1);assert.equal(current.payload.merchandise_total,99000);}
 }finally{await f.close();await other.close();}
});


test('signed-buyer removal replay names the original line after the active cart pointer changes',async()=>{
 const f=await checkoutFixture(),buyer=await actor(f.identity,'buyer',[]),client=new CommerceClient(f.identity);try{
  assert.equal((await client.auth('/sign-in/email',{email:buyer.email,password:buyer.password})).status,200);
  const first=await client.call('/api/v1/carts',{lines:[f.line('fixture-offer-shirt')]});assert.equal(first.response.status,201);const cart=first.payload.cart,line=cart.lines[0];
  const input=initialCartIntent({kind:'remove',product:line.product_id,variant:line.variant_id,publication:line.publication_id,quantity:String(line.quantity),cart:cart.id,version:String(cart.version),line:line.id});
  const removed=await mutateBrowserCart(client.request('/cart',{}),f.identity,input);assert.equal(removed.state.phase,'success');assert.ok(removed.state.message.includes(line.name));
  const second=await client.call('/api/v1/carts',{lines:[f.line('fixture-offer-cream-pack')]});assert.equal(second.response.status,201);assert.notEqual(second.payload.cart.id,cart.id);
  const replay=await mutateBrowserCart(client.request('/cart',{}),f.identity,input);assert.equal(replay.state.phase,'success');assert.equal(replay.state.message,removed.state.message);assert.equal(replay.state.intent.cart,second.payload.cart.id);assert.equal(replay.state.count,1);assert.equal(replay.state.total,99000);
 }finally{try{assert.equal((await client.auth('/sign-out',{})).status,200);assert.equal((await buyer.browser.auth('/sign-out',{})).status,200);}finally{await f.close();}}
});
