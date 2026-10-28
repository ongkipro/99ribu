import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { handleCustomerLookup } from "../../src/modules/accounts/lookup.ts";
import { handleAuditLog } from "../../src/modules/audit/log.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { expireOwnedOrderJob } from "../../src/modules/checkout/expiry.ts";
import { advanceFixtureClock, readFixtureClock } from "../../src/modules/local/fixtures.ts";
import { actor, enroll } from "../contract/access-fixture.ts";
import { CommerceClient } from "./checkout-fixture.ts";
import { closeFulfillmentActor } from "./fulfillment-fixture.ts";
import { paymentFixture } from "./payment-fixture.ts";

// S138 buyer account lookup for customer service (spec 17 B29, DEC-018 Q5) against the isolated TEST database with a
// real two-parcel order placed by a signed-in buyer: role matrix, masked contacts and a closed response shape with canaries for every kind of
// data that must not leave (full phone/email, address line and recipient phone, message text, a bank account number),
// the audit row without the searched value, exact-match-only lookup, the order scope of a warehouse-scoped CS and
// the per-staff rate limit.

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;
type User = Awaited<ReturnType<typeof actor>>;
type Body = Record<string, unknown>;
type Account = {
	id: string;
	display_name: string;
	phone_masked: string | null;
	phone_verified: boolean;
	email_masked: string | null;
	email_verified: boolean;
	created_at: string;
	orders: { id: string; number: string }[];
	orders_truncated: boolean;
	tickets: { id: string; status: string }[];
	tickets_truncated: boolean;
};
type Result = {
	lookup: { kind: string };
	order_access: string;
	accounts: Account[];
	accounts_truncated: boolean;
};

const ORIGIN = "http://127.0.0.1:3099";
const URL_PATH = "/api/v1/admin/customers/lookup";
const ACCOUNT_KEYS = [
	"created_at",
	"display_name",
	"email_masked",
	"email_verified",
	"id",
	"orders",
	"orders_truncated",
	"phone_masked",
	"phone_verified",
	"tickets",
	"tickets_truncated",
];
const RESULT_KEYS = ["accounts", "accounts_truncated", "lookup", "order_access"];

let f: Fixture;
let sql: Fixture["identity"]["sql"];
let identity: Fixture["identity"];
const staff: User[] = [];
const buyers: User[] = [];
let buyer: User;
let quietBuyer: User;
let phone: string;
let localPhone: string;
let email: string;
let profileEmail: string;
let warehouses: string[];
let order: { id: string; number: string };
let canaries: string[];
let conversationIds: string[];
/** 200 answers per staff user: each one must have written exactly one audit row. */
const answered = new Map<string, number>();

const post = async (who: User | null, body: Body, path = URL_PATH) => {
	const request = who
		? who.browser.request(path, body)
		: new Request(`${ORIGIN}${path}`, {
				method: "POST",
				headers: { origin: ORIGIN, "content-type": "application/json" },
				body: JSON.stringify(body),
			});
	const response = await handleCustomerLookup(request, identity);
	assert.equal(response.headers.get("cache-control"), "no-store");
	const text = await response.text();
	if (who && response.status === 200) answered.set(who.id, (answered.get(who.id) ?? 0) + 1);
	return { status: response.status, text, headers: response.headers, body: JSON.parse(text) };
};
const ok = async (who: User, body: Body) => {
	const result = await post(who, body);
	assert.equal(result.status, 200, result.text);
	return result.body as Result;
};
async function staffUser(role: Role, warehouseIds: string[] = [], grant = false, mfa = true) {
	const user = await actor(identity, role, warehouseIds);
	staff.push(user);
	if (mfa) await enroll(user.browser, user.password);
	if (grant)
		await sql`update app.role_grant set permissions=ARRAY['orders.history.read']::text[] where user_id=${user.id}`;
	return user;
}
const audits = (user: User) =>
	sql`select action,subject_id,outcome,reason,details from app.audit_event where actor_id=${user.id} and action='support.customer_lookup' order by created_at,id`;
const keys = (value: unknown, found = new Set<string>()): Set<string> => {
	if (Array.isArray(value)) for (const item of value) keys(item, found);
	else if (value && typeof value === "object")
		for (const [key, item] of Object.entries(value)) {
			found.add(key);
			keys(item, found);
		}
	return found;
};

before(async () => {
	f = await paymentFixture();
	identity = f.identity;
	sql = identity.sql;
	const stamp = String(randomInt(10_000_000, 99_999_999));
	phone = `+6285${stamp}`;
	localPhone = `085${stamp}`;
	const tag = randomUUID().slice(0, 8);
	email = `login-${tag}@example.invalid`;
	profileEmail = `pembeli.${tag}@example.invalid`;
	buyer = await actor(identity, "buyer", []);
	quietBuyer = await actor(identity, "buyer", []);
	buyers.push(buyer, quietBuyer);
	await sql`update app.auth_user set name='Sari Pembeli',email=${email},email_verified=true where id=${buyer.id}`;
	await sql`insert into app.buyer_profile (user_id,display_name,phone,phone_verified_at,email)
		values (${buyer.id},'Sari Pembeli',${phone},clock_timestamp(),${profileEmail})`;
	// A second account with a profile and no history at all.
	await sql`insert into app.buyer_profile (user_id,display_name,phone,email)
		values (${quietBuyer.id},'Budi Sepi',${`+6286${stamp}`},${`sepi.${tag}@example.invalid`})`;

	// The buyer places a real order through checkout with their own session: four shirts split into two parcels.
	const client = new CommerceClient(identity);
	for (const [name, value] of buyer.browser.cookies) client.cookies.set(`${name}:/`, { name, value, path: "/" });
	const cart = await client.call("/api/v1/carts", { lines: [f.line("fixture-offer-shirt", 4)] });
	assert.equal(cart.response.status, 201, JSON.stringify(cart.payload));
	const quoted = await client.call(
		"/api/v1/checkout/quotes",
		{ cart_id: cart.payload.cart.id, address: f.address, contact: f.contact(), payment_method: "prepaid" },
		{ version: 1 },
	);
	assert.equal(quoted.response.status, 201, JSON.stringify(quoted.payload));
	const placed = await client.call("/api/v1/orders", { quote_id: quoted.payload.id }, { version: 1 });
	assert.equal(placed.response.status, 201, JSON.stringify(placed.payload));
	order = placed.payload.order;
	const [owned] = await sql`select owner_user_id from app.commerce_order where id=${order.id}`;
	assert.equal(owned.owner_user_id, buyer.id);
	warehouses = (await sql`select distinct warehouse_id from app.order_shipment where order_id=${order.id} order by 1`).map((r) => String(r.warehouse_id));
	assert.equal(warehouses.length, 2, "the order spans two warehouses");

	// Data that must never leave: the address book, the order's ship-to snapshot, message text, a bank account.
	const [quote] = await sql`select q.document->'contact'->>'phone' contact_phone,q.document->'address'->>'phone' ship_phone,q.document->'address'->>'address_line' street
		from app.checkout_quote q join app.commerce_order o on o.quote_id=q.id where o.id=${order.id}`;
	const book = {
		street: `Jl. Kenanga Rahasia No. ${randomUUID().slice(0, 6)}`,
		recipient: `Penerima Rahasia ${randomUUID().slice(0, 6)}`,
		phone: `+62877${stamp}`,
	};
	await sql`insert into app.buyer_address (user_id,label,recipient_name,phone,street,province,city,district,subdistrict,postcode,destination_code)
		values (${buyer.id},'Rumah',${book.recipient},${book.phone},${book.street},'Jawa Timur','Malang','Klojen','Kauman','65119','CANARY-DEST')`;
	const bank = `BCA 77${stamp}9`;
	const note = `Catatan internal ${randomUUID().slice(0, 6)}`;
	const chat = `Transfer ke rekening ${bank} ya`;
	conversationIds = [];
	for (const [status, priority, sequence] of [
		["open", "high", 1],
		["resolved", "normal", 1],
	] as const) {
		const [conversation] = await sql`insert into app.support_conversation (buyer_user_id,status,priority,public_sequence,last_public_message_at)
			values (${buyer.id},${status},${priority},${sequence},clock_timestamp()) returning id`;
		conversationIds.push(String(conversation.id));
		await sql`insert into app.support_message (conversation_id,public_sequence,sender_side,sender_user_id,client_message_id,request_hash,body)
			values (${conversation.id},1,'buyer',${buyer.id},${randomUUID()},${"0".repeat(64)},${chat})`;
	}
	await sql`insert into app.support_internal_note (conversation_id,author_user_id,client_note_id,request_hash,body)
		values (${conversationIds[0]},${buyer.id},${randomUUID()},${"0".repeat(64)},${note})`;
	canaries = [
		phone,
		phone.slice(3),
		localPhone,
		email,
		profileEmail,
		profileEmail.split("@")[0],
		book.street,
		book.recipient,
		book.phone,
		bank,
		note,
		chat,
		quote.contact_phone,
		quote.ship_phone,
		quote.street,
		f.address.phone,
		f.address.address_line,
		f.address.recipient_name,
		"CANARY-DEST",
	].filter(Boolean) as string[];
});

after(async () => {
	try {
		// Expire the synthetic order the way the payment fixture does, then end the actors' authority.
		const clock = await readFixtureClock("test", f.namespace);
		await advanceFixtureClock("test", f.namespace, 1860, clock.version);
		const [job] = await sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;
		if (job) await sql.begin((tx) => expireOwnedOrderJob(tx, { id: job.id, kind: job.kind, payload: job.payload }));
		for (const user of [...staff, ...buyers])
			await sql`delete from app.auth_rate_limit where key=${`rl:customer-lookup:${user.id}`}`;
		for (const user of [...staff, ...buyers])
			await closeFulfillmentActor(identity, user).catch(() => {});
	} finally {
		await f.close();
	}
});

test("S138 lookup: customer service and owner read; every other role is 403, anonymous 401; refusals leave no audit row", async () => {
	const cs = await staffUser("customer_service", warehouses, true);
	const owner = f.owner as User;
	assert.equal((await ok(cs, { kind: "phone", value: phone })).accounts.length, 1);
	assert.equal((await ok(owner, { kind: "phone", value: phone })).accounts.length, 1);

	const refused: [string, User | null, number][] = [];
	for (const role of ["ecommerce_admin", "warehouse", "finance"] as const)
		refused.push([role, await staffUser(role, warehouses, true), 403]);
	refused.push(["customer_service without two-step", await staffUser("customer_service", [], true, false), 403]);
	refused.push(["buyer", buyer, 403]);
	const affiliate = await actor(identity, "affiliate", []);
	staff.push(affiliate);
	refused.push(["affiliate", affiliate, 403]);
	refused.push(["anonymous", null, 401]);
	for (const [name, who, status] of refused) {
		const result = await post(who, { kind: "phone", value: phone });
		assert.equal(result.status, status, `${name}: ${result.text}`);
		assert.ok(!canaries.some((c) => result.text.includes(c)), `${name} body carries no contact data`);
		if (who) assert.equal((await audits(who)).length, 0, `${name}: a refusal writes no audit row`);
	}
	// Another staff role cannot even learn what the body must look like: the role check comes first.
	assert.equal((await post(refused[0][1], { nonsense: true })).status, 403);

	// Strict input and transport: closed body, known kinds, POST only, same origin, no query string, no bearer.
	for (const bad of [
		{ kind: "phone" },
		{ value: phone },
		{ kind: "name", value: "Sari" },
		{ kind: "phone", value: phone, limit: 100 },
		{ kind: "phone", value: 6285123456789 },
		{ kind: "phone", value: "" },
		{ kind: "email", value: "x".repeat(260) },
		{ kind: ["phone"], value: phone },
	])
		assert.equal((await post(cs, bad)).status, 400, JSON.stringify(bad).slice(0, 80));
	const get = await handleCustomerLookup(cs.browser.request(URL_PATH), identity);
	assert.equal(get.status, 404);
	const query = await post(cs, { kind: "phone", value: phone }, `${URL_PATH}?value=${localPhone}`);
	assert.equal(query.status, 404, "a value in the URL is refused, not honoured");
	const foreign = cs.browser.request(URL_PATH, { kind: "phone", value: phone });
	foreign.headers.set("origin", "http://evil.example");
	assert.equal((await handleCustomerLookup(foreign, identity)).status, 403);
	const bearer = cs.browser.request(URL_PATH, { kind: "phone", value: phone });
	bearer.headers.set("authorization", "Bearer x");
	assert.equal((await handleCustomerLookup(bearer, identity)).status, 401);
	assert.equal((await audits(cs)).length, 1, "only the one successful lookup was audited");
});

test("S138 lookup: masked contacts, closed shape, no address/bank/message data, staff invisible, unknown = empty, exact match only", async () => {
	const cs = await staffUser("customer_service", warehouses, true);
	const byPhone = await post(cs, { kind: "phone", value: phone });
	assert.equal(byPhone.status, 200, byPhone.text);
	const result = byPhone.body as Result;
	assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
	assert.deepEqual(result.lookup, { kind: "phone" });
	const [account] = result.accounts;
	assert.deepEqual(Object.keys(account).sort(), ACCOUNT_KEYS);
	assert.equal(account.id, buyer.id);
	assert.equal(account.display_name, "Sari Pembeli");
	assert.equal(account.phone_masked, `${localPhone.slice(0, 2)}${"•".repeat(localPhone.length - 6)}${localPhone.slice(-4)}`);
	assert.equal(account.phone_verified, true);
	assert.equal(account.email_masked, `p•••@example.invalid`);
	assert.equal(account.email_verified, false, "A profile email that differs from the verified login email is not reported as verified");
	const byLogin = await ok(cs, { kind: "email", value: email.toUpperCase() });
	assert.equal(byLogin.accounts[0]?.email_verified, false);
	await sql`update app.buyer_profile set email=${email} where user_id=${buyer.id}`;
	assert.equal((await ok(cs, { kind: "email", value: email })).accounts[0]?.email_verified, true, "Verified when profile email matches the verified login email");
	await sql`update app.buyer_profile set email=${profileEmail} where user_id=${buyer.id}`;
	assert.deepEqual(account.orders.map((o) => o.id), [order.id]);
	assert.equal(account.orders[0].number, order.number);
	assert.deepEqual(account.tickets.map((t) => t.status).sort(), ["open", "resolved"]);
	assert.deepEqual(account.tickets.map((t) => t.id).sort(), [...conversationIds].sort());

	// Nothing from the canary set anywhere in the body, and no key that could carry it.
	for (const canary of canaries)
		assert.ok(!byPhone.text.includes(canary), `leaked: ${canary}`);
	const names = keys(result);
	for (const name of names)
		assert.doesNotMatch(name, /address|street|recipient|bank|account_number|proof|token|session|password|body|note|^phone$|^email$/i, `field ${name}`);
	assert.deepEqual(
		[...names].sort(),
		[...new Set([...RESULT_KEYS, ...ACCOUNT_KEYS, "kind", "id", "admin_no", "number", "status", "payment_status", "created_at", "priority", "last_message_at"])].sort(),
	);

	// The same account by email (account email and profile email), any case, local or international phone form.
	for (const body of [
		{ kind: "email", value: email },
		{ kind: "email", value: profileEmail.toUpperCase() },
		{ kind: "email", value: ` ${profileEmail} ` },
		{ kind: "phone", value: localPhone },
		{ kind: "phone", value: `+62 ${localPhone.slice(1, 4)}-${localPhone.slice(4)}` },
	])
		assert.deepEqual((await ok(cs, body)).accounts.map((a) => a.id), [buyer.id], JSON.stringify(body));

	// An account with no history answers with the same account shape and empty lists.
	const quiet = await ok(cs, { kind: "phone", value: `+6286${phone.slice(5)}` });
	assert.deepEqual(Object.keys(quiet).sort(), RESULT_KEYS);
	assert.deepEqual(Object.keys(quiet.accounts[0]).sort(), ACCOUNT_KEYS);
	assert.deepEqual([quiet.accounts[0].orders, quiet.accounts[0].tickets], [[], []]);
	assert.equal(quiet.accounts[0].id, quietBuyer.id);

	// An unknown value, and a value that only exists as a staff account, answer the same empty result.
	const unknownPhone = await post(cs, { kind: "phone", value: `+6289${phone.slice(5)}` });
	const unknownEmail = await post(cs, { kind: "email", value: `nobody-${randomUUID()}@example.invalid` });
	const staffEmail = await post(cs, { kind: "email", value: cs.email });
	const ownerEmail = await post(cs, { kind: "email", value: (f.owner as User).email });
	for (const miss of [unknownPhone, unknownEmail, staffEmail, ownerEmail]) {
		assert.equal(miss.status, 200);
		assert.deepEqual(Object.keys(miss.body).sort(), RESULT_KEYS);
		assert.deepEqual(miss.body.accounts, []);
		assert.equal(miss.body.accounts_truncated, false);
		assert.equal(miss.body.order_access, result.order_access, "the access hint depends on the caller, not on the match");
	}
	assert.deepEqual(unknownEmail.body, { ...staffEmail.body, lookup: { kind: "email" } });
	assert.deepEqual(staffEmail.body, ownerEmail.body);

	// No enumeration: fragments are refused or match nothing, wildcards are literals, no list mode exists.
	for (const value of [localPhone.slice(-8), localPhone.slice(0, 7), "08", "0851%", "085*", "%", "+62%", `${localPhone}0`, localPhone.slice(0, -1)]) {
		const partial = await post(cs, { kind: "phone", value });
		assert.ok([400, 422, 200].includes(partial.status), `${value}: ${partial.text}`);
		if (partial.status === 200) assert.deepEqual(partial.body.accounts, [], `${value} must not match`);
	}
	for (const value of [profileEmail.split("@")[0], `${profileEmail.slice(0, 6)}%@example.invalid`, "%@example.invalid", "_@example.invalid", "example.invalid", "@example.invalid", `pembeli.@example.invalid`]) {
		const partial = await post(cs, { kind: "email", value });
		assert.ok([400, 200].includes(partial.status), `${value}: ${partial.text}`);
		if (partial.status === 200) assert.deepEqual(partial.body.accounts, [], `${value} must not match`);
	}
	assert.equal((await post(cs, { kind: "phone", value: "" })).status, 400);
	assert.equal((await post(cs, {})).status, 400);

	// Audit: one row per completed lookup (hits and misses), the kind and match count, no searched value in any form.
	const rows = await audits(cs);
	assert.equal(rows.length, answered.get(cs.id), "one audit row per 200 answer, hits and misses alike");
	assert.ok(rows.every((r) => r.outcome === "allowed" && r.action === "support.customer_lookup"));
	assert.deepEqual(
		Object.keys(rows[0].details).sort(),
		["account_ids", "kind", "matches"],
	);
	assert.deepEqual(rows[0].details, { kind: "phone", matches: 1, account_ids: [buyer.id] });
	assert.equal(rows[0].subject_id, buyer.id);
	const miss = rows.find((r) => r.details.matches === 0);
	assert.deepEqual(miss?.details, { kind: miss?.details.kind, matches: 0, account_ids: [] });
	assert.equal(miss?.subject_id, null);
	const stored = JSON.stringify(rows);
	for (const canary of canaries) assert.ok(!stored.includes(canary), `audit stores ${canary}`);
	for (const fragment of [phone.slice(-8), "example.invalid", "evil"]) assert.ok(!stored.includes(fragment), `audit stores ${fragment}`);

	// The owner reads the row through the audit log: allowlisted details, nothing raw.
	const log = await handleAuditLog(
		(f.owner as User).browser.request(`/api/v1/admin/audit-events?action=support.customer_lookup&actor=${cs.id}&limit=100`),
		identity,
	);
	assert.equal(log.status, 200);
	const page = await log.json();
	assert.equal(page.data.length, rows.length);
	assert.ok(page.data.every((r: { redacted: boolean }) => !r.redacted), "the allowlist covers every stored key");
	assert.deepEqual(page.data.at(-1).details, rows[0].details);
});

test("S138 lookup: order history follows the order-history scope; tickets are not warehouse-scoped", async () => {
	const both = await staffUser("customer_service", warehouses, true);
	const partial = await staffUser("customer_service", [warehouses[0]], true);
	const none = await staffUser("customer_service", [], true);
	const ungranted = await staffUser("customer_service", warehouses, false);
	const owner = f.owner as User;
	const query = { kind: "phone", value: phone };

	const seen = async (who: User) => {
		const result = await ok(who, query);
		assert.equal(result.accounts.length, 1);
		return result;
	};
	const all = await seen(owner);
	assert.equal(all.order_access, "all");
	assert.deepEqual(all.accounts[0].orders.map((o) => o.id), [order.id]);
	const scopedBoth = await seen(both);
	assert.equal(scopedBoth.order_access, "scoped");
	assert.deepEqual(scopedBoth.accounts[0].orders.map((o) => o.id), [order.id], "every parcel inside the scope");
	for (const [name, who, access] of [
		["one of two warehouses", partial, "scoped"],
		["no warehouse", none, "scoped"],
		["no orders.history.read grant", ungranted, "none"],
	] as const) {
		const result = await seen(who);
		assert.equal(result.order_access, access, name);
		assert.deepEqual(result.accounts[0].orders, [], `${name}: the order stays hidden`);
		assert.equal(result.accounts[0].tickets.length, 2, `${name}: tickets are company-wide for the support roles`);
		assert.ok(!JSON.stringify(result).includes(order.number), `${name}: the order number is not echoed anywhere`);
	}
});

test("S138 lookup: the per-staff budget answers 429 with Retry-After, is not audited, and is per user", async () => {
	const limited = await staffUser("customer_service", [], false);
	const other = await staffUser("customer_service", [], false);
	const body = { kind: "phone", value: `+6288${phone.slice(5)}` };
	for (let n = 0; n < 20; n++) assert.equal((await post(limited, body)).status, 200, `lookup ${n + 1}`);
	const refused = await post(limited, body);
	assert.equal(refused.status, 429, refused.text);
	assert.equal(refused.body.code, "RATE_LIMITED");
	assert.ok(Number(refused.headers.get("retry-after")) >= 1);
	assert.equal((await audits(limited)).length, 20, "the refused lookup wrote no audit row");
	assert.ok(!refused.text.includes(body.value));
	assert.equal((await post(limited, { kind: "email", value: "kosong@example.invalid" })).status, 429, "email lookups share the budget");
	assert.equal((await post(other, body)).status, 200, "another staff user has their own budget");
	// A malformed value is refused before it costs budget: 1 + 19 valid lookups use all 20, the 21st is refused.
	assert.equal((await post(other, { kind: "phone", value: "08" })).status, 422);
	for (let n = 0; n < 19; n++) assert.equal((await post(other, body)).status, 200, `lookup ${n + 2}`);
	assert.equal((await post(other, body)).status, 429);
});
