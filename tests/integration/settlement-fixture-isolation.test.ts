import assert from 'node:assert/strict';
import test from 'node:test';
import {handlePromotions} from '../../src/modules/promotions/routes.ts';
import {resolvePromotionReservation} from '../../src/modules/promotions/reservations.ts';
import {promotionFixture} from './promotion-fixture.ts';

test('promotion fixture teardown retires only owned configurations and retains consumed budget/history even after its actor is demoted',async()=>{
 const own=await promotionFixture(),other=await promotionFixture();let closed=false;
 try{
  const campaign=await own.campaign(),direct=await handlePromotions(own.request('',own.config({name:'SYNTHETIC direct fixture campaign'})),own.identity);assert.equal(direct.status,201);const directId=(await direct.json()).id,unrelated=await other.campaign();
  const hold=await own.reserve(await own.input([campaign.id]));await own.identity.sql.begin(tx=>resolvePromotionReservation(tx,hold.id,'consumed','SYNTHETIC committed budget must survive teardown'));
  const [before]=await own.identity.sql`select committed_amount::text committed,reserved_amount::text reserved,budget_revision from app.promotion where id=${campaign.id}`;
  assert.ok(BigInt(before.committed)>0n);
  await own.identity.sql`update app.role_grant set roles=${['warehouse']} where user_id=${own.owner.id}`;
  closed=true;await own.close();
  for(const id of [campaign.id,directId]){
   const [current]=await other.identity.sql`select v.active,v.revision from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision where p.id=${id}`;assert.equal(current.active,false);assert.equal(current.revision,2);
   assert.equal((await other.identity.sql`select count(*)::int n from app.promotion_version where promotion_id=${id}`)[0].n,2);
  }
  assert.deepEqual((await other.identity.sql`select committed_amount::text committed,reserved_amount::text reserved,budget_revision from app.promotion where id=${campaign.id}`)[0],before);
  assert.equal((await other.identity.sql`select v.active from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision where p.id=${unrelated.id}`)[0].active,true);
  assert.equal((await other.identity.sql`select status from app.promotion_reservation where id=${hold.id}`)[0].status,'consumed');
 }finally{try{if(!closed)await own.close();}finally{await other.close();}}
});
