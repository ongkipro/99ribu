import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleStaticPages, readStaticPage } from "../../src/modules/storefront/static-pages.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";

// S-C1 store pages against the real test database: editors only (owner/ecommerce_admin with MFA), append-only
// versions with expected_version, idempotent replay (also for two concurrent requests with one key), version
// conflict, validation, audit, and wire parity for the three operations. Versions are immutable, so this suite
// appends to the test database's `syarat` page on every run and reads the current version first.
const origin = "http://127.0.0.1:3099";
const root = "/api/v1/admin/static-pages";
const identity = createLocalAuth("test");
type User = Awaited<ReturnType<typeof actor>>;
let owner: User, editor: User, support: User, finance: User, noMfa: User;
const users: User[] = [];
const samples: Exchange[] = [];

const cookie = (user: User | null) => (user ? [...user.browser.cookies].map(([name, value]) => `${name}=${value}`).join("; ") : "");
function call(user: User | null, path: string, body?: unknown, key: string = randomUUID()) {
	const headers = new Headers({ origin, cookie: cookie(user) });
	if (body !== undefined) {
		headers.set("content-type", "application/json");
		headers.set("idempotency-key", key);
	}
	return new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function observe(request: Request, expected: number, valid?: boolean) {
	const body = request.headers.get("content-type") === "application/json" && request.body ? await request.clone().text() : undefined;
	const response = await handleStaticPages(request, identity);
	const payload = await response.json();
	assert.equal(response.status, expected, JSON.stringify(payload));
	samples.push({
		url: request.url,
		method: request.method,
		request_headers: Object.fromEntries([...request.headers].filter(([key]) => ["content-type", "idempotency-key"].includes(key))),
		request_body: body,
		body_bytes: body ? Buffer.byteLength(body) : undefined,
		...(valid === undefined ? {} : { request_valid: valid }),
		status: response.status,
		headers: Object.fromEntries(response.headers),
		payload,
	});
	return payload;
}
const current = async () => (await readStaticPage(identity.sql, "syarat"))?.version ?? 0;
const content = (expected: number, patch: Record<string, unknown> = {}) => ({
	expected_version: expected,
	title: "Syarat dan ketentuan",
	body: `## Pemesanan\nSynthetic ${randomUUID()}\n\n- Satu\n- Dua`,
	reason: "Synthetic test",
	...patch,
});

before(async () => {
	owner = await actor(identity, "owner", []);
	editor = await actor(identity, "ecommerce_admin", []);
	support = await actor(identity, "customer_service", []);
	finance = await actor(identity, "finance", []);
	noMfa = await actor(identity, "owner", []);
	users.push(owner, editor, support, finance, noMfa);
	for (const user of [owner, editor, support, finance]) await enroll(user.browser, user.password);
});
after(async () => {
	try {
		await identity.sql`delete from app.audit_event where action='static_page.write' and actor_id in ${identity.sql(users.map((user) => user.id))}`.catch(() => {});
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("S-C1 store pages refuse anonymous, non-editor and non-MFA principals on every operation", async () => {
	for (const path of [root, `${root}/syarat`]) await observe(call(null, path), 401);
	await observe(call(null, `${root}/syarat/versions`, content(0)), 401);
	for (const user of [support, finance, noMfa]) {
		await observe(call(user, root), 403);
		await observe(call(user, `${root}/syarat`), 403);
		await observe(call(user, `${root}/syarat/versions`, content(0)), 403);
	}
	await observe(call(owner, `${root}/beranda`), 404);
});

test("S-C1 an editor appends a version; replay, version conflict and idempotency conflict", async () => {
	const before = await current();
	const body = content(before);
	const key = randomUUID();
	const saved = await observe(call(editor, `${root}/syarat/versions`, body, key), 201, true);
	assert.equal(saved.version, before + 1);
	assert.equal(saved.path, "/syarat");
	// Same key, same body: the saved response, no second version.
	assert.deepEqual(await observe(call(editor, `${root}/syarat/versions`, body, key), 201, true), saved);
	assert.equal(await current(), before + 1);
	// Same key, different body.
	await observe(call(editor, `${root}/syarat/versions`, { ...body, reason: "Other" }, key), 409, true);
	// A stale expected_version.
	assert.equal((await observe(call(owner, `${root}/syarat/versions`, content(before)), 409, true)).code, "VERSION_CONFLICT");
	const [audit] = await identity.sql`select reason,details from app.audit_event where action='static_page.write' and actor_id=${editor.id} order by created_at desc limit 1`;
	assert.equal(audit.reason, "Synthetic test");
	assert.equal(audit.details.version, before + 1);
	const one = await observe(call(owner, `${root}/syarat`), 200);
	assert.equal(one.current.version, before + 1);
	assert.equal(one.current.body, body.body);
	assert.ok(one.versions.length >= 1 && one.versions.length <= 20);
	const list = await observe(call(owner, root), 200);
	assert.deepEqual(list.data.map((row: { slug: string }) => row.slug), ["tentang", "kontak", "syarat", "privasi"]);
	assert.equal(list.data.find((row: { slug: string }) => row.slug === "syarat").version, before + 1);
});

test("S-C1 two concurrent requests with one key make one version and the same answer", async () => {
	const before = await current();
	const body = content(before);
	const key = randomUUID();
	const answers = await Promise.all([0, 1].map(() => handleStaticPages(call(owner, `${root}/syarat/versions`, body, key), identity)));
	assert.deepEqual(answers.map((response) => response.status), [201, 201]);
	const [a, b] = await Promise.all(answers.map((response) => response.json()));
	assert.deepEqual(a, b);
	assert.equal(await current(), before + 1);
});

test("S-C1 one key sent at once to two pages: one version, one IDEMPOTENCY_CONFLICT", async () => {
	const privasi = async () => (await readStaticPage(identity.sql, "privasi"))?.version ?? 0;
	const [syarat0, privasi0] = [await current(), await privasi()];
	const key = randomUUID();
	const answers = await Promise.all([
		handleStaticPages(call(owner, `${root}/syarat/versions`, content(syarat0), key), identity),
		handleStaticPages(call(owner, `${root}/privasi/versions`, content(privasi0, { title: "Kebijakan privasi" }), key), identity),
	]);
	const statuses = answers.map((response) => response.status).sort();
	assert.deepEqual(statuses, [201, 409]);
	const refused = await answers.find((response) => response.status === 409)?.json();
	assert.equal(refused.code, "IDEMPOTENCY_CONFLICT");
	assert.equal((await current()) - syarat0 + (await privasi()) - privasi0, 1);
});

test("S-C1 input validation: empty body, control characters, unknown fields, long title, query string", async () => {
	const before = await current();
	// Schema-visible refusals carry request_valid=false; the server-only rules (blank, control or format characters) do not.
	for (const bad of [content(before, { title: "x".repeat(81) }), { ...content(before), extra: 1 }]) await observe(call(owner, `${root}/syarat/versions`, bad), 400, false);
	for (const bad of [content(before, { body: "   " }), content(before, { title: "Judul\u0007" }), content(before, { body: "a\u200bb" })]) await observe(call(owner, `${root}/syarat/versions`, bad), 400);
	await observe(call(owner, `${root}?limit=1`), 400);
	// The full 20,000-character body fits the 32 KB request limit.
	const long = await observe(call(owner, `${root}/syarat/versions`, content(before, { body: "a".repeat(20000) })), 201, true);
	assert.equal(long.version, before + 1);
	assert.equal(await current(), before + 1);
	// A version row cannot be changed or removed.
	await assert.rejects(identity.sql`update app.static_page_version set title='x' where slug='syarat'`);
	await assert.rejects(identity.sql`delete from app.static_page_version where slug='syarat'`);
	await assert.rejects(identity.sql`insert into app.static_page_version (slug,revision,title,body,actor_id,reason) values ('syarat',${before + 9},'x','x','x','x')`);
});

test("S-C1 wire parity", () => {
	validateExchanges(samples, "static-pages");
});
