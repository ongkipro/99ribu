import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { RETENTION_JOBS } from "../../src/jobs/retention.ts";
import { DATABASE_JOBS } from "../../src/jobs/worker.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { handleSystemHealth, JOB_STATES, type JobCounts, type SystemHealth } from "../../src/modules/ops-health/service.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";

// S136 system health against the real test database: the counts equal an independent per-row classification of
// seeded outbox rows in every state, only the owner (with MFA) may read, and the response never carries a row
// payload, result, key, error text or lease token.
const origin = "http://127.0.0.1:3099";
const path = "/api/v1/admin/system-health";
const identity = createLocalAuth("test");
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
const samples: Exchange[] = [];
const canary = `CANARY-${randomBytes(8).toString("hex")}`;
// A kind the worker registry names, and one it does not (a leased-adapter or unknown kind).
const REGISTERED = "fulfillment.notice";
const UNREGISTERED = `health.probe.${randomBytes(4).toString("hex")}`;
const hour = 3_600_000;
let owner: User;
const people: Partial<Record<Role | "noMfaOwner", User>> = {};

const cookie = (user: User | null) => (user ? [...user.browser.cookies].map(([name, value]) => `${name}=${value}`).join("; ") : "");
async function call(user: User | null, query = "", method = "GET", headers: Record<string, string> = {}) {
	const request = new Request(`${origin}${path}${query}`, { method, headers: { origin, cookie: cookie(user), ...headers } });
	const response = await handleSystemHealth(request, identity);
	const payload = await response.json();
	samples.push({
		url: request.url,
		method,
		request_headers: {},
		request_valid: query === "" && method === "GET",
		status: response.status,
		headers: Object.fromEntries(response.headers),
		payload,
	});
	return { response, payload };
}
async function staff(role: Role, mfa = true) {
	const user = await actor(identity, role, []);
	users.push(user);
	if (mfa) await enroll(user.browser, user.password);
	return user;
}

type Seed = { status: string; runAt: number; attempts: number; max: number; lease?: number; dispatched?: boolean; completed?: boolean };
// State -> how many rows to insert, with the columns that put each row into exactly that state.
const SEEDS: [keyof JobCounts, number, Seed][] = [
	["due", 3, { status: "pending", runAt: -2 * hour, attempts: 0, max: 5 }],
	["scheduled", 2, { status: "pending", runAt: 2 * hour, attempts: 1, max: 5 }],
	["leased", 1, { status: "processing", runAt: -hour, attempts: 1, max: 5, lease: 2 * hour }],
	["lease_expired", 2, { status: "processing", runAt: -hour, attempts: 1, max: 5, lease: -hour }],
	["unknown", 2, { status: "unknown", runAt: -hour, attempts: 1, max: 5, dispatched: true }],
	["failed", 1, { status: "failed", runAt: -hour, attempts: 2, max: 5, completed: true }],
	["dead", 2, { status: "failed", runAt: -hour, attempts: 5, max: 5, completed: true }],
	["completed", 4, { status: "completed", runAt: -hour, attempts: 1, max: 5, completed: true }],
];
const expected = (): JobCounts => Object.fromEntries(SEEDS.map(([state, count]) => [state, count])) as JobCounts;
const zeroes = (): JobCounts => Object.fromEntries(JOB_STATES.map((state) => [state, 0])) as JobCounts;

async function seed(kind: string) {
	const now = Date.now();
	const at = (offset: number) => new Date(now + offset).toISOString();
	for (const [state, count, row] of SEEDS) {
		for (let index = 0; index < count; index++) {
			await identity.sql`insert into app.outbox_job (kind,dedup_key,payload,status,run_at,attempts,max_attempts,last_error,result,lease_token,lease_until,dispatched_at,completed_at)
				values (${kind},${`${canary}:${kind}:${state}:${index}`},${JSON.stringify({ secret: canary })}::jsonb,${row.status},${at(row.runAt)}::timestamptz,${row.attempts},${row.max},${canary},
					${JSON.stringify({ secret: canary })}::jsonb,${row.lease === undefined ? null : randomUUID()},${row.lease === undefined ? null : at(row.lease)}::timestamptz,
					${row.dispatched ? at(-hour) : null}::timestamptz,${row.completed ? at(-hour) : null}::timestamptz)`;
		}
	}
}
/** Independent of the endpoint's SQL: fetch each row of the kind and classify it in code. */
async function directCounts(kind: string): Promise<JobCounts> {
	const rows = await identity.sql`select status,attempts,max_attempts,run_at,lease_until from app.outbox_job where kind=${kind}`;
	const now = Date.now();
	const counts = zeroes();
	for (const row of rows) {
		if (row.status === "pending") counts[new Date(row.run_at).getTime() <= now ? "due" : "scheduled"]++;
		else if (row.status === "processing") counts[new Date(row.lease_until).getTime() > now ? "leased" : "lease_expired"]++;
		else if (row.status === "unknown") counts.unknown++;
		else if (row.status === "failed") counts[row.attempts >= row.max_attempts ? "dead" : "failed"]++;
		else if (row.status === "completed") counts.completed++;
		else assert.fail(`unexpected status ${row.status}`);
	}
	return counts;
}

before(async () => {
	owner = await staff("owner");
	for (const role of ["ecommerce_admin", "warehouse", "customer_service", "finance", "buyer"] as const) people[role] = await staff(role, role !== "buyer");
	people.noMfaOwner = await staff("owner", false);
	await seed(REGISTERED);
	await seed(UNREGISTERED);
});
after(async () => {
	try {
		await identity.sql`delete from app.outbox_job where dedup_key like ${`${canary}:%`}`;
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("S136 counts per kind and state equal a direct row classification, with the unregistered kind flagged", async () => {
	const { response, payload } = await call(owner);
	assert.equal(response.status, 200, JSON.stringify(payload));
	const health = payload as SystemHealth;
	const byKind = new Map(health.kinds.map((entry) => [entry.kind, entry]));
	for (const kind of [REGISTERED, UNREGISTERED]) {
		const entry = byKind.get(kind);
		assert.ok(entry, kind);
		assert.deepEqual(entry.counts, await directCounts(kind), kind);
		// The seeded rows give the full spread; the registered kind may also hold rows other suites left.
		for (const state of JOB_STATES) assert.ok(entry.counts[state] >= expected()[state], `${kind} ${state}`);
	}
	assert.deepEqual(byKind.get(UNREGISTERED)?.counts, expected());
	assert.equal(byKind.get(UNREGISTERED)?.registered, false);
	assert.equal(byKind.get(REGISTERED)?.registered, true);
	// Every registry kind is listed, even with no rows, and totals are the column sums.
	for (const kind of ["local.notification", ...Object.keys(DATABASE_JOBS)]) assert.ok(byKind.has(kind), `registry kind ${kind} listed`);
	for (const state of JOB_STATES) assert.equal(health.totals[state], health.kinds.reduce((sum, entry) => sum + entry.counts[state], 0), state);
	// The oldest due job of a kind is the earliest run_at among its due rows.
	const [due] = await identity.sql`select to_char(min(run_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as oldest from app.outbox_job where kind=${UNREGISTERED} and status='pending' and run_at<=now()`;
	assert.equal(byKind.get(UNREGISTERED)?.oldest_due_at, due.oldest);
});

test("S136 totals match a direct SQL count over the whole table", async () => {
	const direct = async () => {
		const [row] = await identity.sql`select
			count(*) filter (where status='pending' and run_at<=now())::int due, count(*) filter (where status='pending' and run_at>now())::int scheduled,
			count(*) filter (where status='processing' and lease_until>now())::int leased, count(*) filter (where status='processing' and lease_until<=now())::int lease_expired,
			count(*) filter (where status='unknown')::int "unknown", count(*) filter (where status='failed' and attempts<max_attempts)::int failed,
			count(*) filter (where status='failed' and attempts>=max_attempts)::int dead, count(*) filter (where status='completed')::int completed
			from app.outbox_job`;
		return row as unknown as JobCounts;
	};
	const before = await direct();
	const { payload } = await call(owner);
	const after = await direct();
	// Nothing else writes to this test database mid-run; if it did the two direct counts would differ.
	assert.deepEqual(before, after);
	assert.deepEqual((payload as SystemHealth).totals, before);
});

test("S136 response has no payload, result, key, error text or lease token", async () => {
	const { response, payload } = await call(owner);
	assert.equal(response.status, 200);
	const text = JSON.stringify(payload);
	assert.ok(!text.includes(canary), "no seeded row value leaks");
	const keys = new Set<string>();
	JSON.stringify(payload, (key, value) => {
		keys.add(key);
		return value;
	});
	for (const column of ["payload", "result", "dedup_key", "last_error", "lease_token", "lease_until", "dispatched_at", "completed_at", "id"]) assert.ok(!keys.has(column), `no ${column} field`);
	const health = payload as SystemHealth;
	assert.deepEqual(Object.keys(health).sort(), ["as_of", "kinds", "retention", "totals"]);
	for (const entry of health.kinds) assert.deepEqual(Object.keys(entry).sort(), ["counts", "kind", "oldest_due_at", "registered"]);
	assert.equal(response.headers.get("cache-control"), "no-store");
});

test("S136 retention lists the registry and states that no run time is recorded", async () => {
	const { payload } = await call(owner);
	const { retention } = payload as SystemHealth;
	assert.equal(retention.last_run_recorded, false);
	assert.deepEqual(retention.jobs, Object.entries(RETENTION_JOBS).map(([name, job]) => ({ name, table: job.table })));
});

test("S136 refuses anonymous, non-owner, non-MFA, unsupported-transport and parameterised requests", async () => {
	assert.equal((await call(null)).response.status, 401);
	for (const role of ["ecommerce_admin", "warehouse", "customer_service", "finance", "buyer"] as const) {
		const refused = await call(people[role] ?? null);
		assert.equal(refused.response.status, 403, role);
		assert.deepEqual(Object.keys(refused.payload).sort(), ["code", "request_id", "status", "title", "type"], `${role} body is a bare Problem`);
	}
	assert.equal((await call(people.noMfaOwner ?? null)).response.status, 403);
	assert.equal((await call(owner, "", "GET", { "x-cart-token": "synthetic-unsupported" })).response.status, 401);
	assert.equal((await call(owner, "?kind=local.notification")).response.status, 400);
	assert.equal((await call(owner, "", "POST")).response.status, 404);
});

test("S136 every observed exchange matches the OpenAPI contract for success and denial", () => {
	validateExchanges(
		samples.filter((sample) => sample.method === "GET"),
		"system-health",
	);
});
