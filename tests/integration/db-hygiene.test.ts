import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connectDatabase } from "../../src/db/client.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Principal } from "../../src/modules/access/policy.ts";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { listStaffSupportInbox } from "../../src/modules/support/service.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";

// S104: database hot paths and hygiene. Plans and timings are recorded in BUILD-LOG (EXPLAIN before/after).

test("S104 admin categories list only categories used by a current draft or live product, with their ancestors", async () => {
  const identity = createLocalAuth("test"); const users: Awaited<ReturnType<typeof actor>>[] = [];
  const [wh] = await identity.sql`insert into app.warehouse (name,city) values ('Synthetic Hygiene','Malang') returning id`;
  try {
    const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
    const call = async (method: string, path: string, body?: Record<string, unknown>) => {
      const base = owner.browser.request(`/api/v1/admin${path}`, body); base.headers.set("idempotency-key", randomUUID());
      const response = await handleCatalog(new Request(base, { method }), identity);
      return { status: response.status, payload: await response.json() };
    };
    const ok = async (path: string, body: Record<string, unknown>) => {
      const r = await call("POST", path, body); assert.equal(r.status, 201, JSON.stringify(r.payload)); return r.payload;
    };
    const listed = async () => {
      const ids = new Set<string>(); let cursor: string | null = null;
      do {
        const r = await call("GET", `/categories?limit=100${cursor ? `&cursor=${cursor}` : ""}`); assert.equal(r.status, 200, JSON.stringify(r.payload));
        for (const row of r.payload.data) { assert.ok(!ids.has(row.id), "keyset pages never repeat a category"); ids.add(row.id); }
        cursor = r.payload.pagination.next_cursor;
      } while (cursor);
      return ids;
    };
    const tag = randomUUID().slice(0, 8);
    const department = await ok("/categories", { name: `Synthetic dept ${tag}`, slug: `synthetic-${randomUUID()}`, parent_id: null, attribute_definitions: [] });
    const leaf = await ok("/categories", { name: `Synthetic leaf ${tag}`, slug: `synthetic-${randomUUID()}`, parent_id: department.id, attribute_definitions: [] });
    const unused = await ok("/categories", { name: `Synthetic unused ${tag}`, slug: `synthetic-${randomUUID()}`, parent_id: null, attribute_definitions: [] });
    let ids = await listed();
    assert.ok(!ids.has(department.id) && !ids.has(leaf.id) && !ids.has(unused.id), "a category without a product is not listed");

    const stock = await ok("/stock-items", { sku: `HYG-${randomUUID()}`.toUpperCase(), name: "Synthetic hygiene component" });
    await ok("/products", { name: `Synthetic hygiene ${tag}`, category_id: leaf.id, description: " ", images: [], variants: [{
      sku: `HYG-${randomUUID()}`.toUpperCase(), label: "Synthetic unit", attributes: [], offer_kind: "unit", weight_grams: 100, length_mm: 100,
      width_mm: 100, height_mm: 100, default_warehouse_id: wh.id, contents: [{ stock_item_id: stock.id, name: stock.name, quantity: 1 }] }] });
    ids = await listed();
    assert.ok(ids.has(leaf.id), "the draft's category is listed");
    assert.ok(ids.has(department.id), "its department (ancestor) is listed so the picker can show the path");
    assert.ok(!ids.has(unused.id), "an unused category stays hidden");
    // Old rows stay readable by id for products that still point at them (no row is deleted or hidden from joins).
    const [row] = await identity.sql`select id from app.category where id=${unused.id}`; assert.equal(row.id, unused.id);
  } finally {
    await cleanup(identity, users); await identity.sql`update app.warehouse set active=false where id=${wh.id}`; await identity.sql.end();
  }
});

test("S104 staff support inbox pages by keyset (activity desc, id desc) with SQL unread filtering and a bounded query", async () => {
  const { sql } = connectDatabase("test", "owner"); const rollback = new Error("rollback");
  try {
    await assert.rejects(sql.begin(async (tx) => {
      const agent = `hygiene-${randomUUID()}`;
      await tx`insert into app.auth_user (id,name,email,email_verified) values (${agent},'Synthetic agent',${`${agent}@example.invalid`},true)`;
      // Five conversations of one synthetic assignee; c3 and c4 share an activity instant (id breaks the tie).
      const base = Date.parse("2026-01-01T00:00:00.000Z");
      const at = [base + 5000, base + 4000, base + 3000, base + 3000, null];
      const ids: string[] = [];
      for (const [n, instant] of at.entries()) {
        const [c] = await tx`insert into app.support_conversation (assigned_user_id,public_sequence,last_public_message_at,created_at)
          values (${agent},${n + 1},${instant === null ? null : new Date(instant).toISOString()},${new Date(base + 1000).toISOString()}) returning id`;
        ids.push(c.id);
      }
      // The agent has read everything in conversations 0 and 2.
      for (const n of [0, 2]) await tx`insert into app.support_read_position (conversation_id,participant_scope,reader_side,last_read_sequence) values (${ids[n]},${`user:${agent}`},'staff',${n + 1})`;
      const principal = { id: agent } as Principal;
      const page = (query: string) => listStaffSupportInbox(tx, principal, new URL(`http://127.0.0.1:3099/api/v1/admin/support/conversations?assignment=all&assignee_user_id=${agent}&${query}`));
      const [tieHigh, tieLow] = [ids[2], ids[3]].sort().reverse();
      const expected = [ids[0], ids[1], tieHigh, tieLow, ids[4]];
      const seen: string[] = []; let cursor: string | null = null; let pages = 0;
      do {
        const result = await page(`limit=2${cursor ? `&cursor=${cursor}` : ""}`); pages++;
        assert.ok(result.data.length <= 2);
        seen.push(...result.data.map((item) => item.conversation.id));
        assert.equal(result.pagination.has_more, result.pagination.next_cursor !== null);
        cursor = result.pagination.next_cursor;
      } while (cursor);
      assert.deepEqual(seen, expected, "newest activity first, id desc on ties, no repeats or gaps");
      assert.equal(pages, 3);
      const unread = await page("limit=10&unread=true");
      assert.deepEqual(unread.data.map((item) => item.conversation.id), expected.filter((id) => id !== ids[0] && id !== ids[2]));
      assert.ok(unread.data.every((item) => item.current_agent_unread_messages > 0));
      const read = await page("limit=10&unread=false");
      assert.deepEqual(read.data.map((item) => item.conversation.id), expected.filter((id) => id === ids[0] || id === ids[2]));
      await assert.rejects(page(`limit=2&cursor=${randomUUID()}`), { code: "INVALID_CURSOR" });
      throw rollback;
    }), (error) => error === rollback);
  } finally { await sql.end(); }
});
