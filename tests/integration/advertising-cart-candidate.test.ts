import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';
import {capability,commerceActor,digest,prefix} from '../../src/modules/checkout/access.ts';
import {changeLine,createCart} from '../../src/modules/checkout/carts.ts';
import {bootstrapVisitor,readVisitor,visitorCookieName,visitorToken} from '../../src/modules/consent/context.ts';
import {recordConsent} from '../../src/modules/consent/receipts.ts';
import {captureCartMutation} from '../../src/modules/advertising/events.ts';
import {localSignalPayload} from '../../src/modules/advertising/worker.ts';
import {checkoutFixture} from './checkout-fixture.ts';

test('actual distinct same-offer mutations produce distinct consent-gated deltas; exact local payload and withdrawal preserve sent truth',async()=>{
 const f=await checkoutFixture(),owner=connectDatabase('test','owner'),rollback=new Error('Expected cart signal candidate rollback');let stage='bootstrap';
 try{
  assert.equal((await f.client.call('/api/v1/carts',{})).response.status,401);
  const base=f.client.request('/api/v1/visitor-sessions',{client_request_id:randomUUID()}),actor=await commerceActor(base,f.identity);assert.ok(actor?.kind==='guest');
  await assert.rejects(owner.sql.begin(async tx=>{
   const [installed]=await tx`select to_regclass('app.commerce_event') is not null installed`;if(!installed.installed)for(const part of readFileSync('migrations/0017_canonical_signals.sql','utf8').split('--> statement-breakpoint'))if(part.trim())await tx.unsafe(part);
   const active=await bootstrapVisitor(tx,base,f.identity,actor,randomUUID(),{client_request_id:randomUUID()});assert.equal(active.bootstrap,false);
   const vName=await visitorCookieName(f.identity),vToken=await visitorToken(f.identity,active.visitor);f.client.cookies.set(`${vName}:/`,{name:vName,value:`${active.visitor.id}.${vToken}`,path:'/'});
   const choices={analytics:'granted',advertising_measurement:'granted',marketing:'denied',meta:'granted',google:'granted',tiktok:'denied',google_signals:{ad_storage:'denied',analytics_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'}};
   await recordConsent(tx,active.visitor,randomUUID(),{expected_version:0,policy_version:'local-privacy-v1',choices});
   stage='cart create';const request=f.client.request('/api/v1/carts',{}),cart=await createCart(tx,request,f.identity,actor,{}, {clock_namespace:f.namespace});
   const cName=`${await prefix(f.identity)}.cart_access`,cToken=await capability(f.identity,'cart',cart.cart.id,actor.id,cart.cart.cap_issued_at as string);f.client.cookies.set(`${cName}:/`,{name:cName,value:`${cart.cart.id}.${cToken}`,path:'/'});
   let version=cart.cart.revision;const operations:string[]=[];
   for(let n=0;n<2;n++){
    stage=`actual add ${n+1}`;const key=randomUUID(),input=f.line(),request=f.client.request(`/api/v1/carts/${cart.cart.id}/lines`,input,{key,version});
    const changed=await changeLine(tx,request,f.identity,actor,cart.cart.id,null,input);version=changed.version;
    const [operation]=await tx`select id from app.commerce_operation where resource_id=${cart.cart.id} and key=${key}`;operations.push(operation.id);await captureCartMutation(tx,request,f.identity,actor,operation.id);
   }
   stage='canonical add deltas';const events=await tx`select * from app.commerce_event where source_kind='commerce_operation' and source_reference in ${tx(operations)} order by recorded_at`;
   assert.equal(events.length,2);assert.notEqual(events[0].id,events[1].id);assert.ok(events.every(e=>e.payload.contents.length===1&&e.payload.contents[0].quantity===1&&Number(e.merchandise_amount)===99000));
   const rows=await tx`select * from app.ad_event_outbox where event_id in ${tx(events.map(e=>e.id))}`;assert.equal(rows.filter(r=>r.status==='queued').length,4);assert.equal(rows.filter(r=>r.status==='suppressed'&&r.platform==='tiktok').length,2);
   const outbox=rows.find(r=>r.platform==='meta'&&r.event_id===events[0].id);assert.ok(outbox);
   // Relational dispatch proof only. The actual leased adapter/crash lifecycle
   // is tested after application; this controlled lease has no network effect.
   await tx`update app.outbox_job set status='processing',attempts=1,lease_token=${randomUUID()},lease_until=clock_timestamp()+interval '30 seconds',dispatched_at=clock_timestamp() where id=${outbox.job_id}`;
   const payload=localSignalPayload(events[0] as Parameters<typeof localSignalPayload>[0]);
   stage='local exact payload';await assert.rejects(tx.savepoint(t=>t`insert into app.local_ad_sink (outbox_id,event_id,platform,payload_hash,payload) values (${outbox.id},${events[0].id},'meta',repeat('a',64),${JSON.stringify({...payload,value:1})}::jsonb)`),{code:'23514'});
   await tx`insert into app.local_ad_sink (outbox_id,event_id,platform,payload_hash,payload) values (${outbox.id},${events[0].id},'meta',${digest(JSON.stringify(payload))},${JSON.stringify(payload)}::jsonb)`;
   await tx`update app.ad_event_outbox set status='accepted',reason='accepted_local' where id=${outbox.id}`;
   await tx`insert into app.ad_delivery_attempt (outbox_id,kind,outcome) values (${outbox.id},'dispatch','accepted')`;
   stage='withdrawal';const current=await readVisitor(tx,request,f.identity,actor);assert.ok(current);await recordConsent(tx,current,randomUUID(),{expected_version:1,policy_version:'local-privacy-v1',choices:{...choices,advertising_measurement:'denied'}});
   assert.equal((await tx`select status from app.ad_event_outbox where id=${outbox.id}`)[0].status,'accepted');assert.equal((await tx`select count(*)::int n from app.ad_event_outbox where event_id in ${tx(events.map(e=>e.id))} and status='queued'`)[0].n,0);
   assert.deepEqual(Object.keys(payload).sort(),['content_ids','contents','currency','event_id','event_name','occurred_at','value']);
   stage='complete seals';await tx`set constraints all immediate`;throw rollback;
  }),error=>{if(error===rollback)return true;const safe=error as {code?:unknown;constraint_name?:unknown};assert.fail(`Cart signal candidate failed at ${stage} (${String(safe.code??'domain')}/${String(safe.constraint_name??'constraint')})`);});
 }finally{await owner.sql.end();await f.close();}
});
