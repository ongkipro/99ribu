import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { connectDatabase } from "../../src/db/client.ts";
import type { Sql } from "postgres";
import {
	deleteExpiredGuestContextBatch,
	deleteExpiredGuestContexts,
	digest,
} from "../../src/modules/checkout/access.ts";
import { paymentFixture } from "./payment-fixture.ts";

const expiredGuest = async (sql: Sql, days = 1) => {
	const [row] = await sql<{ id: string }[]>`insert into app.commerce_guest_context (digest,created_at,expires_at)
    select ${digest(randomBytes(32).toString("base64url"))},t-${days + 7}*interval '1 day',t-${days}*interval '1 day' from (select clock_timestamp() t) c returning id`;
	return row.id;
};

// S76 / DEC-002: only expired, unreferenced guest contexts may be deleted.
test("S76 bounded cleanup deletes expired unreferenced guest contexts and the guard refuses referenced or live ones", async () => {
	const { sql } = connectDatabase("test");
	const { sql: owner } = connectDatabase("test", "owner");
	const guest = async (expired: boolean) => {
		const token = digest(randomBytes(32).toString("base64url"));
		const [row] = expired
			? await sql<{ id: string }[]>`insert into app.commerce_guest_context (digest,created_at,expires_at)
          select ${token},t-interval '8 days',t-interval '1 day' from (select clock_timestamp() t) c returning id`
			: await sql<{ id: string }[]>`insert into app.commerce_guest_context (digest,created_at,expires_at)
          select ${token},t,t+interval '7 days' from (select clock_timestamp() t) c returning id`;
		return row.id;
	};
	const exists = async (id: string) =>
		(await sql`select 1 from app.commerce_guest_context where id=${id}`)
			.length === 1;
	try {
		const direct = await guest(true);
		const swept = await guest(true);
		const live = await guest(false);
		const cartRef = await guest(true);
		const supportRef = await guest(true);
		const scopeRef = await guest(true);
		// Hard FK reference (cart history is itself undeletable).
		await sql`insert into app.cart (owner_guest_id,transport,cap_digest,cap_issued_at,cap_expires_at,created_at,expires_at)
      select ${cartRef},'browser',${digest(randomUUID())},t-interval '8 days',t-interval '1 day',t-interval '8 days',t-interval '1 day' from (select clock_timestamp() t) c`;
		// Soft references: support identity guest id and a 'guest:<id>' actor scope.
		await sql`insert into app.guest_support_identity (token_digest,guest_id,expires_at) values (${digest(randomUUID())},${supportRef},clock_timestamp()-interval '1 day')`;
		await sql`insert into app.commerce_operation (actor_scope,key,action,request_hash,resource_id,result)
      values (${`guest:${scopeRef}`},${randomUUID()},'cart.create',${digest(randomUUID())},${randomUUID()},'{}'::jsonb)`;

		for (const id of [live, cartRef, supportRef, scopeRef]) {
			await assert.rejects(
				sql`delete from app.commerce_guest_context where id=${id}`,
				{ code: "23514" },
			);
		}
		await sql`delete from app.commerce_guest_context where id=${direct}`;
		assert.equal(await exists(direct), false);

		// Other revocation-guarded relations (order_access) stay undeletable.
		const rollback = new Error("rollback");
		await assert.rejects(
			owner.begin(async (tx) => {
				await tx`create temp table order_access (id int, expires_at timestamptz, revoked_at timestamptz) on commit drop`;
				await tx`create trigger order_access_revocation before update or delete on pg_temp.order_access for each row execute function app.guard_commerce_revocation()`;
				await tx`insert into pg_temp.order_access values (1, clock_timestamp()-interval '1 day', null)`;
				await assert.rejects(
					tx.savepoint((t) => t`delete from pg_temp.order_access`),
					{ code: "23514" },
				);
				throw rollback;
			}),
			(error) => error === rollback,
		);

		// Bounded: never more than the requested batch.
		assert.ok((await deleteExpiredGuestContexts(sql, 1)) <= 1);
		// Drain in bounded batches (the shared test DB may hold other expired rows).
		while ((await deleteExpiredGuestContexts(sql)) > 0);
		assert.equal(await exists(swept), false);
		for (const id of [live, cartRef, supportRef, scopeRef])
			assert.equal(await exists(id), true);
		// Idempotent: rerunning leaves referenced/live rows and needs no state.
		await deleteExpiredGuestContexts(sql);
		await deleteExpiredGuestContexts(sql);
		for (const id of [live, cartRef, supportRef, scopeRef])
			assert.equal(await exists(id), true);
	} finally {
		await sql.end();
		await owner.end();
	}
});

// R4/0028: every probe of commerce_guest_context_referenced() keeps its guest in
// the cleanup anti-join and the delete guard. Guarded histories (order, access,
// return/exception operations) cannot reference an arbitrary guest through
// their domain flows, so one real guest order is repointed per probe inside a
// rolled-back owner transaction with only user triggers disabled; FKs and
// checks stay enforced.
test("R4 cleanup keeps guests referenced by each probe table and the new guest FKs refuse dangling ids", async () => {
	const f = await paymentFixture();
	const { sql: owner } = connectDatabase("test", "owner");
	const rollback = new Error("rollback");
	try {
		const { order } = await f.order();
		await assert.rejects(
			owner.begin(async (tx) => {
				await tx`set local lock_timeout='10s'`;
				const probe = async () => expiredGuest(tx as unknown as Sql);
				const [orderRef, accessRef, returnRef, exceptionRef, referralRef, challengeRef, control] =
					await Promise.all(Array.from({ length: 7 }, probe));
				const guarded = ["commerce_order", "order_access", "return_operation", "commerce_exception", "exception_operation", "affiliate_account"];
				for (const table of guarded) await tx.unsafe(`alter table app.${table} disable trigger user`);
				await tx`update app.commerce_order set owner_guest_id=${orderRef} where id=${order.id}`;
				await tx`update app.order_access set guest_id=${accessRef} where order_id=${order.id}`;
				await tx`insert into app.return_operation (order_id,occurred_at,actor_scope,guest_id,key,action,subject_id,request_hash,response)
          values (${order.id},clock_timestamp(),${`guest:${returnRef}`},${returnRef},${randomUUID()},'return.create',${randomUUID()},${digest(randomUUID())},'{}'::jsonb)`;
				const [exception] = await tx<{ id: string }[]>`insert into app.commerce_exception (order_id,kind,revision,status,source_kind,source_id,reason,occurred_at,created_at)
          values (${order.id},'stock_discrepancy',1,'open','stock_report',${randomUUID()},'SYNTHETIC probe',clock_timestamp(),clock_timestamp()) returning id`;
				await tx`insert into app.exception_operation (exception_id,subject_id,actor_scope,guest_id,action,key,request_hash,input,response,occurred_at)
          values (${exception.id},${exception.id},${`guest:${exceptionRef}`},${exceptionRef},'buyer_accept',${randomUUID()},${digest(randomUUID())},'{}'::jsonb,'{}'::jsonb,clock_timestamp())`;
				const [affiliate] = await tx<{ id: string }[]>`insert into app.affiliate_account (user_id) values (${f.owner.id})
          on conflict (user_id) do update set user_id=excluded.user_id returning id`;
				for (const table of guarded) await tx.unsafe(`alter table app.${table} enable trigger user`);
				const touch = (q: typeof tx, guestId: string) => q`insert into app.referral_touch (affiliate_id,referral_code,guest_id,touched_at,expires_at,operation_id,request_hash)
          values (${affiliate.id},'SYNTHETIC',${guestId},clock_timestamp(),clock_timestamp()+interval '1 day',${randomUUID()},${digest(randomUUID())})`;
				await touch(tx, referralRef);
				await tx`insert into app.support_challenge (kind,actor_scope,target_reference,code_digest,expires_at)
          values ('contact_binding',${`guest:${challengeRef}`},'SYNTHETIC',${digest(randomUUID())},clock_timestamp()+interval '10 minutes')`;

				// 0028 FKs: soft references can no longer name a missing guest.
				await assert.rejects(tx.savepoint((t) => touch(t, randomUUID())), { code: "23503" });
				await assert.rejects(
					tx.savepoint((t) => t`insert into app.guest_support_identity (token_digest,guest_id,expires_at) values (${digest(randomUUID())},${randomUUID()},clock_timestamp())`),
					{ code: "23503" },
				);

				const referenced = [orderRef, accessRef, returnRef, exceptionRef, referralRef, challengeRef];
				for (const id of referenced) {
					const [row] = await tx`select app.commerce_guest_context_referenced(${id}::uuid) referenced`;
					assert.equal(row.referenced, true, id);
					await assert.rejects(
						tx.savepoint((t) => t`delete from app.commerce_guest_context where id=${id}`),
						{ code: "23514" },
					);
				}
				// The candidate anti-join never selects a referenced probe, so the
				// whole drain records no guard/FK refusal and the unreferenced control goes.
				const refusals: unknown[] = [];
				const watched = new Proxy(tx, {
					get(target, prop, receiver) {
						const value = Reflect.get(target, prop, receiver);
						if (prop !== "savepoint") return value;
						return (...args: unknown[]) =>
							(value as (...a: unknown[]) => Promise<unknown>).apply(target, args).catch((error: unknown) => {
								refusals.push(error);
								throw error;
							});
					},
				});
				while ((await deleteExpiredGuestContextBatch(watched)) > 0);
				assert.deepEqual(refusals, []);
				const left = await tx<{ id: string }[]>`select id from app.commerce_guest_context where id in ${tx([...referenced, control])}`;
				assert.deepEqual(new Set(left.map((r) => r.id)), new Set(referenced));
				throw rollback;
			}),
			(error) => error === rollback,
		);
	} finally {
		await owner.end();
		await f.close();
	}
});

// A reference committed after the batch selected its candidates makes the
// guard refuse only that row; the rest of the batch is still deleted.
test("R4 cleanup batch skips a candidate referenced mid-batch and deletes the others", async () => {
	const { sql } = connectDatabase("test");
	const { sql: owner } = connectDatabase("test", "owner");
	const exists = async (id: string) =>
		(await sql`select 1 from app.commerce_guest_context where id=${id}`).length === 1;
	try {
		const first = await expiredGuest(sql, 300);
		const raced = await expiredGuest(sql, 300);
		const last = await expiredGuest(sql, 300);
		let injected = false;
		// Commit a soft 'guest:<id>' reference right after the candidate select.
		const racing = new Proxy(sql, {
			get(target, prop, receiver) {
				if (prop !== "begin") return Reflect.get(target, prop, receiver);
				return (work: (tx: unknown) => Promise<unknown>) =>
					target.begin((tx) =>
						work(
							new Proxy(tx, {
								apply(fn, self, args) {
									const query = Reflect.apply(fn, self, args);
									if (injected) return query;
									injected = true;
									return query.then(async (rows: unknown) => {
										await owner`insert into app.commerce_operation (actor_scope,key,action,request_hash,resource_id,result)
                      values (${`guest:${raced}`},${randomUUID()},'cart.create',${digest(randomUUID())},${randomUUID()},'{}'::jsonb)`;
										return rows;
									});
								},
							}),
						),
					);
			},
		}) as Sql;
		const deleted = await deleteExpiredGuestContexts(racing);
		assert.equal(injected, true);
		assert.ok(deleted >= 2);
		assert.equal(await exists(first), false);
		assert.equal(await exists(last), false);
		assert.equal(await exists(raced), true);
	} finally {
		await sql.end();
		await owner.end();
	}
});
