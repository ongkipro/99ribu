import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { privateDirectory } from "../../src/config/local.ts";
import { catalogMediaFileName } from "../../src/storage/catalog-media.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";

// S-P1 product photo upload (POST /admin/product-photos) against the real test database and private media store:
// role gate (owner/ecommerce_admin with MFA), WebP only by header and magic bytes, size and 300 px limits,
// content-addressed storage (the same bytes give the same URL), audit, the 20-per-minute limit and wire parity.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("test");
type User = Awaited<ReturnType<typeof actor>>;
let owner: User, editor: User, finance: User, noMfa: User;
const users: User[] = [];
const samples: Exchange[] = [];
const stored = new Set<string>();

// A synthetic extended-format (VP8X) WebP header with the given canvas and random payload (as tests/integration/home-banners.test.ts).
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
const upload = (user: User | null, bytes: Uint8Array<ArrayBuffer>, type = "image/webp") =>
	new Request(`${origin}/api/v1/admin/product-photos`, { method: "POST", headers: { origin, cookie: cookie(user), "content-type": type, "idempotency-key": randomUUID() }, body: bytes });
async function observe(request: Request, expected: number) {
	const response = await handleCatalog(request, identity);
	const payload = await response.json();
	assert.equal(response.status, expected, JSON.stringify(payload));
	samples.push({ url: request.url, method: request.method, request_headers: Object.fromEntries([...request.headers].filter(([key]) => ["content-type", "idempotency-key"].includes(key))), status: response.status, headers: Object.fromEntries(response.headers), payload });
	if (response.status === 201) stored.add(catalogMediaFileName("", payload.sha256));
	return payload;
}
const limitKeys = () => users.map((user) => `product-photo:${user.id}`);

before(async () => {
	owner = await actor(identity, "owner", []);
	editor = await actor(identity, "ecommerce_admin", []);
	finance = await actor(identity, "finance", []);
	noMfa = await actor(identity, "owner", []);
	users.push(owner, editor, finance, noMfa);
	for (const user of [owner, editor, finance]) await enroll(user.browser, user.password);
});
after(async () => {
	try {
		for (const name of stored) await unlink(join(privateDirectory("catalog-media"), name)).catch(() => {});
		await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(limitKeys())}`;
		await identity.sql`delete from app.audit_event where action='catalog.photo_upload' and actor_id in ${identity.sql(users.map((user) => user.id))}`.catch(() => {});
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("S-P1 photo upload refuses anonymous, finance and non-MFA principals", async () => {
	await observe(upload(null, webp(800, 800)), 401);
	await observe(upload(finance, webp(800, 800)), 403);
	await observe(upload(noMfa, webp(800, 800)), 403);
});

test("S-P1 an editor stores a WebP; same bytes, same URL; audit recorded", async () => {
	const bytes = webp(1080, 900);
	const first = await observe(upload(editor, bytes), 201);
	assert.match(first.sha256, /^[0-9a-f]{64}$/);
	assert.deepEqual([first.width, first.height, first.byte_size], [1080, 900, bytes.byteLength]);
	assert.ok(first.url.endsWith(`/media/catalog/${catalogMediaFileName("", first.sha256)}`), first.url);
	const second = await observe(upload(owner, bytes), 201);
	assert.equal(second.url, first.url);
	const [audit] = await identity.sql`select details from app.audit_event where action='catalog.photo_upload' and actor_id=${editor.id} and subject_id=${first.sha256}`;
	assert.equal(audit.details.width, 1080);
});

test("S-P1 rejects wrong type, mismatched bytes, too small, too large and empty", async () => {
	await observe(upload(owner, webp(800, 800), "image/jpeg"), 415);
	await observe(upload(owner, Uint8Array.from(randomBytes(400))), 415);
	assert.equal((await observe(upload(owner, webp(299, 800)), 422)).code, "PRODUCT_PHOTO_TOO_SMALL");
	await observe(upload(owner, webp(800, 800, 600 * 1024)), 413);
	await observe(upload(owner, new Uint8Array(0)), 400);
});

test("S-P1 at most 20 uploads per minute per actor", async () => {
	await identity.sql`delete from app.auth_rate_limit where key=${`product-photo:${editor.id}`}`;
	for (let i = 0; i < 20; i++) await observe(upload(editor, webp(400, 400)), 201);
	const refused = await handleCatalog(upload(editor, webp(400, 400)), identity);
	assert.equal(refused.status, 429);
	assert.ok(Number(refused.headers.get("retry-after")) >= 1);
});

test("S-P1 wire parity", () => {
	validateExchanges(samples, "product-photos");
});
