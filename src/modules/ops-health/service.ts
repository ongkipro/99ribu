import type { Sql } from "postgres";
import { DATABASE_JOBS } from "../../jobs/worker.ts";
import { RETENTION_JOBS } from "../../jobs/retention.ts";
import type { LocalAuth } from "../access/auth.ts";
import { assertOrigin, privateJson, problem } from "../access/http.ts";
import { AccessError, getPrincipal } from "../access/policy.ts";

// S136 system health: read-only counts over app.outbox_job (the one outbox/job table) per job kind and
// state, plus the retention registry. Owner only. The response carries kinds, states, counts and one
// timestamp per kind; never payload, result, dedup_key, last_error or any row identity.
//
// States partition every row of one kind (their sum is the kind's total):
//   due           pending and run_at has passed: the worker should pick it up now
//   scheduled     pending with a future run_at (retry back-off, deadlines)
//   leased        processing under a live lease
//   lease_expired processing whose lease ended and expireLeases has not recovered it yet (stuck)
//   unknown       dispatched to an adapter with no confirmed outcome; waits for reconciliation
//   failed        terminal rejection before retries ran out (a permanent error)
//   dead          terminal failure with attempts >= max_attempts (retries exhausted)
//   completed     finished
export const JOB_STATES = ["due", "scheduled", "leased", "lease_expired", "unknown", "failed", "dead", "completed"] as const;
export type JobState = (typeof JOB_STATES)[number];
export type JobCounts = Record<JobState, number>;
export type KindHealth = { kind: string; registered: boolean; counts: JobCounts; oldest_due_at: string | null; };
export type SystemHealth = {
	as_of: string;
	totals: JobCounts;
	kinds: KindHealth[];
	retention: { last_run_recorded: false; jobs: { name: string; table: string }[] };
};

// Kinds the worker's registry knows by name (src/jobs/worker.ts). Leased-adapter kinds (scripts/worker.ts)
// are listed when rows of that kind exist and report registered=false.
const REGISTERED_KINDS: readonly string[] = ["local.notification", ...Object.keys(DATABASE_JOBS)];

const zero = (): JobCounts => Object.fromEntries(JOB_STATES.map((state) => [state, 0])) as JobCounts;

// postgres.js returns timestamptz as text here, so instants are formatted as RFC 3339 UTC in SQL. One
// repeatable-read read-only transaction: every count and as_of share one snapshot and one now().
const INSTANT = "YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"";
export async function readSystemHealth(sql: Sql): Promise<SystemHealth> {
	const [rows, [{ now }]] = await sql.begin("isolation level repeatable read read only", async (tx) => [
		await tx<(JobCounts & { kind: string; oldest_due_at: string | null })[]>`
			select kind,
				count(*) filter (where status='pending' and run_at<=now())::int as due,
				count(*) filter (where status='pending' and run_at>now())::int as scheduled,
				count(*) filter (where status='processing' and lease_until>now())::int as leased,
				count(*) filter (where status='processing' and lease_until<=now())::int as lease_expired,
				count(*) filter (where status='unknown')::int as unknown,
				count(*) filter (where status='failed' and attempts<max_attempts)::int as failed,
				count(*) filter (where status='failed' and attempts>=max_attempts)::int as dead,
				count(*) filter (where status='completed')::int as completed,
				to_char(min(run_at) filter (where status='pending' and run_at<=now()) at time zone 'UTC', ${INSTANT}) as oldest_due_at
			from app.outbox_job group by kind`,
		await tx<{ now: string }[]>`select to_char(now() at time zone 'UTC', ${INSTANT}) as now`,
	] as const);
	const byKind = new Map(rows.map((row) => [row.kind, row]));
	const kinds = [...new Set([...REGISTERED_KINDS, ...byKind.keys()])].sort().map((kind): KindHealth => {
		const row = byKind.get(kind);
		return {
			kind,
			registered: REGISTERED_KINDS.includes(kind),
			counts: row ? Object.fromEntries(JOB_STATES.map((state) => [state, row[state]])) as JobCounts : zero(),
			oldest_due_at: row?.oldest_due_at ?? null,
		};
	});
	const totals = zero();
	for (const entry of kinds) for (const state of JOB_STATES) totals[state] += entry.counts[state];
	return {
		as_of: now,
		totals,
		kinds,
		// Retention runs are not persisted: src/jobs/worker.ts only logs a redacted failure line, so no last
		// run time exists to read. The registry is listed so the page shows what the worker sweeps.
		retention: { last_run_recorded: false, jobs: Object.entries(RETENTION_JOBS).map(([name, job]) => ({ name, table: job.table })) },
	};
}

export async function handleSystemHealth(request: Request, identity: LocalAuth) {
	try {
		assertOrigin(request);
		const url = new URL(request.url);
		if (request.method !== "GET" || url.pathname !== "/api/v1/admin/system-health") throw new AccessError(404, "NOT_FOUND");
		if (["authorization", "x-cart-token", "x-order-token"].some((header) => request.headers.has(header))) throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
		const principal = await getPrincipal(request, identity);
		if (!principal.roles.includes("owner")) throw new AccessError(403, "FORBIDDEN");
		if (url.search) throw new AccessError(400, "INVALID_INPUT");
		return privateJson(await readSystemHealth(identity.sql));
	} catch (error) {
		return problem(error);
	}
}
