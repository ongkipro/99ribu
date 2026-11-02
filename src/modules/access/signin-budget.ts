import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { readTurnstileConfig } from "../../config/runtime.ts";
import { mac } from "../checkout/access.ts";
import type { LocalAuth } from "./auth.ts";

// S149 sign-in budget (OWASP Authentication Cheat Sheet, NIST SP 800-63B-4 section 3.2.2). Only FAILED
// sign-ins count, per ACCOUNT (hashed email, so a known and an unknown address behave the same and the
// counters reveal nothing about existence). Never per client address: rotating addresses gains nothing.
//   - CHALLENGE_AFTER failures inside WINDOW_MS: the next attempt must carry a valid Turnstile token, else it
//     is refused with 429 CHALLENGE_REQUIRED and a Retry-After that grows with the consecutive failures.
//   - SIGN_IN_FAILURE_CEILING consecutive failures: a time-boxed cool-off (423 SIGN_IN_LOCKED + Retry-After),
//     15 minutes first, doubling at each further ceiling hit up to 24 hours. A token does not bypass it, and it
//     expires by itself. NOTE (accepted, M2): production password-reset mail is disabled (NOTIFICATION_DISABLED),
//     so apart from waiting it out, `node scripts/staff.ts unlock-signin production` is the ONLY way to end a
//     cool-off early. That is why a cool-off exists only when a challenge CAN be solved (below).
//   - No Turnstile keys configured (challenge unavailable, H1): a victim could never pass the challenge, so the
//     account behaves like the old fixed-window limiter only: after 5 failures in the 60 s window answer 429
//     CHALLENGE_REQUIRED (no siteKey) with Retry-After = the REMAINING window (never above 60 s, never growing).
//     The growing delay, the 100-failure ceiling and the cool-off do NOT engage: a keyless deployment must not
//     gain a lock that only an operator can lift.
//   - Token verification (siteverify) is never charged to the ACCOUNT (H2: a stranger would spend the victim's
//     allowance). It is bounded per client address bucket and globally instead. A refused verify budget just
//     means "not verified": the request still gets whatever the failure budget alone would give it.
//   - The consecutive count decays after 24 hours without a failure. A successful sign-in or a completed
//     password reset clears everything; unlockSignIn is the operator's way to do the same for one email.
// Counters live in app.auth_rate_limit (no migration), keyed by the hashed email: `window` = failures in the
// current fixed window, `run` = consecutive failures (last_request = last failure), `cool` = ceiling hits
// (count) and the end of the current cool-off (last_request).
export const SIGN_IN_FAILURE_CEILING = 100;
export const COOL_OFF_FIRST_S = 15 * 60;
export const COOL_OFF_MAX_S = 24 * 3600;
export const DECAY_MS = 24 * 3600 * 1000;
export const CHALLENGE_AFTER = 5;
export const WINDOW_MS = 60_000;
const MAX_BACKOFF_S = 3600;
const VERIFY_TIMEOUT_MS = 3000;
export const TURNSTILE_ACTION = "signin";
// siteverify calls per minute: per client address bucket, and across all clients.
export const VERIFY_PER_ADDRESS = 10;
export const VERIFY_GLOBAL = 120;
const VERIFY_WINDOW_MS = 60_000;
// lazy: this gate runs before Better Auth's own per-address limiter, so each distinct email tried adds three small
// rows to app.auth_rate_limit with no per-address cap. They are swept by the existing "auth.rate_limit" retention job
// (src/jobs/retention.ts, 1 day after the last request). Upgrade path: a per-address cap ahead of the gate.

export type BudgetState = { windowCount: number; windowStart: number; run: number; lastFail: number; coolLevel?: number; coolUntil?: number };
export type Decision =
	| { kind: "allow" }
	| { kind: "locked"; retryAfter: number; start: { level: number } | null } // start: this attempt reaches the ceiling and opens a cool-off
	| { kind: "challenge"; retryAfter: number };

// 0 below CHALLENGE_AFTER consecutive failures, then 60 s, 120 s, 240 s ... capped at one hour.
export function backoffSeconds(run: number) {
	if (run < CHALLENGE_AFTER) return 0;
	return Math.min(MAX_BACKOFF_S, 60 * 2 ** Math.min(20, Math.floor(run / CHALLENGE_AFTER) - 1));
}

// 15 min for the first ceiling hit (level 0), doubling per further hit, capped at 24 h.
export const coolOffSeconds = (level: number) => Math.min(COOL_OFF_MAX_S, COOL_OFF_FIRST_S * 2 ** Math.min(20, level));

// Pure decision for the state BEFORE the attempt. `verified`: a Turnstile token for this attempt was accepted.
// `challengeAvailable`: Turnstile keys are configured. Without them only the 60 s window applies (see header).
export function decide(state: BudgetState, now: number, verified: boolean, challengeAvailable = true, ceiling = SIGN_IN_FAILURE_CEILING): Decision {
	if (!challengeAvailable) {
		const left = state.windowCount >= CHALLENGE_AFTER ? state.windowStart + WINDOW_MS - now : 0;
		return left <= 0 ? { kind: "allow" } : { kind: "challenge", retryAfter: Math.min(60, Math.max(1, Math.ceil(left / 1000))) };
	}
	const coolUntil = state.coolUntil ?? 0;
	const run = state.lastFail > 0 && now - state.lastFail >= DECAY_MS ? 0 : state.run; // 24 h quiet: the count decays
	const level = coolUntil > 0 && now - coolUntil >= DECAY_MS ? 0 : (state.coolLevel ?? 0);
	if (coolUntil > now) return { kind: "locked", retryAfter: Math.ceil((coolUntil - now) / 1000), start: null };
	if (run >= ceiling) return { kind: "locked", retryAfter: coolOffSeconds(level), start: { level } };
	const windowLeft = state.windowCount >= CHALLENGE_AFTER ? state.windowStart + WINDOW_MS - now : 0;
	// The growing delay only extends a challenge a failure burst already triggered (old failures never taint a fresh attempt).
	const backoffLeft = state.windowCount >= CHALLENGE_AFTER && run >= CHALLENGE_AFTER ? state.lastFail + backoffSeconds(run) * 1000 - now : 0;
	const left = Math.max(windowLeft, backoffLeft);
	if (left <= 0 || verified) return { kind: "allow" };
	return { kind: "challenge", retryAfter: Math.max(1, Math.ceil(left / 1000)) };
}

type Store = Pick<LocalAuth, "auth" | "sql">;
const keys = async (store: Store, email: string) => {
	const hash = await mac(store as LocalAuth, "auth-account", [email.trim().toLowerCase()]);
	return { hash, window: `rl:signin-window:${hash}`, run: `rl:signin-run:${hash}`, cool: `rl:signin-cool:${hash}` };
};

async function load(sql: Sql | TransactionSql, k: { window: string; run: string; cool: string }): Promise<BudgetState> {
	const rows = await sql<{ key: string; count: number; last_request: string }[]>`
		select key,count,last_request from app.auth_rate_limit where key in (${k.window},${k.run},${k.cool})`;
	const at = (key: string) => rows.find((row) => row.key === key);
	return {
		windowCount: Number(at(k.window)?.count ?? 0), windowStart: Number(at(k.window)?.last_request ?? 0),
		run: Number(at(k.run)?.count ?? 0), lastFail: Number(at(k.run)?.last_request ?? 0),
		coolLevel: Number(at(k.cool)?.count ?? 0), coolUntil: Number(at(k.cool)?.last_request ?? 0),
	};
}
const clock = async (sql: Sql | TransactionSql) => Number((await sql<{ now: string }[]>`select floor(extract(epoch from clock_timestamp())*1000)::text now`)[0].now);

export type VerifyTurnstile = (token: string, remoteIp: string | null) => Promise<boolean>;

// Cloudflare siteverify. Anything but an explicit `success: true` JSON answer (timeout, network error, non-JSON,
// non-2xx, unset secret) is NOT verified: unknown is never success.
export const verifyTurnstile: VerifyTurnstile = async (token, remoteIp) => {
	const config = readTurnstileConfig(process.env);
	if (!config || !token || token.length > 2048) return false;
	try {
		const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
			method: "POST", headers: { "content-type": "application/json" },
			body: JSON.stringify({ secret: config.secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
			signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
		});
		if (!response.ok) return false;
		const payload = await response.json() as { success?: unknown; action?: unknown } | null;
		// A missing action is fine (dummy test keys may omit it); a different one means a widget from another form.
		return payload?.success === true && (payload.action === undefined || payload.action === TURNSTILE_ACTION);
	} catch { return false; }
};

export type SignInGate = { ok: true } | { ok: false; status: 423; code: "SIGN_IN_LOCKED"; retryAfter: number } | { ok: false; status: 429; code: "CHALLENGE_REQUIRED"; retryAfter: number; siteKey: string | null };

// Charge one siteverify call to a bucket; true while the bucket is within `limit` per minute.
async function chargeVerify(sql: Sql | TransactionSql, key: string, limit: number, now: number) {
	const [row] = await sql<{ count: number }[]>`
		insert into app.auth_rate_limit (id,key,count,last_request) values (${randomUUID()},${key},1,${now})
		on conflict (key) do update set
			count=case when app.auth_rate_limit.last_request<=${now - VERIFY_WINDOW_MS} then 1 else app.auth_rate_limit.count+1 end,
			last_request=case when app.auth_rate_limit.last_request<=${now - VERIFY_WINDOW_MS} then ${now} else app.auth_rate_limit.last_request end
		returning count`;
	return Number(row.count) <= limit;
}

// Decide and, when allowed, charge the attempt in one locked transaction (concurrent guesses for one account
// serialise on the rows, so a burst cannot all pass the check before the first is counted). The network
// verification happens outside the lock, and only when the state asks for a challenge: a locked or cooling-off
// account never reaches siteverify, so a token is never spent on a request that is refused anyway.
// A successful sign-in refunds via clearSignInBudget.
// `client`: the caller's address (`ip` goes to siteverify, `bucket` = addressBucket(ip) keys the verify budget).
export async function gateSignIn(store: Store, email: string, token: string | null, client: { ip: string | null; bucket: string } | null,
	verify: VerifyTurnstile = verifyTurnstile, ceiling = SIGN_IN_FAILURE_CEILING): Promise<SignInGate> {
	const { sql } = store;
	const k = await keys(store, email);
	const now = await clock(sql);
	const challengeAvailable = readTurnstileConfig(process.env) !== null;
	let verified = false;
	if (token !== null && client && challengeAvailable && decide(await load(sql, k), now, false, true, ceiling).kind === "challenge") {
		// Bounded per client address and globally so nobody can turn the endpoint into a siteverify amplifier, and
		// never per account so nobody can spend the victim's allowance. A refused budget = not verified, nothing more.
		const bucket = await mac(store as LocalAuth, "signin-verify-address", [client.bucket]);
		if (await chargeVerify(sql, `rl:signin-verify-addr:${bucket}`, VERIFY_PER_ADDRESS, now) && await chargeVerify(sql, "rl:signin-verify-all", VERIFY_GLOBAL, now)) {
			verified = await verify(token, client.ip);
		}
	}
	return sql.begin(async (tx) => {
		const at = await clock(tx);
		for (const key of [k.window, k.run, k.cool]) {
			await tx`insert into app.auth_rate_limit (id,key,count,last_request) values (${randomUUID()},${key},0,0) on conflict (key) do nothing`;
		}
		await tx`select 1 from app.auth_rate_limit where key in (${k.window},${k.run},${k.cool}) order by key for update`;
		const decision = decide(await load(tx, k), at, verified, challengeAvailable, ceiling);
		if (decision.kind === "locked") {
			if (decision.start) {
				// The ceiling is reached: open the cool-off, restart the consecutive count, and remember the level for the next hit.
				await tx`update app.auth_rate_limit set count=${decision.start.level + 1}, last_request=${at + decision.retryAfter * 1000} where key=${k.cool}`;
				await tx`update app.auth_rate_limit set count=0, last_request=0 where key in (${k.run},${k.window})`;
			}
			return { ok: false, status: 423, code: "SIGN_IN_LOCKED", retryAfter: Math.max(1, decision.retryAfter) } as const;
		}
		if (decision.kind === "challenge") {
			return { ok: false, status: 429, code: "CHALLENGE_REQUIRED", retryAfter: decision.retryAfter, siteKey: readTurnstileConfig(process.env)?.siteKey ?? null } as const;
		}
		await tx`update app.auth_rate_limit set
			count=case when last_request<=${at - WINDOW_MS} then 1 else count+1 end,
			last_request=case when last_request<=${at - WINDOW_MS} then ${at} else last_request end
			where key=${k.window}`;
		await tx`update app.auth_rate_limit set count=case when last_request>0 and last_request<=${at - DECAY_MS} then 1 else count+1 end, last_request=${at} where key=${k.run}`;
		return { ok: true } as const;
	});
}

// Successful sign-in or completed password reset: forget the account's failures, cool-off included.
// `unlockSignIn` is the same call under the operator's name (scripts/staff.ts unlock-signin).
export async function clearSignInBudget(store: Store, email: string) {
	const k = await keys(store, email);
	await store.sql`delete from app.auth_rate_limit where key in (${k.window},${k.run},${k.cool})`;
}
export const unlockSignIn = clearSignInBudget;
