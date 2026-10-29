import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { classifyAdminParam } from "../../src/modules/access/admin-number.ts";
import { type AdminNumberKind, adminPath, UNKNOWN_ADMIN_ID } from "../../src/modules/access/admin-paths.ts";
import { getPrincipal } from "../../src/modules/access/policy.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";

interface Warehouse {
	id: string;
	admin_no: number;
}

// Migration 0041 / admin numeric ids: every entity with an admin detail page carries a unique, immutable
// `admin_no` identity, and the console resolves `/admin/<area>/<number>` only within the API's object scope.
// Unknown and out-of-scope numbers have the same payload; unknown and out-of-scope UUIDs never redirect.
// The page-level role gates are proved in the browser suites (they navigate real pages by number as every role).
const identity = createLocalAuth("test");
const TABLES: Record<AdminNumberKind, string> = {
	order: "commerce_order",
	product: "product",
	warehouse: "warehouse",
	return: "return_case",
	refund: "refund",
	exception: "commerce_exception",
	payout: "affiliate_payout",
	reconciliation: "provider_settlement",
	affiliate: "affiliate_account",
};
const run = randomUUID().slice(0, 8);
const users: { id: string; email: string }[] = [];
const warehouses: Warehouse[] = [];

before(async () => {
	for (const label of ["A", "B"]) {
		const [row] = await identity.sql<{ id: string; admin_no: string }[]>`
			insert into app.warehouse (name, city) values (${`Synthetic S145 ${label} ${run}`}, 'Malang') returning id, admin_no::text as admin_no`;
		warehouses.push({ id: row.id, admin_no: Number(row.admin_no) });
	}
});

after(async () => {
	await cleanup(identity, users);
	await identity.sql`delete from app.warehouse where id = any(${warehouses.map((w) => w.id)}::uuid[])`;
	await identity.sql.end();
});

test("each of the nine tables has a NOT NULL, unique, always-generated admin_no and an immutability guard", async () => {
	for (const [kind, table] of Object.entries(TABLES)) {
		const [column] = await identity.sql<{ identity: string; not_null: boolean; type: string }[]>`
			select a.attidentity as identity, a.attnotnull as not_null, format_type(a.atttypid, a.atttypmod) as type
			from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
			where n.nspname = 'app' and c.relname = ${table} and a.attname = 'admin_no' and not a.attisdropped`;
		assert.ok(column, `${kind}: admin_no exists on ${table}`);
		assert.deepEqual(column, { identity: "a", not_null: true, type: "bigint" }, `${kind}: GENERATED ALWAYS AS IDENTITY, NOT NULL, bigint`);
		const unique = await identity.sql`
			select 1 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
			where n.nspname = 'app' and c.relname = ${table} and k.contype = 'u' and k.conname = ${`${table}_admin_no_unique`}`;
		assert.equal(unique.length, 1, `${kind}: unique constraint`);
		const guard = await identity.sql`
			select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
			where c.relname = ${table} and t.tgname = ${`${table}_admin_no_guard`} and t.tgenabled = 'O' and not t.tgisinternal`;
		assert.equal(guard.length, 1, `${kind}: guard trigger enabled`);
		const disabled = await identity.sql`
			select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
			where n.nspname = 'app' and c.relname = ${table} and not t.tgisinternal and t.tgenabled <> 'O'`;
		assert.equal(disabled.length, 0, `${kind}: the migration left no trigger disabled`);
	}
});

test("every existing row is numbered once: positive, distinct, and a row number is never handed out twice", async () => {
	for (const [kind, table] of Object.entries(TABLES)) {
		const [stats] = await identity.sql.unsafe(
			`select count(*)::int as rows, count(distinct admin_no)::int as distinct_numbers, coalesce(min(admin_no), 1)::int as lowest from app.${table}`,
		);
		assert.equal(stats.rows, stats.distinct_numbers, `${kind}: numbers are distinct`);
		assert.ok(stats.lowest >= 1, `${kind}: numbers start at 1`);
	}
	assert.ok(warehouses[1].admin_no > warehouses[0].admin_no, "later rows get later numbers");
	assert.ok(warehouses[0].admin_no >= 1);
});

test("admin_no is generated and immutable: no explicit value on insert, no change on update", async () => {
	const [first] = warehouses;
	await assert.rejects(
		identity.sql`insert into app.warehouse (name, city, admin_no) values (${`Synthetic S145 forced ${run}`}, 'Malang', 1)`,
		{ code: "428C9" },
	);
	await assert.rejects(identity.sql`update app.warehouse set admin_no = ${first.admin_no + 100000} where id = ${first.id}`, { code: "428C9" });
	// DEFAULT would draw a fresh number: the guard trigger refuses it.
	await assert.rejects(identity.sql`update app.warehouse set admin_no = default where id = ${first.id}`, { code: "23514" });
	const [row] = await identity.sql`select admin_no::int as admin_no from app.warehouse where id = ${first.id}`;
	assert.equal(row.admin_no, first.admin_no);
	// Ordinary updates keep the number.
	await identity.sql`update app.warehouse set city = 'Surabaya' where id = ${first.id}`;
	const [after] = await identity.sql`select admin_no::int as admin_no from app.warehouse where id = ${first.id}`;
	assert.equal(after.admin_no, first.admin_no);
});

test("the route parameter resolves by number, redirects a UUID to its number, and refuses everything else", async () => {
	const owner = await actor(identity, "owner", []);
	users.push(owner);
	await enroll(owner.browser, owner.password);
	const principal = await getPrincipal(owner.browser.request("/admin"), identity);
	const [a, b] = warehouses;
	assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", String(a.admin_no)), { kind: "id", id: a.id });
	assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", String(b.admin_no)), { kind: "id", id: b.id });
	// A readable UUID (any case) redirects to the canonical numeric URL.
	assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", a.id), { kind: "redirect", adminNo: a.admin_no });
	assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", a.id.toUpperCase()), { kind: "redirect", adminNo: a.admin_no });
	assert.equal(adminPath("warehouse", a.admin_no), `/admin/produk/gudang/${a.admin_no}`);
	// An unknown number yields the reserved id; an unknown UUID passes through for the client's API 404.
	assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", "999999999999999"), { kind: "id", id: UNKNOWN_ADMIN_ID });
	const stray = randomUUID();
	assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", stray), { kind: "id", id: stray });
	// Non-canonical numbers, junk and user-id shapes are not found without a lookup.
	for (const junk of ["", "0", "007", "-1", "1e3", "1.5", " 12", "12 ", "abc", "1".repeat(16), "user_2fa1", `${a.id}x`, `${a.admin_no}/../1`, "%31", "１２"]) {
		assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", junk), { kind: "missing" }, JSON.stringify(junk));
	}
	// A number of another entity never resolves here: the same number on another table is its own row.
	const [{ n }] = await identity.sql`select count(*)::int as n from app.warehouse where admin_no = ${a.admin_no}`;
	assert.equal(n, 1);
});

test("warehouse-scoped resolution cannot distinguish an out-of-scope number or UUID from an unknown row", async () => {
	const [a, b] = warehouses;
	const staff = await actor(identity, "warehouse", [a.id]);
	users.push(staff);
	await enroll(staff.browser, staff.password);
	const principal = await getPrincipal(staff.browser.request("/admin"), identity);
	assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", String(a.admin_no)), { kind: "id", id: a.id });
	assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", a.id), { kind: "redirect", adminNo: a.admin_no });
	assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", String(b.admin_no)), { kind: "id", id: UNKNOWN_ADMIN_ID });
	assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", b.id), { kind: "id", id: b.id });
	assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", b.id.toUpperCase()), { kind: "id", id: b.id });
	const stray = randomUUID();
	assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", stray), { kind: "id", id: stray });
	// The API agrees: neither out-of-scope nor unknown UUIDs exposes a row.
	for (const id of [b.id, stray]) {
		const response = await handleAccess(staff.browser.request(`/api/v1/admin/warehouses/${id}`), identity);
		assert.equal(response.status, 404);
	}
	// Every entity's scoped lookup retains the same unknown-number / unknown-UUID contract.
	for (const kind of Object.keys(TABLES) as AdminNumberKind[]) {
		assert.deepEqual(await classifyAdminParam(identity.sql, principal, kind, "999999999999999"), { kind: "id", id: UNKNOWN_ADMIN_ID }, kind);
		assert.deepEqual(await classifyAdminParam(identity.sql, principal, kind, stray), { kind: "id", id: stray }, kind);
	}
	// Inactive warehouses are unreadable even while membership still exists.
	await identity.sql`update app.warehouse set active=false where id=${a.id}`;
	try {
		assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", String(a.admin_no)), { kind: "id", id: UNKNOWN_ADMIN_ID });
		assert.deepEqual(await classifyAdminParam(identity.sql, principal, "warehouse", a.id), { kind: "id", id: a.id });
	} finally {
		await identity.sql`update app.warehouse set active=true where id=${a.id}`;
	}
});

test("GET /admin/warehouses and /admin/warehouses/{id} return admin_no beside the UUID id", async () => {
	const owner = await actor(identity, "owner", []);
	users.push(owner);
	await enroll(owner.browser, owner.password);
	const [a] = warehouses;
	const detail = await handleAccess(owner.browser.request(`/api/v1/admin/warehouses/${a.id}`), identity);
	assert.equal(detail.status, 200);
	const body: Warehouse = await detail.json();
	assert.equal(body.id, a.id);
	assert.equal(body.admin_no, a.admin_no);
	const list = await handleAccess(owner.browser.request("/api/v1/admin/warehouses?limit=100"), identity);
	assert.equal(list.status, 200);
	const page: { data: Warehouse[] } = await list.json();
	const rows = page.data;
	assert.ok(rows.length > 0 && rows.every((row) => Number.isInteger(row.admin_no) && row.admin_no >= 1));
	// The API keeps UUID paths: a number in the path is not an identifier there.
	const byNumber = await handleAccess(owner.browser.request(`/api/v1/admin/warehouses/${a.admin_no}`), identity);
	assert.equal(byNumber.status, 400);
});
