import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { AccessError } from "./policy.ts";

// S63 public-mutation budgets. Spec 16 keeps numeric limits as Proposal until load
// evidence exists, so these are conservative local defaults (count per window).
export const LIMITS = {
	guestAccessChallengePerOrder: [5, 900_000],
	guestAccessChallengePerContact: [5, 900_000],
	guestAccessVerifyPerOrder: [20, 900_000],
	buyerChallengePerUser: [5, 900_000],
	buyerVerifyPerUser: [10, 900_000],
	guestSupportSessionGlobal: [120, 60_000],
	guestSupportMessagePerGuest: [30, 60_000],
	supportChallengePerActor: [5, 900_000],
	supportChallengePerContact: [5, 900_000],
	supportVerifyPerChallenge: [20, 600_000],
	evidenceUploadPerCase: [10, 900_000],
	referralTouchPerVisitor: [30, 60_000],
} as const satisfies Record<string, readonly [number, number]>;

// Fixed-window counter in the shared app.auth_rate_limit table. Pass the pool `sql`
// (autocommit), never a request transaction: a rejected attempt must still count after
// the request's own transaction rolls back.
export async function rateLimit(
	sql: Sql | TransactionSql,
	key: string,
	[maximum, windowMs]: readonly [number, number],
) {
	const [clock] = await sql<{ now: string }[]>`
		select floor(extract(epoch from clock_timestamp())*1000)::text now`;
	const now = Number(clock.now);
	const [rate] = await sql<{ count: number; last_request: string }[]>`
		insert into app.auth_rate_limit (id,key,count,last_request)
		values (${randomUUID()},${`rl:${key}`},1,${now})
		on conflict (key) do update set
			count=case when app.auth_rate_limit.last_request<=${now - windowMs} then 1 else app.auth_rate_limit.count+1 end,
			last_request=case when app.auth_rate_limit.last_request<=${now - windowMs} then ${now} else app.auth_rate_limit.last_request end
		returning count,last_request`;
	if (Number(rate.count) > maximum) {
		throw new AccessError(
			429,
			"RATE_LIMITED",
			Math.max(1, Math.ceil((Number(rate.last_request) + windowMs - now) / 1000)),
		);
	}
}
