import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { getPrincipal } from "../../src/modules/access/policy.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { readPublicationState } from "../../src/modules/catalog/publication.ts";
import { appendCostVersion } from "../../src/modules/finance/costs.ts";
import { handleInventory } from "../../src/modules/inventory/routes.ts";
import { actor, BrowserSession, cleanup, enroll } from "../contract/access-fixture.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";

type Actor = Awaited<ReturnType<typeof actor>>;
type Summary = {
  id: string; name: string; category_id: string | null; category_path: string | null; image_url: string | null;
  offer_kinds: string[]; offer_count: number; stock_ready_offers: number; price_idr: number; state: string;
  latest_publication_version: number; published_revision: number | null; ready: boolean; blocker_codes: string[];
};

test("admin product list returns publication summaries with server filters, and withdrawal is an audited, versioned, idempotent command", async () => {
  const identity = createLocalAuth("test"); const users: Actor[] = []; const samples: Exchange[] = [];
  const [wh] = await identity.sql`insert into app.warehouse (name,city) values ('Synthetic Summary','Malang') returning id`;
  try {
    const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
    const send = async (user: { browser: BrowserSession }, method: string, path: string, body?: Record<string, unknown>, key: string = randomUUID()) => {
      const base = user.browser.request(`/api/v1/admin${path}`, body); base.headers.set("idempotency-key", key);
      const req = new Request(base, { method }); const sent = req.body ? await req.clone().text() : undefined;
      const response = await handleCatalog(req, identity); const payload = await response.json();
      return { status: response.status, payload, headers: Object.fromEntries(response.headers), req, sent };
    };
    const ok = async (method: string, path: string, body?: Record<string, unknown>, expected = 201) => {
      const r = await send(owner, method, path, body); assert.equal(r.status, expected, JSON.stringify(r.payload)); return r.payload;
    };
    const observe = async (user: { browser: BrowserSession }, path: string, body: Record<string, unknown>, status: number, key?: string) => {
      const r = await send(user, "POST", path, body, key); assert.equal(r.status, status, JSON.stringify(r.payload));
      samples.push({ url: r.req.url, method: "POST", request_headers: Object.fromEntries([...r.req.headers].filter(([k]) => ["content-type", "idempotency-key"].includes(k))),
        request_body: r.sent, body_bytes: r.sent ? Buffer.byteLength(r.sent) : undefined, status, headers: r.headers, payload: r.payload });
      return r.payload;
    };
    const list = async (query: string) => {
      const r = await send(owner, "GET", `/products?${query}`); assert.equal(r.status, 200, JSON.stringify(r.payload));
      return r.payload as { data: Summary[]; pagination: { next_cursor: string | null } };
    };
    const principal = () => getPrincipal(owner.browser.request("/api/v1/me"), identity);

    // A current commercial policy is a precondition of the financial publish guard (same as finance-publication).
    let history = await (await owner.browser.access("/admin/policy-versions?kind=commercial")).json();
    if (history.latest_version === 0) {
      const proofReq = owner.browser.request("/api/v1/me/reauthentication-proofs", { password: owner.password, action: "company_policy.version", subject_id: "company-commercial" });
      proofReq.headers.set("idempotency-key", randomUUID()); const proof = (await (await handleAccess(proofReq, identity)).json()).proof;
      const req = owner.browser.request("/api/v1/admin/policy-versions", { kind: "commercial", warehouse_id: null, expected_version: 0, effective_at: null,
        values: { default_commission_bps: 1000, minimum_payout_idr: 99000 }, reason: "Synthetic summary baseline", reauthentication_proof: proof });
      req.headers.set("idempotency-key", randomUUID()); assert.equal((await handleAccess(req, identity)).status, 201);
      history = await (await owner.browser.access("/admin/policy-versions?kind=commercial")).json();
    }
    assert.ok(history.current, "current commercial policy");

    const tag = randomUUID().slice(0, 8);
    const parent = await ok("POST", "/categories", { name: `Synthetic parent ${tag}`, slug: `synthetic-${randomUUID()}`, parent_id: null, attribute_definitions: [] });
    const child = await ok("POST", "/categories", { name: `Synthetic child ${tag}`, slug: `synthetic-${randomUUID()}`, parent_id: parent.id, attribute_definitions: [] });
    const unrelated = await ok("POST", "/categories", { name: `Synthetic other ${tag}`, slug: `synthetic-${randomUUID()}`, parent_id: null, attribute_definitions: [] });
    const stock = await ok("POST", "/stock-items", { sku: `SUM-${randomUUID()}`.toUpperCase(), name: "Synthetic summary component" });
    const name = `Synthetic summary ${tag}`;
    const product = await ok("POST", "/products", { name, category_id: child.id, description: " ", images: [], variants: [{
      sku: `SUM-${randomUUID()}`.toUpperCase(), label: "Synthetic unit", attributes: [], offer_kind: "unit", weight_grams: 100, length_mm: 100,
      width_mm: 100, height_mm: 100, default_warehouse_id: wh.id, contents: [{ stock_item_id: stock.id, name: stock.name, quantity: 1 }] }] });
    const q = `q=${encodeURIComponent(name)}`;

    // Draft summary: blocked, same codes as the authoritative publication state for the covered checks.
    let [row] = (await list(q)).data; assert.equal(row.id, product.id);
    assert.equal(row.state, "blocked"); assert.equal(row.ready, false); assert.equal(row.category_id, child.id);
    assert.equal(row.category_path, `Synthetic parent ${tag} › Synthetic child ${tag}`); assert.equal(row.image_url, null);
    assert.deepEqual(row.offer_kinds, ["unit"]); assert.equal(row.offer_count, 1); assert.equal(row.stock_ready_offers, 0);
    assert.equal(row.price_idr, 99000); assert.equal(row.latest_publication_version, 0); assert.equal(row.published_revision, null);
    const authoritative = async () => [...new Set((await readPublicationState(identity, await principal(), product.id)).blockers.map((b) => b.code))].sort();
    assert.deepEqual(row.blocker_codes, await authoritative());
    for (const code of ["MEDIA_REQUIRED", "DESCRIPTION_REQUIRED", "COMPLETE_STOCK_REQUIRED", "UNKNOWN_HPP", "UNKNOWN_PACKAGING_IDR"]) assert.ok(row.blocker_codes.includes(code), code);

    // Server-side filters: descendant category, state, literal text (a % is not a wildcard), strict parameters.
    assert.equal((await list(`${q}&category_id=${parent.id}`)).data.length, 1);
    assert.equal((await list(`${q}&category_id=${unrelated.id}`)).data.length, 0);
    assert.equal((await list(`${q}&state=blocked`)).data.length, 1);
    assert.equal((await list(`${q}&state=ready`)).data.length, 0);
    assert.equal((await list(`q=${encodeURIComponent(`${name}%`)}`)).data.length, 0);
    assert.equal((await list(`q=${encodeURIComponent(tag)}&limit=1`)).data.length, 1);
    for (const bad of ["state=draft", "q=", "q=%20", `category_id=${parent.id}&category_id=${child.id}`, "sort=name"])
      assert.equal((await send(owner, "GET", `/products?${bad}`)).status, 400, bad);

    // Complete the draft: description, media, stock, HPP and assumptions → ready, still matching the guard.
    await ok("PATCH", `/products/${product.id}`, { expected_version: 1, reason: "Synthetic complete draft", description: "Synthetic description",
      images: [{ url: "https://example.invalid/summary.webp", alt: "Synthetic", width: 100, height: 100 }] }, 200);
    const receive = owner.browser.request("/api/v1/admin/inventory/movements", { warehouse_id: wh.id, stock_item_id: stock.id, kind: "receive", quantity: 2, expected_version: 0, reason: "Synthetic summary stock" });
    receive.headers.set("idempotency-key", randomUUID()); assert.equal((await handleInventory(receive, identity)).status, 201);
    const append = async (kind: "component" | "assumption", scope: string, body: Record<string, unknown>) => {
      const req = owner.browser.request("/api/v1/admin/x", body); req.headers.set("idempotency-key", randomUUID());
      return appendCostVersion(req, identity, await principal(), kind, scope, body);
    };
    await append("component", stock.id, { unit_cost: 30000, expected_version: 0, effective_from: null, source: "Synthetic supplier", reason: "Synthetic HPP" });
    await append("assumption", product.variants[0].id, { expected_version: 0, effective_from: null, source: "Synthetic costs", reason: "Synthetic assumptions",
      packaging_idr: 2000, provider_fee_idr: 1000, subsidy_idr: 5000, returns_reserve_idr: 1000 });
    [row] = (await list(q)).data;
    assert.equal(row.state, "ready"); assert.deepEqual(row.blocker_codes, []); assert.deepEqual(await authoritative(), []);
    assert.equal(row.stock_ready_offers, 1); assert.equal(row.image_url, "https://example.invalid/summary.webp");

    // Publish → published.
    await ok("POST", `/products/${product.id}/publications`, { expected_version: 2, expected_publication_version: 0, reason: "Synthetic publish" });
    [row] = (await list(`${q}&state=published`)).data;
    assert.equal(row.published_revision, 2); assert.equal(row.latest_publication_version, 1);

    // Withdrawal: denials, versioned conflict, idempotent replay, already-withdrawn conflict, audit.
    const path = `/products/${product.id}/publication-retractions`; const body = { expected_publication_version: 1, reason: "Synthetic supplier recall" };
    await observe({ browser: new BrowserSession(identity) }, path, body, 401);
    const staff = await actor(identity, "warehouse", [wh.id]); users.push(staff); await enroll(staff.browser, staff.password);
    await observe(staff, path, body, 403);
    await observe(owner, path, { expected_publication_version: 1 }, 400);
    await observe(owner, path, { ...body, expected_publication_version: 2 }, 409);
    const key = randomUUID(); const withdrawn = await observe(owner, path, body, 201, key);
    assert.equal(withdrawn.product_id, product.id); assert.equal(withdrawn.version, 1);
    assert.deepEqual(await observe(owner, path, body, 201, key), withdrawn);
    assert.equal((await observe(owner, path, { ...body, reason: "Changed" }, 409, key)).code, "IDEMPOTENCY_CONFLICT");
    assert.equal((await observe(owner, path, body, 409)).code, "PUBLICATION_ALREADY_WITHDRAWN");
    [row] = (await list(`${q}&state=withdrawn`)).data;
    assert.equal(row.published_revision, null); assert.equal(row.latest_publication_version, 1);
    assert.equal((await readPublicationState(identity, await principal(), product.id)).current, null);
    const [audit] = await identity.sql`select count(*)::int as n from app.audit_event where action='catalog.product.withdraw' and subject_id=${product.id} and reason=${body.reason}`;
    assert.equal(audit.n, 1);

    // Republishing is the ordinary publish against the unchanged latest publication version.
    await ok("POST", `/products/${product.id}/publications`, { expected_version: 2, expected_publication_version: 1, reason: "Synthetic republish" });
    [row] = (await list(`${q}&state=published`)).data; assert.equal(row.latest_publication_version, 2);

    validateExchanges(samples, "publication-withdrawal");
  } finally {
    await cleanup(identity, users); await identity.sql`update app.warehouse set active=false where id=${wh.id}`; await identity.sql.end();
  }
});
