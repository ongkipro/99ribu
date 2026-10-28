import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { handleStaff, type StaffMember } from "../../src/modules/access/staff.ts";
import { actor, type BrowserSession, cleanup, enroll } from "../contract/access-fixture.ts";

// S137 staff directory, role replacement and owner-only MFA reset against the isolated TEST database: owner-only
// reads and writes (non-owner 403, anonymous 401, no audit growth), no secret material in any response, keyset
// paging, versioned replacement with single-use proofs, session revocation, audit rows with the actor, and the
// last-owner invariant under concurrency.

const identity = createLocalAuth("test");
const sql = identity.sql;
after(async () => {
	await sql.end();
});
type Who = { id: string; email: string; password: string; browser: BrowserSession };
type Role = Parameters<typeof actor>[1];
const origin = "http://127.0.0.1:3099";

const staffCall = (who: Who | null, method: "GET" | "POST", path: string, body?: Record<string, unknown>, key?: string) => {
	const request = who
		? who.browser.request(path, body)
		: new Request(`${origin}${path}`, {
				method,
				headers: { origin, "content-type": "application/json" },
				body: body ? JSON.stringify(body) : undefined,
			});
	if (method === "POST") request.headers.set("idempotency-key", key ?? randomUUID());
	return handleStaff(request, identity);
};
const getStaff = async (who: Who | null, query = "") => {
	const response = await staffCall(who, "GET", `/api/v1/admin/staff${query}`);
	return { status: response.status, text: await response.text(), cache: response.headers.get("cache-control") };
};
const lookup = async (who: Who | null, email: string) => {
	const response = await staffCall(who, "GET", `/api/v1/admin/staff/lookup?email=${encodeURIComponent(email)}`);
	return { status: response.status, text: await response.text() };
};
const member = async (who: Who, email: string) => {
	const found = await lookup(who, email);
	assert.equal(found.status, 200, found.text);
	return JSON.parse(found.text) as StaffMember;
};
const accessCall = (who: Who, path: string, body: Record<string, unknown>, key: string = randomUUID()) => {
	const request = who.browser.request(`/api/v1${path}`, body);
	request.headers.set("idempotency-key", key);
	return handleAccess(request, identity);
};
// Proof issuance is capped at five per minute and principal; a test issues many, so each call starts a fresh budget.
async function proofFor(who: Who, action: string, subject: string) {
	await sql`delete from app.auth_rate_limit where key=${`access-proof:${who.id}`}`;
	const response = await accessCall(who, "/me/reauthentication-proofs", { password: who.password, action, subject_id: subject });
	assert.equal(response.status, 201, await response.clone().text());
	return (await response.json()).proof as string;
}
const replace = async (who: Who, target: string, roles: string[], version: number, extra: Record<string, unknown> = {}, proof?: string) => {
	const given = proof ?? (extra.reauthentication_proof as string | undefined) ?? (await proofFor(who, "staff_roles.replace", target));
	return accessCall(who, "/admin/role-grants", {
		user_id: target,
		roles,
		permissions: [],
		warehouse_ids: [],
		expected_version: version,
		reason: "Uji peran staf S137",
		...extra,
		reauthentication_proof: given,
	});
};
const reset = async (who: Who, target: string, proof?: string, key?: string, reason = "Perangkat autentikator hilang") =>
	staffCall(
		who,
		"POST",
		"/api/v1/admin/staff-mfa-resets",
		{ user_id: target, reason, reauthentication_proof: proof ?? (await proofFor(who, "staff_mfa.reset", target)) },
		key,
	);
const grantOf = async (id: string) => (await sql`select roles,permissions,revision from app.role_grant where user_id=${id}`)[0];
const owners = async (ids: string[]) =>
	(await sql`select user_id from app.role_grant where user_id in ${sql(ids)} and 'owner'=any(roles)`).map((row) => String(row.user_id));
const auditCount = async (actorId: string) =>
	Number((await sql`select count(*)::int as n from app.audit_event where actor_id=${actorId}`)[0].n);

async function staff(users: Who[], role: Role, enrolled = true, warehouses: string[] = []) {
	const who = await actor(identity, role, warehouses);
	users.push(who);
	if (enrolled) await enroll(who.browser, who.password);
	return who;
}
/** Test-DB owners left by earlier failed runs would count as "another owner"; park them for the duration of a test. */
async function parkForeignOwners(own: string[]) {
	const foreign = (
		await sql`select g.user_id from app.role_grant g join app.auth_user u on u.id=g.user_id
			where 'owner'=any(g.roles) and u.two_factor_enabled and g.user_id not in ${sql(own)}`
	).map((row) => String(row.user_id));
	if (foreign.length) await sql`update app.auth_user set two_factor_enabled=false where id in ${sql(foreign)}`;
	return async () => {
		if (foreign.length) await sql`update app.auth_user set two_factor_enabled=true where id in ${sql(foreign)}`;
	};
}

test("S137 staff list and lookup: owner only, no secret material, keyset paging, audited lookup", async () => {
	const users: Who[] = [];
	const warehouseId = randomUUID();
	// Prefix "0000-" sorts before leftover "Synthetic Access" rows in the shared test DB so the first page holds all test rows.
	const marker = `0000-s137-${randomUUID().slice(0, 8)}`;
	try {
		await sql`insert into app.warehouse (id,name,city) values (${warehouseId},'Gudang S137','Malang')`;
		const owner = await staff(users, "owner");
		const members = [
			await staff(users, "ecommerce_admin"),
			await staff(users, "warehouse", true, [warehouseId]),
			await staff(users, "customer_service", false),
			await staff(users, "finance"),
		];
		const buyer = await actor(identity, "buyer", []);
		users.push(buyer);
		await sql`update app.auth_user set name=${`${marker}-0-buyer`} where id=${buyer.id}`;
		// Stable, distinct display names so the paging order can be asserted.
		const named = [owner, ...members];
		const names = named.map((_, index) => `${marker}-${"abcde"[index]}`);
		for (const [index, who] of named.entries()) await sql`update app.auth_user set name=${names[index]} where id=${who.id}`;
		await sql`update app.role_grant set permissions=${["exports.read", "shipping.labels.read"]} where user_id=${members[1].id}`;

		// Secret canaries on a listed member: TOTP seed, backup codes, a session token and the password hashes.
		const seed = `SEED-CANARY-${randomUUID()}`;
		const backup = `BACKUP-CANARY-${randomUUID()}`;
		await sql`delete from app.auth_two_factor where user_id=${members[2].id}`;
		await sql`insert into app.auth_two_factor (id,secret,backup_codes,user_id,verified) values (${randomUUID()},${seed},${backup},${members[2].id},true)`;
		await sql`update app.auth_user set two_factor_enabled=true where id=${members[2].id}`;
		const [{ token }] = await sql`select token from app.auth_session where user_id=${members[2].id} limit 1`;
		const hashes = (await sql`select password from app.auth_account where user_id in ${sql(named.map((who) => who.id))} and password is not null`).map((row) => String(row.password));
		assert.ok(hashes.length > 0);

		// Authorization: anonymous 401; every non-owner role 403 on list, lookup and the write routes, without growing the log.
		assert.equal((await getStaff(null)).status, 401);
		assert.equal((await lookup(null, owner.email)).status, 401);
		assert.equal((await staffCall(null, "POST", "/api/v1/admin/staff-mfa-resets", { user_id: owner.id })).status, 401);
		const before = await Promise.all([members[0], members[1], members[3]].map((who) => auditCount(who.id)));
		for (const who of [members[0], members[1], members[3]]) {
			assert.equal((await getStaff(who)).status, 403);
			assert.equal((await lookup(who, owner.email)).status, 403);
			assert.equal((await reset(who, owner.id, "x".repeat(20))).status, 403);
			assert.equal((await replace(who, members[0].id, [], 1, { reauthentication_proof: "x".repeat(20) })).status, 403);
		}
		assert.deepEqual(await Promise.all([members[0], members[1], members[3]].map((who) => auditCount(who.id))), before, "Refusals must not grow the audit log");
		assert.equal((await getStaff(members[2])).status, 403, "Staff without two-step verification is refused");
		assert.equal((await getStaff(buyer)).status, 403);

		// Owner read: shape and privacy.
		const first = await getStaff(owner, "?limit=100");
		assert.equal(first.status, 200, first.text);
		assert.equal(first.cache, "no-store");
		const firstParsed = JSON.parse(first.text) as { data: StaffMember[]; pagination: { next_cursor: string | null } };
		for (const secret of [seed, backup, token, ...hashes]) {
			assert.ok(!first.text.includes(secret), "No secret material in the list");
		}
		const mine = firstParsed.data.filter((row) => row.name.startsWith(marker));
		assert.deepEqual(mine.map((row) => row.name), names, "Ordered by name");
		for (const row of mine)
			assert.deepEqual(Object.keys(row).sort(), ["email", "last_sign_in_at", "mfa_enabled", "name", "permissions", "roles", "user_id", "version", "warehouses"]);
		const byId = new Map(firstParsed.data.map((row) => [row.user_id, row]));
		assert.deepEqual(byId.get(owner.id)?.roles, ["owner"]);
		assert.deepEqual(byId.get(members[1].id)?.roles, ["warehouse"]);
		assert.deepEqual(byId.get(members[1].id)?.permissions, ["exports.read", "shipping.labels.read"]);
		assert.deepEqual(byId.get(members[1].id)?.warehouses, [{ id: warehouseId, name: "Gudang S137", city: "Malang", active: true }]);
		assert.equal(byId.get(members[2].id)?.mfa_enabled, true);
		assert.equal(byId.get(members[2].id)?.version, 1);
		assert.ok(byId.get(owner.id)?.last_sign_in_at, "Newest stored session start");
		assert.equal(byId.has(buyer.id), false, "Buyers are not staff");

		// Keyset paging with limit=2 across three pages covers all five test rows in order, with no duplicates.
		const walked: string[] = [];
		let cursor: string | null = null;
		for (let pageNo = 0; pageNo < 3; pageNo++) {
			const page = await getStaff(owner, `?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
			assert.equal(page.status, 200, page.text);
			const parsed = JSON.parse(page.text) as { data: { user_id: string }[]; pagination: { next_cursor: string | null } };
			assert.ok(parsed.data.length <= 2);
			walked.push(...parsed.data.map((row) => row.user_id));
			cursor = parsed.pagination.next_cursor;
			if (!cursor) break;
			assert.equal(parsed.data.length, 2, "A page with a next cursor is full");
		}
		if (firstParsed.data.length <= 6 && !firstParsed.pagination.next_cursor) assert.equal(cursor, null);
		assert.equal(new Set(walked).size, walked.length, "No row twice across pages");
		assert.deepEqual(walked, firstParsed.data.slice(0, walked.length).map((row) => row.user_id), "Page size does not change the order");
		assert.deepEqual(walked.slice(0, 5), mine.map((row) => row.user_id));
		for (const query of ["?limit=0", "?limit=101", "?limit=1&limit=2", "?x=1", "?cursor=%25%25", `?cursor=${Buffer.from('{"k":1,"id":"a"}').toString("base64url")}`])
			assert.equal((await getStaff(owner, query)).status, 400, query);

		// Lookup: exact email only, normalised, any account (a buyer shows no roles and its grant version).
		const found = await member(owner, buyer.email.toUpperCase());
		assert.equal(found.user_id, buyer.id);
		assert.equal(found.email, buyer.email);
		assert.deepEqual([found.roles, found.permissions, found.warehouses, found.mfa_enabled, found.version], [[], [], [], false, 1]);
		assert.equal((await lookup(owner, buyer.email.slice(0, 12))).status, 400);
		assert.equal((await lookup(owner, `x${buyer.email}`)).status, 404);
		assert.equal((await lookup(owner, "tidak-ada@example.invalid")).status, 404);
		for (const query of ["", "?email=a&email=b", "?email=a%40b.c&x=1", `?email=${"a".repeat(300)}%40b.c`])
			assert.equal((await staffCall(owner, "GET", `/api/v1/admin/staff/lookup${query}`)).status, 400, query);
		const audits = await sql`select subject_id,details from app.audit_event where actor_id=${owner.id} and action='staff.lookup' order by created_at`;
		assert.deepEqual(audits.map((row) => row.details), [{ found: true }, { found: false }, { found: false }]);
		assert.ok(!JSON.stringify(audits).includes(buyer.email) && !JSON.stringify(audits).includes("tidak-ada"), "The typed address is never stored");
		assert.equal(audits[0].subject_id, buyer.id);
	} finally {
		await cleanup(identity, users);
		await sql`delete from app.warehouse where id=${warehouseId}`;
	}
});

test("S137 replace: version, single-use proof, session revocation, audit with the actor", async () => {
	const users: Who[] = [];
	const warehouseId = randomUUID();
	const extraId = randomUUID();
	try {
		await sql`insert into app.warehouse (id,name,city) values (${warehouseId},'Gudang Ganti','Malang'),(${extraId},'Gudang Dua','Surabaya')`;
		const owner = await staff(users, "owner");
		const target = await actor(identity, "buyer", []);
		users.push(target);
		const outsider = await staff(users, "ecommerce_admin");
		const found = await member(owner, target.email);
		assert.equal(found.version, 1);

		// A proof for another purpose or another target does not authorise the replacement.
		const wrongPurpose = await proofFor(owner, "staff_mfa.reset", target.id);
		assert.equal((await replace(owner, target.id, ["warehouse"], 1, { warehouse_ids: [warehouseId] }, wrongPurpose)).status, 403);
		const wrongTarget = await proofFor(owner, "staff_roles.replace", outsider.id);
		assert.equal((await replace(owner, target.id, ["warehouse"], 1, { warehouse_ids: [warehouseId] }, wrongTarget)).status, 403);
		assert.deepEqual((await grantOf(target.id)).roles, ["buyer"]);

		// A stale version conflicts and leaves the proof usable; the version from the lookup applies.
		const proof = await proofFor(owner, "staff_roles.replace", target.id);
		const body = { warehouse_ids: [warehouseId, extraId], permissions: ["exports.read"], reauthentication_proof: proof };
		assert.equal((await replace(owner, target.id, ["warehouse"], 0, body)).status, 409);
		assert.equal((await replace(owner, target.id, ["warehouse"], 7, body)).status, 409);
		const key = randomUUID();
		const request = { user_id: target.id, roles: ["warehouse"], permissions: ["exports.read"], warehouse_ids: [warehouseId, extraId], expected_version: found.version, reason: "Uji peran staf S137", reauthentication_proof: proof };
		const applied = await accessCall(owner, "/admin/role-grants", request, key);
		assert.equal(applied.status, 201, await applied.clone().text());
		const saved = await applied.json();
		assert.deepEqual(saved.roles, ["buyer", "warehouse"]);
		assert.equal(saved.version, 2);

		// A reused proof, a stale version and an expired proof are refused.
		assert.equal((await replace(owner, target.id, ["warehouse"], 2, body)).status, 403, "A consumed proof is refused");
		assert.equal((await replace(owner, target.id, [], 1, {})).status, 409, "Stale expected_version");
		assert.equal(
			(await sql`select count(*)::int as n from app.access_proof where session_id in (select id from app.auth_session where user_id=${owner.id}) and consumed_at is not null`)[0].n,
			1,
		);
		const stale = await proofFor(owner, "staff_roles.replace", target.id);
		await sql`update app.access_proof set expires_at=now()-interval '1 second' where subject_id=${target.id} and consumed_at is null`;
		assert.equal((await replace(owner, target.id, [], 2, {}, stale)).status, 403, "An expired proof is refused");

		// Result: grant, scope, revoked sessions, one audit row naming the actor and the previous roles.
		assert.equal((await target.browser.access("/me")).status, 401, "Target sessions are revoked");
		const after = await member(owner, target.email);
		assert.deepEqual([after.roles, after.permissions, after.version], [["warehouse"], ["exports.read"], 2]);
		assert.deepEqual(after.warehouses.map((w) => w.name).sort(), ["Gudang Dua", "Gudang Ganti"]);
		const events = await sql`select actor_id,details from app.audit_event where subject_id=${target.id} and action='staff_roles.replace' and outcome='allowed'`;
		assert.equal(events.length, 1);
		assert.equal(events[0].actor_id, owner.id);
		assert.deepEqual(events[0].details.previous_roles, ["buyer"]);
		assert.ok(!JSON.stringify(events).includes(proof) && !JSON.stringify(events).includes(owner.password));
		// The committed request replays its saved response without a second audit row.
		const retry = await accessCall(owner, "/admin/role-grants", request, key);
		assert.equal(retry.status, 201);
		assert.deepEqual(await retry.json(), saved);
		assert.equal((await sql`select count(*)::int as n from app.audit_event where subject_id=${target.id} and action='staff_roles.replace' and outcome='allowed'`)[0].n, 1);

		// Anonymous and non-owner writes.
		const anonymous = new Request(`${origin}/api/v1/admin/role-grants`, {
			method: "POST",
			headers: { origin, "content-type": "application/json", "idempotency-key": randomUUID() },
			body: JSON.stringify(request),
		});
		assert.equal((await handleAccess(anonymous, identity)).status, 401);
		assert.equal((await replace(outsider, target.id, [], 2, { reauthentication_proof: "x".repeat(20) })).status, 403);
		assert.equal(await auditCount(outsider.id), 0);
	} finally {
		await cleanup(identity, users);
		await sql`delete from app.warehouse where id in (${warehouseId},${extraId})`;
	}
});

test("S137 last owner: removal of another owner works; the last owner cannot step down, also under concurrency", async () => {
	const users: Who[] = [];
	let restore = async (): Promise<void> => {};
	try {
		const a = await staff(users, "owner");
		const b = await staff(users, "owner");
		const c = await staff(users, "owner");
		const ids = [a.id, b.id, c.id];
		restore = await parkForeignOwners(ids);

		// Removal of another owner ends that owner's sessions and the audit row records who they were.
		const removed = await replace(a, c.id, [], 1);
		assert.equal(removed.status, 201, await removed.clone().text());
		assert.deepEqual((await removed.json()).roles, ["buyer"], "A removed owner keeps an ordinary account");
		assert.deepEqual((await owners(ids)).sort(), [a.id, b.id].sort());
		assert.equal((await c.browser.access("/me")).status, 401);
		const [event] = await sql`select actor_id,details from app.audit_event where subject_id=${c.id} and action='staff_roles.replace' and outcome='allowed'`;
		assert.equal(event.actor_id, a.id);
		assert.deepEqual(event.details.previous_roles, ["owner"]);

		// Two owners step down at the same moment: one wins, the other is refused as the last owner.
		const stepProofs = [await proofFor(a, "staff_roles.replace", a.id), await proofFor(b, "staff_roles.replace", b.id)];
		const steps = await Promise.all([replace(a, a.id, [], 1, {}, stepProofs[0]), replace(b, b.id, [], 1, {}, stepProofs[1])]);
		assert.deepEqual(steps.map((r) => r.status).sort(), [201, 409], "One step-down wins");
		const refused = steps.find((r) => r.status === 409);
		assert.ok(refused);
		assert.equal((await refused.json()).code, "LAST_OWNER");
		const left = await owners([a.id, b.id]);
		assert.equal(left.length, 1, "Exactly one owner remains");
		const survivor = left[0] === a.id ? a : b;
		const stepped = survivor === a ? b : a;
		assert.equal((await stepped.browser.access("/me")).status, 401, "The owner that stepped down lost its sessions");

		// The last owner cannot remove itself: refused, nothing changed, the proof stays unused, the session lives.
		const proof = await proofFor(survivor, "staff_roles.replace", survivor.id);
		const refusal = await replace(survivor, survivor.id, [], 1, {}, proof);
		assert.equal(refusal.status, 409);
		assert.equal((await refusal.json()).code, "LAST_OWNER");
		assert.deepEqual([(await grantOf(survivor.id)).roles, (await grantOf(survivor.id)).revision], [["owner"], 1]);
		assert.equal((await survivor.browser.access("/me")).status, 200);
		assert.equal((await sql`select count(*)::int as n from app.access_proof where subject_id=${survivor.id} and consumed_at is not null`)[0].n, 0);
		assert.equal((await sql`select count(*)::int as n from app.audit_event where subject_id=${survivor.id} and action='staff_roles.replace' and outcome='allowed'`)[0].n, 0);
		assert.equal((await sql`select count(*)::int as n from app.audit_event where actor_id=${survivor.id} and action='staff_roles.replace' and outcome='denied' and reason='LAST_OWNER'`)[0].n, 2);
	} finally {
		await restore();
		await cleanup(identity, users);
	}
});

test("S137 last owner: mutual and cyclic removals never leave zero owners", async () => {
	const users: Who[] = [];
	let restore = async (): Promise<void> => {};
	try {
		const a = await staff(users, "owner");
		const b = await staff(users, "owner");
		const c = await staff(users, "owner");
		restore = await parkForeignOwners([a.id, b.id, c.id]);

		// A removes B while B removes A: the first commit wins, the loser is refused (its session is gone).
		const mutualProofs = [await proofFor(a, "staff_roles.replace", b.id), await proofFor(b, "staff_roles.replace", a.id)];
		const mutual = await Promise.all([replace(a, b.id, [], 1, {}, mutualProofs[0]), replace(b, a.id, [], 1, {}, mutualProofs[1])]);
		assert.deepEqual(mutual.map((r) => r.status).sort(), [201, 403]);
		assert.equal((await owners([a.id, b.id])).length, 1);
		assert.deepEqual(await owners([c.id]), [c.id], "The uninvolved owner is untouched");

		// A cycle over three fresh owners: the lock order serialises it, two removals win, one owner remains.
		const d = await staff(users, "owner");
		const e = await staff(users, "owner");
		const f = await staff(users, "owner");
		restore = await parkForeignOwners([a.id, b.id, c.id, d.id, e.id, f.id]);
		const cycleProofs = [await proofFor(d, "staff_roles.replace", e.id), await proofFor(e, "staff_roles.replace", f.id), await proofFor(f, "staff_roles.replace", d.id)];
		const cycle = await Promise.all([replace(d, e.id, [], 1, {}, cycleProofs[0]), replace(e, f.id, [], 1, {}, cycleProofs[1]), replace(f, d.id, [], 1, {}, cycleProofs[2])]);
		assert.deepEqual(cycle.map((r) => r.status).sort(), [201, 201, 403], JSON.stringify(await Promise.all(cycle.map((r) => r.clone().text()))));
		assert.equal((await owners([d.id, e.id, f.id])).length, 1);
	} finally {
		await restore();
		await cleanup(identity, users);
	}
});

test("S137 owner MFA reset: audited, single-use proof, ends sessions, re-enrolment, last-owner interplay", async () => {
	const users: Who[] = [];
	let restore = async (): Promise<void> => {};
	try {
		const owner = await staff(users, "owner");
		const second = await staff(users, "owner");
		const target = await staff(users, "finance");
		const buyer = await actor(identity, "buyer", []);
		users.push(buyer);
		const other = await staff(users, "warehouse");
		restore = await parkForeignOwners([owner.id, second.id]);
		assert.equal((await sql`select count(*)::int as n from app.auth_two_factor where user_id=${target.id}`)[0].n, 1);

		// Refusals: self, a non-staff account, a proof of another purpose, a non-owner, a malformed body, no key.
		assert.equal((await reset(owner, owner.id, "x".repeat(20))).status, 403);
		assert.equal((await reset(owner, buyer.id)).status, 404);
		const wrongPurpose = await proofFor(owner, "staff_roles.replace", target.id);
		assert.equal((await reset(owner, target.id, wrongPurpose)).status, 403);
		assert.equal((await reset(other, target.id, "x".repeat(20))).status, 403);
		assert.equal((await staffCall(owner, "POST", "/api/v1/admin/staff-mfa-resets", { user_id: target.id, reason: " ", reauthentication_proof: "x".repeat(20) })).status, 400);
		assert.equal((await staffCall(owner, "POST", "/api/v1/admin/staff-mfa-resets", { user_id: target.id, reason: "a", reauthentication_proof: "x", extra: 1 })).status, 400);
		const noKey = owner.browser.request("/api/v1/admin/staff-mfa-resets", { user_id: target.id, reason: "a", reauthentication_proof: "x".repeat(20) });
		assert.equal((await handleStaff(noKey, identity)).status, 400);
		assert.equal((await sql`select count(*)::int as n from app.auth_two_factor where user_id=${target.id}`)[0].n, 1, "Refusals change nothing");
		assert.equal((await target.browser.access("/me")).status, 200);
		assert.equal(await auditCount(other.id), 0);

		// Reset: seed and backup codes deleted, flag cleared, sessions gone, no secret in the response, one audit row.
		const proof = await proofFor(owner, "staff_mfa.reset", target.id);
		const key = randomUUID();
		const done = await reset(owner, target.id, proof, key);
		const text = await done.text();
		assert.equal(done.status, 201, text);
		assert.deepEqual(JSON.parse(text), { user_id: target.id, mfa_enabled: false });
		assert.equal((await sql`select count(*)::int as n from app.auth_two_factor where user_id=${target.id}`)[0].n, 0);
		assert.equal((await sql`select two_factor_enabled from app.auth_user where id=${target.id}`)[0].two_factor_enabled, false);
		assert.equal((await sql`select count(*)::int as n from app.auth_session where user_id=${target.id}`)[0].n, 0);
		assert.equal((await target.browser.access("/me")).status, 401);
		assert.equal((await reset(owner, target.id, proof)).status, 403, "A consumed proof is refused");
		const replay = await reset(owner, target.id, proof, key);
		assert.equal(replay.status, 201, "Same key and body replays the saved result");
		assert.deepEqual(await replay.json(), { user_id: target.id, mfa_enabled: false });
		assert.equal((await reset(owner, target.id, proof, key, "Alasan berbeda")).status, 409);
		const events = await sql`select actor_id,reason,details from app.audit_event where action='staff_mfa.reset' and subject_id=${target.id} and outcome='allowed'`;
		assert.equal(events.length, 1);
		assert.equal(events[0].actor_id, owner.id);
		assert.equal(events[0].reason, "Perangkat autentikator hilang");
		assert.deepEqual(events[0].details, { previous_mfa_enabled: true });
		assert.ok(!JSON.stringify(events).includes(proof));

		// The grant is kept; the password signs in, but staff routes answer MFA_REQUIRED until a new enrolment.
		assert.deepEqual((await grantOf(target.id)).roles, ["finance"]);
		assert.equal((await member(owner, target.email)).mfa_enabled, false);
		assert.equal((await target.browser.auth("/sign-in/email", { email: target.email, password: target.password })).status, 200);
		const gated = await target.browser.access("/me");
		assert.equal(gated.status, 403);
		assert.equal((await gated.json()).code, "MFA_REQUIRED");
		await enroll(target.browser, target.password);
		assert.equal((await target.browser.access("/me")).status, 200, "Re-enrolment restores access");
		assert.equal((await member(owner, target.email)).mfa_enabled, true);

		// Another owner can be reset; until it enrols again it does not count, so the last usable owner cannot step down.
		const secondReset = await reset(owner, second.id);
		assert.equal(secondReset.status, 201, await secondReset.clone().text());
		const refusal = await replace(owner, owner.id, [], 1);
		assert.equal(refusal.status, 409);
		assert.equal((await refusal.json()).code, "LAST_OWNER");
		assert.equal((await owners([owner.id, second.id])).length, 2);
	} finally {
		await restore();
		await cleanup(identity, users);
	}
});
