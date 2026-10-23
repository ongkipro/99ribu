import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import test from "node:test";
import { connectDatabase } from "../../src/db/client.ts";
import {
	claimJob,
	expireLeases,
	markDispatched,
} from "../../src/jobs/leases.ts";
import { enqueueJob } from "../../src/jobs/outbox.ts";
import { runOneJob } from "../../src/jobs/worker.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleAccounts } from "../../src/modules/accounts/service.ts";
import { handleAdvertisingDiagnostics } from "../../src/modules/advertising/diagnostics.ts";
import { handleAffiliateProfile } from "../../src/modules/affiliates/profile.ts";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import {
	bootstrapGuest,
	capability,
	commerceActor,
	prefix,
	setCookie,
} from "../../src/modules/checkout/access.ts";
import { createCart } from "../../src/modules/checkout/carts.ts";
import { lockRecoveryCollectionBasis } from "../../src/modules/checkout/exceptions/collection.ts";
import { submitOrder } from "../../src/modules/checkout/orders.ts";
import { createQuote } from "../../src/modules/checkout/quotes.ts";
import {
	accrueOrderCommissions,
	holdUnitCommission,
	matureEligibleCommissions,
	recordReplacementUnitReceiptMaturity,
	recordUnitReceiptMaturity,
} from "../../src/modules/commissions/service.ts";
import { handleShippingLabels } from "../../src/modules/documents/labels.ts";
import { lockVerifiedReceivables } from "../../src/modules/finance/settlements/receivables.ts";
import {
	coveredOperationalDeadline,
	packingDeadline,
} from "../../src/modules/fulfillment/calendar.ts";
import {
	ingestWaybillEvent,
	simulateWaybillIssue,
} from "../../src/modules/fulfillment/local.ts";
import {
	offerAvailability,
	releaseReservation,
	reserveOffers,
} from "../../src/modules/inventory/reservations.ts";
import { handleInventory } from "../../src/modules/inventory/routes.ts";
import { seedCommerce } from "../../src/modules/local/commerce.ts";
import {
	advanceFixtureClock,
	readFixtureClock,
} from "../../src/modules/local/fixtures.ts";
import { handleOrderReceipt } from "../../src/modules/orders/receipt.ts";
import {
	createLocalOperation,
	ingestProviderEvent,
	simulateCollection,
} from "../../src/modules/payments/local.ts";
import { reconcilePaymentNow } from "../../src/modules/payments/recovery.ts";
import { paymentAdapter } from "../../src/modules/payments/worker.ts";
import { queueEligibleAffiliatePayouts } from "../../src/modules/payouts/service.ts";
import { resolvePolicy } from "../../src/modules/settings/policies.ts";
import { handleSupport } from "../../src/modules/support/routes.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { advertisingFixture, deniedChoices } from "./advertising-fixture.ts";
import { CommerceClient } from "./checkout-fixture.ts";
import { codFixture } from "./cod-fixture.ts";
import { fulfillmentCalendarFixture } from "./fulfillment-calendar-fixture.ts";
import {
	closeFulfillmentActor,
	fulfillmentFixture,
} from "./fulfillment-fixture.ts";
import { paymentFixture } from "./payment-fixture.ts";
import { returnFixture } from "./return-fixture.ts";
import { shippingFixture } from "./shipping-fixture.ts";

const exec = promisify(execFile);
const origin = "http://127.0.0.1:3099";

type FixtureSimulation = {
	case: string;
	adapter: string;
	sequence: string[];
	expected: string;
};

function readCanonicalSimulations(): FixtureSimulation[] {
	const raw = JSON.parse(
		readFileSync(
			new URL(
				"../../docs/spec/fixtures/localhost-commerce.json",
				import.meta.url,
			),
			"utf8",
		),
	) as { simulations: FixtureSimulation[] };
	return raw.simulations;
}

class SupportScenarioClient {
	readonly identity = createLocalAuth("test");
	cookies = new Map<string, string>();

	constructor(identity: ReturnType<typeof createLocalAuth>) {
		this.identity = identity;
	}

	absorb(response: Response) {
		for (const raw of response.headers.getSetCookie()) {
			const [pair, ...attrs] = raw.split(";").map((s) => s.trim());
			const eq = pair.indexOf("=");
			if (eq <= 0) continue;
			const name = pair.slice(0, eq);
			const value = pair.slice(eq + 1);
			if (value && !attrs.includes("Max-Age=0")) {
				this.cookies.set(name, value);
			} else {
				this.cookies.delete(name);
			}
		}
	}

	async call(path: string, body?: unknown) {
		const method = body !== undefined ? "POST" : "GET";
		const headers = new Headers({
			origin,
			...(method !== "GET" ? { "idempotency-key": randomUUID() } : {}),
			...(body !== undefined ? { "content-type": "application/json" } : {}),
		});
		if (this.cookies.size > 0) {
			headers.set(
				"cookie",
				[...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
			);
		}
		const req = new Request(`${origin}${path}`, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
		const response = await handleSupport(req, this.identity);
		this.absorb(response);
		return {
			status: response.status,
			payload: await response.json(),
		};
	}
}

test("S62.1: standalone fixture validator rejects invalid mutations and confirms 14 scenario contracts", async () => {
	const { stdout } = await exec(
		"python3",
		["docs/spec/scripts/check-localhost-fixtures.py"],
		{ timeout: 15000 },
	);
	assert.ok(stdout.includes("PASS synthetic fixture:"));
	assert.ok(
		stdout.includes("14 scenario contracts; 12 invalid mutations rejected"),
	);
});

test("S62.2: rerunnable seedCommerce on the same namespace preserves identities without wiping rows and populates all seeded tables", async () => {
	const identity = createLocalAuth("test");
	const owner = await actor(identity, "owner", []);
	await enroll(owner.browser, owner.password);
	const ns = `s62-${randomUUID().slice(0, 10)}`;
	const request = () =>
		owner.browser.request("/api/v1/admin/local-fixture-command");

	try {
		const first = await seedCommerce(request(), identity, "test", ns);
		const second = await seedCommerce(request(), identity, "test", ns);
		assert.deepEqual(second, first);

		const [authUserCount] = await identity.sql<{ n: number }[]>`
			select count(*)::int as n
			from app.auth_user u
			join app.local_fixture_principal p on p.user_id = u.id
			where p.namespace = ${ns}
		`;
		const [warehouseCount] = await identity.sql<{ n: number }[]>`
			select count(*)::int as n
			from app.warehouse w
			join app.local_fixture_warehouse fw on fw.warehouse_id = w.id
			where fw.namespace = ${ns}
		`;
		const [stockItemCount] = await identity.sql<{ n: number }[]>`
			select count(*)::int as n
			from app.stock_item
			where id in ${identity.sql(Object.values(first.stocks))}
		`;
		const [balanceCount] = await identity.sql<{ n: number }[]>`
			select count(*)::int as n
			from app.inventory_balance
			where id in ${identity.sql(Object.values(first.positions))}
		`;
		const [productCount] = await identity.sql<{ n: number }[]>`
			select count(*)::int as n
			from app.product
			where id in ${identity.sql(Object.values(first.products))}
		`;
		const [offerCount] = await identity.sql<{ n: number }[]>`
			select count(*)::int as n
			from app.offer
			where id in ${identity.sql(Object.values(first.offers))}
		`;
		const [pubHeadCount] = await identity.sql<{ n: number }[]>`
			select count(*)::int as n
			from app.publication_head
			where product_id in ${identity.sql(Object.values(first.products))}
				and revision > 0
		`;

		assert.equal(authUserCount.n, 8);
		assert.equal(warehouseCount.n, 2);
		assert.equal(stockItemCount.n, 3);
		assert.equal(balanceCount.n, 6);
		assert.equal(productCount.n, 4);
		assert.equal(offerCount.n, 4);
		assert.equal(pubHeadCount.n, 2);

		// Bounded namespace cleanup of active reservations and expiry jobs without wiping historical catalog/warehouse identities
		for (const reservationId of Object.values(first.reservations)) {
			await identity.sql.begin((tx) =>
				releaseReservation(
					tx,
					reservationId,
					"Bounded S62 namespace reservation cleanup",
				),
			);
			await identity.sql`
				delete from app.outbox_job
				where kind = 'inventory.reservation.expire'
					and payload->>'reservationId' = ${reservationId}
			`;
		}
		const [activeHolds] = await identity.sql<{ n: number }[]>`
			select count(*)::int as n
			from app.stock_reservation
			where id in ${identity.sql(Object.values(first.reservations))}
				and status = 'active'
		`;
		assert.equal(activeHolds.n, 0);
	} finally {
		await cleanup(identity, [owner]);
		await identity.sql.end();
	}
});

const observedScenarios: Record<string, Record<string, unknown>> = {};

test("S62.3a: canonical payment, expiry, late-payment stock loss, and split COD refusal scenarios (1-4)", async () => {
	// 1. prepaid-success-duplicate (S25)
	{
		const f = await advertisingFixture();
		try {
			await f.consent(f.client);
			const order = await f.order(f.client);
			const payment = await f.pay(f.client, order.id);
			assert.equal(await payment.complete(), true);

			const duplicate = await simulateCollection(
				f.identity.sql,
				"test",
				payment.attempt.id,
			);
			const duplicateJob = await ingestProviderEvent(f.identity.sql, duplicate);
			assert.equal(await runOneJob(f.identity.sql, {}, duplicateJob), true);

			const orderReload = await f.client.call(`/api/v1/orders/${order.id}`);
			assert.equal(orderReload.response.status, 200);
			const receiptReload = await handleOrderReceipt(
				f.client.request(`/api/v1/orders/${order.id}/receipt`),
				f.identity,
			);
			assert.equal(receiptReload.status, 200);

			const [receipts] = await f.identity.sql<{ n: number }[]>`
				select count(*)::int as n from app.economic_receipt where order_id = ${order.id}
			`;
			const [purchases] = await f.identity.sql<{ n: number }[]>`
				select count(*)::int as n from app.commerce_event where order_id = ${order.id} and name = 'Purchase'
			`;
			const [balance] = await f.identity.sql<{ b: string }[]>`
				select sum(case when side = 'debit' then amount else -amount end)::text as b
				from app.finance_posting
				where transaction_id in (select transaction_id from app.economic_receipt where order_id = ${order.id})
			`;
			assert.equal(receipts.n, 1);
			assert.equal(purchases.n, 1);
			assert.equal(balance.b, "0");

			observedScenarios["prepaid-success-duplicate"] = {
				ownerSlice: "S25",
				receiptCount: receipts.n,
				purchaseSignalCount: purchases.n,
				postingBalance: balance.b,
			};
		} finally {
			await f.close();
		}
	}

	// 2. payment-timeout-after-commit (S24)
	{
		const f = await paymentFixture();
		try {
			const { order, client } = await f.order();
			const path = `/api/v1/orders/${order.id}/payment-attempts`;
			const attempt = (
				await f.call(client, path, { method_id: "local-prepaid" })
			).payload;
			const [stored] = await f.identity.sql<{ creation_job_id: string }[]>`
				select creation_job_id from app.payment_attempt where id = ${attempt.id}
			`;
			await runOneJob(
				f.identity.sql,
				{
					"payment.create": paymentAdapter(
						f.identity.sql,
						"test",
						new Map([[attempt.id, "paid-commit-lost-ack"]]),
					),
				},
				stored.creation_job_id,
			);
			const [unknownJob] = await f.identity.sql<{ status: string }[]>`
				select status from app.outbox_job where id = ${stored.creation_job_id}
			`;
			assert.equal(unknownJob.status, "unknown");

			const jobs = await reconcilePaymentNow(f.identity.sql, attempt.id);
			for (const job of jobs) {
				await runOneJob(
					f.identity.sql,
					{ "payment.create": paymentAdapter(f.identity.sql, "test") },
					job,
				);
			}
			const lookedUp = await f.call(client, `${path}/${attempt.id}`);
			assert.equal(lookedUp.payload.status, "confirmed");

			const [ops] = await f.identity.sql<{ n: number }[]>`
				select count(*)::int as n from app.local_payment_operation where attempt_id = ${attempt.id}
			`;
			const [receipts] = await f.identity.sql<{ n: number }[]>`
				select count(*)::int as n from app.economic_receipt where order_id = ${order.id}
			`;
			assert.equal(ops.n, 1);
			assert.equal(receipts.n, 1);

			observedScenarios["payment-timeout-after-commit"] = {
				ownerSlice: "S24",
				attemptStatus: lookedUp.payload.status,
				operationCount: ops.n,
				receiptCount: receipts.n,
			};
		} finally {
			await f.close();
		}
	}

	// 3. late-payment-stock-loss (S33)
	{
		const f = await paymentFixture();
		try {
			const old = await f.order(5);
			const path = `/api/v1/orders/${old.order.id}/payment-attempts`;
			const attempt = (
				await f.call(old.client, path, { method_id: "local-prepaid" })
			).payload;
			await createLocalOperation(f.identity.sql, "test", attempt.id);

			const clock = await readFixtureClock("test", f.namespace);
			await advanceFixtureClock("test", f.namespace, 1860, clock.version);
			const [expiry] = await f.identity.sql<{ id: string }[]>`
				select id from app.outbox_job
				where kind = 'checkout.order.expire' and payload->>'orderId' = ${old.order.id}
			`;
			assert.equal(await runOneJob(f.identity.sql, {}, expiry.id), true);

			// Another buyer reserves the 5 units so stock is unavailable to revive
			const newer = await f.order(5);
			const paid = await simulateCollection(f.identity.sql, "test", attempt.id);
			const callback = await ingestProviderEvent(f.identity.sql, paid);
			await f.identity.sql.begin(async (tx) => {
				const units = await tx<{ id: string }[]>`
					select fi.id from app.fulfillment_item fi
					join app.order_item oi on oi.id = fi.order_item_id
					where oi.order_id = ${old.order.id}
				`;
				assert.equal(units.length, 5);
			});
			await runOneJob(f.identity.sql, {}, callback);

			const [result] = await f.identity.sql<
				{ outcome: string; reason: string; receipt_id: string }[]
			>`
				select outcome, reason, receipt_id from app.payment_event_result where event_id = ${paid.id}
			`;
			assert.equal(result.outcome, "recovery");
			assert.equal(result.reason, "late_payment");
			assert.ok(result.receipt_id);

			const [oldState] = await f.identity.sql<
				{ status: string; payment_status: string; hold_status: string }[]
			>`
				select o.status, o.payment_status, r.status as hold_status
				from app.commerce_order o
				join app.stock_reservation r on r.id = o.stock_reservation_id
				where o.id = ${old.order.id}
			`;
			assert.deepEqual(oldState, {
				status: "cancelled",
				payment_status: "expired",
				hold_status: "expired",
			});

			const [newerState] = await f.identity.sql<{ hold_status: string }[]>`
				select r.status as hold_status
				from app.commerce_order o
				join app.stock_reservation r on r.id = o.stock_reservation_id
				where o.id = ${newer.order.id}
			`;
			assert.equal(newerState.hold_status, "active");

			const basis = await f.identity.sql.begin(async (tx) => {
				const units = await tx<{ id: string }[]>`
					select fi.id from app.fulfillment_item fi
					join app.order_item oi on oi.id = fi.order_item_id
					where oi.order_id = ${old.order.id}
				`;
				return lockRecoveryCollectionBasis(tx, old.order.id, {
					kind: "purchased_units",
					fulfillment_item_ids: units.map((u) => u.id),
				});
			});
			assert.equal(basis.basis_kind, "purchased_units");
			assert.equal(basis.sources.length, 1);
			assert.equal(basis.sources[0].amount, old.order.buyer_total);

			observedScenarios["late-payment-stock-loss"] = {
				ownerSlice: "S33",
				outcome: result.outcome,
				reason: result.reason,
				orderStatus: oldState.status,
				holdStatus: oldState.hold_status,
				recoveryAmountIdr: basis.sources[0].amount,
			};
		} finally {
			await f.close();
		}
	}

	// 4. split-cod-refusal (S30)
	{
		const f = await codFixture();
		try {
			await f.move("fixture-malang:fixture-shirt", "quarantine", 2);
			await f.move("fixture-pontianak:fixture-shirt", "quarantine", 1);
			await f.consent(f.client);
			const splitOrder = await f.order(f.client, 2);
			assert.equal(splitOrder.shipments.length, 2);

			const [parcelA, parcelB] = splitOrder.shipments;
			const collectEventA = await f.collect(parcelA.id);
			const refuseEventB = await f.collect(parcelB.id, { status: "refused" });

			const [resA] = await f.identity.sql<
				{ receipt_id: string; transaction_id: string }[]
			>`
				select receipt_id, transaction_id from app.cod_event_result where event_id = ${collectEventA.event.id}
			`;
			const [resB] = await f.identity.sql<
				{ receipt_id: string | null; transaction_id: string | null }[]
			>`
				select receipt_id, transaction_id from app.cod_event_result where event_id = ${refuseEventB.event.id}
			`;
			assert.ok(resA.receipt_id);
			assert.equal(resB.receipt_id, null);
			assert.equal(resB.transaction_id, null);

			const context = {
				provider: "local.cod" as const,
				environment: "test" as const,
				occurred_at: new Date(Date.now() + 60_000).toISOString(),
				clock_namespace: null,
			};
			const verified = await f.identity.sql.begin((tx) =>
				lockVerifiedReceivables(tx, context, [resA.transaction_id]),
			);
			assert.equal(verified.size, 1);

			const purchases = await f.identity.sql<
				{ id: string; merchandise_amount: string }[]
			>`
				select id, merchandise_amount::text as merchandise_amount
				from app.commerce_event
				where order_id = ${splitOrder.id} and name = 'Purchase'
			`;
			assert.equal(purchases.length, 1);
			assert.equal(Number(purchases[0].merchandise_amount), 99000);

			observedScenarios["split-cod-refusal"] = {
				ownerSlice: "S30",
				purchaseCount: purchases.length,
				merchandiseAmountIdr: Number(purchases[0].merchandise_amount),
				refusalPurchaseCount: 0,
				settledReceivableCount: verified.size,
			};
		} finally {
			await f.close();
		}
	}
});

test("S62.3b: canonical last-component race, publication gate, and waybill reprint scenarios (5-7)", async () => {
	// 5. last-component-race (S15)
	{
		const identity = createLocalAuth("test");
		const connA = connectDatabase("test");
		const connB = connectDatabase("test");
		const owner = await actor(identity, "owner", []);
		await enroll(owner.browser, owner.password);
		const [wh] = await identity.sql<{ id: string }[]>`
			insert into app.warehouse (name, city) values ('Synthetic S15 Race Warehouse', 'Malang') returning id
		`;
		const reservations: string[] = [];

		const callAdmin = async (
			domain: "catalog" | "inventory",
			path: string,
			body: Record<string, unknown>,
		) => {
			const req = owner.browser.request(`/api/v1/admin${path}`, body);
			req.headers.set("idempotency-key", randomUUID());
			const res = await (domain === "catalog"
				? handleCatalog
				: handleInventory)(req, identity);
			assert.equal(res.status, 201);
			return res.json();
		};

		try {
			const stockA = await callAdmin("catalog", "/stock-items", {
				sku: `RACE-A-${randomUUID().slice(0, 8)}`.toUpperCase(),
				name: "Shared Race Component A",
			});
			const stockB = await callAdmin("catalog", "/stock-items", {
				sku: `RACE-B-${randomUUID().slice(0, 8)}`.toUpperCase(),
				name: "Bundle Companion Component B",
			});
			const category = await callAdmin("catalog", "/categories", {
				name: "Synthetic Race Category",
				slug: `race-${randomUUID().slice(0, 8)}`,
				parent_id: null,
				attribute_definitions: [],
			});
			const base = {
				attributes: [],
				weight_grams: 100,
				length_mm: 100,
				width_mm: 100,
				height_mm: 100,
				default_warehouse_id: wh.id,
			};
			const product = await callAdmin("catalog", "/products", {
				name: "Synthetic Competing Offers",
				category_id: category.id,
				description: "Two offers sharing last physical unit",
				images: [],
				variants: [
					{
						...base,
						sku: `U-${randomUUID().slice(0, 8)}`.toUpperCase(),
						label: "Unit Offer",
						offer_kind: "unit",
						contents: [
							{ stock_item_id: stockA.id, name: stockA.name, quantity: 1 },
						],
					},
					{
						...base,
						sku: `B-${randomUUID().slice(0, 8)}`.toUpperCase(),
						label: "Bundle Offer",
						offer_kind: "bundle",
						contents: [
							{ stock_item_id: stockA.id, name: stockA.name, quantity: 1 },
							{ stock_item_id: stockB.id, name: stockB.name, quantity: 1 },
						],
					},
				],
			});
			const unitOffer = product.variants.find(
				(v: { offer_kind: string }) => v.offer_kind === "unit",
			);
			const bundleOffer = product.variants.find(
				(v: { offer_kind: string }) => v.offer_kind === "bundle",
			);
			const posA = await callAdmin("inventory", "/inventory/positions", {
				warehouse_id: wh.id,
				stock_item_id: stockA.id,
				lot_id: null,
			});
			await callAdmin("inventory", "/inventory/positions", {
				warehouse_id: wh.id,
				stock_item_id: stockB.id,
				lot_id: null,
			});
			await callAdmin("inventory", "/inventory/movements", {
				warehouse_id: wh.id,
				stock_item_id: stockA.id,
				kind: "receive",
				quantity: 1,
				expected_version: 0,
				reason: "Single shared unit",
			});
			await callAdmin("inventory", "/inventory/movements", {
				warehouse_id: wh.id,
				stock_item_id: stockB.id,
				kind: "receive",
				quantity: 1,
				expected_version: 0,
				reason: "Companion unit",
			});

			let releaseLock = () => {};
			let readyLock = () => {};
			const held = new Promise<void>((r) => {
				releaseLock = r;
			});
			const locked = new Promise<void>((r) => {
				readyLock = r;
			});
			const blocker = identity.sql.begin(async (tx) => {
				await tx`select id from app.inventory_balance where id = ${posA.id} for update`;
				readyLock();
				await held;
			});
			await locked;

			const expires = new Date(Date.now() + 60000).toISOString();
			const pending = Promise.allSettled([
				connA.sql.begin((tx) =>
					reserveOffers(tx, {
						key: `race-a:${randomUUID()}`,
						lines: [
							{
								line_id: randomUUID(),
								product_id: product.id,
								product_revision: 1,
								offer_id: unitOffer.id,
								warehouse_id: wh.id,
								quantity: 1,
							},
						],
						expires_at: expires,
						actor_id: owner.id,
					}),
				),
				connB.sql.begin((tx) =>
					reserveOffers(tx, {
						key: `race-b:${randomUUID()}`,
						lines: [
							{
								line_id: randomUUID(),
								product_id: product.id,
								product_revision: 1,
								offer_id: bundleOffer.id,
								warehouse_id: wh.id,
								quantity: 1,
							},
						],
						expires_at: expires,
						actor_id: owner.id,
					}),
				),
			]);

			let waiting = 0;
			for (let i = 0; i < 100; i++) {
				const [row] = await identity.sql<{ n: number }[]>`
					select count(*)::int as n
					from pg_stat_activity
					where datname = '99ribu_test'
						and wait_event_type = 'Lock'
						and query like '%app.inventory_balance b join jsonb_to_recordset%'
				`;
				waiting = row.n;
				if (waiting === 2) break;
				await setTimeout(20);
			}
			assert.equal(waiting, 2);
			releaseLock();
			await blocker;

			const results = await pending;
			const winners = results.filter((r) => r.status === "fulfilled");
			const losers = results.filter((r) => r.status === "rejected");
			assert.equal(winners.length, 1);
			assert.equal(losers.length, 1);
			for (const r of results) {
				if (r.status === "fulfilled") reservations.push(r.value.header.id);
				else assert.equal(r.reason.code, "INSUFFICIENT_STOCK");
			}

			const [bal] = await identity.sql<
				{ on_hand: number; reserved: number; quarantined: number }[]
			>`
				select on_hand, reserved, quarantined from app.inventory_balance where id = ${posA.id}
			`;
			assert.deepEqual(bal, { on_hand: 1, reserved: 1, quarantined: 0 });
			const avail = await identity.sql.begin((tx) =>
				offerAvailability(tx, {
					product_id: product.id,
					product_revision: 1,
					offer_id: unitOffer.id,
					warehouse_id: wh.id,
				}),
			);
			assert.equal(avail, 0);

			observedScenarios["last-component-race"] = {
				ownerSlice: "S15",
				competingConnections: 2,
				winners: winners.length,
				losers: losers.length,
				availableAfterRace: avail,
			};
		} finally {
			for (const resId of reservations) {
				await identity.sql.begin((tx) =>
					releaseReservation(tx, resId, "Cleanup S15 race reservation"),
				);
				await identity.sql`
					delete from app.outbox_job
					where kind = 'inventory.reservation.expire' and payload->>'reservationId' = ${resId}
				`;
			}
			await cleanup(identity, [owner]);
			await identity.sql`update app.warehouse set active = false where id = ${wh.id}`;
			await connA.sql.end();
			await connB.sql.end();
			await identity.sql.end();
		}
	}

	// 6. label-funding-pending (S54) & 7. label-expired-reprint (S55)
	{
		const f = await fulfillmentFixture("cod");
		const sql = f.identity.sql;
		const [parcelA, parcelB] = f.parcels;
		assert.ok(parcelA && parcelB);

		const callOwnerLabel = async (
			path: string,
			body?: Record<string, unknown>,
		) => {
			const req = f.owner.browser.request(path, body);
			if (body !== undefined) req.headers.set("idempotency-key", randomUUID());
			const res = await handleShippingLabels(req, f.identity);
			const ct = res.headers.get("content-type") ?? "";
			if (ct.includes("application/pdf")) {
				return {
					status: res.status,
					bytes: Buffer.from(await res.arrayBuffer()),
					payload: null,
				};
			}
			return {
				status: res.status,
				bytes: null,
				payload: await res.json(),
			};
		};

		try {
			// Scenario 6: label-funding-pending (parcelB has no active issued waybill)
			const blockedLabel = await callOwnerLabel(
				`/api/v1/admin/shipments/${parcelB.shipment_id}/label-jobs`,
				{ format: "thermal_100x150" },
			);
			assert.equal(blockedLabel.status, 409);
			assert.equal(blockedLabel.payload.code, "WAYBILL_REQUIRED");

			const [parcelBArtifacts] = await sql<{ n: number }[]>`
				select count(*)::int as n from app.shipping_label_artifact where shipment_id = ${parcelB.shipment_id}
			`;
			const [parcelBBookings] = await sql<{ n: number }[]>`
				select count(*)::int as n from app.shipment_booking where fulfillment_id = ${parcelB.id}
			`;
			assert.equal(parcelBArtifacts.n, 0);
			assert.equal(parcelBBookings.n, 0);

			observedScenarios["label-funding-pending"] = {
				ownerSlice: "S54",
				status: blockedLabel.status,
				code: blockedLabel.payload.code,
				artifactCount: parcelBArtifacts.n,
				bookingCount: parcelBBookings.n,
			};

			// Scenario 7: label-expired-reprint (parcelA with issued waybill + TEST-NOT-FOR-SHIPPING disclosure watermark)
			const tplRes = await callOwnerLabel(
				"/api/v1/admin/shipping-label-templates",
				{
					name: `test-watermark-${randomUUID().slice(0, 8)}`,
					format: "thermal_100x150",
					privacy_mode: "masked_phone",
					brand_mode: "neutral_partner",
					partner_brand_name: "Mitra Logistik 99ribu",
					disclosure_text:
						"TEST-NOT-FOR-SHIPPING - Hanya untuk pengujian lokal",
				},
			);
			assert.equal(tplRes.status, 201);
			const templateId = tplRes.payload.id as string;

			const bookingA = await f.book(parcelA);
			await f.run(bookingA.creation_job_id);
			for (const cb of await sql<{ callback_job_id: string }[]>`
				select callback_job_id from app.waybill_provider_event where booking_id = ${bookingA.id}
			`) {
				await f.run(cb.callback_job_id);
			}
			const issuedA = await simulateWaybillIssue(sql, "test", bookingA.id);
			await f.run(await ingestWaybillEvent(sql, issuedA));

			const job1 = await callOwnerLabel(
				`/api/v1/admin/shipments/${parcelA.shipment_id}/label-jobs`,
				{ format: "thermal_100x150", template_id: templateId },
			);
			assert.equal(job1.status, 202);
			const artifact1Id = job1.payload.artifact_id as string;

			const pdf1 = await callOwnerLabel(
				`/api/v1/admin/label-artifacts/${artifact1Id}/content`,
			);
			assert.equal(pdf1.status, 200);
			const pdf1Text = pdf1.bytes?.toString("utf8") ?? "";
			assert.ok(pdf1Text.startsWith("%PDF-1.4"));
			assert.ok(pdf1Text.includes("TEST-NOT-FOR-SHIPPING"));

			const initPrint = await callOwnerLabel(
				`/api/v1/admin/shipments/${parcelA.shipment_id}/print-attempts`,
				{
					artifact_id: artifact1Id,
					kind: "initial_print",
					outcome: "completed",
				},
			);
			assert.equal(initPrint.status, 201);

			// Expire artifact1 and trigger safe retrieval + reprint with explicit reason
			await sql`
				update app.shipping_label_artifact
				set expires_at = clock_timestamp() - interval '1 second'
				where id = ${artifact1Id}
			`;

			const job2 = await callOwnerLabel(
				`/api/v1/admin/shipments/${parcelA.shipment_id}/label-jobs`,
				{ format: "thermal_100x150", template_id: templateId },
			);
			assert.equal(job2.status, 202);
			const artifact2Id = job2.payload.artifact_id as string;
			assert.notEqual(artifact2Id, artifact1Id);

			const meta1 = await callOwnerLabel(
				`/api/v1/admin/label-artifacts/${artifact1Id}`,
			);
			const meta2 = await callOwnerLabel(
				`/api/v1/admin/label-artifacts/${artifact2Id}`,
			);
			assert.equal(meta1.payload.status, "expired");
			assert.equal(meta2.payload.status, "valid");
			assert.equal(
				meta2.payload.tracking_number,
				meta1.payload.tracking_number,
			);

			const pdf2 = await callOwnerLabel(
				`/api/v1/admin/label-artifacts/${artifact2Id}/content`,
			);
			assert.equal(pdf2.status, 200);
			const pdf2Text = pdf2.bytes?.toString("utf8") ?? "";
			assert.ok(pdf2Text.startsWith("%PDF-1.4"));
			assert.ok(pdf2Text.includes("TEST-NOT-FOR-SHIPPING"));

			const reprintRes = await callOwnerLabel(
				`/api/v1/admin/shipments/${parcelA.shipment_id}/print-attempts`,
				{
					artifact_id: artifact2Id,
					kind: "reprint",
					outcome: "completed",
					reason: "Artefak label sebelumnya kedaluwarsa, cetak ulang aman",
				},
			);
			assert.equal(reprintRes.status, 201);

			const [bookingCountA] = await sql<{ n: number }[]>`
				select count(*)::int as n from app.shipment_booking where fulfillment_id = ${parcelA.id}
			`;
			assert.equal(bookingCountA.n, 1);

			observedScenarios["label-expired-reprint"] = {
				ownerSlice: "S55",
				expiredArtifactStatus: meta1.payload.status,
				refreshedArtifactStatus: meta2.payload.status,
				sameAwb:
					meta2.payload.tracking_number === meta1.payload.tracking_number,
				bookingCount: bookingCountA.n,
			};
		} finally {
			await f.close();
		}
	}
});

test("S62.3c: canonical ads consent/timeout, support escalation, and shared-device scenarios (8-11)", async () => {
	// 8. ads-consent-denied (S25) & 9. ads-delivery-timeout (S60)
	{
		const f = await advertisingFixture();
		try {
			// Scenario 8: ads-consent-denied
			const deniedClient = new CommerceClient(f.identity);
			await f.consent(deniedClient, deniedChoices);
			const deniedOrder = await f.order(deniedClient);
			const deniedPay = await f.pay(deniedClient, deniedOrder.id);
			assert.equal(await deniedPay.complete(), true);

			const [deniedMoney] = await f.identity.sql<{ payment_status: string }[]>`
				select payment_status from app.commerce_order where id = ${deniedOrder.id}
			`;
			assert.equal(deniedMoney.payment_status, "confirmed");
			const [deniedEvent] = await f.identity.sql<{ id: string }[]>`
				select id from app.commerce_event where order_id = ${deniedOrder.id} and name = 'Purchase'
			`;
			const suppressedRows = await f.identity.sql<
				{ status: string; job_id: string | null }[]
			>`
				select status, job_id from app.ad_event_outbox where event_id = ${deniedEvent.id}
			`;
			assert.equal(suppressedRows.length, 3);
			assert.ok(
				suppressedRows.every(
					(r) => r.status === "suppressed" && r.job_id === null,
				),
			);

			observedScenarios["ads-consent-denied"] = {
				ownerSlice: "S25",
				paymentStatus: deniedMoney.payment_status,
				suppressedPlatforms: suppressedRows.length,
			};

			// Scenario 9: ads-delivery-timeout
			await f.consent(f.client);
			const consentedOrder = await f.order(f.client);
			const consentedPay = await f.pay(f.client, consentedOrder.id);
			assert.equal(await consentedPay.complete(), true);

			const [consentedEvent] = await f.identity.sql<
				{ id: string; occurred_at: string }[]
			>`
				select id, occurred_at from app.commerce_event
				where order_id = ${consentedOrder.id} and name = 'Purchase'
			`;
			const [googleOutbox] = await f.identity.sql<
				{ id: string; job_id: string }[]
			>`
				select id, job_id from app.ad_event_outbox
				where event_id = ${consentedEvent.id} and platform = 'google'
			`;
			await f.identity.sql`
				update app.outbox_job
				set status = 'unknown', attempts = 1, dispatched_at = clock_timestamp(), last_error = 'LEASE_EXPIRED'
				where id = ${googleOutbox.job_id}
			`;

			await handleAdvertisingDiagnostics(
				f.owner.browser.request("/api/v1/admin/advertising/destinations"),
				f.identity,
			);
			const [googleDestination] = await f.identity.sql<{ id: string }[]>`
				select id from app.ad_destination_config where platform = 'google'
			`;
			const googleDiagRes = await handleAdvertisingDiagnostics(
				f.owner.browser.request(
					`/api/v1/admin/advertising/destinations/${googleDestination.id}/diagnostics`,
				),
				f.identity,
				googleDestination.id,
			);
			const googleDiag = await googleDiagRes.json();

			const replayRes = await handleAdvertisingDiagnostics(
				f.owner.browser.request(
					`/api/v1/admin/advertising/destinations/${googleDestination.id}/replays`,
					{
						expected_version: googleDiag.version,
						event_id: consentedEvent.id,
						reason: "Replay terkontrol setelah respons pengiriman hilang",
					},
				),
				f.identity,
				googleDestination.id,
			);
			assert.equal(replayRes.status, 202);
			const replayPayload = await replayRes.json();
			assert.equal(replayPayload.event_id, consentedEvent.id);
			assert.equal(
				replayPayload.occurred_at,
				new Date(consentedEvent.occurred_at).toISOString(),
			);

			const [sinkRow] = await f.identity.sql<
				{
					event_id: string;
					payload: { event_id: string; occurred_at: string };
				}[]
			>`
				select event_id, payload from app.local_ad_sink
				where outbox_id = ${googleOutbox.id} and platform = 'google'
			`;
			assert.equal(sinkRow.event_id, consentedEvent.id);
			assert.equal(
				sinkRow.payload.occurred_at,
				new Date(consentedEvent.occurred_at).toISOString(),
			);

			observedScenarios["ads-delivery-timeout"] = {
				ownerSlice: "S60",
				eventIdPreserved: sinkRow.event_id === consentedEvent.id,
				occurredAtPreserved:
					sinkRow.payload.occurred_at ===
					new Date(consentedEvent.occurred_at).toISOString(),
			};
		} finally {
			await f.close();
		}
	}

	// 10. chat-unknown-send (S41)
	{
		const f = await shippingFixture();
		const csAgent = await actor(f.identity, "customer_service", []);
		await enroll(csAgent.browser, csAgent.password);
		const csClient = new SupportScenarioClient(f.identity);
		for (const [k, v] of csAgent.browser.cookies) csClient.cookies.set(k, v);
		const guestClient = new SupportScenarioClient(f.identity);

		try {
			const boot = await guestClient.call("/api/v1/guest-support-sessions", {
				client_request_id: `req-${randomUUID()}`,
			});
			assert.equal(boot.status, 201);

			const line = f.line("fixture-offer-shirt");
			const conv = await guestClient.call("/api/v1/support/conversations", {
				client_conversation_id: `conv-${randomUUID()}`,
				product_id: line.product_id,
			});
			assert.equal(conv.status, 200);
			const convId = conv.payload.id as string;

			// CS agent claims conversation and writes internal note
			const claim = await csClient.call(
				`/api/v1/admin/support/conversations/${convId}/claims`,
				{ expected_version: 1 },
			);
			assert.equal(claim.status, 200);
			const secretNote = `INTERNAL-CS-NOTE-${randomUUID()}`;
			const noteRes = await csClient.call(
				`/api/v1/admin/support/conversations/${convId}/notes`,
				{ text: secretNote },
			);
			assert.equal(noteRes.status, 200);

			// Customer sends message and retries with same client_message_id after lost response
			const clientMessageId = `msg-${randomUUID()}`;
			const msgBody = {
				client_message_id: clientMessageId,
				text: "Apakah stok kaos ini masih tersedia untuk pengiriman hari ini?",
				attachment_ids: [],
			};
			const send1 = await guestClient.call(
				`/api/v1/support/conversations/${convId}/messages`,
				msgBody,
			);
			const send2 = await guestClient.call(
				`/api/v1/support/conversations/${convId}/messages`,
				msgBody,
			);
			assert.equal(send1.status, 200);
			assert.equal(send2.status, 200);
			assert.equal(send2.payload.id, send1.payload.id);

			const history = await guestClient.call(
				`/api/v1/support/conversations/${convId}/messages`,
			);
			const stream = await guestClient.call(
				`/api/v1/support/conversations/${convId}/events`,
			);
			assert.equal(history.payload.data.length, 1);
			assert.ok(!JSON.stringify(history.payload).includes(secretNote));
			assert.ok(!JSON.stringify(stream.payload).includes(secretNote));

			const [noteCount] = await f.identity.sql<{ n: number }[]>`
				select count(*)::int as n from app.support_internal_note where conversation_id = ${convId}
			`;
			assert.equal(noteCount.n, 1);

			observedScenarios["chat-unknown-send"] = {
				ownerSlice: "S41",
				publicMessageCount: history.payload.data.length,
				internalNoteCount: noteCount.n,
				noteLeakedToCustomer: false,
			};
		} finally {
			await closeFulfillmentActor(f.identity, csAgent);
			await f.close();
		}
	}

	// 11. shared-device-and-guest-link (S46)
	{
		const f = await returnFixture("cod");
		const buyerA = await actor(f.identity, "buyer", []);
		const buyerB = await actor(f.identity, "buyer", []);

		const callAccount = async (
			who: Awaited<ReturnType<typeof actor>>,
			path: string,
			body?: Record<string, unknown>,
		) => {
			const req = who.browser.request(path, body);
			if (body !== undefined) req.headers.set("idempotency-key", randomUUID());
			const res = await handleAccounts(req, f.identity);
			return { status: res.status, payload: await res.json() };
		};

		try {
			const addrA = await callAccount(buyerA, "/api/v1/me/addresses", {
				expected_book_version: 0,
				address: {
					label: "Rumah Buyer A",
					recipient_name: "Pembeli A",
					phone: "081234567890",
					street: "Jl. Privasi Buyer A No. 10",
					district: "Lowokwaru",
					city: "Malang",
					province: "Jawa Timur",
					postcode: "65141",
				},
			});
			assert.equal(addrA.status, 201);

			// Buyer A logs out / terminates all sessions
			const termA = await callAccount(
				buyerA,
				"/api/v1/me/session-terminations",
				{ scope: "all" },
			);
			assert.equal(termA.status, 201);

			const revokedRead = await callAccount(buyerA, "/api/v1/me/addresses");
			assert.equal(revokedRead.status, 401);

			// Buyer B logs in on shared device: sees no Buyer A addresses and is denied unproven guest order link
			const bookB = await callAccount(buyerB, "/api/v1/me/addresses");
			assert.equal(bookB.status, 200);
			assert.equal(bookB.payload.data.length, 0);

			const crossLink = await callAccount(
				buyerB,
				"/api/v1/me/guest-order-link-challenges",
				{
					order_id: f.order.id,
					contact: "+6281999999999",
				},
			);
			assert.equal(crossLink.status, 403);
			assert.equal(crossLink.payload.code, "ORDER_CONTACT_MISMATCH");

			observedScenarios["shared-device-and-guest-link"] = {
				ownerSlice: "S46",
				revokedBuyerAStatus: revokedRead.status,
				buyerBAddressCount: bookB.payload.data.length,
				crossOrderLinkStatus: crossLink.status,
			};
		} finally {
			await closeFulfillmentActor(f.identity, buyerA);
			await closeFulfillmentActor(f.identity, buyerB);
			await f.close();
		}
	}
});

test("S62.3d: canonical replacement affiliate hold, SLA cutoff, and receipt revision scenarios (12-14) + 14-case coverage proof", async () => {
	const simulations = readCanonicalSimulations();
	const expected14Cases = simulations.map((s) => s.case);
	assert.equal(expected14Cases.length, 14);

	// 12. replacement-affiliate-hold (S36/S37)
	{
		const f = await shippingFixture();
		const affiliate = await actor(f.identity, "affiliate", []);
		const sql = f.identity.sql;

		try {
			const enrollReq = affiliate.browser.request("/api/v1/me/affiliate", {
				terms_version: "v1",
				referral_code: `S62-${randomUUID().slice(0, 8).toUpperCase()}`,
				beneficiary_bank_code: "BCA",
				beneficiary_account_number: "1234567890",
				beneficiary_account_holder: "Mitra S62",
			});
			enrollReq.headers.set("idempotency-key", randomUUID());
			const enrollRes = await handleAffiliateProfile(enrollReq, f.identity);
			assert.equal(enrollRes.status, 201);
			const profile = await enrollRes.json();

			const client = new CommerceClient(f.identity);
			const bootRes = new Response(null);
			await bootstrapGuest(f.identity, bootRes, new Request("http://127.0.0.1:3099/api/v1/carts", { method: "POST" }));
			client.absorb(bootRes);
			const guestBuyer = await commerceActor(
				client.request("/api/v1/carts"),
				f.identity,
			);
			assert.ok(guestBuyer);

			const line = f.line("fixture-offer-shirt");
			const createdCart = await sql.begin((tx) =>
				createCart(
					tx,
					client.request("/api/v1/carts", {}),
					f.identity,
					guestBuyer,
					{
						lines: [
							{
								variant_id: line.offer_id,
								quantity: 2,
								expected_publication_id: line.publication_id,
							},
						],
					},
					{ clock_namespace: f.namespace },
				),
			);
			const token = await capability(
				f.identity,
				"cart",
				createdCart.cart.id,
				guestBuyer.id,
				createdCart.cart.cap_issued_at as string,
			);
			const cookieRes = new Response(null);
			setCookie(
				cookieRes,
				`${await prefix(f.identity)}.cart_access`,
				`${createdCart.cart.id}.${token}`,
			);
			client.absorb(cookieRes);

			const quoteInput = {
				cart_id: createdCart.cart.id,
				address: {
					recipient_name: "Pembeli Afiliasi S62",
					phone: "+6281200000077",
					address_line: "Jl. Afiliasi 77",
					destination_id: "test-malang",
					postal_code: "00001",
				},
				contact: { phone: "+6281200000077" },
				payment_method: "prepaid" as const,
			};
			const quote = (await sql.begin((tx) =>
				createQuote(
					tx,
					client.request("/api/v1/checkout/quotes", quoteInput, { version: 1 }),
					f.identity,
					guestBuyer,
					quoteInput,
					{ affiliate_id: profile.id },
				),
			)) as { id: string };

			const submitted = await sql.begin((tx) =>
				submitOrder(
					tx,
					client.request(
						"/api/v1/orders",
						{ quote_id: quote.id },
						{ version: 1 },
					),
					f.identity,
					guestBuyer,
					{ quote_id: quote.id },
				),
			);

			const accrued = await sql.begin((tx) =>
				accrueOrderCommissions(tx, { orderId: submitted.order.id }),
			);
			assert.equal(accrued.length, 2);
			const [u1, u2] = accrued;

			// Set each unit commission to 49500 IDR so together they reach the exact 99000 threshold once both mature
			await sql`
				update app.commission_entry
				set amount_idr = 49500
				where order_id = ${submitted.order.id}
			`;

			const t0 = "2026-06-01T10:00:00.000Z";
			const tReplacement = "2026-06-05T10:00:00.000Z";
			await sql.begin(async (tx) => {
				await recordUnitReceiptMaturity(tx, {
					fulfillmentItemId: u1.fulfillment_item_id,
					receivedAt: t0,
				});
				await recordUnitReceiptMaturity(tx, {
					fulfillmentItemId: u2.fulfillment_item_id,
					receivedAt: t0,
				});
				await holdUnitCommission(tx, {
					fulfillmentItemId: u2.fulfillment_item_id,
					holdReason: "Unit ke-2 diganti melalui pengiriman pengganti",
				});
				await recordReplacementUnitReceiptMaturity(tx, {
					fulfillmentItemId: u2.fulfillment_item_id,
					receivedAt: tReplacement,
				});
			});

			// At original H+10 (2026-06-11), only u1 matures; u2 was reset to replacement H+10 (2026-06-15)
			const maturedOriginal = await sql.begin((tx) =>
				matureEligibleCommissions(tx, {
					affiliateId: profile.id,
					asOf: "2026-06-11T10:00:00.000Z",
				}),
			);
			assert.equal(maturedOriginal.length, 1);
			assert.equal(maturedOriginal[0].id, u1.id);

			const prematureQueue = await sql.begin((tx) =>
				queueEligibleAffiliatePayouts(tx, { affiliateId: profile.id }),
			);
			assert.equal(prematureQueue.length, 0);

			// Advance clock to replacement H+10 (2026-06-15): u2 matures and payout queues at 99000 with no automatic bank transfer
			const maturedReplacement = await sql.begin((tx) =>
				matureEligibleCommissions(tx, {
					affiliateId: profile.id,
					asOf: "2026-06-15T10:00:00.000Z",
				}),
			);
			assert.equal(maturedReplacement.length, 1);
			assert.equal(maturedReplacement[0].id, u2.id);

			const queuedPayouts = await sql.begin((tx) =>
				queueEligibleAffiliatePayouts(tx, { affiliateId: profile.id }),
			);
			assert.equal(queuedPayouts.length, 1);
			assert.equal(Number(queuedPayouts[0].amount_idr), 99000);
			assert.equal(queuedPayouts[0].status, "queued");
			assert.equal(queuedPayouts[0].execution_mode, "manual");
			assert.equal(queuedPayouts[0].transferred_at, null);

			observedScenarios["replacement-affiliate-hold"] = {
				ownerSlice: "S37",
				unaffectedMaturedAtOriginalH10: maturedOriginal.length === 1,
				replacedMaturedAtNewH10: maturedReplacement.length === 1,
				queuedPayoutAmountIdr: Number(queuedPayouts[0].amount_idr),
				payoutStatus: queuedPayouts[0].status,
				automaticBankTransferOccurred: queuedPayouts[0].transferred_at !== null,
			};
		} finally {
			await closeFulfillmentActor(f.identity, affiliate);
			await f.close();
		}
	}

	// 13. worker-crash-catchup (S12)
	{
		const { sql } = connectDatabase("test");
		const reference = randomUUID();
		const kind = `s62.catchup.${randomUUID()}`;
		const key = `s62-catchup:${reference}`;
		let jobId = "";

		try {
			jobId = await sql.begin(async (tx) => {
				await tx`
					insert into app.local_delivery (id, recipient, kind, url, expires_at)
					values (${reference}, ${`catchup-${reference}@example.test`}, 'existing_account', 'http://127.0.0.1:3099/login', now() + interval '1 hour')
				`;
				return enqueueJob(tx, kind, key, { deliveryId: reference }, 3);
			});

			const claim = await claimJob(sql, kind);
			assert.ok(claim);
			assert.equal(claim.id, jobId);
			await markDispatched(sql, claim);

			// Commit effect with original job identity, then simulate worker crash / lease expiry before settleClaim
			await sql`
				update app.local_delivery set delivered_at = clock_timestamp() where id = ${reference}
			`;
			await sql`
				insert into app.audit_event (actor_id, action, subject_id, outcome, reason)
				values (${`lease-effect:${reference}`}, 'local_delivery.send', ${jobId}, 'allowed', 'Committed before worker crash')
			`;
			await sql`
				update app.outbox_job set lease_until = now() - interval '1 second' where id = ${jobId}
			`;
			await expireLeases(sql);

			const [unknownState] = await sql<{ status: string }[]>`
				select status from app.outbox_job where id = ${jobId}
			`;
			assert.equal(unknownState.status, "unknown");

			await sql`
				update app.outbox_job set run_at = now() - interval '1 second' where id = ${jobId}
			`;
			assert.equal(
				await runOneJob(
					sql,
					{
						[kind]: {
							async dispatch() {
								throw new Error("Must not re-dispatch committed effect");
							},
							async reconcile(reconcileClaim) {
								assert.equal(reconcileClaim.id, jobId);
								const [effect] = await sql<{ delivered_at: string | null }[]>`
									select delivered_at from app.local_delivery where id = ${reference}
								`;
								assert.ok(effect?.delivered_at);
								return {
									status: "succeeded",
									receipt: { reference, job_id: reconcileClaim.id },
								};
							},
						},
					},
					jobId,
				),
				true,
			);

			const [completed] = await sql<
				{ status: string; attempts: number; result: { job_id: string } }[]
			>`
				select status, attempts, result from app.outbox_job where id = ${jobId}
			`;
			const [effects] = await sql<{ n: number }[]>`
				select count(*)::int as n from app.audit_event where actor_id = ${`lease-effect:${reference}`}
			`;
			assert.equal(completed.status, "completed");
			assert.equal(completed.result.job_id, jobId);
			assert.equal(effects.n, 1);

			observedScenarios["worker-crash-catchup"] = {
				ownerSlice: "S12",
				jobId,
				reconciledStatus: completed.status,
				effectCount: effects.n,
			};
		} finally {
			if (jobId) await sql`delete from app.outbox_job where id = ${jobId}`;
			await sql`delete from app.local_delivery where id = ${reference}`;
			await sql.end();
		}
	}

	// 14. holiday-calendar-boundaries (S29)
	{
		const f = await fulfillmentCalendarFixture();
		try {
			const firstPolicy = await f.append(0);
			const anchor = f.at(0, "03:00:00.000");
			const original = await f.identity.sql.begin((tx) =>
				packingDeadline(tx, f.warehouseId, anchor),
			);
			assert.equal(original.calendar_version_id, firstPolicy.id);
			assert.equal(original.packing_due_at, f.at(6, "15:00:00.000"));

			const frozenPolicy = await resolvePolicy(
				f.identity.sql,
				"warehouse_calendar",
				f.warehouseId,
				new Date(firstPolicy.effective_at),
			);
			const secondPolicy = await f.append(1, {
				...f.values,
				cutoff_local: "14:00",
				closed_dates: [...f.values.closed_dates, f.localDate(6)],
			});
			const prospective = await f.identity.sql.begin((tx) =>
				packingDeadline(tx, f.warehouseId, anchor),
			);
			assert.equal(prospective.calendar_version_id, secondPolicy.id);
			assert.equal(prospective.packing_due_at, f.at(7, "14:00:00.000"));

			const retained = await f.identity.sql.begin((tx) =>
				coveredOperationalDeadline(
					tx,
					f.warehouseId,
					frozenPolicy,
					original.actionable_at,
					2,
				),
			);
			assert.equal(retained.due_at, original.packing_due_at);

			observedScenarios["holiday-calendar-boundaries"] = {
				ownerSlice: "S29",
				source: f.values.source,
				originalDueAt: original.packing_due_at,
				prospectiveDueAt: prospective.packing_due_at,
				historicalAnchorImmutable: retained.due_at === original.packing_due_at,
			};
		} finally {
			await f.close();
		}
	}

	assert.deepEqual(
		Object.keys(observedScenarios).sort(),
		[...expected14Cases].sort(),
	);
});
