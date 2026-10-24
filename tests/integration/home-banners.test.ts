import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { privateDirectory } from "../../src/config/local.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { currentHomeBanners } from "../../src/modules/storefront/banners.ts";
import { handleHomeBanners } from "../../src/modules/storefront/home-banners.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";

// S110 home banners against the real test database: permissions (owner/ecommerce_admin with MFA, others refused),
// reauthentication on every write, audited immutable versions, WIB scheduling in the public projection, reorder,
// retirement, image upload checks, database guards and wire parity for all seven operations.
const origin = "http://127.0.0.1:3099";
const root = "/api/v1/admin/home-banners";
const identity = createLocalAuth("test");
type User = Awaited<ReturnType<typeof actor>>;
let owner: User, editor: User, support: User, noMfa: User;
const users: User[] = [];
const samples: Exchange[] = [];
const created: string[] = [];
const storedImages: string[] = [];
let image = "";

// A synthetic extended-format (VP8X) WebP header with the given canvas and random payload: enough for the
// magic-byte, scan and size checks; the bytes are unique per call, so cleanup removes only this run's files.
function webp(width: number, height: number, payload = 256) {
	const bytes = Buffer.concat([Buffer.alloc(30), randomBytes(payload)]);
	bytes.write("RIFF", 0, "latin1");
	bytes.writeUInt32LE(bytes.length - 8, 4);
	bytes.write("WEBPVP8X", 8, "latin1");
	bytes.writeUInt32LE(10, 16);
	bytes.writeUIntLE(width - 1, 24, 3);
	bytes.writeUIntLE(height - 1, 27, 3);
	return Uint8Array.from(bytes);
}
const cookie = (user: User | null) => (user ? [...user.browser.cookies].map(([name, value]) => `${name}=${value}`).join("; ") : "");
async function observe(request: Request, expected: number, valid?: boolean) {
	const body = request.headers.get("content-type") === "application/json" && request.body ? await request.clone().text() : undefined;
	const response = await handleHomeBanners(request, identity);
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
function call(user: User | null, path: string, body?: unknown, key: string = randomUUID()) {
	const headers = new Headers({ origin, cookie: cookie(user) });
	if (body !== undefined) {
		headers.set("content-type", "application/json");
		headers.set("idempotency-key", key);
	}
	return new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
function upload(user: User | null, bytes: Uint8Array<ArrayBuffer>, type = "image/webp") {
	return new Request(`${origin}/api/v1/admin/home-banner-images`, {
		method: "POST",
		headers: { origin, cookie: cookie(user), "content-type": type, "idempotency-key": randomUUID() },
		body: bytes,
	});
}
async function proof(user: User) {
	// Proof issuance allows five per minute per principal; this suite needs more, so it resets its own bucket.
	await identity.sql`delete from app.auth_rate_limit where key=${`access-proof:${user.id}`}`;
	const request = user.browser.request("/api/v1/me/reauthentication-proofs", { password: user.password, action: "home_banner.write", subject_id: "home-banners" });
	request.headers.set("idempotency-key", randomUUID());
	const response = await handleAccess(request, identity);
	const payload = await response.json();
	assert.equal(response.status, 201, JSON.stringify(payload));
	return payload.proof as string;
}
const hour = 3_600_000;
const content = (patch: Record<string, unknown> = {}) => ({
	title: "Synthetic banner",
	subtitle: "Synthetic only",
	action_label: "Lihat pilihan",
	href: "/promo",
	image_sha256: image,
	image_alt: "Synthetic test image",
	tint: null,
	starts_at: new Date(Date.now() - hour).toISOString(),
	ends_at: new Date(Date.now() + hour).toISOString(),
	active: true,
	...patch,
});
async function make(user: User, patch: Record<string, unknown> = {}) {
	const banner = await observe(call(user, root, { ...content(patch), reason: "Synthetic create", reauthentication_proof: await proof(user) }), 201, true);
	created.push(banner.id);
	return banner;
}

before(async () => {
	owner = await actor(identity, "owner", []);
	editor = await actor(identity, "ecommerce_admin", []);
	support = await actor(identity, "customer_service", []);
	noMfa = await actor(identity, "owner", []);
	users.push(owner, editor, support, noMfa);
	for (const user of [owner, editor, support]) await enroll(user.browser, user.password);
});
after(async () => {
	try {
		// Retire every banner this run created, so the shared database's storefront falls back to its defaults.
		for (const id of created) {
			const [row] = await identity.sql`select v.revision,v.retired from app.home_banner h join app.home_banner_version v on v.banner_id=h.id and v.revision=h.revision where h.id=${id}`;
			if (row && !row.retired) {
				const response = await handleHomeBanners(call(owner, `${root}/${id}/retirements`, { expected_version: row.revision, reason: "Synthetic teardown", reauthentication_proof: await proof(owner) }), identity);
				assert.equal(response.status, 201);
			}
		}
		for (const name of storedImages) await unlink(join(privateDirectory("catalog-media"), name)).catch(() => {});
		await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(users.map((user) => `home-banner-image:${user.id}`))}`;
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("S110 banner API refuses anonymous, non-editor and non-MFA principals on every operation", async () => {
	const dummy = randomUUID();
	for (const path of [root, `${root}/${dummy}/versions`]) await observe(call(null, path), 401);
	for (const path of [root, `${root}/order`, `${root}/${dummy}/versions`, `${root}/${dummy}/retirements`]) await observe(call(null, path, {}), 401);
	await observe(upload(null, webp(800, 800)), 401);
	await observe(call(support, root), 403);
	await observe(call(noMfa, root), 403);
	await observe(upload(support, webp(800, 800)), 403);
	// The content proof is for editors only and binds the fixed company subject.
	const refused = support.browser.request("/api/v1/me/reauthentication-proofs", { password: support.password, action: "home_banner.write", subject_id: "home-banners" });
	refused.headers.set("idempotency-key", randomUUID());
	assert.equal((await handleAccess(refused, identity)).status, 403);
	const wrongSubject = owner.browser.request("/api/v1/me/reauthentication-proofs", { password: owner.password, action: "home_banner.write", subject_id: "company-commercial" });
	wrongSubject.headers.set("idempotency-key", randomUUID());
	assert.equal((await handleAccess(wrongSubject, identity)).status, 400);
	const mixed = call(owner, root);
	mixed.headers.set("x-cart-token", "synthetic-unsupported");
	await observe(mixed, 401);
});

test("S110 image upload enforces type, magic bytes, size and pixel bounds before storing catalog media", async () => {
	await observe(upload(owner, webp(800, 800), "image/png"), 415);
	await observe(upload(owner, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(64)])), 415);
	await observe(upload(owner, new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), 415);
	await observe(upload(owner, webp(800, 800, 512 * 1024)), 413);
	await observe(upload(owner, webp(599, 800)), 422);
	await observe(upload(owner, webp(800, 4097)), 422);
	const bytes = webp(1080, 1350);
	const stored = await observe(upload(editor, bytes), 201);
	assert.equal(stored.sha256, createHash("sha256").update(bytes).digest("hex"));
	assert.deepEqual([stored.width, stored.height, stored.byte_size], [1080, 1350, bytes.byteLength]);
	assert.equal(stored.url, `/media/catalog/${stored.sha256.slice(0, 12)}.webp`);
	image = stored.sha256;
	storedImages.push(`${image}.webp`);
	const [audit] = await identity.sql`select actor_id from app.audit_event where action='home_banner.image_upload' and subject_id=${image}`;
	assert.equal(audit.actor_id, editor.id);
});

test("S110 writes need a fresh proof, are audited and retry-safe; owner and ecommerce_admin both manage banners", async () => {
	const input = { ...content({ title: "Synthetic live" }), reason: "Synthetic create" };
	await observe(call(owner, root, input), 400, false);
	await observe(call(owner, root, { ...input, reauthentication_proof: "synthetic-not-issued" }), 403, true);
	const key = randomUUID();
	const first = await observe(call(owner, root, { ...input, reauthentication_proof: await proof(owner) }, key), 201, true);
	created.push(first.id);
	assert.equal(first.version, 1);
	assert.equal(first.phase, "live");
	assert.deepEqual([first.image.width, first.image.height], [1080, 1350]);
	// Same key and body: the saved response, without consuming another proof (the spent one is passed again).
	assert.deepEqual(await observe(call(owner, root, { ...input, reauthentication_proof: "spent-proof-ignored" }, key), 201, true), first);
	await observe(call(owner, root, { ...input, title: "Changed", reauthentication_proof: "x" }, key), 409, true);
	await observe(call(owner, root, { ...content({ href: "https://evil.example/promo" }), reason: "x", reauthentication_proof: await proof(owner) }), 400, false);
	await observe(call(owner, root, { ...content({ image_sha256: "0".repeat(64) }), reason: "x", reauthentication_proof: await proof(owner) }), 422, true);
	const byEditor = await make(editor, { title: "Synthetic editor" });
	assert.equal(byEditor.recorded_by, editor.id);
	const audits = await identity.sql`select action,actor_id from app.audit_event where subject_id in ${identity.sql([first.id, byEditor.id])} order by created_at`;
	assert.deepEqual(audits.map((row) => [row.action, row.actor_id]), [["home_banner.create", owner.id], ["home_banner.create", editor.id]]);
});

test("S110 public projection honours WIB windows, pauses, rail order and exposes public fields only", async () => {
	// A WIB campaign day: 1 Dec 2026 00:00 WIB to 2 Dec 2026 00:00 WIB is 30 Nov 17:00Z to 1 Dec 17:00Z.
	const scheduled = await make(owner, { title: "Synthetic scheduled", starts_at: "2026-11-30T17:00:00.000Z", ends_at: "2026-12-01T17:00:00.000Z" });
	const paused = await make(editor, { title: "Synthetic paused", active: false });
	const list = await observe(call(owner, root), 200, true);
	assert.equal(list.configured, true);
	const mine = (rows: { id: string }[]) => rows.map((row) => row.id).filter((id) => created.includes(id));
	assert.equal(list.data.find((b: { id: string }) => b.id === scheduled.id).phase, "scheduled");
	assert.equal(list.data.find((b: { id: string }) => b.id === paused.id).phase, "paused");
	const at = async (iso: string) => mine((await currentHomeBanners(identity.sql, new Date(iso))).banners);
	assert.ok(!(await at("2026-11-30T16:59:59.999Z")).includes(scheduled.id), "before 00:00 WIB");
	assert.ok((await at("2026-11-30T17:00:00.000Z")).includes(scheduled.id), "from 00:00 WIB");
	assert.ok((await at("2026-12-01T16:59:59.999Z")).includes(scheduled.id), "until just before the next 00:00 WIB");
	assert.ok(!(await at("2026-12-01T17:00:00.000Z")).includes(scheduled.id), "end is exclusive");
	const now = await currentHomeBanners(identity.sql);
	assert.ok(!mine(now.banners).includes(paused.id), "paused never shows");
	const live = now.banners.find((b) => created.includes(b.id));
	assert.ok(live);
	assert.deepEqual(Object.keys(live).sort(), ["action_label", "href", "id", "image", "subtitle", "tint", "title"]);
	assert.deepEqual(Object.keys(live.image).sort(), ["alt", "height", "src", "width"]);
	assert.match(live.image.src, /^\/media\/catalog\/synthetic-[a-z-]+-[0-9a-f]{12}\.webp$/);
	// Rail order follows position (creation appends last).
	const positions = list.data.filter((b: { id: string }) => created.includes(b.id)).map((b: { position: number }) => b.position);
	assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test("S110 reorder, revise and retire append versions; stale writes and retired banners are refused", async () => {
	const current = (await observe(call(owner, root), 200, true)).data as { id: string; version: number; title: string }[];
	const reversed = [...current].reverse();
	const banners = reversed.map((b) => ({ id: b.id, expected_version: b.version }));
	await observe(call(owner, `${root}/order`, { banners: banners.slice(1), reason: "Synthetic order", reauthentication_proof: await proof(owner) }), 409, true);
	const ordered = await observe(call(owner, `${root}/order`, { banners, reason: "Synthetic order", reauthentication_proof: await proof(owner) }), 201, true);
	assert.deepEqual(ordered.data.map((b: { id: string }) => b.id), reversed.map((b) => b.id));
	assert.deepEqual(ordered.data.map((b: { position: number }) => b.position), reversed.map((_, i) => i));
	const target = ordered.data.find((b: { id: string }) => created.includes(b.id));
	const revision = { ...content({ title: "Synthetic revised", tint: "slate", href: "/cari?q=kaos+polos" }), reason: "Synthetic revise" };
	await observe(call(owner, `${root}/${target.id}/versions`, { ...revision, expected_version: target.version + 5, reauthentication_proof: await proof(owner) }), 409, true);
	const revised = await observe(call(editor, `${root}/${target.id}/versions`, { ...revision, expected_version: target.version, reauthentication_proof: await proof(editor) }), 201, true);
	assert.deepEqual([revised.version, revised.title, revised.position, revised.href], [target.version + 1, "Synthetic revised", target.position, "/cari?q=kaos+polos"]);
	const retired = await observe(call(owner, `${root}/${target.id}/retirements`, { expected_version: revised.version, reason: "Synthetic retire", reauthentication_proof: await proof(owner) }), 201, true);
	assert.deepEqual([retired.retired, retired.active, retired.phase], [true, false, "retired"]);
	await observe(call(owner, `${root}/${target.id}/retirements`, { expected_version: retired.version, reason: "again", reauthentication_proof: await proof(owner) }), 409, true);
	await observe(call(owner, `${root}/${target.id}/versions`, { ...revision, expected_version: retired.version, reauthentication_proof: await proof(owner) }), 409, true);
	assert.ok(!(await currentHomeBanners(identity.sql)).banners.some((b) => b.id === target.id));
	assert.ok((await observe(call(owner, `${root}?state=retired`), 200, true)).data.some((b: { id: string }) => b.id === target.id));
	await observe(call(owner, `${root}?state=all`), 400, false);
	const history = await observe(call(owner, `${root}/${target.id}/versions?limit=2`), 200, true);
	assert.deepEqual(history.data.map((v: { version: number }) => v.version), [retired.version, revised.version]);
	assert.equal(history.pagination.next_cursor, String(revised.version));
	await observe(call(owner, `${root}/${randomUUID()}/versions`), 404);
	const actions = await identity.sql`select action from app.audit_event where subject_id=${target.id} order by created_at`;
	assert.deepEqual(actions.map((row) => row.action).slice(-2), ["home_banner.revise", "home_banner.retire"]);
	assert.ok((await identity.sql`select 1 from app.audit_event where action='home_banner.reorder' and actor_id=${owner.id}`).length);
});

test("S110 database guards keep banner identities permanent and versions immutable and sequential", async () => {
	const id = created[0];
	const rejects = async (statement: Promise<unknown>) => assert.rejects(statement, (error: { code?: string }) => error.code === "23514");
	await rejects(identity.sql`update app.home_banner_version set title='Tampered' where banner_id=${id}`);
	await rejects(identity.sql`delete from app.home_banner_version where banner_id=${id}`);
	await rejects(identity.sql`delete from app.home_banner where id=${id}`);
	await rejects(identity.sql`update app.home_banner set revision=revision+1 where id=${id}`);
	await rejects(identity.sql`insert into app.home_banner (revision) values (1)`);
	// A version that skips the head, or an identity left without its version, never commits.
	await rejects(
		identity.sql.begin(async (tx) => {
			const [head] = await tx`select revision from app.home_banner where id=${id}`;
			await tx`insert into app.home_banner_version (banner_id,revision,title,action_label,href,image_sha256,image_width,image_height,image_alt,starts_at,ends_at,position,active,actor_id,reason)
				values (${id},${head.revision + 2},'x','x','/promo',${image},800,800,'x',now(),now()+interval '1 hour',0,false,'synthetic','x')`;
		}),
	);
	await rejects(identity.sql.begin((tx) => tx`insert into app.home_banner (id) values (${randomUUID()})`));
	await assert.rejects(
		identity.sql`insert into app.home_banner_version (banner_id,revision,title,action_label,href,image_sha256,image_width,image_height,image_alt,starts_at,ends_at,position,active,actor_id,reason)
			values (${id},999,'x','x','https://evil.example',${image},800,800,'x',now(),now()+interval '1 hour',0,false,'synthetic','x')`,
	);
});

test("S110 every banner operation matches the OpenAPI contract for success and denial", () => {
	validateExchanges(samples, "home-banners");
});
