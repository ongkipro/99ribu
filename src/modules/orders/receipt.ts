import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { assertOrigin, privateJson, problem } from "../access/http.ts";
import { AccessError } from "../access/policy.ts";
import { id, invalid } from "../catalog/validation.ts";
import {
	type CommerceActor,
	commerceActor,
	cookie,
	digest,
	prefix,
} from "../checkout/access.ts";
import {
	authorizeOrder,
	type OrderRow,
	projectOrder,
} from "../checkout/orders.ts";
import type { QuoteDocument } from "../checkout/quotes.ts";
import { projectAttempt } from "../payments/attempts.ts";
import { projectCodCollections } from "../payments/cod.ts";
import { handlePayments } from "../payments/routes.ts";
import { projectBuyerRefund } from "../returns/refunds.ts";
import {
	assertCheckoutTransport,
	checkoutApiRequest,
} from "../storefront/checkout.ts";
import {
	type CheckoutAttempt,
	type CheckoutIssuedCookie,
	type CheckoutPaymentState,
	checkoutIssuedCookies,
	initialCheckoutPayment,
	recoverCheckoutOrder,
} from "../storefront/checkout-order.ts";

export type ProjectedOrder = Awaited<ReturnType<typeof projectOrder>>;
export type ReceiptCollection = {
	id: string;
	shipment_id: string;
	status: "pending" | "verified" | "unknown" | "refunded";
	merchandise_amount: number;
	shipping_and_fees_amount: number;
	occurred_at: string | null;
};
export type ReceiptRefund = {
	id: string;
	status:
		| "awaiting_destination"
		| "pending"
		| "unknown"
		| "succeeded"
		| "failed";
	amount: number;
	order_item_ids: string[];
	confirmed_at: string | null;
};
export type ReceiptNextAction = {
	kind:
		| "check_original_payment"
		| "retry_supported_payment"
		| "track_parcel"
		| "open_return"
		| "open_support";
	resource_id: string;
	enabled: boolean;
	reason: string;
};
export type ReceiptShipToSnapshot = {
	recipient_name: string;
	phone_masked: string;
	address_line: string;
	destination_id: string;
	province: string;
	city: string;
	district: string;
	subdistrict: string;
	postal_code: string;
	rt?: string;
	rw?: string;
	landmark?: string;
	snapshot_at: string;
};
export type OrderReceipt = {
	order: ProjectedOrder;
	as_of: string;
	version: number;
	money_basis: "frozen_order_totals_and_verified_allocations";
	collections: ReceiptCollection[];
	refunds: ReceiptRefund[];
	next_actions: ReceiptNextAction[];
	last_checked_at: string;
	payment_state:
		| "pending"
		| "confirmed"
		| "expired"
		| "failed"
		| "unknown"
		| "partially_refunded"
		| "refunded";
	payment_attempt_id: string | null;
	collections_complete: boolean;
	refunds_complete: boolean;
	ship_to: ReceiptShipToSnapshot;
};
export type OrderReceiptView =
	| {
			kind: "ready";
			receipt: OrderReceipt;
			attempt: CheckoutAttempt | null;
			attemptUnavailable: boolean;
			shouldObserve: boolean;
	  }
	| {
			kind: "denied" | "unavailable";
			receipt: null;
			attempt: null;
			attemptUnavailable: true;
			code: string;
	  };

export const orderReceiptPath = (orderId: string) => `/pesanan/${id(orderId)}`;
export const maskReceiptPhone = (phone: string) => `+62••••${phone.slice(-4)}`;

export async function receiptIssuedCookies(
	identity: LocalAuth,
	orderId: string,
	issued: string[],
): Promise<CheckoutIssuedCookie[]> {
	const order = id(orderId),
		p = await prefix(identity),
		base = await checkoutIssuedCookies(identity, order, issued);
	if (!base.length) return [];
	return [
		base[0],
		{ ...base[0], name: `${p}.receipt_access`, path: orderReceiptPath(order) },
	];
}

export async function allOrderIssuedCookies(
	identity: LocalAuth,
	orderId: string,
	issued: string[],
): Promise<CheckoutIssuedCookie[]> {
	const order = id(orderId),
		p = await prefix(identity),
		base = await checkoutIssuedCookies(identity, order, issued);
	if (!base.length) return [];
	return [
		...base,
		{ ...base[0], name: `${p}.receipt_access`, path: orderReceiptPath(order) },
	];
}

export async function orderReceiptRequest(
	request: Request,
	identity: LocalAuth,
	orderId: string,
) {
	const p = await assertCheckoutTransport(request, identity),
		order = id(orderId);
	if (new URL(request.url).pathname !== orderReceiptPath(order))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	const alias = `${p}.receipt_access`,
		native = `${p}.order_access`;
	const pointer = cookie(request, alias),
		original = cookie(request, native);
	if (original !== null && (pointer === null || original !== pointer))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	if (
		pointer !== null &&
		!new RegExp(`^${order}\\.[A-Za-z0-9_-]{43}$`).test(pointer)
	)
		throw new AccessError(401, "UNAUTHENTICATED");
	const pairs = (request.headers.get("cookie") ?? "")
		.split(";")
		.map((v) => v.trim())
		.filter(
			(v) => v && !v.startsWith(`${alias}=`) && !v.startsWith(`${native}=`),
		);
	if (pointer !== null) pairs.push(`${native}=${pointer}`);
	const headers = new Headers(request.headers);
	headers.set("cookie", pairs.join("; "));
	headers.delete("content-length");
	return new Request(request.url, { method: request.method, headers });
}

export async function projectOrderReceipt(
	tx: TransactionSql,
	orderId: string,
): Promise<{ receipt: OrderReceipt; attempt: CheckoutAttempt | null }> {
	const [o] = await tx<
		OrderRow[]
	>`select * from app.commerce_order where id=${id(orderId)} for share`;
	if (!o) throw new AccessError(404, "NOT_FOUND");
	const order = await projectOrder(tx, o.id);
	const [clock] = await tx<
		{ now: string }[]
	>`select app.reservation_clock(${o.clock_namespace})::text as now`;
	const asOf = new Date(clock.now).toISOString();
	const [quote] = await tx<
		{ document: QuoteDocument }[]
	>`select document from app.checkout_quote where id=${o.quote_id}`;
	if (!quote?.document?.address) throw new AccessError(503, "ORDER_INVALID");
	const addr = quote.document.address;
	const ship_to: ReceiptShipToSnapshot = {
		recipient_name: addr.recipient_name,
		phone_masked: maskReceiptPhone(addr.phone),
		address_line: addr.address_line,
		destination_id: addr.destination_id,
		province: addr.province,
		city: addr.city,
		district: addr.district,
		subdistrict: addr.subdistrict,
		postal_code: addr.postal_code,
		snapshot_at: new Date(o.created_at).toISOString(),
	};
	let attempt: CheckoutAttempt | null = null;
	let attemptCount = 0;
	if (o.payment_method === "prepaid") {
		const [latest] = await tx<
			{ id: string }[]
		>`select id from app.payment_attempt where order_id=${o.id} order by created_at desc,(status in ('confirmed','pending','unknown')) desc,id desc limit 1`;
		const [countRow] = await tx<
			{ n: number }[]
		>`select count(*)::int n from app.payment_attempt where order_id=${o.id}`;
		attemptCount = countRow?.n ?? 0;
		if (latest) attempt = await projectAttempt(tx, o.id, latest.id);
	}
	const collections: ReceiptCollection[] = [];
	let collectionsComplete = true;
	let codRefused = false;
	const originalShipments = order.shipments.filter(
		(s) => s.kind === "original",
	);
	const fallbackShipmentId =
		originalShipments[0]?.id ?? order.shipments[0]?.id ?? o.id;
	// DEC-008: a manual-bank unique code is a buyer-paid charge frozen per parcel; it is shown
	// inside each parcel's shipping-and-fees figure so the rows sum to the amount transferred.
	const parcelCharges = new Map(
		(
			await tx<
				{ id: string; payment_charge: string }[]
			>`select id,payment_charge from app.order_shipment where order_id=${o.id}`
		).map((r) => [String(r.id), Number(r.payment_charge)]),
	);
	const prepaidFees = (s: { id: string; buyer_shipping_amount: number }) =>
		s.buyer_shipping_amount + (parcelCharges.get(s.id) ?? 0);
	if (o.payment_method === "prepaid") {
		const receipts = await tx<
			{
				id: string;
				shipment_id: string | null;
				merchandise_amount: string;
				buyer_shipping: string;
				occurred_at: string;
			}[]
		>`select id,shipment_id,merchandise_amount,buyer_shipping,occurred_at from app.economic_receipt where order_id=${o.id} and kind='prepaid' order by occurred_at asc,id asc limit 51`;
		collectionsComplete = receipts.length <= 50;
		if (receipts.length) {
			const paidAt = new Date(receipts[0].occurred_at).toISOString();
			const isRefunded =
				(order.refund_total > 0 && order.refund_total >= order.buyer_total) ||
				o.payment_status === "refunded";
			for (const s of originalShipments.slice(0, 50)) {
				const sMerch = s.items
					.filter((i) => !i.cancelled)
					.reduce((sum, u) => {
						const item = order.items.find((it) => it.id === u.order_item_id);
						return sum + (item ? item.unit_price * u.quantity : 0);
					}, 0);
				collections.push({
					id: String(receipts[0].id),
					shipment_id: s.id,
					status: isRefunded ? "refunded" : "verified",
					merchandise_amount: sMerch,
					shipping_and_fees_amount: prepaidFees(s),
					occurred_at: paidAt,
				});
			}
		} else {
			const st: ReceiptCollection["status"] =
				attempt?.status === "unknown"
					? "unknown"
					: attempt?.status === "confirmed"
						? "verified"
						: "pending";
			for (const s of originalShipments.slice(0, 50)) {
				const sMerch = s.items
					.filter((i) => !i.cancelled)
					.reduce((sum, u) => {
						const item = order.items.find((it) => it.id === u.order_item_id);
						return sum + (item ? item.unit_price * u.quantity : 0);
					}, 0);
				collections.push({
					id: attempt?.id ?? s.id,
					shipment_id: s.id,
					status: st,
					merchandise_amount: sMerch,
					shipping_and_fees_amount: prepaidFees(s),
					occurred_at: null,
				});
			}
			if (!collections.length) {
				collections.push({
					id: attempt?.id ?? o.id,
					shipment_id: fallbackShipmentId,
					status: st,
					merchandise_amount: order.merchandise_total,
					shipping_and_fees_amount:
						Math.max(0, order.shipping_total - order.subsidy_total) +
						order.payment_charge_total,
					occurred_at: null,
				});
			}
		}
	} else {
		const [confirmedCod] =
			await tx`select order_id from app.cod_confirmation where order_id=${o.id}`;
		if (confirmedCod) {
			const cod = await projectCodCollections(tx, o.id);
			collectionsComplete = cod.parcels.length <= 50;
			for (const p of cod.parcels.slice(0, 50)) {
				if (p.status === "refused") codRefused = true;
				collections.push({
					id: String(p.receipt_id ?? p.id),
					shipment_id: String(p.id),
					status:
						p.status === "collected"
							? "verified"
							: p.status === "reconciliation"
								? "unknown"
								: "pending",
					merchandise_amount: p.merchandise_amount,
					// DEC-009: the buyer-paid COD fee is collected with shipping by the courier.
					shipping_and_fees_amount: p.buyer_shipping_amount + p.cod_fee_amount,
					occurred_at: p.collected_at,
				});
			}
		} else {
			const rows = await tx<
				{ id: string; merchandise_amount: string; buyer_shipping: string; payment_charge: string }[]
			>`select id,merchandise_amount,buyer_shipping,payment_charge from app.order_shipment where order_id=${o.id} order by parcel_id,id limit 51`;
			collectionsComplete = rows.length <= 50;
			for (const s of rows.slice(0, 50))
				collections.push({
					id: String(s.id),
					shipment_id: String(s.id),
					status: "pending",
					merchandise_amount: Number(s.merchandise_amount),
					shipping_and_fees_amount: Number(s.buyer_shipping) + Number(s.payment_charge),
					occurred_at: null,
				});
		}
	}
	const refunds: ReceiptRefund[] = [];
	let refundsComplete = true;
	const [schema] = await tx<
		{ installed: boolean }[]
	>`select to_regclass('app.refund') is not null installed`;
	if (schema.installed) {
		const refundRows = await tx<
			{ id: string; status: string; cash_at: string | null }[]
		>`select r.id,r.status,(select max(e.occurred_at)::text from app.refund_event e where e.refund_id=r.id and e.status='succeeded') cash_at from app.refund r where r.order_id=${o.id} order by r.created_at desc,r.id desc limit 51`;
		refundsComplete = refundRows.length <= 50;
		for (const row of refundRows.slice(0, 50)) {
			const projected = await projectBuyerRefund(tx, row.id);
			const itemIds = await tx<
				{ order_item_id: string }[]
			>`select distinct fi.order_item_id from app.refund_allocation ra join app.return_item ri on ri.id=ra.return_item_id join app.order_fulfillment_item fi on fi.id=ri.fulfillment_item_id where ra.refund_id=${row.id}`;
			const mappedStatus: ReceiptRefund["status"] =
				projected.status === "queued" || projected.status === "processing"
					? "pending"
					: (projected.status as ReceiptRefund["status"]);
			refunds.push({
				id: projected.id,
				status: mappedStatus,
				amount: projected.amount,
				order_item_ids: itemIds.map((i) => String(i.order_item_id)),
				confirmed_at:
					mappedStatus === "succeeded" && row.cash_at
						? new Date(row.cash_at).toISOString()
						: null,
			});
		}
	}
	const paymentState: OrderReceipt["payment_state"] =
		(order.refund_total > 0 && order.refund_total >= order.buyer_total) ||
		o.payment_status === "refunded"
			? "refunded"
			: o.payment_status === "partially_refunded" || order.refund_total > 0
				? "partially_refunded"
				: attempt?.status === "unknown" ||
						collections.some((c) => c.status === "unknown")
					? "unknown"
					: o.payment_status === "expired" ||
							(o.status === "cancelled" && o.payment_status === "pending")
						? "expired"
						: (attempt?.status === "failed" &&
									o.payment_status === "pending") ||
								codRefused
							? "failed"
							: o.payment_status === "confirmed"
								? "confirmed"
								: "pending";
	const next_actions: ReceiptNextAction[] = [];
	if (o.payment_method === "prepaid") {
		if (attempt && ["pending", "unknown"].includes(attempt.status)) {
			next_actions.push({
				kind: "check_original_payment",
				resource_id: attempt.id,
				enabled: true,
				reason: "Periksa status percobaan pembayaran yang sudah dibuat.",
			});
		}
		if (
			o.status === "pending" &&
			o.payment_status === "pending" &&
			Date.parse(o.expires_at) > Date.parse(asOf) &&
			(!attempt || ["failed", "expired"].includes(attempt.status))
		) {
			next_actions.push({
				kind: "retry_supported_payment",
				resource_id: o.id,
				enabled: attemptCount < 5,
				reason:
					attemptCount < 5
						? "Siapkan instruksi pembayaran untuk pesanan yang masih berlaku."
						: "Batas 5 percobaan pembayaran untuk pesanan ini telah tercapai.",
			});
		}
	}
	for (const s of order.shipments.slice(0, 15)) {
		next_actions.push({
			kind: "track_parcel",
			resource_id: s.id,
			enabled: Boolean(s.tracking_number),
			reason: s.tracking_number
				? `Nomor resi ${s.tracking_number} tersedia untuk pelacakan pengiriman.`
				: "Nomor resi akan ditampilkan setelah pengiriman diterbitkan gudang.",
		});
	}
	if (order.items.some((i) => i.received_quantity > 0)) {
		next_actions.push({
			kind: "open_return",
			resource_id: o.id,
			enabled: true,
			reason:
				"Barang yang sudah diterima dapat diajukan pemeriksaan retur sesuai kebijakan.",
		});
	}
	next_actions.push({
		kind: "open_support",
		resource_id: o.id,
		enabled: true,
		reason: "Bantuan pelanggan menggunakan referensi pesanan ini.",
	});
	return {
		receipt: {
			order,
			as_of: asOf,
			version: order.version,
			money_basis: "frozen_order_totals_and_verified_allocations",
			collections,
			refunds,
			next_actions: next_actions.slice(0, 20),
			last_checked_at: asOf,
			payment_state: paymentState,
			payment_attempt_id: attempt?.id ?? null,
			collections_complete: collectionsComplete,
			refunds_complete: refundsComplete,
			ship_to,
		},
		attempt,
	};
}

export async function authorizeOrderOrContinuity(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	actor: CommerceActor | null,
	orderId: string,
): Promise<OrderRow> {
	const target = id(orderId);
	try {
		return await authorizeOrder(tx, request, identity, actor, target);
	} catch (error) {
		if (!(error instanceof AccessError) || ![401, 404].includes(error.status))
			throw error;
		if (actor?.kind === "user") {
			const [linked] = await tx<
				{ id: string }[]
			>`select id from app.buyer_identity_challenge where user_id=${actor.id} and kind='guest_order_link' and status='verified' and order_id=${target} limit 1`;
			if (linked) {
				const [order] = await tx<
					OrderRow[]
				>`select * from app.commerce_order where id=${target} for share`;
				if (order) return order;
			}
		}
		const candidateToken = await continuityToken(request, identity);
		if (candidateToken) {
			const tokenDigest = digest(`order-access:${candidateToken}`);
			const [verified] = await tx<
				{ id: string }[]
			>`select id from app.support_challenge where kind='guest_order_access' and order_id=${target} and verified_at is not null and expires_at>clock_timestamp() and target_reference=${tokenDigest} limit 1`;
			if (verified) {
				const [order] = await tx<
					OrderRow[]
				>`select * from app.commerce_order where id=${target} for share`;
				if (order) return order;
			}
		}
		throw error;
	}
}

// Guest order capability travels only in HttpOnly cookies, never query strings (spec 09).
async function continuityToken(request: Request, identity: LocalAuth) {
	return (
		cookie(request, "__Host-99ribu_order") ??
		cookie(request, `${await prefix(identity)}.guest_order_access`)
	);
}

export type OrderContinuityExceptionProposal = {
	case_id: string;
	case_status: string;
	case_version: number;
	proposal_id: string;
	proposal_kind: string;
	proposal_status: string;
	requires_buyer_choice: boolean;
	summary: string;
};

export type OrderContinuityReturnSummary = {
	id: string;
	status: string;
	requested_resolution: "refund" | "replacement";
	resolution: "refund" | "replacement" | null;
	version: number;
	replacement_shipment_ids: string[];
	evidence_count: number;
};

export type OrderContinuityExtras = {
	exception_proposals: OrderContinuityExceptionProposal[];
	return_cases: OrderContinuityReturnSummary[];
	support_conversation_id: string | null;
};

export async function readOrderContinuityExtras(
	identity: LocalAuth,
	orderId: string,
): Promise<OrderContinuityExtras> {
	const target = id(orderId);
	return identity.sql.begin(async (tx) => {
		const exception_proposals: OrderContinuityExceptionProposal[] = [];
		const [hasExceptions] = await tx<
			{ installed: boolean }[]
		>`select to_regclass('app.commerce_exception') is not null installed`;
		if (hasExceptions?.installed) {
			const rows = await tx<
				{
					case_id: string;
					case_status: string;
					case_version: number;
					proposal_id: string;
					proposal_kind: string;
					proposal_status: string;
					requires_buyer_choice: boolean;
					summary: string;
				}[]
			>`
    select c.id case_id,c.status case_status,c.revision case_version,p.id proposal_id,p.kind proposal_kind,p.status proposal_status,
     (c.status='awaiting_buyer' and c.proposal_event_id=p.id) requires_buyer_choice,
     coalesce(p.reason,'Penanganan kendala pesanan memerlukan konfirmasi Anda.') summary
    from app.commerce_exception c
    join app.exception_event p on p.exception_id=c.id and p.kind='propose'
    where c.order_id=${target}
    order by p.occurred_at desc,p.id desc limit 10`;
			for (const r of rows)
				exception_proposals.push({
					...r,
					case_version: Number(r.case_version),
					requires_buyer_choice: Boolean(r.requires_buyer_choice),
				});
		}
		const return_cases: OrderContinuityReturnSummary[] = [];
		const [hasReturns] = await tx<
			{ installed: boolean }[]
		>`select to_regclass('app.return_case') is not null installed`;
		if (hasReturns?.installed) {
			const cases = await tx<
				{
					id: string;
					status: string;
					requested_resolution: "refund" | "replacement";
					resolution: "refund" | "replacement" | null;
					revision: number;
				}[]
			>`
    select id,status,requested_resolution,resolution,revision from app.return_case where order_id=${target} order by created_at desc,id desc limit 10`;
			for (const c of cases) {
				const replacements = await tx<
					{ id: string }[]
				>`select id from app.replacement_shipment where case_id=${c.id} order by id`;
				const [ev] = await tx<
					{ n: number }[]
				>`select count(*)::int n from app.return_evidence where case_id=${c.id} and status='attached'`;
				return_cases.push({
					id: String(c.id),
					status: c.status,
					requested_resolution: c.requested_resolution,
					resolution: c.resolution,
					version: Number(c.revision),
					replacement_shipment_ids: replacements.map((r) => String(r.id)),
					evidence_count: ev?.n ?? 0,
				});
			}
		}
		const [conv] = await tx<
			{ id: string }[]
		>`select id from app.support_conversation where primary_order_id=${target} order by updated_at desc,id desc limit 1`;
		return {
			exception_proposals,
			return_cases,
			support_conversation_id: conv ? String(conv.id) : null,
		};
	});
}

export async function readOrderReceipt(
	request: Request,
	identity: LocalAuth,
	orderId: string,
): Promise<OrderReceiptView> {
	try {
		const targetId = id(orderId);
		const url = new URL(request.url);
		const cleanUrl = new URL(orderReceiptPath(targetId), url.origin);
		const cleanReq = new Request(cleanUrl, {
			method: request.method,
			headers: request.headers,
		});
		const scoped = await orderReceiptRequest(cleanReq, identity, targetId);
		const authorized = await identity.sql.begin(async (tx) => {
			const actor = await commerceActor(scoped, identity);
			return authorizeOrderOrContinuity(tx, scoped, identity, actor, targetId);
		});
		const hasContinuityCredential = Boolean(
			await continuityToken(scoped, identity),
		);
		let attemptUnavailable = false;
		if (authorized.payment_method === "prepaid") {
			const [clock] = await identity.sql<
				{ attempt_id: string | null }[]
			>`select (select a.id from app.payment_attempt a where a.order_id=${authorized.id} order by a.created_at desc,(a.status in ('confirmed','pending','unknown')) desc,a.id desc limit 1) attempt_id`;
			if (clock?.attempt_id) {
				const res = await handlePayments(
						checkoutApiRequest(
							scoped,
							`/api/v1/orders/${authorized.id}/payment-attempts/${clock.attempt_id}`,
							"GET",
						),
						identity,
					),
					data = await res.json();
				if (
					[401, 403, 404].includes(res.status) &&
					authorized.owner_user_id === null &&
					!hasContinuityCredential
				)
					throw new AccessError(res.status, data.code);
				if (!res.ok) attemptUnavailable = true;
			}
		}
		return await identity.sql.begin(async (tx) => {
			const actor = await commerceActor(scoped, identity);
			const current = await authorizeOrderOrContinuity(
				tx,
				scoped,
				identity,
				actor,
				targetId,
			);
			const { receipt, attempt } = await projectOrderReceipt(tx, current.id);
			const [obs] = await tx<
				{ viewed: boolean }[]
			>`select exists(select 1 from app.commerce_event where order_id=${current.id} and name='receipt_viewed') viewed`;
			await authorizeOrderOrContinuity(tx, scoped, identity, actor, current.id);
			const hasVisitorCookie = Boolean(
				cookie(request, `${await prefix(identity)}.visitor`),
			);
			return {
				kind: "ready" as const,
				receipt,
				attempt,
				attemptUnavailable,
				shouldObserve: !obs?.viewed && hasVisitorCookie,
			};
		});
	} catch (error) {
		return {
			kind:
				error instanceof AccessError && error.status < 500
					? "denied"
					: "unavailable",
			receipt: null,
			attempt: null,
			attemptUnavailable: true,
			code: error instanceof AccessError ? error.code : "SERVICE_UNAVAILABLE",
		};
	}
}

export async function handleOrderReceipt(
	request: Request,
	identity: LocalAuth,
) {
	try {
		assertOrigin(request);
		if (
			["authorization", "x-cart-token", "x-order-token"].some((name) =>
				request.headers.has(name),
			)
		)
			throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
		if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
		const url = new URL(request.url);
		if (url.search) throw invalid();
		const match = /^\/api\/v1\/orders\/([^/]+)\/receipt$/.exec(url.pathname);
		if (!match) throw new AccessError(404, "NOT_FOUND");
		const targetId = id(match[1]);
		const receipt = await identity.sql.begin(async (tx) => {
			const actor = await commerceActor(request, identity);
			const current = await authorizeOrderOrContinuity(
				tx,
				request,
				identity,
				actor,
				targetId,
			);
			const projected = await projectOrderReceipt(tx, current.id);
			await authorizeOrderOrContinuity(
				tx,
				request,
				identity,
				actor,
				current.id,
			);
			return projected.receipt;
		});
		return privateJson(receipt, 200);
	} catch (error) {
		return problem(error);
	}
}

export async function prepareOrderReceiptPayment(
	request: Request,
	identity: LocalAuth,
	input: { order: string; key: string },
): Promise<CheckoutPaymentState> {
	const initial = { ...initialCheckoutPayment(input.order), key: input.key };
	try {
		if (request.method !== "POST") throw invalid();
		const scoped = await orderReceiptRequest(request, identity, input.order);
		// DEC-008: the attempt uses the channel frozen on the order.
		const [channel] = await identity.sql<{ method_id: string }[]>`select coalesce(payment_channel,'local-prepaid') method_id from app.commerce_order where id=${id(input.order)}`;
		const response = await handlePayments(
				checkoutApiRequest(
					scoped,
					`/api/v1/orders/${id(input.order)}/payment-attempts`,
					"POST",
					{ method_id: channel?.method_id ?? "local-prepaid" },
					input.key,
				),
				identity,
			),
			data = await response.json();
		if (!response.ok) throw new AccessError(response.status, data.code);
		return {
			...initial,
			phase: "success",
			message:
				"Instruksi pembayaran tersimpan. Periksa status dari halaman ini.",
		};
	} catch (error) {
		const blocked =
				error instanceof AccessError && [401, 403, 404].includes(error.status),
			unknown = !(error instanceof AccessError) || error.status >= 500,
			code = error instanceof AccessError ? error.code : "SERVICE_UNAVAILABLE";
		const message = unknown
			? "Hasil permintaan belum diketahui. Ulangi permintaan yang sama; pesanan tidak dibuat ulang."
			: code === "PAYMENT_ATTEMPT_ACTIVE"
				? "Instruksi sebelumnya masih aktif. Perbarui status pembayaran."
				: code === "PAYMENT_ATTEMPT_LIMIT"
					? "Batas percobaan pembayaran tercapai. Periksa status pesanan."
					: code === "PAYMENT_NOT_AVAILABLE"
						? "Pembayaran ini sudah tidak tersedia. Perbarui status pesanan."
						: blocked
							? "Akses pesanan perlu diperiksa. Buka kembali melalui sesi belanja Anda."
							: "Instruksi belum dapat disiapkan. Periksa status sebelum mencoba lagi.";
		return {
			...initial,
			key: unknown ? input.key : randomUUID(),
			phase: unknown ? "unknown" : "error",
			message,
			code,
			blocked,
		};
	}
}

export async function recoverOrderReceipt(
	request: Request,
	identity: LocalAuth,
	orderId: string,
) {
	return recoverCheckoutOrder(request, identity, orderId);
}
