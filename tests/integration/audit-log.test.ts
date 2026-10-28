import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleAuditLog } from "../../src/modules/audit/log.ts";
import {
	cleanText,
	MASK,
	MONEY_ACTIONS,
	redactDetails,
	redactSubject,
} from "../../src/modules/audit/redaction.ts";
import { actor, type BrowserSession, cleanup, enroll } from "../contract/access-fixture.ts";

// S135 audit log viewer against the isolated TEST database: role scope (owner all, finance money only, everyone
// else 403 without growing the log), allowlist redaction of a seeded event that carries secrets, keyset paging with
// timestamp ties, filters, and the audited read.

const identity = createLocalAuth("test");
const sql = identity.sql;
type Session = { id: string; email: string; password: string; browser: BrowserSession };
type Page = {
	scope: string;
	data: {
		id: string;
		occurred_at: string;
		actor_id: string | null;
		actor_name: string | null;
		action: string;
		subject_id: string | null;
		outcome: string;
		reason: string;
		details: Record<string, unknown>;
		redacted: boolean;
	}[];
	pagination: { next_cursor: string | null };
};

const read = async (who: Session | null, query: Record<string, string>) => {
	const url = new URL("http://127.0.0.1:3099/api/v1/admin/audit-events");
	for (const [key, value] of Object.entries(query))
		url.searchParams.set(key, value);
	const request = who
		? who.browser.request(`${url.pathname}${url.search}`)
		: new Request(url, { headers: { origin: url.origin } });
	const response = await handleAuditLog(request, identity);
	assert.equal(response.headers.get("cache-control"), "no-store");
	return { status: response.status, body: await response.json() };
};
const page = async (who: Session, query: Record<string, string>) => {
	const result = await read(who, query);
	assert.equal(result.status, 200, JSON.stringify(result.body));
	return result.body as Page;
};
const countReads = async (userId: string) =>
	Number(
		(
			await sql`select count(*)::int as n from app.audit_event where actor_id=${userId} and action='audit.read'`
		)[0].n,
	);

// Secret-looking material seeded into stored events. None of it may ever appear in a response.
const SECRETS = {
	otp: "483920",
	token: "tok_live_9f8e7d6c5b4a39281706f5e4d3c2b1a0",
	proofDigest: "b1946ac92492d2347c6235b4d2611184b1946ac92492d2347c6235b4d2611184",
	hmac: "hmac-sha256=3f1a9c0d7e5b2a48",
	password: "$argon2id$v=19$m=65536$c2FsdHNhbHQ$hashhashhash",
	session: "session-cookie-value-123",
	account: "1234567890123",
	bankRef: "TRF-BCA-0099887",
	phone: "+6281234567890",
	email: "pembeli.pribadi@example.invalid",
	replyText: "Halo kak, kode diskon rahasia KAKAK50",
};

test("S135 audit log: scope, redaction, keyset paging with ties, filters and the audited read", async () => {
	const owner = await actor(identity, "owner", []);
	const finance = await actor(identity, "finance", []);
	const others = [
		await actor(identity, "ecommerce_admin", []),
		await actor(identity, "warehouse", []),
		await actor(identity, "customer_service", []),
	];
	const buyer = await actor(identity, "buyer", []);
	for (const who of [owner, finance, ...others]) await enroll(who.browser, who.password);
	await sql`update app.role_grant set permissions=${["finance.reconciliation.read", "finance.refunds.read", "finance.costs.read"]} where user_id=${finance.id}`;
	const users = [owner, finance, ...others, buyer];
	const marker = `s135-${randomUUID()}`;
	const tieAt = "2026-01-15 10:00:00.123456+00";
	const money = [...MONEY_ACTIONS].filter((a) => !a.startsWith("local."));
	const nonMoney = [
		"staff_roles.replace",
		"catalog.product.publish",
		"finance.costs.read",
		"affiliate.beneficiary_change",
		"support.saved_reply.version",
		"audit.read.fixture",
	];

	const seed = async (
		action: string,
		subject: string | null,
		details: unknown,
		at: string,
		reason = "Seeded for S135",
		actorId: string = marker,
	) => {
		const [row] = await sql`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details,created_at)
			values (${actorId},${action},${subject},'allowed',${reason},${JSON.stringify(details)}::jsonb,${at}::timestamptz) returning id`;
		return String(row.id);
	};

	try {
		// 12 events share one microsecond timestamp (ties), the rest are spread out; half money, half not.
		const seeded: { id: string; action: string }[] = [];
		for (let index = 0; index < 12; index++) {
			const action = index % 2 === 0 ? money[index % money.length] : nonMoney[index % nonMoney.length];
			seeded.push({ id: await seed(action, `tie-${index}`, { operation_id: `op-${index}`, version: index }, tieAt), action });
		}
		for (let index = 0; index < 10; index++) {
			const action = index % 2 === 0 ? money[(index + 3) % money.length] : nonMoney[(index + 1) % nonMoney.length];
			seeded.push({
				id: await seed(action, `spread-${index}`, { version: index }, `2026-01-${String(10 + index).padStart(2, "0")} 08:00:00+00`),
				action,
			});
		}
		// An actor that is staff (owner) shows a name; the seeded marker actor is nobody.
		await seed("finance.reconcile", "named", { operation_id: "op-named" }, "2026-01-16 08:00:00+00", "Seeded for S135", owner.id);

		// Secrets on events whose action HAS a policy, on one that has none, and in free-text positions.
		const leaky = {
			manual: await seed(
				"finance.manual_transfer",
				"order-1",
				{
					operation_id: "op-m",
					order_id: "order-1",
					amount: 99000,
					expected_amount: 99000,
					bank_reference: SECRETS.bankRef,
					account_number: SECRETS.account,
					proof_digest: SECRETS.proofDigest,
					hmac: SECRETS.hmac,
					password_hash: SECRETS.password,
					session_token: SECRETS.session,
					otp: SECRETS.otp,
				},
				"2026-01-20 09:00:00+00",
				`Transfer dicocokkan ${SECRETS.token}`,
			),
			challenge: await seed(
				"buyer.contact_change.challenge",
				randomUUID(),
				{ challenge_id: "chal-1", channel: "whatsapp", targetValue: SECRETS.phone, code: SECRETS.otp, otp: SECRETS.otp },
				"2026-01-20 09:01:00+00",
			),
			evidence: await seed(
				"payout.evidence_uploaded",
				"evidence-1",
				{ evidence_id: "ev-1", size_bytes: 1200, media_type: "image/png", sha256: SECRETS.proofDigest },
				"2026-01-20 09:02:00+00",
			),
			unknown: await seed(
				"zz.unlisted_action",
				SECRETS.email,
				{ secret: SECRETS.token, note: SECRETS.replyText },
				"2026-01-20 09:03:00+00",
			),
			saved: await seed(
				"support.saved_reply.version",
				"reply-1",
				{ version: 3, before: { body: SECRETS.replyText }, after: { body: SECRETS.replyText } },
				"2026-01-20 09:04:00+00",
			),
			grants: await seed(
				"staff_roles.replace",
				"user-9",
				{ id: "g1", user_id: "user-9", roles: ["finance"], warehouse_ids: [], permissions: ["finance.summary.read"], version: 2, reauthentication_proof: SECRETS.proofDigest },
				"2026-01-20 09:05:00+00",
			),
			session: await seed(
				"auth.undelivered_session.recover",
				SECRETS.session,
				{ user_id: "user-9", session_id: SECRETS.session, session_revoked: true },
				"2026-01-20 09:06:00+00",
			),
		};
		const everySeeded = [...seeded.map((s) => s.id), ...Object.values(leaky)];

		// 1. Non-permitted roles: 403 (after a valid session), 401 anonymously, and no audit row for the refusal.
		for (const who of [...others, buyer]) {
			const refused = await read(who, {});
			assert.equal(refused.status, 403);
			assert.equal(refused.body.code, "FORBIDDEN");
			assert.equal(await countReads(who.id), 0, "A refusal must not write an audit row");
		}
		assert.equal((await read(null, {})).status, 401);
		// A refusal precedes validation: an unauthorised caller learns nothing about the filters.
		assert.equal((await read(others[0], { bogus: "1" })).status, 403);

		// 2. Owner: every seeded event once, newest first, across pages that cut through the timestamp tie.
		const ownerReads = await countReads(owner.id);
		const seen: Page["data"] = [];
		let cursor: string | null = null;
		let pages = 0;
		do {
			const result: Page = await page(owner, { actor: marker, limit: "5", ...(cursor ? { cursor } : {}) });
			assert.equal(result.scope, "all");
			assert.ok(result.data.length <= 5);
			seen.push(...result.data);
			cursor = result.pagination.next_cursor;
			pages++;
		} while (cursor);
		assert.equal(seen.length, everySeeded.length);
		assert.equal(new Set(seen.map((e) => e.id)).size, seen.length, "Each row exactly once");
		assert.deepEqual(new Set(seen.map((e) => e.id)), new Set(everySeeded));
		assert.ok(pages >= 6);
		const expectedOrder = await sql`select id from app.audit_event where actor_id=${marker} order by created_at desc, id desc`;
		assert.deepEqual(seen.map((e) => e.id), expectedOrder.map((r) => String(r.id)), "Stable (created_at, id) descending order");
		const tied = seen.filter((e) => e.occurred_at === "2026-01-15T10:00:00.123Z");
		assert.equal(tied.length, 12);
		assert.equal((await countReads(owner.id)) - ownerReads, pages, "One audit.read per page");

		// 3. The read itself is audited, with filter names but never actor/object values.
		const [latest] = await sql`select details,reason,subject_id,outcome from app.audit_event where actor_id=${owner.id} and action='audit.read' order by created_at desc,id desc limit 1`;
		assert.equal(latest.outcome, "allowed");
		assert.deepEqual(latest.details, { scope: "all", filters: ["actor"], action_filter: null, page: "next", returned: seen.length - 5 * (pages - 1) });
		const firstRead = await page(owner, { actor: marker, object: "tie-3", action: "finance.", from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" });
		assert.ok(firstRead.data.length <= 1);
		const [audited] = await sql`select details from app.audit_event where actor_id=${owner.id} and action='audit.read' order by created_at desc,id desc limit 1`;
		assert.deepEqual(audited.details, {
			scope: "all",
			filters: ["actor", "action", "object", "period"],
			action_filter: "finance.",
			page: "first",
			returned: firstRead.data.length,
		});
		const auditedJson = JSON.stringify(audited.details);
		for (const value of [marker, "tie-3", "2026-01-01"]) assert.ok(!auditedJson.includes(value), `${value} is not echoed into the audit read`);
		// A page never lists its own read.
		const own = await page(owner, { actor: owner.id, limit: "100" });
		assert.ok(own.data.some((e) => e.action === "finance.reconcile" && e.actor_name === "Synthetic Access"));
		const countBefore = own.data.filter((e) => e.action === "audit.read").length;
		const again = await page(owner, { actor: owner.id, limit: "100" });
		assert.equal(again.data.filter((e) => e.action === "audit.read").length, countBefore + 1, "The earlier read is listed, the current one is not");

		// 4. Redaction: the seeded secrets never leave, whichever action carries them.
		const everything = JSON.stringify(seen);
		for (const [name, secret] of Object.entries(SECRETS))
			assert.ok(!everything.includes(secret), `${name} must not appear in any returned event`);
		const byId = new Map(seen.map((e) => [e.id, e]));
		assert.deepEqual(byId.get(leaky.manual)?.details, { operation_id: "op-m", order_id: "order-1", amount: 99000, expected_amount: 99000 });
		assert.ok(byId.get(leaky.manual)?.redacted);
		assert.ok(byId.get(leaky.manual)?.reason.includes(MASK), "A token inside free text is masked");
		assert.deepEqual(byId.get(leaky.challenge)?.details, { challenge_id: "chal-1" });
		assert.deepEqual(byId.get(leaky.evidence)?.details, { evidence_id: "ev-1", size_bytes: 1200, media_type: "image/png" });
		assert.deepEqual(byId.get(leaky.unknown)?.details, {}, "An action without a policy exposes no details");
		assert.equal(byId.get(leaky.unknown)?.subject_id, null, "A subject shaped like an email is withheld");
		assert.ok(byId.get(leaky.unknown)?.redacted);
		assert.deepEqual(byId.get(leaky.saved)?.details, { version: 3 }, "Saved-reply snapshots are not exposed");
		assert.deepEqual(byId.get(leaky.grants)?.details, { id: "g1", user_id: "user-9", roles: ["finance"], warehouse_ids: [], permissions: ["finance.summary.read"], version: 2 });
		assert.equal(byId.get(leaky.session)?.subject_id, null, "A session id subject is withheld");
		assert.deepEqual(byId.get(leaky.session)?.details, { user_id: "user-9", session_revoked: true });
		assert.equal(byId.get(seeded[0].id)?.redacted, false, "Fully allowlisted details are not flagged");
		assert.equal(byId.get(seeded[0].id)?.actor_name, null, "Only staff actors are named");

		// 5. Finance: money actions only, filtered in SQL whatever the request asks for.
		const financeSeen: Page["data"] = [];
		cursor = null;
		do {
			const result: Page = await page(finance, { actor: marker, limit: "7", ...(cursor ? { cursor } : {}) });
			assert.equal(result.scope, "money");
			financeSeen.push(...result.data);
			cursor = result.pagination.next_cursor;
		} while (cursor);
		const expectedMoney = [...seeded.map((s) => ({ id: s.id, action: s.action })), { id: leaky.manual, action: "finance.manual_transfer" }, { id: leaky.evidence, action: "payout.evidence_uploaded" }]
			.filter((e) => (MONEY_ACTIONS as readonly string[]).includes(e.action));
		assert.ok(expectedMoney.length >= 8);
		assert.deepEqual(new Set(financeSeen.map((e) => e.id)), new Set(expectedMoney.map((e) => e.id)));
		assert.ok(financeSeen.every((e) => (MONEY_ACTIONS as readonly string[]).includes(e.action)), "No non-money action is returned to finance");
		assert.equal(new Set(financeSeen.map((e) => e.id)).size, financeSeen.length);
		// A family filter that would match owner-only rows is still cut to money; an owner-only action returns nothing.
		const family = await page(finance, { actor: marker, action: "finance.", limit: "100" });
		assert.ok(family.data.length > 0 && family.data.every((e) => (MONEY_ACTIONS as readonly string[]).includes(e.action)));
		assert.ok(!family.data.some((e) => e.action === "finance.costs.read"));
		assert.deepEqual((await page(finance, { actor: marker, action: "staff_roles.replace" })).data, []);
		assert.deepEqual((await page(finance, { object: "user-9", actor: marker })).data, [], "Owner-only events never leak by object filter");
		const financeRead = await page(finance, { actor: marker });
		assert.ok(financeRead.data.length > 0);
		const [financeAudit] = await sql`select details from app.audit_event where actor_id=${finance.id} and action='audit.read' order by created_at desc,id desc limit 1`;
		assert.deepEqual(financeAudit.details, { scope: "money", filters: ["actor"], action_filter: null, page: "first", returned: financeRead.data.length });
		// Finance sees none of its own or the owner's audit.read rows (not a money action).
		assert.ok(!(await page(finance, { actor: owner.id, limit: "100" })).data.some((e) => e.action === "audit.read"));
		// Finance sees an action only with the permission its money surface needs (spec 07); the rule is read in the
		// read transaction, so narrowing the grant narrows the next read.
		const only = async (permissions: string[]) => {
			await sql`update app.role_grant set permissions=${permissions} where user_id=${finance.id}`;
			const seen = await page(finance, { actor: marker, limit: "100" });
			return new Set(seen.data.map((e) => e.action.split(".")[0]));
		};
		assert.deepEqual([...(await only([]))].sort(), ["payout"], "No finance permission: payout actions only");
		assert.deepEqual([...(await only(["finance.refunds.read"]))].sort(), ["payout", "refund"]);
		const reconciliationOnly = await only(["finance.reconciliation.read"]);
		assert.ok(reconciliationOnly.has("finance") && reconciliationOnly.has("payout") && !reconciliationOnly.has("refund"));
		await sql`update app.role_grant set permissions=${["finance.costs.read"]} where user_id=${finance.id}`;
		const costsOnly = await page(finance, { actor: marker, limit: "100" });
		assert.ok(costsOnly.data.some((e) => e.action === "finance.costs.append"));
		assert.ok(costsOnly.data.every((e) => e.action === "finance.costs.append" || e.action.startsWith("payout.")), "Costs permission opens cost writes and payouts only");

		// 6. Period and exact-action filters.
		// 10:00:00.123456 UTC is 17:00 WIB: a two-hour WIB window around it holds exactly the 12 tied rows, and `to` is exclusive.
		const day = await page(owner, { actor: marker, from: "2026-01-15T16:00:00+07:00", to: "2026-01-15T18:00:00+07:00", limit: "100" });
		assert.equal(day.data.length, 12);
		assert.equal((await page(owner, { actor: marker, from: "2026-01-15T16:00:00+07:00", to: "2026-01-15T17:00:00.123456+07:00", limit: "100" })).data.length, 0, "A `to` at the instant itself excludes it");
		assert.equal((await page(owner, { actor: marker, from: "2026-01-15T17:00:00.123456+07:00", to: "2026-01-15T18:00:00+07:00", limit: "100" })).data.length, 12, "A `from` at the instant itself includes it");
		const exact = await page(owner, { actor: marker, action: "finance.manual_transfer" });
		assert.deepEqual(
			new Set(exact.data.map((e) => e.id)),
			new Set([leaky.manual, ...seeded.filter((s) => s.action === "finance.manual_transfer").map((s) => s.id)]),
		);
		const empty = await page(owner, { actor: `${marker}-nobody` });
		assert.deepEqual(empty.data, []);
		assert.equal(empty.pagination.next_cursor, null);

		// 7. Strict closed query.
		const invalid: Record<string, string>[] = [
			{ bogus: "1" },
			{ limit: "0" },
			{ limit: "101" },
			{ limit: "abc" },
			{ actor: "" },
			{ actor: "has space" },
			{ actor: "a@b.c" },
			{ action: "Not.An.Action" },
			{ from: "2026-01-01" },
			{ from: "2026-02-01T00:00:00Z", to: "2026-01-01T00:00:00Z" },
			{ from: "2026-02-31T00:00:00Z" },
			{ to: "2026-04-31T00:00:00+07:00" },
			{ from: "2026-01-01T00:00:00+18:30" },
			{ from: "0000-01-01T00:00:00Z" },
			{ cursor: "not-a-cursor!" },
			{ cursor: Buffer.from(JSON.stringify({ t: "now", id: "x" })).toString("base64url") },
		];
		for (const query of invalid) {
			const result = await read(owner, query);
			assert.equal(result.status, 400, JSON.stringify(query));
			assert.equal(result.body.code, "INVALID_INPUT");
		}
		const duplicated = await handleAuditLog(owner.browser.request("/api/v1/admin/audit-events?actor=a&actor=b"), identity);
		assert.equal(duplicated.status, 400);
		const post = await handleAuditLog(new Request("http://127.0.0.1:3099/api/v1/admin/audit-events", { method: "POST", headers: { origin: "http://127.0.0.1:3099", cookie: owner.browser.request("/").headers.get("cookie") ?? "" } }), identity);
		assert.equal(post.status, 404);

		// 8. The log stays append-only: the viewer wrote only its own audit.read rows.
		const [unchanged] = await sql`select count(*)::int as n from app.audit_event where actor_id=${marker}`;
		assert.equal(Number(unchanged.n), everySeeded.length);
	} finally {
		await cleanup(identity, users);
	}
});

test("S135 redaction policy: allowlist only, scalars only, fail closed", () => {
	// Nested before/after keep only their allowlisted keys.
	const nested = redactDetails("support.classification.set", {
		version: 2,
		before: { priority: "high", tag_ids: ["t1"], note: SECRETS.replyText },
		after: { priority: "low", tag_ids: ["t1", "t2"] },
		extra: SECRETS.token,
	});
	assert.deepEqual(nested.details, { version: 2, before: { priority: "high", tag_ids: ["t1"] }, after: { priority: "low", tag_ids: ["t1", "t2"] } });
	assert.ok(nested.redacted);
	// An object where a scalar is expected, a list of objects, and an oversize list are withheld, not echoed.
	const shaped = redactDetails("finance.reconcile", { operation_id: { nested: SECRETS.token }, version: 1, action: "match" });
	assert.deepEqual(shaped.details, { version: 1, action: "match" });
	assert.ok(shaped.redacted);
	const lists = redactDetails("staff_roles.replace", { roles: [{ a: 1 }], warehouse_ids: Array.from({ length: 101 }, (_, i) => `w${i}`), permissions: ["a", "b"] });
	assert.deepEqual(lists.details, { permissions: ["a", "b"] });
	// Prefix and exact lookup; an exact entry beats its family; unknown and non-object details expose nothing.
	assert.deepEqual(redactDetails("local.payment.reconcile", { job_id: "j", previous_status: "failed", previous_error: SECRETS.token }).details, { job_id: "j", previous_status: "failed" });
	assert.deepEqual(redactDetails("catalog.product.publish", { publication_id: "p", version: 9 }).details, { publication_id: "p" });
	assert.deepEqual(redactDetails("not.in.policy", { a: 1 }), { details: {}, redacted: true });
	assert.deepEqual(redactDetails("not.in.policy", {}), { details: {}, redacted: false });
	assert.deepEqual(redactDetails("finance.reconcile", "just a string"), { details: {}, redacted: true });
	assert.deepEqual(redactDetails("hasOwnProperty", { x: 1 }), { details: {}, redacted: true }, "Prototype names are not policies");
	// Long strings and control characters.
	assert.equal(redactDetails("finance.reconcile", { source_reference: SECRETS.proofDigest }).details.source_reference, MASK);
	assert.equal(cleanText("a\u0000b\nc", 10), "a b c");
	assert.equal(cleanText("ab ".repeat(200), 300).length, 301);
	assert.equal(cleanText(randomUUID(), 100).length, 36, "UUIDs stay readable");
	// Subjects: opaque ids pass, free text and session ids do not.
	assert.deepEqual(redactSubject("finance.reconcile", "order:123_a-b.c"), { subject: "order:123_a-b.c", redacted: false });
	assert.deepEqual(redactSubject("finance.reconcile", "Budi Santoso"), { subject: null, redacted: true });
	assert.deepEqual(redactSubject("auth.undelivered_session.recover", "abc"), { subject: null, redacted: true });
	assert.deepEqual(redactSubject("finance.reconcile", null), { subject: null, redacted: false });
});
