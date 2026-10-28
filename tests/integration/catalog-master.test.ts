import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import type { LocalAuth } from "../../src/modules/access/auth.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { handleManualFulfillment } from "../../src/modules/fulfillment/manual-routes.ts";
import { handleFinance } from "../../src/modules/finance/routes.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";

// S134 catalog master data (R3: cost writes) at the HTTP handler boundary the console calls: HPP and assumption versions are
// written only with finance.costs.write (owner implicitly), prospective only and optimistic-version checked; roles without
// finance.costs.read never receive an amount; product, SKU, category and warehouse reads respect the caller's scope.
type Handler = (request: Request, identity: LocalAuth) => Promise<Response>;
const identity = createLocalAuth("test");
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
const run = randomUUID().slice(0, 8);
const HPP = 4242424;
const PACKAGING = 1313131;
const FIELDS = { packaging_idr: PACKAGING, provider_fee_idr: 1414141, subsidy_idr: 1515151, returns_reserve_idr: 1616161 };
const AMOUNTS = [HPP, PACKAGING, 1414141, 1515151, 1616161].map(String);

let owner: User;
let financeRead: User;
let financeWrite: User;
let financeNone: User;
let ecommerce: User;
let warehouseStaff: User;
let support: User;
let warehouseA = "";
let warehouseB = "";
let stockId = "";
let offerId = "";
let productA = "";
let productB = "";
let categoryId = "";

async function staff(role: Parameters<typeof actor>[1], warehouseIds: string[] = [], permissions: string[] = []) {
	const user = await actor(identity, role, warehouseIds);
	users.push(user);
	await enroll(user.browser, user.password);
	if (permissions.length) await identity.sql`update app.role_grant set permissions=${permissions} where user_id=${user.id}`;
	return user;
}
async function call(user: User, handler: Handler, path: string, body?: Record<string, unknown>, key: string | null = body ? randomUUID() : null) {
	const request = user.browser.request(path, body);
	if (key) request.headers.set("idempotency-key", key);
	const response = await handler(request, identity);
	const text = await response.text();
	// biome-ignore lint/suspicious/noExplicitAny: the assertions read differently shaped response bodies
	return { status: response.status, text, json: text ? (JSON.parse(text) as Record<string, any>) : {} };
}
const root = "/api/v1/admin";
const catalog = (user: User, path: string, body?: Record<string, unknown>) => call(user, handleCatalog, `${root}${path}`, body);
const finance = (user: User, path: string, body?: Record<string, unknown>, key?: string | null) => call(user, handleFinance, `${root}${path}`, body, key);
const costBody = (unit_cost: number | null, expected_version: number, extra: Record<string, unknown> = {}) => ({
	unit_cost,
	expected_version,
	effective_from: null,
	source: "Synthetic supplier invoice",
	reason: "Synthetic HPP version",
	...extra,
});
const assumptionBody = (expected_version: number, extra: Record<string, unknown> = {}) => ({
	...FIELDS,
	expected_version,
	effective_from: null,
	source: "Synthetic conservative estimate",
	reason: "Synthetic assumption version",
	...extra,
});
const noAmounts = (text: string) => {
	for (const amount of AMOUNTS) assert.ok(!text.includes(amount), `response leaked ${amount}`);
};
const versions = async (table: "component_cost_version" | "offer_cost_assumption_version", column: "stock_item_id" | "offer_id", id: string) =>
	(await identity.sql.unsafe(`select count(*)::int as n from app.${table} where ${column}='${id}'`))[0].n as number;

before(async () => {
	const insertWarehouse = async (label: string) =>
		(await identity.sql`insert into app.warehouse (name,city) values (${`Synthetic S134 ${label} ${run}`},'Malang') returning id`)[0].id as string;
	warehouseA = await insertWarehouse("A");
	warehouseB = await insertWarehouse("B");
	owner = await staff("owner");
	financeRead = await staff("finance", [], ["finance.costs.read"]);
	financeWrite = await staff("finance", [], ["finance.costs.read", "finance.costs.write"]);
	financeNone = await staff("finance");
	ecommerce = await staff("ecommerce_admin", [warehouseA]);
	warehouseStaff = await staff("warehouse", [warehouseA]);
	support = await staff("customer_service");

	const category = await catalog(owner, "/categories", { name: `Synthetic S134 ${run}`, slug: `s134-${run}`, parent_id: null, attribute_definitions: [] });
	assert.equal(category.status, 201);
	categoryId = category.json.id;
	const stock = await catalog(owner, "/stock-items", { sku: `S134-${run}`.toUpperCase(), name: `Synthetic S134 stock ${run}` });
	assert.equal(stock.status, 201);
	stockId = stock.json.id;
	const make = async (warehouseId: string, label: string) => {
		const product = await catalog(owner, "/products", {
			name: `Synthetic S134 ${label} ${run}`,
			description: "Synthetic only",
			images: [],
			category_id: categoryId,
			variants: [
				{
					sku: `S134-${label}-${run}`.toUpperCase(),
					label: "Synthetic unit",
					attributes: [],
					offer_kind: "unit",
					weight_grams: 100,
					length_mm: 100,
					width_mm: 100,
					height_mm: 100,
					default_warehouse_id: warehouseId,
					contents: [{ stock_item_id: stockId, name: stock.json.name, quantity: 1 }],
				},
			],
		});
		assert.equal(product.status, 201);
		return product.json;
	};
	const a = await make(warehouseA, "a");
	productA = a.id;
	offerId = a.variants[0].id;
	productB = (await make(warehouseB, "b")).id;
	// The contribution review needs an owner-configured commercial policy; keep an existing one.
	const history = await call(owner, handleAccess, `${root}/policy-versions?kind=commercial`);
	if (history.json.latest_version === 0) {
		const proof = await call(owner, handleAccess, "/api/v1/me/reauthentication-proofs", { password: owner.password, action: "company_policy.version", subject_id: "company-commercial" });
		assert.equal(proof.status, 201);
		const policy = await call(owner, handleAccess, `${root}/policy-versions`, {
			kind: "commercial",
			warehouse_id: null,
			expected_version: 0,
			effective_at: null,
			values: { default_commission_bps: 1000, minimum_payout_idr: 99000 },
			reason: "Synthetic S134 baseline",
			reauthentication_proof: proof.json.proof,
		});
		assert.equal(policy.status, 201);
	}
});
after(async () => {
	await cleanup(identity, users);
	await identity.sql`update app.warehouse set active=false where id in (${warehouseA},${warehouseB})`;
	await identity.sql.end();
});

test("S134 HPP and assumption writes need finance.costs.write: every other role is refused and writes nothing", async () => {
	const component = `/stock-items/${stockId}/cost-versions`;
	const assumption = `/offers/${offerId}/cost-assumption-versions`;
	// Read-only finance, finance without a grant, ecommerce admin, warehouse and customer service: 403 on both writes.
	for (const user of [financeRead, financeNone, ecommerce, warehouseStaff, support]) {
		const hpp = await finance(user, component, costBody(HPP, 0));
		const profile = await finance(user, assumption, assumptionBody(0));
		assert.equal(hpp.status, 403, "HPP write refused");
		assert.equal(profile.status, 403, "assumption write refused");
		assert.equal(hpp.json.code, "FORBIDDEN");
		noAmounts(hpp.text + profile.text);
	}
	assert.equal(await versions("component_cost_version", "stock_item_id", stockId), 0);
	assert.equal(await versions("offer_cost_assumption_version", "offer_id", offerId), 0);

	// A finance user with the write grant writes, and is recorded as the author.
	const key = randomUUID();
	const first = await finance(financeWrite, component, costBody(HPP, 0), key);
	assert.equal(first.status, 201);
	assert.equal(first.json.unit_cost, HPP);
	assert.equal(first.json.version, 1);
	assert.equal(first.json.recorded_by, financeWrite.id);
	// The retry key replays the saved result instead of adding a second version.
	const replay = await finance(financeWrite, component, costBody(HPP, 0), key);
	assert.equal(replay.status, 201);
	assert.deepEqual(replay.json, first.json);
	assert.equal(await versions("component_cost_version", "stock_item_id", stockId), 1);
	// The write is audited once under its author; a refused caller leaves no append row.
	const audited = await identity.sql`select actor_id from app.audit_event where action='finance.costs.append' and subject_id=${stockId}`;
	assert.deepEqual(audited.map((row) => row.actor_id), [financeWrite.id]);
	// The same key with different input is a conflict, never a silent second write.
	assert.equal((await finance(financeWrite, component, costBody(HPP + 1, 0), key)).json.code, "IDEMPOTENCY_CONFLICT");

	// Owner has the write implicitly (no delegated permission needed).
	const profile = await finance(owner, assumption, assumptionBody(0));
	assert.equal(profile.status, 201);
	assert.equal(profile.json.packaging_idr, PACKAGING);

	// Revoking write while keeping read: the form's API answers 403 again, reads stay.
	await identity.sql`update app.role_grant set permissions=${["finance.costs.read"]} where user_id=${financeWrite.id}`;
	assert.equal((await finance(financeWrite, component, costBody(HPP + 2, 1))).status, 403);
	assert.equal((await finance(financeWrite, component)).status, 200);
	await identity.sql`update app.role_grant set permissions=${["finance.costs.read", "finance.costs.write"]} where user_id=${financeWrite.id}`;
	assert.equal(await versions("component_cost_version", "stock_item_id", stockId), 1);
});

test("S134 cost versions are prospective, version-checked, and a lost race appends once", async () => {
	const component = `/stock-items/${stockId}/cost-versions`;
	const [{ n: before }] = await identity.sql`select count(*)::int n from app.component_cost_version where stock_item_id=${stockId}`;
	const latest = (await finance(owner, component)).json.latest_version as number;
	assert.equal(latest, before);
	// A past effective time is refused with the domain's code and writes nothing.
	const past = await finance(owner, component, costBody(1, latest, { effective_from: new Date(Date.now() - 1000).toISOString() }));
	assert.equal(past.status, 400);
	assert.equal(past.json.code, "RETROACTIVE_COST_FORBIDDEN");
	const far = await finance(owner, component, costBody(1, latest, { effective_from: new Date(Date.now() + 367 * 86_400_000).toISOString() }));
	assert.equal(far.json.code, "COST_SCHEDULE_TOO_DISTANT");
	// A stale expected_version conflicts instead of overwriting.
	const stale = await finance(owner, component, costBody(1, latest - 1));
	assert.equal(stale.status, 409);
	assert.equal(stale.json.code, "VERSION_CONFLICT");
	assert.equal(await versions("component_cost_version", "stock_item_id", stockId), before);
	// Two editors sending the same expected version: exactly one wins, the other is told to reload.
	const results = await Promise.all([finance(owner, component, costBody(10, latest)), finance(financeWrite, component, costBody(20, latest))]);
	assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
	assert.equal(results.find((r) => r.status === 409)?.json.code, "VERSION_CONFLICT");
	assert.equal(await versions("component_cost_version", "stock_item_id", stockId), latest + 1);
	// Unknown stays unknown: null is stored as null, not Rp0.
	const unknown = await finance(owner, component, costBody(null, latest + 1));
	assert.equal(unknown.status, 201);
	assert.equal(unknown.json.unit_cost, null);
	// A scheduled version blocks an immediate one that would precede it.
	const scheduled = await finance(owner, component, costBody(HPP + 5, latest + 2, { effective_from: new Date(Date.now() + 3_600_000).toISOString() }));
	assert.equal(scheduled.status, 201);
	const early = await finance(owner, component, costBody(HPP + 6, latest + 3));
	assert.equal(early.json.code, "SCHEDULE_CONFLICT");
});

test("S134 no cost amount reaches a role without finance.costs.read", async () => {
	// Owner and the read grants see the amounts (positive control).
	for (const user of [owner, financeRead]) {
		assert.equal((await finance(user, `/stock-items/${stockId}/cost-versions`)).status, 200);
		assert.equal((await finance(user, `/offers/${offerId}/cost-assumption-versions`)).json.current.packaging_idr, PACKAGING);
	}
	const review = await finance(financeRead, `/products/${productA}/contribution-reviews`);
	assert.equal(review.status, 200);
	assert.equal(review.json.offers[0].assumptions.packaging_idr, PACKAGING);
	// Everyone else: 403 on every cost read, bodies carry no amount.
	for (const user of [financeNone, ecommerce, warehouseStaff, support]) {
		for (const path of [`/stock-items/${stockId}/cost-versions`, `/offers/${offerId}/cost-assumption-versions`, `/products/${productA}/contribution-reviews`]) {
			const refused = await finance(user, path);
			assert.equal(refused.status, 403, `${path} refused`);
			noAmounts(refused.text);
		}
	}
	// The catalog reads those roles do have never embed a cost or contribution field.
	for (const user of [ecommerce, warehouseStaff]) {
		for (const path of [`/products/${productA}`, `/products/${productA}/publications`, "/products?limit=100", `/categories?limit=100`]) {
			const read = await catalog(user, path);
			assert.equal(read.status, 200, path);
			noAmounts(read.text);
			assert.doesNotMatch(read.text, /unit_cost|estimated_hpp|estimated_contribution|packaging_idr|provider_fee_idr/);
		}
	}
	// Warehouse staff see financial publication blockers as one generic code.
	const state = await catalog(warehouseStaff, `/products/${productA}/publications`);
	assert.ok(state.json.blockers.every((b: { code: string }) => !/^UNKNOWN_|BELOW_MARGIN_FLOOR|COST_/.test(b.code)));
});

test("S134 product, SKU, category and warehouse reads respect role and warehouse scope", async () => {
	// Products: the warehouse-scoped roles see only products whose active offers sit in their warehouses.
	const pages = async (user: User) => {
		const ids: string[] = [];
		let cursor = "";
		for (let page = 0; page < 200; page++) {
			const read = await catalog(user, `/products?limit=100${cursor ? `&cursor=${cursor}` : ""}`);
			assert.equal(read.status, 200);
			ids.push(...read.json.data.map((row: { id: string }) => row.id));
			cursor = read.json.pagination.next_cursor;
			if (!cursor) break;
		}
		return ids;
	};
	for (const user of [ecommerce, warehouseStaff]) {
		const ids = await pages(user);
		assert.ok(ids.includes(productA));
		assert.ok(!ids.includes(productB), "product of another warehouse is not listed");
		assert.equal((await catalog(user, `/products/${productB}`)).status, 404, "detail of another warehouse is hidden, not forbidden");
	}
	// The shared test DB holds thousands of products; seek directly to each UUID with the keyset cursor.
	const beforeUuid = (id: string) => `${id.slice(0, 24)}000000000000`;
	const listedProduct = async (user: User, id: string) => {
		const read = await catalog(user, `/products?limit=5&cursor=${beforeUuid(id)}`);
		assert.equal(read.status, 200);
		return read.json.data.some((row: { id: string }) => row.id === id);
	};
	for (const user of [owner, financeRead]) {
		assert.ok((await listedProduct(user, productA)) && (await listedProduct(user, productB)), "company-wide readers see both");
	}
	for (const user of [financeNone, support]) {
		for (const path of [`/products/${productA}`, "/products?limit=5", "/categories?limit=5"]) {
			assert.equal((await catalog(user, path)).status, 403);
		}
	}

	// SKU dictionary: owner and ecommerce_admin only (finance cost readers are refused on this list).
	assert.equal((await catalog(ecommerce, "/stock-items?limit=5")).status, 200);
	for (const user of [financeRead, warehouseStaff, support]) assert.equal((await catalog(user, "/stock-items?limit=5")).status, 403);

	// Writes: SKU and category creation is owner/ecommerce_admin only; a duplicate SKU conflicts.
	const sku = `S134-W-${run}`.toUpperCase();
	for (const user of [financeWrite, warehouseStaff, support]) {
		assert.equal((await catalog(user, "/stock-items", { sku, name: "Synthetic refused" })).status, 403);
		assert.equal((await catalog(user, "/categories", { name: "Refused", slug: `refused-${run}`, parent_id: null, attribute_definitions: [] })).status, 403);
	}
	const created = await catalog(ecommerce, "/stock-items", { sku, name: "Synthetic SKU by ecommerce admin" });
	assert.equal(created.status, 201);
	assert.equal((await catalog(owner, "/stock-items", { sku, name: "Synthetic duplicate" })).json.code, "CATALOG_IDENTITY_CONFLICT");
	assert.equal((await catalog(owner, "/stock-items", { sku: "lower case", name: "Bad" })).status, 400);

	// The category list shows only categories a product uses (DEC-011/S104): a fresh one is not listed until then.
	const fresh = await catalog(ecommerce, "/categories", { name: `Synthetic unused ${run}`, slug: `s134-unused-${run}`, parent_id: null, attribute_definitions: [] });
	assert.equal(fresh.status, 201);
	const twin = await catalog(owner, "/categories", { name: "Synthetic twin", slug: `s134-unused-${run}`, parent_id: null, attribute_definitions: [] });
	assert.equal(twin.json.code, "CATALOG_IDENTITY_CONFLICT");
	const listed = async (id: string) => {
		const read = await catalog(ecommerce, `/categories?limit=5&cursor=${beforeUuid(id)}`);
		assert.equal(read.status, 200);
		return read.json.data.some((row: { id: string }) => row.id === id);
	};
	assert.equal(await listed(categoryId), true, "category used by a product is listed");
	assert.equal(await listed(fresh.json.id), false, "category without a product is not listed");

	// Warehouses: members see only their own; a warehouse outside the scope is a 404 (never a 403 that probes ids).
	for (const user of [ecommerce, warehouseStaff]) {
		const list = await call(user, handleAccess, `${root}/warehouses?limit=100`);
		assert.deepEqual(list.json.data.map((row: { id: string }) => row.id), [warehouseA]);
		const own = await call(user, handleAccess, `${root}/warehouses/${warehouseA}`);
		assert.equal(own.status, 200);
		assert.deepEqual(Object.keys(own.json).sort(), ["active", "admin_no", "city", "id", "name", "timezone"]);
		const other = await call(user, handleAccess, `${root}/warehouses/${warehouseB}`);
		assert.equal(other.status, 404);
		assert.equal(other.json.code, "NOT_FOUND");
	}
	assert.equal((await call(owner, handleAccess, `${root}/warehouses/${warehouseB}`)).status, 200);
	for (const user of [financeRead, support]) assert.equal((await call(user, handleAccess, `${root}/warehouses/${warehouseA}`)).status, 403);
	assert.equal((await call(owner, handleAccess, `${root}/warehouses/${warehouseA}?x=1`)).status, 400);
	assert.equal((await call(owner, handleAccess, `${root}/warehouses/not-a-uuid`)).status, 400);
	assert.equal((await call(owner, handleAccess, `${root}/warehouses/${randomUUID()}`)).status, 404);
	const closed = (await identity.sql`insert into app.warehouse (name,city,active) values (${`Synthetic S134 closed ${run}`},'Malang',false) returning id`)[0].id;
	assert.equal((await call(owner, handleAccess, `${root}/warehouses/${closed}`)).status, 404, "inactive warehouse is not readable");

	// Pickup profile (private personal data) and calendar: the detail screen's two private sections.
	const profile = (user: User, id: string) => call(user, handleManualFulfillment, `${root}/warehouses/${id}/pickup-profile`);
	assert.equal((await profile(owner, warehouseB)).status, 200);
	assert.equal((await profile(ecommerce, warehouseA)).status, 200);
	assert.equal((await profile(ecommerce, warehouseB)).status, 404);
	for (const user of [warehouseStaff, financeRead, support]) assert.equal((await profile(user, warehouseA)).status, 403);
	const calendar = (user: User) => call(user, handleAccess, `${root}/policy-versions?kind=warehouse_calendar&warehouse_id=${warehouseA}&limit=5`);
	assert.equal((await calendar(owner)).status, 200);
	for (const user of [ecommerce, warehouseStaff, financeRead]) assert.equal((await calendar(user)).status, 403);
	// An owner-written calendar version is the one the detail screen shows as current.
	const { timezone } = (await call(owner, handleAccess, `${root}/warehouses/${warehouseA}`)).json;
	const year = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).format(new Date()));
	const proof = await call(owner, handleAccess, "/api/v1/me/reauthentication-proofs", { password: owner.password, action: "warehouse_calendar.version", subject_id: warehouseA });
	assert.equal(proof.status, 201);
	const saved = await call(owner, handleAccess, `${root}/policy-versions`, {
		kind: "warehouse_calendar",
		warehouse_id: warehouseA,
		expected_version: 0,
		effective_at: null,
		values: { timezone, year, working_weekdays: [1, 2, 3, 4, 5], cutoff_local: "14:30", closed_dates: [`${year}-12-25`], source: "TEST-ONLY", approval: "test_only" },
		reason: "Synthetic S134 calendar",
		reauthentication_proof: proof.json.proof,
	});
	assert.equal(saved.status, 201);
	const current = (await calendar(owner)).json;
	assert.equal(current.latest_version, 1);
	assert.equal(current.current.values.cutoff_local, "14:30");
	assert.equal(current.current.values.year, year);
});
