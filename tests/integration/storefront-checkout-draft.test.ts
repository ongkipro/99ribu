import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {lstat,rename,unlink,utimes,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {privateDirectory} from '../../src/config/local.ts';
import {actorScope,commerceActor,mac,prefix} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {clearCheckoutDraft,readCheckoutDraft,writeCheckoutDraft} from '../../src/modules/storefront/checkout-draft.ts';
import {initialCheckoutIntent,initialCheckoutState,mutateCheckout,readCheckout} from '../../src/modules/storefront/checkout.ts';
import {checkoutFixture,CommerceClient} from './checkout-fixture.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';

test('submitted raw checkout draft and note survive an authorized resume and fence stale writers without changing quote or money',async()=>{
 const f=await checkoutFixture();let cartId:string|null=null;try{
  const body={lines:[f.line()]},key=randomUUID();assert.equal((await f.client.call('/api/v1/carts',body,{key})).response.status,401);
  const request=f.client.request('/api/v1/carts',body,{key}),actor=await commerceActor(request,f.identity);assert.ok(actor?.kind==='guest');
  const created=await f.identity.sql.begin(tx=>createCart(tx,request,f.identity,actor,body,{clock_namespace:f.namespace}));cartId=created.cart.id;assert.equal((await f.client.call('/api/v1/carts',body,{key})).response.status,201);
  const draft={recipient_name:'SYNTHETIC saved recipient',phone:'081200000000',email:'',destination_id:'test-malang',address_line:'SYNTHETIC raw street\nRT 01',buyer_note:'SYNTHETIC saved note\nRing once',payment_method:'prepaid'};
  let intent=initialCheckoutIntent({cart:cartId,version:'1',draft});const post=()=>f.client.request('/checkout',{}),get=()=>f.client.request('/checkout');
  const first=await writeCheckoutDraft(post(),f.identity,intent);assert.equal(first.kind,'saved');intent={...intent,draft_revision:String(first.revision)};
  const realm=await prefix(f.identity),scopeKey=await mac(f.identity,'checkout-draft',[realm,actorScope(actor),actor.id,cartId]),root=join(privateDirectory('artifacts'),'checkout-drafts'),currentPath=join(root,`${realm}.${scopeKey}.json`),legacyPath=join(root,`${scopeKey}.json`);await rename(currentPath,legacyPath);
  const quoted=await mutateCheckout(post(),f.identity,intent);assert.equal(quoted.state.phase,'success');const quote=quoted.state.view.quote;assert.ok(quote);
  const accepted=await writeCheckoutDraft(post(),f.identity,intent,{step:'shipping',quote:quote.id,allocation_id:quote.selected_allocation_id,packages:quote.packages.map(p=>({package_id:p.id,shipping_option_id:p.selected_option_id}))});assert.equal(accepted.kind,'saved');
  const resumed=await readCheckout(get(),f.identity);assert.equal(resumed.draft.buyer_note,draft.buyer_note,'a submitted delivery note must not silently become empty on a fresh checkout GET');assert.equal(resumed.draft.address_line,draft.address_line);assert.equal(resumed.draft.phone,draft.phone);assert.equal(initialCheckoutState(resumed).step,'shipping');assert.equal(resumed.quote?.id,quote.id);assert.ok((await lstat(currentPath)).isFile());await assert.rejects(lstat(legacyPath),{code:'ENOENT'},'the pre-retention draft is atomically preserved under its environment prefix');
  const revision=accepted.revision,next={...intent,draft_revision:String(revision),draft_sequence:'2',draft:{...draft,buyer_note:'SYNTHETIC newest note'}};
  const saved=await writeCheckoutDraft(post(),f.identity,next);assert.equal(saved.kind,'saved');
  const stale=await writeCheckoutDraft(post(),f.identity,{...intent,draft_revision:String(revision),draft_sequence:'1'});assert.equal(stale.kind,'stale');
  const competing=await writeCheckoutDraft(post(),f.identity,{...intent,draft_writer:randomUUID(),draft_revision:String(revision)});assert.equal(competing.kind,'conflict');assert.equal(competing.revision,saved.revision);
  const stored=await readCheckoutDraft(get(),f.identity,cartId);assert.equal(stored.kind,'saved');assert.equal(stored.progress?.draft.buyer_note,next.draft.buyer_note);
  const invalidNote=await mutateCheckout(post(),f.identity,{...next,kind:'order',quote:quote.id,draft:{...draft,buyer_note:'SYNTHETIC\u0001 invalid note'}});assert.equal(invalidNote.state.step,'contact');assert.equal(invalidNote.state.intent.kind,'quote','failed review validation must not leave an order action behind the next shipping label');assert.equal(invalidNote.state.errors.buyer_note,'Gunakan catatan maksimal 500 karakter tanpa karakter kontrol.');
  const foreign=new CommerceClient(f.identity);assert.equal((await foreign.call('/api/v1/carts',{lines:[]})).response.status,401);try{await assert.rejects(readCheckoutDraft(foreign.request('/checkout'),f.identity,cartId),error=>error instanceof Error&&'status'in error&&[401,403,404].includes(Number(error.status)));}finally{await foreign.auth('/sign-out',{});}
  for(const header of ['authorization','x-cart-token','x-order-token'])await assert.rejects(readCheckoutDraft(f.client.request('/checkout',undefined,{headers:{[header]:'forged'}}),f.identity,cartId),{code:'UNSUPPORTED_AUTH_TRANSPORT'});
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_order where cart_id=${cartId}`)[0].n,0);
  const [unchanged]=await f.identity.sql`select revision,active_quote_id from app.cart where id=${cartId}`;assert.equal(unchanged.revision,1);assert.equal(unchanged.active_quote_id,quote.id);
  const clock=await readFixtureClock('test',f.namespace),[cart]=await f.identity.sql`select expires_at from app.cart where id=${cartId}`;await advanceFixtureClock('test',f.namespace,Math.ceil((new Date(cart.expires_at).getTime()-Date.parse(clock.now))/1000)+1,clock.version);
  assert.equal((await readCheckoutDraft(get(),f.identity,cartId)).kind,'expired');assert.equal((await writeCheckoutDraft(post(),f.identity,next)).kind,'closed');assert.equal((await readCheckoutDraft(get(),f.identity,cartId)).kind,'empty');
 }finally{try{if(cartId)await clearCheckoutDraft(f.client.request('/checkout',{}),f.identity,cartId);await f.client.auth('/sign-out',{});}finally{await f.close();}}
});

test('a new authorized draft write removes physically expired signed-out progress and abandoned temporary files while respecting the writer lock',async()=>{
 const f=await checkoutFixture(),next=new CommerceClient(f.identity);let freshCart:string|null=null,orphan:string|null=null,temporary:string|null=null;
 try{
  const create=async(client:CommerceClient)=>{const body={lines:[f.line()]},key=randomUUID();assert.equal((await client.call('/api/v1/carts',body,{key})).response.status,401);const request=client.request('/api/v1/carts',body,{key}),actor=await commerceActor(request,f.identity);assert.ok(actor?.kind==='guest');const result=await f.identity.sql.begin(tx=>createCart(tx,request,f.identity,actor,body,{clock_namespace:f.namespace}));assert.equal((await client.call('/api/v1/carts',body,{key})).response.status,201);return {cart:result.cart,actor};};
  const old=await create(f.client),intent=initialCheckoutIntent({cart:old.cart.id,version:'1',draft:{recipient_name:'SYNTHETIC orphan recipient',phone:'081200000000',email:'',destination_id:'test-malang',address_line:'SYNTHETIC orphan address',buyer_note:'SYNTHETIC orphan note',payment_method:'prepaid'}});
  assert.equal((await writeCheckoutDraft(f.client.request('/checkout',{}),f.identity,intent)).kind,'saved');
  const realm=await prefix(f.identity),key=await mac(f.identity,'checkout-draft',[realm,actorScope(old.actor),old.actor.id,old.cart.id]),root=join(privateDirectory('artifacts'),'checkout-drafts');
  const current=join(root,`${realm}.${key}.json`),legacy=join(root,`${key}.json`);orphan=await lstat(current).then(()=>current).catch(error=>{if(error.code==='ENOENT')return legacy;throw error;});
  temporary=`${orphan}.${randomUUID()}.tmp`;await writeFile(temporary,'SYNTHETIC abandoned partial draft',{flag:'wx',mode:0o600});const past=new Date(Date.now()-26*3600000);await utimes(orphan,past,past);await utimes(temporary,past,past);
  assert.equal((await f.client.auth('/sign-out',{})).status,200);const fresh=await create(next);freshCart=fresh.cart.id;let freshIntent=initialCheckoutIntent({cart:freshCart,version:'1'});
  await f.identity.sql.begin(async tx=>{await tx`select pg_advisory_xact_lock(hashtextextended(${`checkout-draft:${key}`},0))`;const reply=await writeCheckoutDraft(next.request('/checkout',{}),f.identity,freshIntent);assert.equal(reply.kind,'saved');freshIntent={...freshIntent,draft_revision:String(reply.revision),draft_sequence:'1'};assert.ok((await lstat(orphan as string)).isFile());assert.ok((await lstat(temporary as string)).isFile());});
  assert.equal((await writeCheckoutDraft(next.request('/checkout',{}),f.identity,freshIntent)).kind,'saved');await assert.rejects(lstat(orphan),{code:'ENOENT'},'the next authorized write must physically remove an expired signed-out draft');await assert.rejects(lstat(temporary),{code:'ENOENT'},'abandoned raw temporary data must also expire');
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_order where cart_id in ${f.identity.sql([old.cart.id,freshCart])}`)[0].n,0);
 }finally{try{if(freshCart)await clearCheckoutDraft(next.request('/checkout',{}),f.identity,freshCart);for(const path of [orphan,temporary])if(path)await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});await next.auth('/sign-out',{});await f.client.auth('/sign-out',{});}finally{await f.close();}}
});
