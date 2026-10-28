import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { describeDevice } from "../../src/components/admin/account-model.ts";
import { createLocalAuth, type LocalAuth } from "../../src/modules/access/auth.ts";
import { readOwnProfile } from "../../src/modules/access/account-security.ts";
import { getPrincipal } from "../../src/modules/access/policy.ts";
import { handleAccounts } from "../../src/modules/accounts/service.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { actor, BrowserSession, cleanup, enroll, terminationProof } from "../contract/access-fixture.ts";

interface Actor {
	id: string;
	email: string;
	password: string;
	browser: BrowserSession;
}
interface MfaSetup {
	totpURI: string;
	backupCodes: string[];
}
interface Staff extends Actor {
	setup: MfaSetup;
	codeIndex: number;
}

// S129: staff account security. Real PostgreSQL, real Better Auth sessions and the real handlers.

async function staff(identity: LocalAuth, role: "owner" | "customer_service" | "finance", warehouseIds: string[] = []) {
	const user = await actor(identity, role, warehouseIds);
	const setup = await enroll(user.browser, user.password);
	return { ...user, setup, codeIndex: 0 };
}
type Account = { id: string; email: string };

/** Another signed-in, MFA-verified session of the same staff account (second device), via a backup code. */
async function secondSession(identity: LocalAuth, user: Staff) {
	const browser = new BrowserSession(identity);
	const login = await browser.auth("/sign-in/email", { email: user.email, password: user.password });
	assert.equal(login.status, 200);
	assert.equal((await login.json()).twoFactorRedirect, true);
	user.codeIndex += 1;
	assert.equal((await browser.auth("/two-factor/verify-backup-code", { code: user.setup.backupCodes[user.codeIndex] })).status, 200);
	assert.equal((await browser.access("/me")).status, 200);
	return browser;
}

function accounts(browser: BrowserSession, identity: LocalAuth, body: Record<string, unknown>, key: string = randomUUID()) {
	const request = browser.request("/api/v1/me/session-terminations", body);
	request.headers.set("idempotency-key", key);
	return handleAccounts(request, identity);
}

async function issue(identity: LocalAuth, who: Pick<Actor, "browser" | "password">, action: string, subject: string, password = who.password) {
	const request = who.browser.request("/api/v1/me/reauthentication-proofs", { password, action, subject_id: subject });
	request.headers.set("idempotency-key", randomUUID());
	const response = await handleAccess(request, identity);
	const payload = await response.json();
	return { status: response.status, code: payload.code as string | undefined, proof: payload.proof as string | undefined };
}

async function audit(identity: LocalAuth, userId: string) {
	return identity.sql<{ action: string; outcome: string; reason: string; subject_id: string; details: Record<string, unknown> }[]>`
		select action, outcome, reason, subject_id, details from app.audit_event
		where actor_id=${userId} and action like 'auth.%' order by created_at, id`;
}

async function sessionSecrets(identity: LocalAuth, ...userIds: string[]) {
	const rows = await identity.sql<{ id: string; token: string }[]>`select id, token from app.auth_session where user_id in ${identity.sql(userIds)}`;
	return rows.flatMap((row) => [row.id, row.token]);
}

test("account security read: own sessions only, current marked, no token, seed or code in the response", async () => {
	const identity = createLocalAuth("test");
	const users: Account[] = [];
	try {
		const owner = await staff(identity, "owner");
		const support = await staff(identity, "customer_service");
		users.push(owner, support);
		const device = await secondSession(identity, owner);

		const mine = await owner.browser.auth("/account-security");
		assert.equal(mine.status, 200);
		assert.equal(mine.headers.get("cache-control"), "no-store");
		const text = await mine.text();
		const view = JSON.parse(text);
		assert.equal(view.sessions.length, 2);
		assert.deepEqual(view.sessions.map((s: { current: boolean }) => s.current), [true, false], "current first, the other device second");
		assert.deepEqual(Object.keys(view.sessions[0]).sort(), ["current", "expires_at", "ip_hint", "signed_in_at", "user_agent"]);
		assert.equal(view.two_factor.enabled, true);
		assert.equal(view.two_factor.mandatory, true);
		assert.ok(view.two_factor.verified_at);
		assert.equal(view.two_factor.backup_codes_remaining, 9, "ten codes minus the one the second device used");

		// No session id/token (own or foreign), TOTP seed or backup code anywhere in the body.
		const [seed] = await identity.sql<{ secret: string }[]>`select secret from app.auth_two_factor where user_id=${owner.id}`;
		const secrets = [
			...(await sessionSecrets(identity, owner.id, support.id)),
			seed.secret,
			new URL(owner.setup.totpURI).searchParams.get("secret") as string,
			...owner.setup.backupCodes,
			...support.setup.backupCodes,
		];
		for (const secret of secrets) assert.ok(!text.includes(secret), "response must not carry secret material");
		assert.doesNotMatch(text, /token|secret|backup_?codes"?\s*:\s*\[/i);

		// Another staff account sees only its own single session, never the owner's.
		const theirs = await support.browser.auth("/account-security");
		assert.equal(theirs.status, 200);
		const theirView = await theirs.json();
		assert.equal(theirView.sessions.length, 1);
		assert.equal(theirView.sessions[0].current, true);
		assert.equal(theirView.two_factor.backup_codes_remaining, 10);

		// The same device can read the list too; reads are scoped by the cookie, not by anything the caller sends.
		const viaDevice = await (await device.auth("/account-security")).json();
		assert.deepEqual(viaDevice.sessions.map((s: { current: boolean }) => s.current), [true, false]);

		// Query strings are refused; unauthenticated callers and staff without a verified second factor get nothing.
		assert.equal((await owner.browser.auth("/account-security?user_id=other")).status, 400);
		assert.equal((await new BrowserSession(identity).auth("/account-security")).status, 401);
		const unenrolled = await actor(identity, "customer_service", []);
		users.push(unenrolled);
		const noMfa = await unenrolled.browser.auth("/account-security");
		assert.equal(noMfa.status, 403);
		assert.equal((await noMfa.json()).code, "MFA_REQUIRED");
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("terminateOwnSessions follows the OpenAPI contract: all_other needs a bound single-use proof and keeps the current session", async () => {
	const identity = createLocalAuth("test");
	const users: Account[] = [];
	try {
		const owner = await staff(identity, "owner");
		const other = await staff(identity, "finance");
		users.push(owner, other);
		const device = await secondSession(identity, owner);
		const otherDevice = await secondSession(identity, other);

		// The old code-side vocabulary is gone; the contract values are the only ones.
		const spec = readFileSync("docs/spec/openapi.yaml", "utf8");
		const block = spec.slice(spec.indexOf("    SessionTerminationInput:"), spec.indexOf("    PrivateNotification:"));
		const scopeBlock = block.slice(block.indexOf("scope:"), block.indexOf("reauthentication_proof:"));
		assert.deepEqual([...scopeBlock.matchAll(/^ {10}- (\S+)$/gm)].map((m) => m[1]), ["current", "all_other"]);
		assert.match(spec, /- session\.terminate_others\n/);
		for (const legacy of ["others", "all"]) assert.equal((await accounts(owner.browser, identity, { scope: legacy })).status, 400);
		assert.equal((await accounts(owner.browser, identity, { scope: "all_other", reauthentication_proof: "x".repeat(20), unknown: true })).status, 400);

		// Missing proof: 403, nothing revoked, staff refusal audited.
		const missing = await accounts(owner.browser, identity, { scope: "all_other" });
		assert.equal(missing.status, 403);
		assert.equal((await missing.json()).code, "REAUTHENTICATION_REQUIRED");
		assert.equal((await device.access("/me")).status, 200, "other session survives a refused request");

		// Proof issuance is bound to the caller's own id, current password and this purpose.
		assert.deepEqual(await issue(identity, owner, "session.terminate_others", other.id), { status: 403, code: "FORBIDDEN", proof: undefined });
		assert.equal((await issue(identity, owner, "session.terminate_others", owner.id, "wrong-synthetic-password")).code, "REAUTHENTICATION_REQUIRED");

		// A proof for another purpose, a stale proof and a proof minted by another session are all refused.
		const wrongPurpose = (await issue(identity, owner, "support.contact_rebind", owner.id)).proof as string;
		assert.equal((await accounts(owner.browser, identity, { scope: "all_other", reauthentication_proof: wrongPurpose })).status, 403);
		const stale = (await issue(identity, owner, "session.terminate_others", owner.id)).proof as string;
		await identity.sql`update app.access_proof set expires_at=clock_timestamp()-interval '1 second' where action='session.terminate_others' and session_id in (select id from app.auth_session where user_id=${owner.id})`;
		const staleResponse = await accounts(owner.browser, identity, { scope: "all_other", reauthentication_proof: stale });
		assert.equal(staleResponse.status, 403);
		assert.equal((await staleResponse.json()).code, "REAUTHENTICATION_REQUIRED");
		const fromDevice = (await issue(identity, { browser: device, password: owner.password }, "session.terminate_others", owner.id)).proof as string;
		assert.equal((await accounts(owner.browser, identity, { scope: "all_other", reauthentication_proof: fromDevice })).status, 403, "proof is bound to the session that earned it");
		assert.equal((await device.access("/me")).status, 200);
		const foreign = (await issue(identity, other, "session.terminate_others", other.id)).proof as string;
		assert.equal((await accounts(owner.browser, identity, { scope: "all_other", reauthentication_proof: foreign })).status, 403, "another account's proof is useless");
		assert.equal((await otherDevice.access("/me")).status, 200, "and ends nothing of theirs");

		// A good proof ends the other device and keeps this session, with its second-factor state.
		const proof = await terminationProof(identity, owner);
		const key = randomUUID();
		const done = await accounts(owner.browser, identity, { scope: "all_other", reauthentication_proof: proof }, key);
		assert.equal(done.status, 201);
		assert.equal(done.headers.get("cache-control"), "no-store");
		const ack = await done.json();
		assert.deepEqual(Object.keys(ack).sort(), ["as_of", "id", "status", "version"]);
		assert.equal(ack.status, "confirmed");
		assert.equal(ack.id, owner.id);
		assert.equal((await owner.browser.access("/me")).status, 200, "current session kept");
		assert.equal((await device.access("/me")).status, 401, "other session ended");
		assert.equal((await otherDevice.access("/me")).status, 200, "another account's session untouched");
		const left = await (await owner.browser.auth("/account-security")).json();
		assert.equal(left.sessions.length, 1);
		assert.equal(left.sessions[0].current, true);
		assert.ok(left.two_factor.verified_at);

		// Same key replays the first answer; a new key cannot reuse the consumed proof.
		const replay = await accounts(owner.browser, identity, { scope: "all_other", reauthentication_proof: proof }, key);
		assert.deepEqual(await replay.json(), ack);
		assert.equal((await accounts(owner.browser, identity, { scope: "all_other", reauthentication_proof: proof })).status, 403);
		assert.equal((await accounts(owner.browser, identity, { scope: "all_other", reauthentication_proof: "q".repeat(24) }, key)).status, 201, "same key and intent: still the stored answer, whatever proof is sent");

		// Audit: one allowed row (not two for the replay), refusals recorded for staff, no proof or token in details.
		const rows = await audit(identity, owner.id);
		const allowed = rows.filter((row) => row.action === "auth.sessions.terminate" && row.outcome === "allowed");
		assert.equal(allowed.length, 1);
		assert.deepEqual(allowed[0].details, { scope: "all_other", revoked_sessions: 1 });
		assert.equal(allowed[0].subject_id, owner.id);
		const denied = rows.filter((row) => row.action === "auth.sessions.terminate" && row.outcome === "denied");
		assert.ok(denied.length >= 4);
		assert.ok(denied.every((row) => row.reason === "REAUTHENTICATION_REQUIRED"));
		assert.ok(!JSON.stringify(rows).includes(proof));

		// `current` ends exactly this session.
		const current = await accounts(owner.browser, identity, { scope: "current" });
		assert.equal(current.status, 201);
		assert.equal((await owner.browser.access("/me")).status, 401);
		assert.equal((await otherDevice.access("/me")).status, 200);
		assert.ok((await audit(identity, owner.id)).some((row) => row.details.scope === "current" && row.outcome === "allowed"));
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("session termination is budgeted per account", async () => {
	const identity = createLocalAuth("test");
	const users: Account[] = [];
	try {
		const user = await staff(identity, "customer_service");
		users.push(user);
		const statuses: number[] = [];
		for (let attempt = 0; attempt < 12; attempt++) {
			statuses.push((await accounts(user.browser, identity, { scope: "all_other", reauthentication_proof: "p".repeat(24) })).status);
		}
		assert.deepEqual(statuses, [...Array(10).fill(403), 429, 429]);
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("change password: current password required and budgeted, other sessions end, second factor carries over, audit written", async () => {
	const identity = createLocalAuth("test");
	const users: Account[] = [];
	try {
		const user = await staff(identity, "owner");
		const budget = await staff(identity, "finance");
		users.push(user, budget);
		const device = await secondSession(identity, user);
		const newPassword = randomBytes(18).toString("base64url");
		const change = (browser: BrowserSession, body: Record<string, unknown>) => browser.auth("/change-password", body);

		// Shape: no client choice about revoking other sessions; same password refused; unauthenticated and unverified refused.
		assert.equal((await change(user.browser, { currentPassword: user.password, newPassword, revokeOtherSessions: false })).status, 400);
		assert.equal((await change(user.browser, { currentPassword: user.password, newPassword: user.password })).status, 400);
		assert.equal((await change(new BrowserSession(identity), { currentPassword: user.password, newPassword })).status, 401);
		const unverified = await actor(identity, "finance", []);
		users.push(unverified);
		const noMfa = await change(unverified.browser, { currentPassword: unverified.password, newPassword });
		assert.equal(noMfa.status, 403);
		assert.equal((await noMfa.json()).code, "MFA_REQUIRED");

		// Wrong current password and a too-short new one are refused, audited as denied, and change nothing.
		const wrong = await change(user.browser, { currentPassword: "wrong-synthetic-password", newPassword });
		assert.equal(wrong.status, 400);
		assert.equal((await wrong.json()).code, "INVALID_PASSWORD");
		assert.equal((await change(user.browser, { currentPassword: user.password, newPassword: "short" })).status, 400);
		assert.equal((await device.access("/me")).status, 200, "nothing revoked by refusals");

		const ok = await change(user.browser, { currentPassword: user.password, newPassword });
		assert.equal(ok.status, 200);
		const payload = await ok.json();
		assert.ok(!("token" in payload) && !JSON.stringify(payload).includes(newPassword));
		assert.equal((await device.access("/me")).status, 401, "other session ended");
		assert.equal((await user.browser.access("/me")).status, 200, "this device keeps working, still second-factor verified");
		const principal = await getPrincipal(user.browser.request("/api/v1/me"), identity);
		assert.ok(principal.mfaAt, "MFA verification moved to the replacement session");
		const [{ n }] = await identity.sql<{ n: number }[]>`select count(*)::int n from app.auth_session where user_id=${user.id}`;
		assert.equal(n, 1);

		// The old password is dead; the new one signs in (and still needs the second factor).
		const old = await new BrowserSession(identity).auth("/sign-in/email", { email: user.email, password: user.password });
		assert.equal(old.status, 401);
		const fresh = new BrowserSession(identity);
		const login = await fresh.auth("/sign-in/email", { email: user.email, password: newPassword });
		assert.equal(login.status, 200);
		assert.equal((await login.json()).twoFactorRedirect, true);

		const rows = await audit(identity, user.id);
		assert.deepEqual(
			rows.filter((row) => row.action === "auth.password.change").map((row) => [row.outcome, row.reason]),
			[["denied", "INVALID_PASSWORD"], ["denied", "PASSWORD_TOO_SHORT"], ["allowed", "own_password_changed"]],
		);
		const text = JSON.stringify(rows);
		for (const secret of [user.password, newPassword, "wrong-synthetic-password"]) assert.ok(!text.includes(secret));

		// Guessing the current password is capped per account: five attempts, then 429 even for the right password.
		const attempts: number[] = [];
		for (let attempt = 0; attempt < 5; attempt++) attempts.push((await change(budget.browser, { currentPassword: `guess-${attempt}-synthetic`, newPassword })).status);
		assert.deepEqual(attempts, [400, 400, 400, 400, 400]);
		const limited = await change(budget.browser, { currentPassword: budget.password, newPassword });
		assert.equal(limited.status, 429);
		assert.ok(Number(limited.headers.get("retry-after") ?? limited.headers.get("x-retry-after")) > 0);
		const stillOld = await new BrowserSession(identity).auth("/sign-in/email", { email: budget.email, password: budget.password });
		assert.equal(stillOld.status, 200, "the refused request changed nothing");
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("backup codes: regeneration needs the password, replaces the old set, is audited, and staff cannot disable MFA", async () => {
	const identity = createLocalAuth("test");
	const users: Account[] = [];
	try {
		const user = await staff(identity, "customer_service");
		users.push(user);
		const generate = (browser: BrowserSession, body: Record<string, unknown>) => browser.auth("/two-factor/generate-backup-codes", body);
		assert.equal((await generate(user.browser, {})).status, 400);
		assert.equal((await generate(user.browser, { password: user.password, userId: "someone-else" })).status, 400);
		assert.equal((await generate(new BrowserSession(identity), { password: user.password })).status, 401);
		const wrong = await generate(user.browser, { password: "wrong-synthetic-password" });
		assert.equal(wrong.status, 400);
		assert.equal((await wrong.json()).code, "INVALID_PASSWORD");

		const made = await generate(user.browser, { password: user.password });
		assert.equal(made.status, 200);
		assert.equal(made.headers.get("cache-control"), "no-store");
		const fresh = (await made.json()).backupCodes as string[];
		assert.equal(fresh.length, 10);
		assert.ok(fresh.every((code) => !user.setup.backupCodes.includes(code)));

		// The old set is dead for a new device; a new code works once.
		const next = new BrowserSession(identity);
		assert.equal((await next.auth("/sign-in/email", { email: user.email, password: user.password })).status, 200);
		assert.equal((await next.auth("/two-factor/verify-backup-code", { code: user.setup.backupCodes[0] })).status, 401);
		assert.equal((await next.auth("/two-factor/verify-backup-code", { code: fresh[0] })).status, 200);
		const status = await (await user.browser.auth("/account-security")).json();
		assert.equal(status.two_factor.backup_codes_remaining, 9);
		for (const code of fresh) assert.ok(!JSON.stringify(status).includes(code), "codes are shown once, at creation");

		const rows = await audit(identity, user.id);
		assert.deepEqual(
			rows.filter((row) => row.action === "auth.backup_codes.regenerate").map((row) => [row.outcome, row.reason]),
			[["denied", "INVALID_PASSWORD"], ["allowed", "own_backup_codes_regenerated"]],
		);
		for (const code of [...fresh, ...user.setup.backupCodes]) assert.ok(!JSON.stringify(rows).includes(code));

		// Routes that would switch MFA off or leak/end sessions outside the contract stay closed.
		for (const [path, method] of [["/two-factor/disable", "POST"], ["/revoke-other-sessions", "POST"], ["/revoke-session", "POST"], ["/revoke-sessions", "POST"], ["/list-sessions", "GET"]] as const) {
			const response = await user.browser.auth(path, method === "POST" ? { password: user.password, token: "x" } : undefined);
			assert.equal(response.status, 404, path);
		}
		const [flag] = await identity.sql<{ two_factor_enabled: boolean }[]>`select two_factor_enabled from app.auth_user where id=${user.id}`;
		assert.equal(flag.two_factor_enabled, true);

		// A buyer without two-step verification has no codes to regenerate.
		const buyer = await actor(identity, "buyer", []);
		users.push(buyer);
		const none = await generate(buyer.browser, { password: buyer.password });
		assert.equal(none.status, 400);
		assert.equal((await none.json()).code, "TWO_FACTOR_NOT_ENABLED");
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("backup codes: a session opened before two-step enrollment cannot regenerate them", async () => {
	const identity = createLocalAuth("test");
	const users: Account[] = [];
	try {
		const buyer = await actor(identity, "buyer", []);
		users.push(buyer);
		// A second session of the same account, opened (password only) before the account enrolls.
		const early = new BrowserSession(identity);
		assert.equal((await early.auth("/sign-in/email", { email: buyer.email, password: buyer.password })).status, 200);
		const setup = await enroll(buyer.browser, buyer.password);
		const generate = (browser: BrowserSession) => browser.auth("/two-factor/generate-backup-codes", { password: buyer.password });
		const refused = await generate(early);
		assert.equal(refused.status, 403);
		assert.equal((await refused.json()).code, "MFA_REQUIRED");
		// The original codes still work: the refused session did not replace them.
		const probe = new BrowserSession(identity);
		assert.equal((await probe.auth("/sign-in/email", { email: buyer.email, password: buyer.password })).status, 200);
		assert.equal((await probe.auth("/two-factor/verify-backup-code", { code: setup.backupCodes[0] })).status, 200);
		// The enrolling, verified session may regenerate.
		assert.equal((await generate(buyer.browser)).status, 200);
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("profile is the caller's own, read-only data and the device label never echoes the raw header", async () => {
	const identity = createLocalAuth("test");
	const users: Account[] = [];
	const warehouse = randomUUID();
	try {
		await identity.sql`insert into app.warehouse (id,name,city) values (${warehouse},'Gudang Sintetis S129','Malang')`;
		const user = await staff(identity, "customer_service", [warehouse]);
		const other = await staff(identity, "finance");
		users.push(user, other);
		await identity.sql`update app.role_grant set permissions=ARRAY['orders.history.read','exports.read']::text[] where user_id=${user.id}`;
		const principal = await getPrincipal(user.browser.request("/api/v1/me"), identity);
		const profile = await readOwnProfile(identity, principal);
		assert.deepEqual(Object.keys(profile).sort(), ["email", "name", "permissions", "roles", "warehouses"]);
		assert.equal(profile.email, user.email);
		assert.deepEqual(profile.roles, ["customer_service"]);
		assert.deepEqual(profile.permissions, ["orders.history.read", "exports.read"]);
		assert.deepEqual(profile.warehouses, [{ name: "Gudang Sintetis S129", city: "Malang" }]);
		const theirs = await readOwnProfile(identity, await getPrincipal(other.browser.request("/api/v1/me"), identity));
		assert.equal(theirs.email, other.email);
		assert.deepEqual(theirs.warehouses, []);

		assert.equal(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"), "Chrome di Windows");
		assert.equal(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "Safari di iOS");
		assert.equal(describeDevice(null), "Perangkat tidak dikenal");
		assert.equal(describeDevice("<script>alert(1)</script>"), "Perangkat tidak dikenal");
	} finally {
		await cleanup(identity, users);
		await identity.sql`delete from app.warehouse_membership where warehouse_id=${warehouse}`;
		await identity.sql`delete from app.warehouse where id=${warehouse}`;
		await identity.sql.end();
	}
});
