import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import test from "node:test";
import { connectDatabase } from "../src/db/client.ts";
import { enqueueLocalDelivery } from "../src/jobs/outbox.ts";

const exec = promisify(execFile);
const command = ["--env-file=.env.example", "scripts/worker.ts", "test", "--once"];

test("outbox is atomic and idempotent; competing workers and a killed transaction preserve one effect", async (t) => {
  const { sql } = connectDatabase("test");
  const ids: string[] = [];
  const ownedJobs=new Map<string,string>();
  const targeted=(deliveryId:string)=>{const jobId=ownedJobs.get(deliveryId);assert.ok(jobId);return [...command,jobId];};
  async function seed() {
    const id = randomUUID(); ids.push(id);
    await sql.begin(async (tx) => {
      await tx`insert into app.local_delivery (id, recipient, kind, url, expires_at) values (${id}, 'worker@example.test', 'existing_account', 'http://127.0.0.1:3099/login', now()+interval '30 minutes')`;
      const first = await enqueueLocalDelivery(tx, id);ownedJobs.set(id,first);
      assert.equal(await enqueueLocalDelivery(tx, id), first);
    });
    return id;
  }
  try {
    await t.test("targeted host execution preserves older unrelated work and missing IDs cannot select another job",async()=>{
      const older=await seed(),selected=await seed();
      await exec(process.execPath,targeted(selected),{timeout:10000});
      await exec(process.execPath,[...command,randomUUID()],{timeout:10000});
      const [pending]=await sql`select status,attempts from app.outbox_job where id=${ownedJobs.get(older) as string}`;
      assert.equal(pending.status,'pending');assert.equal(pending.attempts,0);assert.equal((await sql`select delivered_at from app.local_delivery where id=${older}`)[0].delivered_at,null);
      const [completed]=await sql`select status,attempts from app.outbox_job where id=${ownedJobs.get(selected) as string}`;assert.equal(completed.status,'completed');assert.equal(completed.attempts,1);
    });
    await t.test("upgrade preserves delivered legacy messages without marking queued intents delivered", async () => {
      const queued = await seed();
      const legacy = randomUUID(); ids.push(legacy);
      await sql.begin(async (tx) => {
        await tx`insert into app.local_delivery (id, recipient, kind, url, expires_at) values (${legacy}, 'legacy@example.test', 'existing_account', 'http://127.0.0.1:3099/login', now()+interval '30 minutes')`;
        const migration = await readFile(new URL("../migrations/0004_preserve_delivered_inbox.sql", import.meta.url), "utf8");
        await tx.unsafe(migration);
        const [old] = await tx`select delivered_at=created_at as preserved from app.local_delivery where id=${legacy}`;
        const [pending] = await tx`select delivered_at from app.local_delivery where id=${queued}`;
        assert.equal(old.preserved, true); assert.ok(pending.delivered_at === null);
      });
      await exec(process.execPath, targeted(queued), { timeout: 10000 });
    });
    await t.test("domain intent and job roll back together", async () => {
      const id = randomUUID(); ids.push(id);
      await assert.rejects(sql.begin(async (tx) => {
        await tx`insert into app.local_delivery (id, recipient, kind, url, expires_at) values (${id}, 'rollback@example.test', 'existing_account', 'http://127.0.0.1:3099/login', now()+interval '30 minutes')`;
        await enqueueLocalDelivery(tx, id);
        throw new Error("synthetic rollback");
      }), /synthetic rollback/);
      assert.equal((await sql`select id from app.local_delivery where id=${id}`).length, 0);
      assert.equal((await sql`select id from app.outbox_job where dedup_key=${`local-delivery:${id}`}`).length, 0);
    });
    await t.test("independent worker processes contend on each real job and produce one completion", async () => {
      const queued = [await seed(), await seed()];
      for(const id of queued){
        let pending:Promise<unknown>[]=[];
        try{
          await sql.begin(async tx=>{
            await tx`select id from app.local_delivery where id=${id} for update`;
            let finished=0;
            pending=Array.from({length:2},()=>exec(process.execPath,targeted(id),{timeout:10000}).then(result=>{finished++;return result;}));
            for(const child of pending)void child.catch(()=>{});
            let concurrent=false;
            for(let attempt=0;attempt<100;attempt++){
              const [waiting]=await sql`select count(*)::int n from pg_stat_activity where datname='99ribu_test' and usename='99ribu_test_app' and wait_event_type='Lock' and query like 'select recipient, url, expires_at from app.local_delivery%'`;
              if(waiting.n===1&&finished===1){concurrent=true;break;}
              await setTimeout(30);
            }
            assert.ok(concurrent,'One real worker must hold the targeted job transaction while its competing process finishes without taking that locked job');
          });
        }finally{await Promise.all(pending);}
      }
      const jobs = await sql`select status, attempts from app.outbox_job where payload->>'deliveryId' in ${sql(queued)}`;
      assert.equal(jobs.length, 2);
      assert.ok(jobs.every((row) => row.status === "completed" && row.attempts === 1));
      assert.equal((await sql`select id from app.local_delivery where id in ${sql(queued)} and delivered_at is not null`).length, 2);
    });
    await t.test("worker death before commit leaves a durable job for its replacement", async () => {
      const id = await seed();
      await sql.begin(async (tx) => {
        await tx`select id from app.local_delivery where id=${id} for update`;
        const child = spawn(process.execPath, targeted(id), { stdio: "ignore" });
        const exited = once(child, "exit");
        try {
          let waiting = false;
          for (let i = 0; i < 100; i++) {
            const rows = await sql`select pid from pg_stat_activity where datname='99ribu_test' and usename='99ribu_test_app' and wait_event_type='Lock' and query like 'select recipient, url, expires_at from app.local_delivery%'`;
            if (rows.length > 0) { waiting = true; break; }
            await setTimeout(30);
          }
          assert.ok(waiting, "Worker must actually hold its job transaction before the crash");
        } finally {
          child.kill("SIGKILL"); await exited;
        }
      });
      const [pending] = await sql`select status, attempts from app.outbox_job where dedup_key=${`local-delivery:${id}`}`;
      assert.equal(pending.status, "pending"); assert.equal(pending.attempts, 0);
      await exec(process.execPath, targeted(id), { timeout: 10000 });
      const [done] = await sql`select status, attempts from app.outbox_job where dedup_key=${`local-delivery:${id}`}`;
      assert.equal(done.status, "completed"); assert.equal(done.attempts, 1);
      await exec(process.execPath, targeted(id), { timeout: 10000 });
      const [again] = await sql`select attempts from app.outbox_job where dedup_key=${`local-delivery:${id}`}`;
      assert.equal(again.attempts, 1);
    });
    await t.test("unknown payloads are terminal failures without side effects", async () => {
      const id = randomUUID(); ids.push(id);
      const [inserted]=await sql`insert into app.outbox_job (kind, dedup_key, payload) values ('local.notification', ${`local-delivery:${id}`}, ${JSON.stringify({ deliveryId: "-".repeat(36) })}::jsonb) returning id`;ownedJobs.set(id,inserted.id);
      await exec(process.execPath, targeted(id), { timeout: 10000 });
      const [job] = await sql`select status, last_error from app.outbox_job where dedup_key=${`local-delivery:${id}`}`;
      assert.equal(job.status, "failed"); assert.equal(job.last_error, "invalid_payload");
    });
    await t.test("worker refuses live or missing modes and unknown arguments before readiness", async () => {
      for (const changes of [{ SHIPPING_ADAPTER: "live" }, { NOTIFICATION_ADAPTER: "" }, { EXTERNAL_DISPATCH: "enabled" }]) {
        await assert.rejects(exec(process.execPath, command, { env: { ...process.env, ...changes }, timeout: 10000 }), (error: unknown) => {
          assert.ok(error instanceof Error && "stdout" in error && !String(error.stdout).includes("worker_ready")); return true;
        });
      }
      for(const suffix of [["--unknown"],["not-a-job-id"],[randomUUID(),randomUUID()]])await assert.rejects(exec(process.execPath,[...command,...suffix],{timeout:10000}),(error:unknown)=>{assert.ok(error instanceof Error&&"stdout"in error&&!String(error.stdout).includes("worker_ready"));return true;});
    });
  } finally {
    const keys = ids.map((id) => `local-delivery:${id}`);
    await sql`delete from app.outbox_job where dedup_key in ${sql(keys)}`;
    await sql`delete from app.local_delivery where id in ${sql(ids)}`;
    await sql.end();
  }
});
