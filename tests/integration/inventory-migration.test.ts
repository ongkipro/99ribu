import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { connectDatabase } from "../../src/db/client.ts";

test("inventory candidate/applied SQL rejects unposted, negative and unsealed state without persisting fixtures", async () => {
  const { sql } = connectDatabase("test", "owner"); const rollback = new Error("ROLLBACK_OWN_INVENTORY_PROBE");
  const [before] = await sql`select count(*)::int as n from information_schema.tables where table_schema='app'`;
  try {
    await assert.rejects(sql.begin(async (tx) => {
      const [installed] = await tx`select to_regclass('app.inventory_balance') as relation`;
      if (!installed.relation) {
        const migration = await readFile(new URL("../../migrations/0010_physical_inventory.sql", import.meta.url), "utf8");
        for (const statement of migration.split("--> statement-breakpoint").map((v) => v.trim()).filter(Boolean)) {
          try { await tx.unsafe(statement); }
          catch (error) { throw new Error(`Candidate DDL ${statement.split("\n")[0]}: ${error instanceof Error ? error.message : "failed"}`); }
        }
      }
      async function rejects(write: () => Promise<unknown>) {
        await tx.unsafe("SAVEPOINT inventory_negative"); let failed = false;
        try { await write(); }
        catch (error) { assert.ok(error && typeof error === "object" && "code" in error); assert.equal(error.code, "23514"); failed = true; }
        finally { await tx.unsafe("ROLLBACK TO SAVEPOINT inventory_negative"); await tx.unsafe("RELEASE SAVEPOINT inventory_negative"); }
        assert.equal(failed, true, "The database must reject the invalid inventory state");
      }
      const [warehouse] = await tx`insert into app.warehouse (name,city) values ('Synthetic inventory SQL probe','Malang') returning id`;
      const namespace = `p${randomUUID().replaceAll("-", "").slice(0,20)}`;
      const fixtureTime = new Date(Date.now() + 86400000).toISOString();
      await tx`insert into app.local_fixture_namespace (name,clock) values (${namespace},${fixtureTime})`;
      await tx`insert into app.local_fixture_warehouse (namespace,fixture_id,warehouse_id) values (${namespace},'inventory-probe',${warehouse.id})`;
      const [clock] = await tx`select app.inventory_clock(${warehouse.id}) as normal_time,app.inventory_clock(${warehouse.id},${namespace}) as fixture_time`;
      assert.equal(new Date(clock.fixture_time).toISOString(), fixtureTime);
      assert.ok(Math.abs(new Date(clock.normal_time).getTime() - Date.now()) < 1000, "Warehouse mapping alone must never freeze normal application time");
      const [stock] = await tx`insert into app.stock_item (sku,name) values (${`PROBE-${randomUUID()}`.toUpperCase()},'Synthetic SQL component') returning id`;
      await rejects(() => tx`insert into app.inventory_balance (warehouse_id,stock_item_id,on_hand) values (${warehouse.id},${stock.id},1)`);
      const [balance] = await tx`insert into app.inventory_balance (warehouse_id,stock_item_id) values (${warehouse.id},${stock.id}) returning id,revision`;
      assert.equal(balance.revision, 0);
      await rejects(() => tx`update app.inventory_balance set on_hand=1,revision=1 where id=${balance.id}`);
      await tx`insert into app.stock_movement (balance_id,revision,kind,quantity,on_hand_delta,reserved_delta,quarantined_delta,source_ref,reason)
        values (${balance.id},1,'receive',1,1,0,0,${randomUUID()},'Synthetic initial receipt')`;
      await tx`update app.inventory_balance set on_hand=1,revision=1 where id=${balance.id}`;
      await rejects(async () => {
        await tx`insert into app.stock_movement (balance_id,revision,kind,quantity,on_hand_delta,reserved_delta,quarantined_delta,source_ref,reason)
          values (${balance.id},2,'adjust_down',2,-2,0,0,${randomUUID()},'Synthetic oversell attempt')`;
        await tx`update app.inventory_balance set on_hand=-1,revision=2 where id=${balance.id}`;
      });
      await rejects(async () => {
        await tx`insert into app.stock_movement (balance_id,revision,kind,quantity,on_hand_delta,reserved_delta,quarantined_delta,source_ref,reason)
          values (${balance.id},2,'adjust_up',1,1,0,0,${randomUUID()},'Synthetic missing balance commit')`;
        await tx.unsafe("SET CONSTRAINTS app.stock_movement_applied IMMEDIATE");
      });
      await rejects(() => tx`insert into app.stock_reservation (key,request_hash,kind,expires_at)
        values (${randomUUID()},${"0".repeat(64)},'checkout',null)`);
      await rejects(async () => {
        await tx`insert into app.stock_reservation (key,request_hash,kind,expires_at)
          values (${randomUUID()},${"0".repeat(64)},'checkout',clock_timestamp()+interval '5 minutes')`;
        await tx.unsafe("SET CONSTRAINTS app.stock_reservation_sealed IMMEDIATE");
      });
      const [after] = await tx`select on_hand,reserved,quarantined,revision from app.inventory_balance where id=${balance.id}`;
      assert.deepEqual(after, { on_hand: 1, reserved: 0, quarantined: 0, revision: 1 });
      throw rollback;
    }), (error: unknown) => error === rollback);
    const [after] = await sql`select count(*)::int as n from information_schema.tables where table_schema='app'`;
    assert.equal(after.n, before.n, "Candidate DDL and all synthetic rows must roll back");
  } finally { await sql.end(); }
});
