import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import type {Claim} from '../../src/jobs/leases.ts';
import {runOneJob} from '../../src/jobs/worker.ts';
import {advertisingAdapter} from '../../src/modules/advertising/worker.ts';
import {advertisingFixture,deniedChoices} from './advertising-fixture.ts';

async function add(f:Awaited<ReturnType<typeof advertisingFixture>>){
 const body={lines:[f.line()]},key=randomUUID();let result=await f.client.call('/api/v1/carts',body,{key});if(result.response.status===401)result=await f.client.call('/api/v1/carts',body,{key});assert.equal(result.response.status,201);
 const [event]=await f.identity.sql`select * from app.commerce_event where source_kind='commerce_operation' and payload->>'cart_id'=${result.payload.cart.id} and name='cart_changed'`;assert.ok(event);
 const rows=await f.identity.sql`select * from app.ad_event_outbox where event_id=${event.id} order by platform`;assert.equal(rows.length,3);assert.ok(rows.every(r=>r.status==='queued'));
 return {event,rows};
}
test('actual advertising lease lost acknowledgement reconciles one canonical sink after consent withdrawal without resending',async()=>{
 const f=await advertisingFixture();
 try{
  await f.consent(f.client);const {event,rows}=await add(f),outbox=rows.find(r=>r.platform==='meta');assert.ok(outbox);
  const adapter=advertisingAdapter(f.identity.sql,'test',new Map([[outbox.id,'after-commit-lost-ack']]));
  assert.equal(await runOneJob(f.identity.sql,{'advertising.dispatch':adapter},outbox.job_id),true);
  assert.equal((await f.identity.sql`select status from app.outbox_job where id=${outbox.job_id}`)[0].status,'unknown');
  const [first]=await f.identity.sql`select * from app.local_ad_sink where outbox_id=${outbox.id}`;assert.ok(first);assert.equal(first.event_id,event.id);assert.equal(first.payload.event_id,event.id);assert.equal(first.payload.occurred_at,new Date(event.occurred_at).toISOString());assert.equal(first.payload.value,99000);
  assert.deepEqual(Object.keys(first.payload).sort(),['content_ids','contents','currency','event_id','event_name','occurred_at','value']);
  await f.consent(f.client,deniedChoices,1);
  assert.equal((await f.identity.sql`select count(*)::int n from app.ad_event_outbox where event_id=${event.id} and status='cancelled'`)[0].n,2);
  await f.identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${outbox.job_id} and status='unknown'`;
  assert.equal(await runOneJob(f.identity.sql,{'advertising.dispatch':advertisingAdapter(f.identity.sql,'test')},outbox.job_id),true);
  assert.equal((await f.identity.sql`select status from app.outbox_job where id=${outbox.job_id}`)[0].status,'completed');
  const sinks=await f.identity.sql`select * from app.local_ad_sink where event_id=${event.id}`;assert.equal(sinks.length,1);assert.deepEqual(sinks[0].payload,first.payload);
  const attempts=await f.identity.sql`select kind,outcome from app.ad_delivery_attempt where outbox_id=${outbox.id} order by recorded_at,id`;assert.deepEqual(attempts.map(r=>[r.kind,r.outcome]),[['dispatch','accepted'],['reconcile','accepted']]);
  for(const cancelled of rows.filter(r=>r.id!==outbox.id)) assert.equal(await runOneJob(f.identity.sql,{'advertising.dispatch':advertisingAdapter(f.identity.sql,'test')},cancelled.job_id),false);
 }finally{await f.close();}
});

test('actual local signal rollback reconciles definitive no effect and fences an old sender; simultaneous workers send once',async()=>{
 const f=await advertisingFixture();
 try{
  await f.consent(f.client);const {rows}=await add(f),outbox=rows[0],adapter=advertisingAdapter(f.identity.sql,'test',new Map([[outbox.id,'before-commit']]));let oldClaim:Claim|undefined;
  assert.equal(await runOneJob(f.identity.sql,{'advertising.dispatch':{dispatch:(claim,signal)=>{oldClaim=claim;return adapter.dispatch(claim,signal);},reconcile:adapter.reconcile}},outbox.job_id),true);assert.ok(oldClaim);
  assert.equal((await f.identity.sql`select count(*)::int n from app.local_ad_sink where outbox_id=${outbox.id}`)[0].n,0);assert.equal((await f.identity.sql`select status from app.outbox_job where id=${outbox.job_id}`)[0].status,'unknown');
  await f.identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${outbox.job_id} and status='unknown'`;
  const current=advertisingAdapter(f.identity.sql,'test');assert.equal(await runOneJob(f.identity.sql,{'advertising.dispatch':current},outbox.job_id),true);
  assert.equal((await f.identity.sql`select status from app.ad_event_outbox where id=${outbox.id}`)[0].status,'quarantined');assert.equal((await f.identity.sql`select status from app.outbox_job where id=${outbox.job_id}`)[0].status,'failed');
  assert.equal((await current.dispatch(oldClaim,new AbortController().signal)).status,'unknown');assert.equal((await f.identity.sql`select count(*)::int n from app.local_ad_sink where outbox_id=${outbox.id}`)[0].n,0);
  const concurrent=rows[1],results=await Promise.all([runOneJob(f.identity.sql,{'advertising.dispatch':current},concurrent.job_id),runOneJob(f.identity.sql,{'advertising.dispatch':current},concurrent.job_id)]);assert.deepEqual(results.sort(),[false,true]);
  assert.equal((await f.identity.sql`select count(*)::int n from app.local_ad_sink where outbox_id=${concurrent.id}`)[0].n,1);
  const withdrawn=await f.consent(f.client,deniedChoices,1);assert.equal(withdrawn.version,2);
  assert.equal((await f.identity.sql`select status from app.ad_event_outbox where id=${outbox.id}`)[0].status,'quarantined');assert.equal((await f.identity.sql`select count(*)::int n from app.local_ad_sink where outbox_id=${outbox.id}`)[0].n,0);
 }finally{await f.close();}
});
