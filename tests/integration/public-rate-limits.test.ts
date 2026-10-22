import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { LIMITS } from "../../src/modules/access/rate-limit.ts";
import { handleAccounts } from "../../src/modules/accounts/service.ts";
import { digest } from "../../src/modules/checkout/access.ts";
import { handleSupport } from "../../src/modules/support/routes.ts";
import { supportChallengeProof } from "../../src/modules/support/service.ts";

const origin = "http://127.0.0.1:3099";
const post = (path: string, body: unknown, cookie?: string) =>
	new Request(`${origin}${path}`, {
		method: "POST",
		headers: {
			origin,
			"content-type": "application/json",
			"idempotency-key": randomUUID(),
			...(cookie ? { cookie } : {}),
		},
		body: JSON.stringify(body),
	});
const phone = () =>
	`+62812${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function assertLimited(response: Response) {
	assert.equal(response.status, 429);
	const retryAfter = Number(response.headers.get("retry-after"));
	assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1);
	assert.equal(response.headers.get("content-type"), "application/problem+json");
	assert.equal((await response.json()).code, "RATE_LIMITED");
}

test("S63 guest-order-access challenges are limited per order and per contact, durably across rolled-back attempts", async () => {
	const identity = createLocalAuth("test");
	const orderId = randomUUID();
	const sharedPhone = phone();
	const keys = [
		`rl:guest-access-challenge-order:${orderId}`,
		`rl:guest-access-challenge-contact:${digest(`phone:${sharedPhone}`)}`,
	];
	const challenge = (order: string, contact: string) =>
		handleAccounts(
			post("/api/v1/guest-order-access/challenges", {
				order_id: order,
				contact,
			}),
			identity,
		);
	try {
		const [perOrder] = LIMITS.guestAccessChallengePerOrder;
		for (let i = 0; i < perOrder; i++) {
			const contact = phone();
			keys.push(`rl:guest-access-challenge-contact:${digest(`phone:${contact}`)}`);
			const response = await challenge(orderId, contact);
			// Unknown order rolls back its transaction, yet the attempt still spends budget.
			assert.notEqual(response.status, 429);
			await response.body?.cancel();
		}
		const extra = phone();
		keys.push(`rl:guest-access-challenge-contact:${digest(`phone:${extra}`)}`);
		await assertLimited(await challenge(orderId, extra));

		const [perContact] = LIMITS.guestAccessChallengePerContact;
		for (let i = 0; i < perContact; i++) {
			const order = randomUUID();
			keys.push(`rl:guest-access-challenge-order:${order}`);
			const response = await challenge(order, sharedPhone);
			assert.notEqual(response.status, 429);
			await response.body?.cancel();
		}
		const last = randomUUID();
		keys.push(`rl:guest-access-challenge-order:${last}`);
		await assertLimited(await challenge(last, sharedPhone));
	} finally {
		await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(keys)}`;
		await identity.sql.end();
	}
});

test("S63 support recovery challenges from a guest session are limited per actor", async () => {
	const identity = createLocalAuth("test");
	let scope: string | null = null;
	const contacts: string[] = [];
	try {
		const session = await handleSupport(
			post("/api/v1/guest-support-sessions", {
				client_request_id: randomUUID().replaceAll("-", ""),
			}),
			identity,
		);
		assert.equal(session.status, 201);
		const cookie = session.headers
			.getSetCookie()
			.map((raw) => raw.split(";")[0])
			.join("; ");
		const guestId = cookie.split("=")[1].split(".")[0];
		scope = `guest_support:${guestId}`;
		const recover = () => {
			const contact = phone();
			contacts.push(contact);
			return handleSupport(
				post(
					"/api/v1/support/recovery-challenges",
					{
						contact: { kind: "phone", phone: contact },
						recovery_reference: randomUUID(),
					},
					cookie,
				),
				identity,
			);
		};
		const [perActor] = LIMITS.supportChallengePerActor;
		for (let i = 0; i < perActor; i++) {
			const response = await recover();
			assert.equal(response.status, 201);
			await response.body?.cancel();
		}
		await assertLimited(await recover());
	} finally {
		if (scope) {
			await identity.sql`delete from app.support_challenge where actor_scope = ${scope}`;
			await identity.sql`delete from app.auth_rate_limit where key = ${`rl:support-challenge-actor:${scope}`}`;
		}
		const contactKeys = contacts.map(
			(c) => `rl:support-challenge-contact:${digest(`phone:${c}`)}`,
		);
		if (contactKeys.length) {
			await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(contactKeys)}`;
		}
		await identity.sql.end();
	}
});

test("S41/S63 support challenge verification enforces a durable 5-attempt cap across parallel rolled-back guesses", async () => {
	const identity = createLocalAuth("test");
	let scope: string | null = null;
	let challengeId: string | null = null;
	const contact = phone();
	try {
		const session = await handleSupport(
			post("/api/v1/guest-support-sessions", {
				client_request_id: randomUUID().replaceAll("-", ""),
			}),
			identity,
		);
		assert.equal(session.status, 201);
		const cookie = session.headers
			.getSetCookie()
			.map((raw) => raw.split(";")[0])
			.join("; ");
		const guestId = cookie.split("=")[1].split(".")[0];
		scope = `guest_support:${guestId}`;
		const issued = await handleSupport(
			post(
				"/api/v1/support/contact-challenges",
				{
					expected_version: 0,
					contact: { kind: "phone", phone: contact },
				},
				cookie,
			),
			identity,
		);
		assert.equal(issued.status, 201);
		const body = (await issued.json()) as { challenge_id: string };
		challengeId = body.challenge_id;
		const validProof = await supportChallengeProof(
			identity,
			challengeId,
			"contact_binding",
			`phone:${contact}`,
		);
		const statuses = await Promise.all(
			Array.from({ length: 12 }, (_, idx) =>
				handleSupport(
					post(
						`/api/v1/support/contact-challenges/${challengeId}/verifications`,
						{ proof: `wrong-proof-${idx}-${randomUUID()}` },
						cookie,
					),
					identity,
				).then(async (res) => {
					await res.body?.cancel();
					return res.status;
				}),
			),
		);
		assert.equal(statuses.filter((s) => s === 403).length, 5);
		assert.equal(statuses.filter((s) => s === 409).length, 7);
		const [row] = await identity.sql<{ attempts: number }[]>`
			select attempts from app.support_challenge where id = ${challengeId}
		`;
		assert.equal(Number(row.attempts), 5);
		const lockedValid = await handleSupport(
			post(
				`/api/v1/support/contact-challenges/${challengeId}/verifications`,
				{ proof: validProof },
				cookie,
			),
			identity,
		);
		assert.equal(lockedValid.status, 409);
		await lockedValid.body?.cancel();
	} finally {
		if (scope) {
			await identity.sql`delete from app.support_challenge where actor_scope = ${scope}`;
			await identity.sql`delete from app.auth_rate_limit where key = ${`rl:support-challenge-actor:${scope}`}`;
		}
		if (challengeId) {
			await identity.sql`delete from app.auth_rate_limit where key = ${`rl:support-verify:${challengeId}`}`;
		}
		await identity.sql`delete from app.auth_rate_limit where key = ${`rl:support-challenge-contact:${digest(`phone:${contact}`)}`}`;
		await identity.sql.end();
	}
});
