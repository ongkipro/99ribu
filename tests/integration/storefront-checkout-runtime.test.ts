import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {commerceActor,prefix} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {expireOwnedOrderJob} from '../../src/modules/checkout/expiry.ts';
import {handleCheckout} from '../../src/modules/checkout/routes.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {checkoutAllocationChoices,initialCheckoutIntent,mutateCheckout,readCheckout} from '../../src/modules/storefront/checkout.ts';
import {checkoutIssuedCookies,checkoutOrderPath,readCheckoutPayment,recoverCheckoutOrder} from '../../src/modules/storefront/checkout-order.ts';
import {checkoutFixture,CommerceClient} from './checkout-fixture.ts';

test('checkout bridge uses real guest authority, native quote/selection, one order after a discarded committed reply and scoped denial',async t=>{
 const f=await checkoutFixture();let cartId:string|null=null,otherGuest:CommerceClient|null=null;
 t.after(async()=>{
  const failures:unknown[]=[];
  for(const client of [otherGuest,f.client])if(client)try{await client.auth('/sign-out',{});}catch(error){failures.push(error);}
  try{
   const orders=cartId?await f.identity.sql`select id from app.commerce_order where cart_id=${cartId} and clock_namespace=${f.namespace}`:[];
   if(orders.length){const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
    for(const order of orders){const [job]=await f.identity.sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;assert.ok(job);await f.identity.sql.begin(tx=>expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload}));}
   }
  }catch(error){failures.push(error);}
  try{await f.close();}catch(error){failures.push(error);}
  if(failures.length)throw new AggregateError(failures,'Owned checkout scenario cleanup failed; original test failure remains separate');
 });
 const input={lines:[f.line('fixture-offer-shirt',2)]},key=randomUUID();
 assert.equal((await f.client.call('/api/v1/carts',input,{key})).response.status,401);
 const request=f.client.request('/api/v1/carts',input,{key}),actor=await commerceActor(request,f.identity);assert.ok(actor?.kind==='guest');
 const created=await f.identity.sql.begin(tx=>createCart(tx,request,f.identity,actor,input,{clock_namespace:f.namespace}));cartId=created.cart.id;
 const issued=await f.client.call('/api/v1/carts',input,{key});assert.equal(issued.response.status,201);assert.equal(issued.payload.cart.id,cartId);
 const before=await readCheckout(f.client.request('/checkout'),f.identity);assert.equal(before.kind,'ready');assert.equal(before.cart?.merchandise_total,198000);
 const draft={recipient_name:f.address.recipient_name,phone:f.contact().phone,email:'',destination_id:f.address.destination_id,address_line:'SYNTHETIC street\nRT 01',buyer_note:'SYNTHETIC note\nRing once',payment_method:'prepaid'};
 const intent=initialCheckoutIntent({cart:cartId,version:'1',draft});
 const noMatches=await mutateCheckout(f.client.request('/checkout',{}),f.identity,{...intent,navigate:'lookup',query:'not-a-synthetic-destination'});
 assert.equal(noMatches.state.view.destinations.length,0);assert.equal(noMatches.state.intent.draft.phone,draft.phone);assert.equal(noMatches.state.phase,'idle');
 const badSearch=await mutateCheckout(f.client.request('/checkout',{}),f.identity,{...intent,navigate:'lookup',query:'\u202eevil'});assert.equal(badSearch.state.phase,'error');assert.ok(badSearch.state.errors.query);assert.equal(badSearch.state.intent.draft.address_line,draft.address_line);
 const defaultLookup=await mutateCheckout(f.client.request('/checkout',{}),f.identity,{...intent,navigate:'stay',query:'not-a-synthetic-destination'});assert.equal(defaultLookup.state.step,'contact');assert.equal(defaultLookup.state.view.destinations.length,0);
 const [beforeQuote]=await f.identity.sql`select count(*)::int n from app.checkout_quote where cart_id=${cartId}`;assert.equal(beforeQuote.n,0);
 const quoted=await mutateCheckout(f.client.request('/checkout',{}),f.identity,intent);assert.equal(quoted.state.phase,'success');assert.equal(quoted.state.step,'review','single-page checkout: a quote opens the order step directly');assert.equal(quoted.state.intent.kind,'order');assert.equal(quoted.order,null);assert.ok(quoted.state.view.quoteCurrent);
 const quote=quoted.state.view.quote;assert.ok(quote);assert.equal(quote.merchandise_total,198000);assert.equal(quote.buyer_total,quote.merchandise_total+quote.shipping_total-quote.subsidy_total);
 assert.ok(quoted.state.view.allocations.length);assert.ok(quoted.state.view.allocations.every(plan=>quote.allocation_options.some(option=>option.id===plan.id)));assert.ok(quoted.state.view.allocations.every(plan=>plan.packages.every(parcel=>parcel.items.every(item=>item.name&&item.variant&&Number.isSafeInteger(item.quantity)&&item.quantity>0&&item.contents.length>0))));
 const [storedQuote]=await f.identity.sql<{document:import('../../src/modules/checkout/quotes.ts').QuoteDocument}[]>`select document from app.checkout_quote where id=${quote.id}`;assert.ok(quoted.state.view.cart);
 const document=structuredClone(storedQuote.document),original=JSON.stringify(document),duplicate={...structuredClone(document.selected_plan),id:'buyer-equivalent-native-plan'};document.plans.push(duplicate,{...structuredClone(duplicate),id:'another-equivalent-native-plan'});const beforeGrouping=JSON.stringify(document);
 const grouped=checkoutAllocationChoices(document,quoted.state.view.cart,duplicate.id),equivalent=grouped.find(plan=>plan.id===duplicate.id);assert.ok(equivalent);assert.equal(equivalent.equivalent_count,1);assert.ok(grouped.some(plan=>plan.id===document.selected_plan.id),'issued and pending native identities both remain explicitly selectable even when buyer-equivalent');assert.equal(grouped.length,quoted.state.view.allocations.length+1);assert.equal(JSON.stringify(storedQuote.document),original,'frontend grouping must never rewrite a native plan');assert.equal(checkoutAllocationChoices(document,quoted.state.view.cart,document.selected_plan.id).find(plan=>plan.id===document.selected_plan.id)?.equivalent_count,3);
 assert.equal(JSON.stringify(document),beforeGrouping,'grouping is a read-only projection');
 const other=storedQuote.document.plans.find(p=>p.id!==storedQuote.document.selected_plan.id&&p.packages.length!==storedQuote.document.selected_plan.packages.length);assert.ok(other);const nonIssued=structuredClone(storedQuote.document);nonIssued.plans.push({...structuredClone(other),id:'alias-of-pending-non-issued-plan'});const nonIssuedBefore=JSON.stringify(nonIssued),pendingGroup=checkoutAllocationChoices(nonIssued,quoted.state.view.cart,other.id);assert.equal(pendingGroup.length,quoted.state.view.allocations.length,'pending X and equivalent non-issued Y must remain one choice');assert.ok((pendingGroup.find(p=>p.id===other.id)?.equivalent_count??0)>=2);assert.ok(pendingGroup.some(p=>p.id===nonIssued.selected_plan.id));assert.ok(!pendingGroup.some(p=>p.id==='alias-of-pending-non-issued-plan'));assert.equal(JSON.stringify(nonIssued),nonIssuedBefore);
 const foreign=new CommerceClient(f.identity),checkoutForeignView=await readCheckout(foreign.request('/checkout'),f.identity);assert.deepEqual(checkoutForeignView.allocations,[],'private allocation contents require current cart/guest authority');
 const quoteOutage=await readCheckout(f.client.request('/checkout'),f.identity,async()=>Response.json({code:'SERVICE_UNAVAILABLE'},{status:503}));assert.equal(quoteOutage.kind,'unavailable');assert.equal(quoteOutage.quote,null);assert.equal(quoteOutage.quoteCurrent,false,'an unreadable existing quote must not silently become a ready empty draft');
 const packages=quote.packages.map(p=>({package_id:p.id,shipping_option_id:p.selected_option_id}));const stayedShipping=await mutateCheckout(f.client.request('/checkout',{}),f.identity,{...quoted.state.intent,packages,navigate:'stay'});assert.equal(stayedShipping.state.step,'review');assert.equal(stayedShipping.state.intent.kind,'order');assert.equal(stayedShipping.state.view.quote?.id,quote.id);assert.deepEqual(stayedShipping.state.intent.packages,packages);assert.equal(stayedShipping.order,null);
 // No JavaScript: "Buat pesanan" submitted with other couriers applies them first and creates no order.
 const changedChoice=quote.packages.map(p=>({package_id:p.id,shipping_option_id:p.options.find(o=>o.id!==p.selected_option_id)?.id??p.selected_option_id}));assert.ok(changedChoice.some((c,i)=>c.shipping_option_id!==quote.packages[i].selected_option_id));
 const selected=await mutateCheckout(f.client.request('/checkout',{}),f.identity,{...quoted.state.intent,packages:changedChoice});
 assert.equal(quoted.state.intent.kind,'order');assert.equal(selected.order,null);assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_order where cart_id=${cartId}`)[0].n,0,'a changed selection on an order submit must not place an order');assert.equal(selected.state.message,'Pengiriman diperbarui. Periksa total lalu buat pesanan.');assert.equal(selected.state.intent.kind,'order');assert.notEqual(selected.state.intent.key,quoted.state.intent.key,'the confirming press uses a new idempotency key');
 assert.deepEqual(selected.state.view.quote?.packages.map(p=>({package_id:p.id,shipping_option_id:p.selected_option_id})),changedChoice,'the submitted couriers became the quote selection');
 assert.equal(selected.state.phase,'success');assert.equal(selected.state.step,'review');assert.equal(selected.state.view.quote?.expires_at,quote.expires_at);assert.notEqual(selected.state.view.quote?.buyer_total,quote.buyer_total);assert.equal(selected.state.previousTotal,quote.buyer_total,'server result carries the old authoritative total without browser history or JS refs');
 const [beforeReviewStay]=await f.identity.sql`select count(*)::int n from app.checkout_quote where cart_id=${cartId}`;const stayedReview=await mutateCheckout(f.client.request('/checkout',{}),f.identity,{...selected.state.intent,navigate:'stay'});assert.equal(stayedReview.state.step,'review');assert.equal(stayedReview.state.view.quote?.id,selected.state.view.quote?.id);assert.equal(stayedReview.order,null);assert.equal((await f.identity.sql`select count(*)::int n from app.checkout_quote where cart_id=${cartId}`)[0].n,beforeReviewStay.n);assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_order where cart_id=${cartId}`)[0].n,0);
 const helpReturn=await mutateCheckout(f.client.request('/checkout',{}),f.identity,{...selected.state.intent,navigate:'review'});assert.equal(helpReturn.state.step,'review');assert.equal(helpReturn.state.view.quote?.id,selected.state.view.quote?.id);assert.equal(helpReturn.state.intent.draft.address_line,draft.address_line);
 // Another tab creates a new authoritative quote. The stale submit must not
 // place an order or silently accept its totals; an explicit new review follows.
 const otherQuote=await mutateCheckout(f.client.request('/checkout',{}),f.identity,{...intent,key:randomUUID()});assert.equal(otherQuote.state.phase,'success');
 const stale=await mutateCheckout(f.client.request('/checkout',{}),f.identity,selected.state.intent);assert.equal(stale.state.code,'QUOTE_SUPERSEDED');assert.equal(stale.state.step,'contact');assert.equal(stale.state.intent.kind,'quote');assert.equal(stale.state.intent.draft.phone,draft.phone);
 const renewed=await mutateCheckout(f.client.request('/checkout',{}),f.identity,stale.state.intent);assert.equal(renewed.state.phase,'success');const renewedQuote=renewed.state.view.quote;assert.ok(renewedQuote);
 const alternativeAllocation=renewedQuote.allocation_options.find(p=>p.id!==renewedQuote.selected_allocation_id);assert.ok(alternativeAllocation);assert.equal(renewed.state.step,'review');assert.equal(renewed.state.intent.kind,'order');
 // JavaScript path: a changed split auto-submits a 'shipping' intent and returns to the same order step.
 const reallocated=await mutateCheckout(f.client.request('/checkout',{}),f.identity,{...renewed.state.intent,kind:'shipping',allocation_id:alternativeAllocation.id,packages:renewedQuote.packages.map(p=>({package_id:p.id,shipping_option_id:p.selected_option_id}))});assert.equal(reallocated.state.step,'review');assert.equal(reallocated.state.intent.kind,'order');assert.equal(reallocated.order,null);assert.equal(reallocated.state.message,'Pembagian paket diperbarui. Periksa total lalu buat pesanan.');assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_order where cart_id=${cartId}`)[0].n,0);assert.equal(reallocated.state.view.quote?.selected_allocation_id,alternativeAllocation.id);assert.equal(reallocated.state.previousTotal,renewedQuote.buyer_total,'allocation changes also carry the old native total');const reallocatedQuote=reallocated.state.view.quote;assert.ok(reallocatedQuote);
 // The order press carries the unchanged visible parcel radios; it is the order itself, not another selection.
 const exact=structuredClone({...reallocated.state.intent,packages:reallocatedQuote.packages.map(p=>({package_id:p.id,shipping_option_id:p.selected_option_id}))});assert.equal(exact.kind,'order');
 const lost=await mutateCheckout(f.client.request('/checkout',{}),f.identity,exact,async(request,identity)=>{const reply=await handleCheckout(request,identity);if(new URL(request.url).pathname==='/api/v1/orders'&&request.method==='POST'&&reply.status===201)throw new Error('Owned response loss after real native commit');return reply;});
 assert.equal(lost.order,null);assert.equal(lost.state.phase,'unknown');assert.deepEqual(lost.state.intent,exact);
 const [committed]=await f.identity.sql`select id,payment_status,buyer_total from app.commerce_order where cart_id=${cartId}`;assert.ok(committed);assert.equal(committed.payment_status,'pending');
 const unavailable=await mutateCheckout(f.client.request('/checkout',{}),f.identity,lost.state.intent,async(request,identity)=>new URL(request.url).pathname.startsWith('/api/v1/checkout/quotes/')&&request.method==='GET'?Response.json({code:'SERVICE_UNAVAILABLE'},{status:503}):handleCheckout(request,identity));
 assert.equal(unavailable.state.phase,'unknown');assert.deepEqual(unavailable.state.intent,exact,'a pre-read outage on an unresolved retry must never rotate its original key/body/version');
 const replay=await mutateCheckout(f.client.request('/checkout',{}),f.identity,unavailable.state.intent);assert.ok(replay.order);assert.equal(replay.order.id,committed.id);assert.equal(replay.order.buyer_total,Number(committed.buyer_total));
 const response=new Response();for(const cookie of replay.cookies)response.headers.append('set-cookie',cookie);f.client.absorb(response);
 assert.equal((await f.client.call(`/api/v1/orders/${replay.order.id}`)).response.status,200);
 const [count]=await f.identity.sql`select count(*)::int n from app.commerce_order where cart_id=${cartId}`;assert.equal(count.n,1);
 const [stored]=await f.identity.sql`select buyer_note from app.commerce_order where id=${replay.order.id}`;assert.equal(stored.buyer_note,'SYNTHETIC note Ring once');
 const conflict=await mutateCheckout(f.client.request('/checkout',{}),f.identity,{...exact,draft:{...exact.draft,buyer_note:'SYNTHETIC different note'}});assert.equal(conflict.state.code,'IDEMPOTENCY_CONFLICT');assert.equal(conflict.order,null);
 const stranger=new CommerceClient(f.identity),denied=await mutateCheckout(stranger.request('/checkout',{}),f.identity,exact);assert.equal(denied.state.blocked,true);assert.equal(denied.order,null);assert.equal(denied.state.view.quote,null);assert.equal(denied.state.intent.draft.recipient_name,'');assert.equal(denied.state.intent.draft.phone,'');
 const get=await mutateCheckout(f.client.request('/checkout'),f.identity,exact);assert.equal(get.order,null);assert.equal(get.state.code,'INVALID_INPUT');
 for(const name of ['x-cart-token','x-order-token','authorization']){
  const rejected=await mutateCheckout(f.client.request('/checkout',{}, {headers:{[name]:'forged'}}),f.identity,exact);assert.equal(rejected.state.code,'UNSUPPORTED_AUTH_TRANSPORT');assert.equal(rejected.state.blocked,true);
 }
 for(const cookie of replay.cookies){const value=cookie.slice(cookie.indexOf('=')+1,cookie.indexOf(';'));assert.ok(!JSON.stringify(replay.state).includes(value),'native capability must stay outside serializable action state');}
 const uiPath=checkoutOrderPath(replay.order.id),p=await prefix(f.identity);
 assert.equal((await readCheckoutPayment(f.client.request(uiPath),f.identity,replay.order.id)).kind,'denied','API-path cookie alone must not become a frontend credential');
 const recovered=await recoverCheckoutOrder(f.client.request(uiPath,{}),f.identity,replay.order.id);assert.equal(recovered.order.id,replay.order.id);
 const issuedUi=await checkoutIssuedCookies(f.identity,replay.order.id,recovered.cookies);assert.equal(issuedUi.length,2);assert.equal(issuedUi[0].path,`/api/v1/orders/${replay.order.id}`);assert.equal(issuedUi[1].path,uiPath);assert.equal(issuedUi[0].maxAge,issuedUi[1].maxAge);
 assert.ok(issuedUi.every(c=>c.httpOnly&&c.sameSite==='lax'&&c.maxAge>0&&c.maxAge<=604800));
 for(const entry of issuedUi)f.client.cookies.set(`${entry.name}:${entry.path}`,{name:entry.name,value:entry.value,path:entry.path});
 for(let i=0;i<2;i++){const view=await readCheckoutPayment(f.client.request(uiPath),f.identity,replay.order.id);assert.equal(view.kind,'ready');assert.equal(view.order?.id,replay.order.id);assert.equal(view.attempt,null);}
 const [noAttempt]=await f.identity.sql`select count(*)::int n from app.payment_attempt where order_id=${replay.order.id}`;assert.equal(noAttempt.n,0,'GET payment views must not create an attempt');
 const alias=issuedUi[1],base=f.client.request(uiPath),withCookie=(suffix:string)=>{const request=new Request(base);request.headers.set('cookie',`${base.headers.get('cookie')}; ${suffix}`);return request;};
 assert.equal((await readCheckoutPayment(withCookie(`${p}.order_access=${alias.value}`),f.identity,replay.order.id)).kind,'ready','Next redirect may co-forward the identical newly issued API cookie');
 for(const suffix of [`${alias.name}=${alias.value}`,`${p}.order_access=conflicting`]){const deniedView=await readCheckoutPayment(withCookie(suffix),f.identity,replay.order.id);assert.equal(deniedView.kind,'denied');assert.equal(deniedView.order,null);}
 const nativeOnly=new Request(base);nativeOnly.headers.set('cookie',`${(base.headers.get('cookie')??'').split(';').filter(v=>!v.trim().startsWith(`${alias.name}=`)).join(';')}; ${p}.order_access=${alias.value}`);
 assert.equal((await readCheckoutPayment(nativeOnly,f.identity,replay.order.id)).kind,'denied');
 const wrongOrder=await readCheckoutPayment(f.client.request(uiPath),f.identity,randomUUID());assert.equal(wrongOrder.kind,'denied');assert.equal(wrongOrder.order,null);
 const originalCookie=recovered.cookies[0];
 for(const bad of [originalCookie.replace('HttpOnly',''),originalCookie.replace('SameSite=Lax','SameSite=None'),originalCookie.replace(`Path=/api/v1/orders/${replay.order.id}`,'Path=/'),originalCookie.replace(/Max-Age=\d+/,'Max-Age=604801')])await assert.rejects(checkoutIssuedCookies(f.identity,replay.order.id,[bad]),/Unexpected checkout cookie/);
 otherGuest=new CommerceClient(f.identity);assert.equal((await otherGuest.call('/api/v1/carts',{lines:[]})).response.status,401);
 otherGuest.cookies.set(`${alias.name}:${alias.path}`,{name:alias.name,value:alias.value,path:alias.path});
 const foreignView=await readCheckoutPayment(otherGuest.request(uiPath),f.identity,replay.order.id);assert.equal(foreignView.kind,'denied');assert.equal(foreignView.order,null);
 await assert.rejects(recoverCheckoutOrder(otherGuest.request(uiPath,{}),f.identity,replay.order.id),{code:'UNAUTHENTICATED'});
 assert.equal((await f.client.call(`/api/v1/orders/${replay.order.id}`)).response.status,200,'original API cookie remains independently usable on its exact API path');
 assert.equal((await f.client.auth('/sign-out',{})).status,200);
 const revoked=await readCheckoutPayment(f.client.request(uiPath),f.identity,replay.order.id);assert.equal(revoked.kind,'denied');assert.equal(revoked.order,null,'stale UI alias cannot survive guest-context revocation');
 const [after]=await f.identity.sql`select count(*)::int n from app.commerce_order where cart_id=${cartId}`;assert.equal(after.n,1);
});

test('a no-JavaScript order press with a changed courier never places the order, even when its selection reply is lost and the same action is repeated',async t=>{
 const f=await checkoutFixture();let cartId:string|null=null;
 t.after(async()=>{
  const failures:unknown[]=[];
  try{
   const orders=cartId?await f.identity.sql`select id from app.commerce_order where cart_id=${cartId} and clock_namespace=${f.namespace}`:[];
   if(orders.length){const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
    for(const order of orders){const [job]=await f.identity.sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;assert.ok(job);await f.identity.sql.begin(tx=>expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload}));}
   }
  }catch(error){failures.push(error);}
  try{await f.client.auth('/sign-out',{});}catch(error){failures.push(error);}
  try{await f.close();}catch(error){failures.push(error);}
  if(failures.length)throw new AggregateError(failures,'Owned checkout scenario cleanup failed; original test failure remains separate');
 });
 const input={lines:[f.line('fixture-offer-shirt',2)]},key=randomUUID();
 assert.equal((await f.client.call('/api/v1/carts',input,{key})).response.status,401);
 const request=f.client.request('/api/v1/carts',input,{key}),actor=await commerceActor(request,f.identity);assert.ok(actor?.kind==='guest');
 cartId=(await f.identity.sql.begin(tx=>createCart(tx,request,f.identity,actor,input,{clock_namespace:f.namespace}))).cart.id;
 assert.equal((await f.client.call('/api/v1/carts',input,{key})).response.status,201);
 const draft={recipient_name:f.address.recipient_name,phone:f.contact().phone,email:'',destination_id:f.address.destination_id,address_line:'SYNTHETIC street',buyer_note:'',payment_method:'prepaid'};
 const quoted=await mutateCheckout(f.client.request('/checkout',{}),f.identity,initialCheckoutIntent({cart:cartId,version:'1',draft}));
 assert.equal(quoted.state.step,'review');assert.equal(quoted.state.intent.kind,'order');const quote=quoted.state.view.quote;assert.ok(quote);
 const changed=quote.packages.map(p=>({package_id:p.id,shipping_option_id:p.options.find(o=>o.id!==p.selected_option_id)?.id??p.selected_option_id}));
 assert.ok(changed.some((c,i)=>c.shipping_option_id!==quote.packages[i].selected_option_id),'fixture offers an alternative courier');
 const exact={...quoted.state.intent,packages:changed};
 const orders=async()=>(await f.identity.sql`select count(*)::int n from app.commerce_order where cart_id=${cartId}`)[0].n;
 const lost=await mutateCheckout(f.client.request('/checkout',{}),f.identity,exact,async(req,identity)=>{const reply=await handleCheckout(req,identity);if(new URL(req.url).pathname.endsWith('/selection')&&req.method==='POST'&&reply.status<300)throw new Error('Owned response loss after the selection committed');return reply;});
 assert.equal(lost.state.phase,'unknown');assert.equal(lost.order,null);assert.deepEqual(lost.state.intent,exact,'an unknown result keeps the exact action for the repeat');assert.equal(await orders(),0);
 // "Periksa hasil tindakan" repeats the same order press. The buyer has not yet seen the total for the new couriers.
 const repeated=await mutateCheckout(f.client.request('/checkout',{}),f.identity,lost.state.intent);
 assert.equal(repeated.order,null,'repeating a lost courier change must not place an order the buyer never confirmed at the new total');
 assert.equal(await orders(),0);assert.equal(repeated.state.step,'review');assert.equal(repeated.state.message,'Pengiriman diperbarui. Periksa total lalu buat pesanan.');assert.notEqual(repeated.state.intent.key,exact.key);
 assert.deepEqual(repeated.state.view.quote?.packages.map(p=>({package_id:p.id,shipping_option_id:p.selected_option_id})),changed);
 // A deliberate second press with a fresh key places exactly one order.
 const placed=await mutateCheckout(f.client.request('/checkout',{}),f.identity,{...repeated.state.intent,packages:changed});
 assert.ok(placed.order);assert.equal(await orders(),1);assert.equal(placed.order.buyer_total,repeated.state.view.quote?.buyer_total);
});
