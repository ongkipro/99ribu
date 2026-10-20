import assert from 'node:assert/strict';
import test from 'node:test';
import {checkoutFixture,CommerceClient} from './checkout-fixture.ts';

test('creating a cart rejects quantity beyond complete stock across the two owned warehouses',async()=>{
 const f=await checkoutFixture();try{
  assert.equal((await f.client.call('/api/v1/carts',{})).response.status,401);
  const denied=await f.client.call('/api/v1/carts',{lines:[f.line('fixture-offer-shirt',6)]});
  assert.equal(denied.response.status,409);assert.equal(denied.payload.code,'OFFER_UNAVAILABLE');
  assert.equal((await f.client.call('/api/v1/carts/current')).response.status,404);
  const valid=await f.client.call('/api/v1/carts',{lines:[f.line('fixture-offer-shirt',5)]});
  assert.equal(valid.response.status,201);assert.equal(valid.payload.cart.lines[0].quantity,5);
  assert.equal(valid.payload.cart.merchandise_total,495000);
 }finally{await f.close();}
});

test('coalesced add and quantity update deny excess stock without advancing the cart',async()=>{
 const f=await checkoutFixture();try{
  assert.equal((await f.client.call('/api/v1/carts',{})).response.status,401);
  const created=await f.client.call('/api/v1/carts',{lines:[f.line('fixture-offer-shirt')]});assert.equal(created.response.status,201);
  const cart=created.payload.cart,line=cart.lines[0];
  const added=await f.client.call(`/api/v1/carts/${cart.id}/lines`,f.line('fixture-offer-shirt',5),{version:cart.version});
  assert.equal(added.response.status,409);assert.equal(added.payload.code,'OFFER_UNAVAILABLE');
  const updated=await f.client.call(`/api/v1/carts/${cart.id}/lines/${line.id}`,{quantity:6,expected_version:cart.version},{method:'PATCH'});
  assert.equal(updated.response.status,409);assert.equal(updated.payload.code,'OFFER_UNAVAILABLE');
  const unchanged=await f.client.call(`/api/v1/carts/${cart.id}`);assert.equal(unchanged.response.status,200);
  assert.equal(unchanged.payload.version,cart.version);assert.equal(unchanged.payload.lines[0].quantity,1);assert.equal(unchanged.payload.merchandise_total,99000);
  const valid=await f.client.call(`/api/v1/carts/${cart.id}/lines/${line.id}`,{quantity:5,expected_version:cart.version},{method:'PATCH'});
  assert.equal(valid.response.status,200);assert.equal(valid.payload.version,cart.version+1);assert.equal(valid.payload.lines[0].quantity,5);
 }finally{await f.close();}
});

test('sold-out stock blocks create and change but preserves existing lines and permits removal',async()=>{
 const f=await checkoutFixture();try{
  assert.equal((await f.client.call('/api/v1/carts',{})).response.status,401);
  const created=await f.client.call('/api/v1/carts',{lines:[f.line('fixture-offer-shirt')]});assert.equal(created.response.status,201);
  const cart=created.payload.cart,line=cart.lines[0],offer=f.line('fixture-offer-shirt');
  const positions=await f.identity.sql<{id:string;available:number}[]>`select b.id,b.on_hand-b.reserved-b.quarantined as available from app.inventory_balance b
   where b.id in ${f.identity.sql(Object.values(f.seeded.positions))} and b.stock_item_id in (
    select c.stock_item_id from app.offer_component c where c.offer_id=${offer.variant_id} and c.product_id=${line.product_id} and c.revision=${line.product_revision})`;
  assert.ok(positions.length>0);
  for(const position of positions){if(position.available<=0)continue;const key=Object.keys(f.seeded.positions).find(key=>f.seeded.positions[key]===position.id);assert.ok(key);await f.move(key,'quarantine',position.available);}
  const other=new CommerceClient(f.identity);assert.equal((await other.call('/api/v1/carts',{})).response.status,401);
  const denied=await other.call('/api/v1/carts',{lines:[offer]});assert.equal(denied.response.status,409);assert.equal(denied.payload.code,'OFFER_UNAVAILABLE');
  const key=created.request.headers.get('idempotency-key');assert.ok(key);
  const replay=await f.client.call('/api/v1/carts',{lines:[offer]},{key});assert.equal(replay.response.status,201);assert.equal(replay.payload.cart.id,cart.id);assert.equal(replay.payload.cart.version,cart.version);
  const updated=await f.client.call(`/api/v1/carts/${cart.id}/lines/${line.id}`,{quantity:1,expected_version:cart.version},{method:'PATCH'});
  assert.equal(updated.response.status,409);assert.equal(updated.payload.code,'OFFER_UNAVAILABLE');
  const current=await f.client.call(`/api/v1/carts/${cart.id}`);assert.equal(current.response.status,200);assert.equal(current.payload.version,cart.version);assert.equal(current.payload.lines[0].quantity,1);
  const removed=await f.client.call(`/api/v1/carts/${cart.id}/lines/${line.id}`,undefined,{method:'DELETE',version:cart.version});
  assert.equal(removed.response.status,200);assert.equal(removed.payload.version,cart.version+1);assert.deepEqual(removed.payload.lines,[]);assert.equal(removed.payload.merchandise_total,0);
 }finally{await f.close();}
});
