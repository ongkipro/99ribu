import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';
import {enqueueJob} from '../../src/jobs/outbox.ts';
import {claimJob,markDispatched,type JobAdapter} from '../../src/jobs/leases.ts';
import {runOneJob} from '../../src/jobs/worker.ts';

test('targeted payment-worker selection processes only the owned identity and leaves unrelated expired leases intact',async()=>{
 const {sql}=connectDatabase('test'),kind=`payment-proof-${randomUUID()}`,owned:string[]=[],seen:string[]=[];
 const adapter:JobAdapter={async dispatch(claim){seen.push(claim.id);return {status:'succeeded',receipt:{source:'TEST-ONLY no external effect'}};},async reconcile(){throw new Error('Unexpected proof reconciliation');}};
 try{
  const foreign=await sql.begin(tx=>enqueueJob(tx,kind,randomUUID(),{proof:'unrelated no-effect fixture'}));owned.push(foreign);
  const target=await sql.begin(tx=>enqueueJob(tx,kind,randomUUID(),{proof:'owned no-effect fixture'}));owned.push(target);
  const claim=await claimJob(sql,kind,false,foreign);assert.ok(claim);assert.equal(await markDispatched(sql,claim),true);
  // Only this synthetic no-effect lease clock is advanced; no money/order clock.
  await sql`update app.outbox_job set lease_until=clock_timestamp()-interval '1 second' where id=${foreign}`;
  const before=await sql`select status,attempts,lease_token,lease_until,run_at from app.outbox_job where id=${foreign}`;
  assert.equal(await runOneJob(sql,{[kind]:adapter},target),true);assert.deepEqual(seen,[target]);
  assert.deepEqual(await sql`select status,attempts,lease_token,lease_until,run_at from app.outbox_job where id=${foreign}`,before);
  assert.equal(await runOneJob(sql,{[kind]:adapter},randomUUID()),false);assert.equal(await runOneJob(sql,{[kind]:adapter},target),false);
  assert.equal((await sql`select status from app.outbox_job where id=${target}`)[0].status,'completed');
  await assert.rejects(runOneJob(sql,{[kind]:adapter},'invalid-job'),{code:'INVALID_INPUT'});
  assert.deepEqual(await sql`select status,attempts,lease_token,lease_until,run_at from app.outbox_job where id=${foreign}`,before);
 }finally{if(owned.length) await sql`delete from app.outbox_job where id in ${sql(owned)}`;await sql.end();}
});
