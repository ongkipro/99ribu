import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { runLeasedJob } from "../../jobs/leases.ts";
import { enqueueJob } from "../../jobs/outbox.ts";
import type { LocalAuth } from "../access/auth.ts";
import {
	assertOrigin,
	privateJson,
	problem,
	readBody,
} from "../access/http.ts";
import { AccessError, getPrincipal, type Principal } from "../access/policy.ts";
import { measurementAllowed, type Platform } from "../consent/choices.ts";
import type { Visitor } from "../consent/context.ts";
import { type Consent, currentConsent } from "../consent/receipts.ts";
import { advertisingAdapter } from "./worker.ts";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS: Platform[] = ["meta", "google", "tiktok"];

const DEFAULT_DESTINATIONS: Record<
	Platform,
	{
		id: string;
		public_identifier: string;
		secret_reference: string;
		destination_version: string;
	}
> = {
	meta: {
		id: "00000000-0000-4000-8000-000000000601",
		public_identifier: "meta-pixel-local-001",
		secret_reference: "secret://local/meta-capi-token",
		destination_version: "local-sink-v1",
	},
	google: {
		id: "00000000-0000-4000-8000-000000000602",
		public_identifier: "AW-LOCAL-001/UPLOAD_CLICKS",
		secret_reference: "secret://local/google-ads-token",
		destination_version: "local-sink-v1",
	},
	tiktok: {
		id: "00000000-0000-4000-8000-000000000603",
		public_identifier: "tiktok-pixel-local-001",
		secret_reference: "secret://local/tiktok-events-token",
		destination_version: "local-sink-v1",
	},
};

const FORBIDDEN_SECRET_KEYS = new Set([
	"secret",
	"secret_value",
	"secret_reference",
	"api_key",
	"access_token",
	"token",
	"private_key",
	"client_secret",
]);

interface DestinationRow {
	id: string;
	platform: Platform;
	destination_version: string;
	paused: boolean;
	public_identifier: string | null;
	secret_reference: string | null;
	revision: number;
	actor_id: string | null;
	reason: string | null;
	updated_at: string;
}

export async function ensureDefaultDestinations(sql: Sql): Promise<void> {
	for (const platform of PLATFORMS) {
		const def = DEFAULT_DESTINATIONS[platform];
		const [existing] = await sql<{ id: string }[]>`
      select id from app.ad_destination_config where platform = ${platform}
    `;
		if (!existing) {
			await sql.begin(async (tx) => {
				const [inserted] = await tx<{ id: string }[]>`
          insert into app.ad_destination_config (
            id, platform, destination_version, paused, public_identifier, secret_reference, revision, actor_id, reason
          ) values (
            ${def.id}::uuid,
            ${platform},
            ${def.destination_version},
            false,
            ${def.public_identifier},
            ${def.secret_reference},
            1,
            'system',
            'Bootstrap konfigurasi tujuan iklan lokal.'
          )
          on conflict (platform) do nothing
          returning id
        `;
				if (inserted) {
					await tx`
            insert into app.ad_destination_version (
              id, destination_id, revision, platform, destination_version, paused, public_identifier, secret_reference, actor_id, reason
            ) values (
              ${randomUUID()}::uuid,
              ${inserted.id}::uuid,
              1,
              ${platform},
              ${def.destination_version},
              false,
              ${def.public_identifier},
              ${def.secret_reference},
              'system',
              'Bootstrap konfigurasi tujuan iklan lokal.'
            )
            on conflict (destination_id, revision) do nothing
          `;
				}
			});
		}
	}
}

// The {destinationId} path parameter is the ad_destination_config row id; platform names are not aliases.
async function resolveDestinationRow(
	sql: Sql,
	destinationId: string,
): Promise<DestinationRow> {
	await ensureDefaultDestinations(sql);
	if (!UUID_RE.test(destinationId)) throw new AccessError(404, "NOT_FOUND");
	const [row] = await sql<DestinationRow[]>`
      select id, platform, destination_version, paused, public_identifier, secret_reference, revision, actor_id, reason, updated_at
      from app.ad_destination_config
      where id = ${destinationId}::uuid
    `;
	if (!row) throw new AccessError(404, "NOT_FOUND");
	return row;
}

async function computePlatformDiagnostics(
	sql: Sql,
	row: DestinationRow,
	fromIso?: string,
	toIso?: string,
) {
	const [clock] = await sql<{ now: string }[]>`select clock_timestamp() as now`;
	const asOf = new Date(clock.now).toISOString();
	const from =
		fromIso ?? new Date(Date.parse(asOf) - 30 * 86400_000).toISOString();
	const to = toIso ?? new Date(Date.parse(asOf) + 60_000).toISOString();
	const platform = row.platform;

	// Outbox status breakdown for this platform
	const outboxRows = await sql<
		{
			id: string;
			event_id: string;
			status: string;
			reason: string;
			job_id: string | null;
			expires_at: string;
			event_name: string;
			order_id: string | null;
			receipt_id: string | null;
			merchandise_amount: string;
			visitor_id: string | null;
			consent_receipt_id: string | null;
			occurred_at: string;
			in_local_sink: boolean;
		}[]
	>`
    select o.id,
           o.event_id,
           o.status,
           o.reason,
           o.job_id,
           o.expires_at,
           e.name as event_name,
           e.order_id,
           e.receipt_id,
           e.merchandise_amount::text as merchandise_amount,
           e.visitor_id,
           e.consent_receipt_id,
           e.occurred_at,
           exists (
             select 1 from app.local_ad_sink s
             where s.outbox_id = o.id and s.platform = o.platform
           ) as in_local_sink
    from app.ad_event_outbox o
    join app.commerce_event e on e.id = o.event_id
    where o.platform = ${platform}
      and e.occurred_at >= ${from}::timestamptz
      and e.occurred_at <= ${to}::timestamptz
    order by e.occurred_at desc, o.id asc
  `;

	let eligibleCount = 0;
	let suppressedCount = 0;
	let queuedCount = 0;
	let acceptedCount = 0;
	let processedCount = 0;
	let quarantinedCount = 0;

	for (const ob of outboxRows) {
		if (
			ob.reason === "eligible" ||
			ob.status === "queued" ||
			ob.status === "accepted"
		) {
			eligibleCount += 1;
		}
		if (ob.status === "suppressed" || ob.status === "cancelled") {
			suppressedCount += 1;
		}
		if (ob.status === "queued") {
			queuedCount += 1;
		}
		if (ob.status === "accepted") {
			acceptedCount += 1;
		}
		if (ob.in_local_sink) {
			processedCount += 1;
		}
		if (ob.status === "quarantined") {
			quarantinedCount += 1;
		}
	}

	// Purchase collection instances vs unique orders
	const purchaseRows = outboxRows.filter((r) => r.event_name === "Purchase");
	const purchaseCollectionInstances = purchaseRows.length;
	const uniqueOrders = new Set(
		purchaseRows.map((r) => r.order_id).filter(Boolean),
	).size;

	const acceptedPurchaseRows = purchaseRows.filter(
		(r) => r.status === "accepted",
	);
	const acceptedPurchaseInstances = acceptedPurchaseRows.length;
	const acceptedUniqueOrders = new Set(
		acceptedPurchaseRows.map((r) => r.order_id).filter(Boolean),
	).size;

	const dispatchedSignalMerchandiseIdr = acceptedPurchaseRows.reduce(
		(sum, r) => sum + Number(r.merchandise_amount ?? 0),
		0,
	);
	const eligibleSignalMerchandiseIdr = purchaseRows
		.filter(
			(r) =>
				r.reason === "eligible" ||
				r.status === "accepted" ||
				r.status === "queued",
		)
		.reduce((sum, r) => sum + Number(r.merchandise_amount ?? 0), 0);
	const suppressedSignalMerchandiseIdr = purchaseRows
		.filter((r) => r.status === "suppressed" || r.status === "cancelled")
		.reduce((sum, r) => sum + Number(r.merchandise_amount ?? 0), 0);

	// Economic receipt gross vs refund vs net merchandise reconciliation
	const [moneyRec] = await sql<
		{
			gross_merchandise: string;
			receipt_count: string;
			unique_receipt_orders: string;
			prepaid_instances: string;
			cod_instances: string;
			refunded_merchandise: string;
			adjustment_merchandise: string;
			adjustment_count: string;
		}[]
	>`
    select
      coalesce((
        select sum(er.merchandise_amount)
        from app.economic_receipt er
        where er.occurred_at >= ${from}::timestamptz and er.occurred_at <= ${to}::timestamptz
      ), 0)::text as gross_merchandise,
      coalesce((
        select count(*)
        from app.economic_receipt er
        where er.occurred_at >= ${from}::timestamptz and er.occurred_at <= ${to}::timestamptz
      ), 0)::text as receipt_count,
      coalesce((
        select count(distinct er.order_id)
        from app.economic_receipt er
        where er.occurred_at >= ${from}::timestamptz and er.occurred_at <= ${to}::timestamptz
      ), 0)::text as unique_receipt_orders,
      coalesce((
        select count(*)
        from app.economic_receipt er
        where er.occurred_at >= ${from}::timestamptz and er.occurred_at <= ${to}::timestamptz
          and er.kind = 'prepaid'
      ), 0)::text as prepaid_instances,
      coalesce((
        select count(*)
        from app.economic_receipt er
        where er.occurred_at >= ${from}::timestamptz and er.occurred_at <= ${to}::timestamptz
          and er.kind = 'cod'
      ), 0)::text as cod_instances,
      (
        coalesce((
          select sum(ra.merchandise_amount)
          from app.refund_allocation ra
          join app.refund r on r.id = ra.refund_id
          where r.created_at >= ${from}::timestamptz and r.created_at <= ${to}::timestamptz
            and r.status = 'completed'
        ), 0) +
        coalesce((
          select sum(rra.merchandise_amount)
          from app.recovery_refund_allocation rra
          join app.recovery_refund rr on rr.id = rra.refund_id
          where rr.created_at >= ${from}::timestamptz and rr.created_at <= ${to}::timestamptz
            and rr.status = 'completed'
        ), 0)
      )::text as refunded_merchandise,
      coalesce((
        select sum(rai.merchandise_refunded)
        from app.refund_adjustment_intent rai
        where rai.recorded_at >= ${from}::timestamptz and rai.recorded_at <= ${to}::timestamptz
      ), 0)::text as adjustment_merchandise,
      coalesce((
        select count(*)
        from app.refund_adjustment_intent rai
        where rai.recorded_at >= ${from}::timestamptz and rai.recorded_at <= ${to}::timestamptz
      ), 0)::text as adjustment_count
  `;

	const grossMerchandiseIdr = Number(moneyRec.gross_merchandise);
	const refundedMerchandiseIdr = Math.max(
		Number(moneyRec.refunded_merchandise),
		Number(moneyRec.adjustment_merchandise),
	);
	const netMerchandiseIdr = Math.max(
		0,
		grossMerchandiseIdr - refundedMerchandiseIdr,
	);
	const unresolvedAdjustments = Number(moneyRec.adjustment_count);

	// Missing identity reporting (redacted counts only — never raw click IDs or PII)
	const ordersWithoutVisitor = purchaseRows.filter((r) => !r.visitor_id).length;
	const ordersWithoutConsent = purchaseRows.filter(
		(r) => r.reason === "no_consent" || r.reason === "withdrawn",
	).length;
	const expiredEventsCount = outboxRows.filter(
		(r) => r.reason === "expired",
	).length;

	const warnings: string[] = [];
	if (row.paused) {
		warnings.push(
			`Pengiriman sinyal ${platform.toUpperCase()} sedang dijeda oleh pemilik.`,
		);
	}
	if (ordersWithoutVisitor > 0 || ordersWithoutConsent > 0) {
		warnings.push(
			`${ordersWithoutVisitor + ordersWithoutConsent} kejadian Purchase tidak dikirim karena tanpa atribusi sesi atau persetujuan (consent).`,
		);
	}
	if (unresolvedAdjustments > 0) {
		warnings.push(
			`${unresolvedAdjustments} penyesuaian pengembalian dana (refund adjustment) tercatat terpisah dari penerimaan awal.`,
		);
	}

	return {
		destination_id: String(row.id),
		platform,
		as_of: asOf,
		from,
		to,
		scope: "company" as const,
		complete: true,
		purchase_collection_instances: purchaseCollectionInstances,
		purchase_instances: purchaseCollectionInstances,
		unique_orders: uniqueOrders,
		accepted_purchase_instances: acceptedPurchaseInstances,
		accepted_unique_orders: acceptedUniqueOrders,
		prepaid_collection_instances: Number(moneyRec.prepaid_instances),
		cod_collection_instances: Number(moneyRec.cod_instances),
		merchandise_value: {
			amount: dispatchedSignalMerchandiseIdr,
			currency: "IDR" as const,
		},
		eligible: eligibleCount,
		suppressed: suppressedCount,
		queued: queuedCount,
		accepted: acceptedCount,
		processed: processedCount,
		quarantined: quarantinedCount,
		// Acceptance != processing != external ad-network attribution (null = unknown externally)
		attributed: null as number | null,
		unresolved_adjustments: unresolvedAdjustments,
		reconciliation: {
			gross_merchandise_amount_idr: grossMerchandiseIdr,
			refunded_merchandise_amount_idr: refundedMerchandiseIdr,
			net_merchandise_amount_idr: netMerchandiseIdr,
			dispatched_purchase_signal_amount_idr: dispatchedSignalMerchandiseIdr,
			eligible_purchase_signal_amount_idr: eligibleSignalMerchandiseIdr,
			suppressed_purchase_signal_amount_idr: suppressedSignalMerchandiseIdr,
			net_signal_merchandise_amount_idr: Math.max(
				0,
				dispatchedSignalMerchandiseIdr - refundedMerchandiseIdr,
			),
			delta_gross_vs_dispatched_idr:
				grossMerchandiseIdr - dispatchedSignalMerchandiseIdr,
			delta_net_vs_dispatched_idr:
				netMerchandiseIdr - dispatchedSignalMerchandiseIdr,
			purchase_collection_instances: purchaseCollectionInstances,
			unique_orders: uniqueOrders,
		},
		missing_identity: {
			orders_without_visitor_session: ordersWithoutVisitor,
			orders_without_consent: ordersWithoutConsent,
			expired_outbox_events: expiredEventsCount,
			total_suppressed_or_missing:
				ordersWithoutVisitor + ordersWithoutConsent + expiredEventsCount,
		},
		warnings,
	};
}

function projectDestination(
	row: DestinationRow,
	diagnostics: Awaited<ReturnType<typeof computePlatformDiagnostics>>,
	versions?: {
		revision: number;
		paused: boolean;
		public_identifier: string | null;
		reason: string | null;
		created_at: string;
	}[],
) {
	return {
		id: String(row.id),
		version: Number(row.revision),
		revision: Number(row.revision),
		platform: row.platform,
		destination_version: String(row.destination_version),
		public_identifier:
			row.public_identifier ??
			DEFAULT_DESTINATIONS[row.platform].public_identifier,
		external_destination_id:
			row.public_identifier ??
			DEFAULT_DESTINATIONS[row.platform].public_identifier,
		conversion_action_id:
			row.platform === "google" ? "UPLOAD_CLICKS_LOCAL" : "",
		...(row.platform === "google"
			? { google_conversion_source: "UPLOAD_CLICKS" as const }
			: {}),
		paused: Boolean(row.paused),
		enabled: !row.paused,
		server_purchase_enabled: !row.paused,
		browser_purchase_enabled: false as const,
		credentials_configured: Boolean(row.secret_reference),
		secret_redacted: true as const,
		updated_at: new Date(row.updated_at).toISOString(),
		eligible: diagnostics.eligible,
		suppressed: diagnostics.suppressed,
		queued: diagnostics.queued,
		accepted: diagnostics.accepted,
		processed: diagnostics.processed,
		attributed: diagnostics.attributed,
		purchase_collection_instances: diagnostics.purchase_collection_instances,
		purchase_instances: diagnostics.purchase_instances,
		unique_orders: diagnostics.unique_orders,
		merchandise_value: diagnostics.merchandise_value,
		reconciliation: diagnostics.reconciliation,
		missing_identity: diagnostics.missing_identity,
		diagnostics,
		...(versions
			? {
					history: versions.map((v) => ({
						version: Number(v.revision),
						paused: Boolean(v.paused),
						public_identifier: v.public_identifier,
						reason: v.reason,
						created_at: new Date(v.created_at).toISOString(),
					})),
				}
			: {}),
	};
}

async function requireOwnerPrincipal(request: Request, identity: LocalAuth) {
	if (
		["authorization", "x-cart-token", "x-order-token"].some((h) =>
			request.headers.has(h),
		)
	) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}
	const principal = await getPrincipal(request, identity);
	if (!principal.roles.includes("owner")) {
		throw new AccessError(403, "FORBIDDEN");
	}
	return principal;
}

export async function listAdvertisingDestinations(
	request: Request,
	identity: LocalAuth,
) {
	const url = new URL(request.url);
	const allowedParams = new Set(["cursor", "limit", "from", "to"]);
	for (const key of url.searchParams.keys()) {
		if (!allowedParams.has(key) || url.searchParams.getAll(key).length !== 1) {
			throw new AccessError(400, "INVALID_INPUT");
		}
	}
	await requireOwnerPrincipal(request, identity);
	await ensureDefaultDestinations(identity.sql);

	const rows = await identity.sql<DestinationRow[]>`
    select id, platform, destination_version, paused, public_identifier, secret_reference, revision, actor_id, reason, updated_at
    from app.ad_destination_config
    order by case platform when 'meta' then 1 when 'google' then 2 when 'tiktok' then 3 else 4 end
  `;

	const from = url.searchParams.get("from") ?? undefined;
	const to = url.searchParams.get("to") ?? undefined;

	const data = [];
	for (const row of rows) {
		const diag = await computePlatformDiagnostics(identity.sql, row, from, to);
		const versions = await identity.sql<
			{
				revision: number;
				paused: boolean;
				public_identifier: string | null;
				reason: string | null;
				created_at: string;
			}[]
		>`
      select revision, paused, public_identifier, reason, created_at
      from app.ad_destination_version
      where destination_id = ${row.id}::uuid
      order by revision desc
    `;
		data.push(projectDestination(row, diag, versions));
	}

	return {
		data,
		pagination: {
			next_cursor: null,
		},
	};
}

export async function getAdvertisingDestination(
	request: Request,
	identity: LocalAuth,
	destinationId: string,
) {
	const url = new URL(request.url);
	const allowedParams = new Set(["from", "to"]);
	for (const key of url.searchParams.keys()) {
		if (!allowedParams.has(key) || url.searchParams.getAll(key).length !== 1) {
			throw new AccessError(400, "INVALID_INPUT");
		}
	}
	await requireOwnerPrincipal(request, identity);
	const row = await resolveDestinationRow(identity.sql, destinationId);

	const rawFrom = url.searchParams.get("from");
	const rawTo = url.searchParams.get("to");
	if ((rawFrom && !rawTo) || (!rawFrom && rawTo)) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	let from: string | undefined;
	let to: string | undefined;
	if (rawFrom && rawTo) {
		const fMs = Date.parse(rawFrom);
		const tMs = Date.parse(rawTo);
		if (
			!Number.isFinite(fMs) ||
			!Number.isFinite(tMs) ||
			fMs >= tMs ||
			tMs - fMs > 366 * 86400_000
		) {
			throw new AccessError(400, "INVALID_INPUT");
		}
		from = new Date(fMs).toISOString();
		to = new Date(tMs).toISOString();
	}

	const diag = await computePlatformDiagnostics(identity.sql, row, from, to);
	const versions = await identity.sql<
		{
			revision: number;
			paused: boolean;
			public_identifier: string | null;
			reason: string | null;
			created_at: string;
		}[]
	>`
    select revision, paused, public_identifier, reason, created_at
    from app.ad_destination_version
    where destination_id = ${row.id}::uuid
    order by revision desc
  `;

	return projectDestination(row, diag, versions);
}

export async function updateAdvertisingDestination(
	request: Request,
	identity: LocalAuth,
	destinationId: string,
) {
	assertOrigin(request);
	const url = new URL(request.url);
	if (url.search) throw new AccessError(400, "INVALID_INPUT");
	const principal = await requireOwnerPrincipal(request, identity);
	const body = await readBody(request);

	for (const k of Object.keys(body)) {
		if (FORBIDDEN_SECRET_KEYS.has(k)) {
			throw new AccessError(400, "SECRET_WRITE_FORBIDDEN");
		}
	}
	if (body.browser_purchase_enabled === true) {
		throw new AccessError(400, "BROWSER_PURCHASE_FORBIDDEN");
	}

	const expectedVersion = body.expected_version;
	if (
		typeof expectedVersion !== "number" ||
		!Number.isInteger(expectedVersion) ||
		expectedVersion < 1
	) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	const reason = typeof body.reason === "string" ? body.reason.trim() : "";
	if (!reason || reason.length > 1000) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	await ensureDefaultDestinations(identity.sql);

	const updated = await identity.sql.begin(async (tx) => {
		const target = await resolveDestinationRow(
			tx as unknown as Sql,
			destinationId,
		);
		const [locked] = await tx<DestinationRow[]>`
      select id, platform, destination_version, paused, public_identifier, secret_reference, revision, actor_id, reason, updated_at
      from app.ad_destination_config
      where id = ${target.id}::uuid
      for update
    `;
		if (!locked) throw new AccessError(404, "NOT_FOUND");
		if (Number(locked.revision) !== expectedVersion) {
			throw new AccessError(409, "VERSION_CONFLICT");
		}
		const nextPublicId =
			typeof body.public_identifier === "string" &&
			body.public_identifier.trim().length > 0
				? body.public_identifier.trim()
				: typeof body.external_destination_id === "string" &&
						body.external_destination_id.trim().length > 0
					? body.external_destination_id.trim()
					: locked.public_identifier;

		const nextDestVersion =
			typeof body.destination_version === "string" &&
			body.destination_version.trim().length > 0
				? body.destination_version.trim()
				: locked.destination_version;

		const nextPaused =
			typeof body.paused === "boolean"
				? body.paused
				: typeof body.enabled === "boolean"
					? !body.enabled
					: locked.paused;

		const nextRevision = Number(locked.revision) + 1;

		const [saved] = await tx<DestinationRow[]>`
      update app.ad_destination_config
      set public_identifier = ${nextPublicId},
          destination_version = ${nextDestVersion},
          paused = ${nextPaused},
          revision = ${nextRevision},
          actor_id = ${principal.id},
          reason = ${reason},
          updated_at = clock_timestamp()
      where id = ${locked.id}::uuid
      returning id, platform, destination_version, paused, public_identifier, secret_reference, revision, actor_id, reason, updated_at
    `;

		await tx`
      insert into app.ad_destination_version (
        id, destination_id, revision, platform, destination_version, paused, public_identifier, secret_reference, actor_id, reason
      ) values (
        ${randomUUID()}::uuid,
        ${saved.id}::uuid,
        ${nextRevision},
        ${saved.platform},
        ${saved.destination_version},
        ${saved.paused},
        ${saved.public_identifier},
        ${saved.secret_reference},
        ${principal.id},
        ${reason}
      )
    `;

		await tx`
      insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
      values (
        ${principal.id},
        'advertising.destination.update',
        ${saved.id},
        'allowed',
        ${reason},
        ${JSON.stringify({
					platform: saved.platform,
					version: nextRevision,
					before: {
						destination_version: locked.destination_version,
						public_identifier: locked.public_identifier,
						paused: locked.paused,
					},
					after: {
						destination_version: saved.destination_version,
						public_identifier: saved.public_identifier,
						paused: saved.paused,
					},
				})}::jsonb
      )
    `;

		return saved;
	});

	const diag = await computePlatformDiagnostics(identity.sql, updated);
	const versions = await identity.sql<
		{
			revision: number;
			paused: boolean;
			public_identifier: string | null;
			reason: string | null;
			created_at: string;
		}[]
	>`
    select revision, paused, public_identifier, reason, created_at
    from app.ad_destination_version
    where destination_id = ${updated.id}::uuid
    order by revision desc
  `;
	return projectDestination(updated, diag, versions);
}

export async function setDestinationPauseState(
	request: Request,
	identity: LocalAuth,
	destinationId: string,
) {
	assertOrigin(request);
	const url = new URL(request.url);
	if (url.search) throw new AccessError(400, "INVALID_INPUT");
	const principal = await requireOwnerPrincipal(request, identity);
	const body = await readBody(request);

	const expectedVersion = body.expected_version;
	if (
		typeof expectedVersion !== "number" ||
		!Number.isInteger(expectedVersion) ||
		expectedVersion < 1
	) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	const reason =
		typeof body.reason === "string"
			? body.reason.trim()
			: "Pembaruan status jeda tujuan iklan.";
	if (!reason || reason.length > 1000) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	// One audited endpoint pauses and resumes; AdPauseInput requires an explicit target state.
	if (typeof body.paused !== "boolean") {
		throw new AccessError(400, "INVALID_INPUT");
	}
	const desiredPause = body.paused;
	await ensureDefaultDestinations(identity.sql);

	const updated = await identity.sql.begin(async (tx) => {
		const target = await resolveDestinationRow(
			tx as unknown as Sql,
			destinationId,
		);
		const [locked] = await tx<DestinationRow[]>`
      select id, platform, destination_version, paused, public_identifier, secret_reference, revision, actor_id, reason, updated_at
      from app.ad_destination_config
      where id = ${target.id}::uuid
      for update
    `;
		if (!locked) throw new AccessError(404, "NOT_FOUND");
		if (Number(locked.revision) !== expectedVersion) {
			throw new AccessError(409, "VERSION_CONFLICT");
		}
		const nextRevision = Number(locked.revision) + 1;
		const [saved] = await tx<DestinationRow[]>`
      update app.ad_destination_config
      set paused = ${desiredPause},
          revision = ${nextRevision},
          actor_id = ${principal.id},
          reason = ${reason},
          updated_at = clock_timestamp()
      where id = ${locked.id}::uuid
      returning id, platform, destination_version, paused, public_identifier, secret_reference, revision, actor_id, reason, updated_at
    `;

		await tx`
      insert into app.ad_destination_version (
        id, destination_id, revision, platform, destination_version, paused, public_identifier, secret_reference, actor_id, reason
      ) values (
        ${randomUUID()}::uuid,
        ${saved.id}::uuid,
        ${nextRevision},
        ${saved.platform},
        ${saved.destination_version},
        ${saved.paused},
        ${saved.public_identifier},
        ${saved.secret_reference},
        ${principal.id},
        ${reason}
      )
    `;

		// Hold or release pending outbox jobs for this platform
		if (desiredPause) {
			await tx`
        update app.outbox_job j
        set run_at = clock_timestamp() + interval '365 days'
        from app.ad_event_outbox o
        where o.job_id = j.id
          and o.platform = ${saved.platform}
          and o.status = 'queued'
          and j.status = 'pending'
      `;
		} else {
			await tx`
        update app.outbox_job j
        set run_at = clock_timestamp()
        from app.ad_event_outbox o
        where o.job_id = j.id
          and o.platform = ${saved.platform}
          and o.status = 'queued'
          and o.expires_at > clock_timestamp()
          and j.status = 'pending'
      `;
		}

		await tx`
      insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
      values (
        ${principal.id},
        ${desiredPause ? "advertising.destination.pause" : "advertising.destination.resume"},
        ${saved.id},
        'allowed',
        ${reason},
        ${JSON.stringify({
					platform: saved.platform,
					version: nextRevision,
					before: { paused: locked.paused },
					after: { paused: saved.paused },
				})}::jsonb
      )
    `;

		return saved;
	});

	const diag = await computePlatformDiagnostics(identity.sql, updated);
	const versions = await identity.sql<
		{
			revision: number;
			paused: boolean;
			public_identifier: string | null;
			reason: string | null;
			created_at: string;
		}[]
	>`
    select revision, paused, public_identifier, reason, created_at
    from app.ad_destination_version
    where destination_id = ${updated.id}::uuid
    order by revision desc
  `;
	return projectDestination(updated, diag, versions);
}

type ReplayTrace = {
	destination_id: string | null;
	platform: Platform | null;
	event_id: string | null;
	outbox_id: string | null;
	job_id: string | null;
};

export async function replayAdvertisingEvent(
	request: Request,
	identity: LocalAuth,
	destinationId: string,
) {
	assertOrigin(request);
	const url = new URL(request.url);
	if (url.search) throw new AccessError(400, "INVALID_INPUT");
	const principal = await requireOwnerPrincipal(request, identity);
	const trace: ReplayTrace = {
		destination_id: null,
		platform: null,
		event_id: null,
		outbox_id: null,
		job_id: null,
	};
	try {
		return await replayWithTrace(
			request,
			identity,
			principal,
			destinationId,
			trace,
		);
	} catch (error) {
		// The replay transaction may have rolled back; this separate row is the failure trace.
		// Once a job was queued the committed request row exists, so this records its result.
		const code = error instanceof AccessError ? error.code : "REPLAY_FAILED";
		try {
			await identity.sql`
        insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
        values (
          ${principal.id},
          ${trace.job_id ? "advertising.destination.replay.result" : "advertising.destination.replay"},
          ${trace.destination_id},
          'denied',
          ${code},
          ${JSON.stringify(trace)}::jsonb
        )
      `;
		} catch {
			// Never mask the original replay error with an audit write failure.
		}
		throw error;
	}
}

async function replayWithTrace(
	request: Request,
	identity: LocalAuth,
	principal: Principal,
	destinationId: string,
	trace: ReplayTrace,
) {
	const actorId = principal.id;
	const body = await readBody(request);

	// Forbid caller-supplied amount/time/event_name overrides
	for (const forbidden of [
		"amount",
		"merchandise_amount",
		"occurred_at",
		"event_name",
		"name",
		"payload",
	]) {
		if (body[forbidden] !== undefined) {
			throw new AccessError(400, "CALLER_OVERRIDE_FORBIDDEN");
		}
	}

	const expectedVersion = body.expected_version;
	if (
		typeof expectedVersion !== "number" ||
		!Number.isInteger(expectedVersion) ||
		expectedVersion < 1
	) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	const reason = typeof body.reason === "string" ? body.reason.trim() : "";
	if (!reason || reason.length > 1000) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	const eventId = typeof body.event_id === "string" ? body.event_id : null;
	const outboxIdInput =
		typeof body.outbox_id === "string" ? body.outbox_id : null;
	if (
		(!eventId || !UUID_RE.test(eventId)) &&
		(!outboxIdInput || !UUID_RE.test(outboxIdInput))
	) {
		throw new AccessError(400, "INVALID_INPUT");
	}

	await ensureDefaultDestinations(identity.sql);
	const destination = await resolveDestinationRow(identity.sql, destinationId);
	trace.destination_id = destination.id;
	trace.platform = destination.platform;
	if (Number(destination.revision) !== expectedVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	if (destination.paused) {
		throw new AccessError(409, "DESTINATION_PAUSED");
	}
	const platform = destination.platform;

	// Locate the outbox row and event
	const [target] = await identity.sql<
		{
			outbox_id: string;
			event_id: string;
			platform: Platform;
			status: string;
			reason: string;
			job_id: string | null;
			expires_at: string;
			occurred_at: string;
			visitor_id: string | null;
			consent_receipt_id: string | null;
			merchandise_amount: string;
		}[]
	>`
    select o.id as outbox_id,
           o.event_id,
           o.platform,
           o.status,
           o.reason,
           o.job_id,
           o.expires_at,
           e.occurred_at,
           e.visitor_id,
           e.consent_receipt_id,
           e.merchandise_amount::text as merchandise_amount
    from app.ad_event_outbox o
    join app.commerce_event e on e.id = o.event_id
    where o.platform = ${platform}
      and (${eventId}::uuid is null or o.event_id = ${eventId}::uuid)
      and (${outboxIdInput}::uuid is null or o.id = ${outboxIdInput}::uuid)
    limit 1
  `;

	if (!target) {
		throw new AccessError(404, "NOT_FOUND");
	}
	trace.event_id = String(target.event_id);
	trace.outbox_id = String(target.outbox_id);

	const [clock] = await identity.sql<
		{ now: string }[]
	>`select clock_timestamp() as now`;
	const nowMs = Date.parse(clock.now);

	// Check consent & suppression first
	if (
		target.status === "suppressed" ||
		target.status === "cancelled" ||
		target.reason === "no_consent" ||
		target.reason === "withdrawn" ||
		target.reason === "source_not_eligible"
	) {
		if (target.reason === "expired") {
			throw new AccessError(409, "EVENT_EXPIRED");
		}
		throw new AccessError(409, "CONSENT_SUPPRESSED");
	}

	if (target.status === "quarantined") {
		throw new AccessError(409, "EVENT_QUARANTINED");
	}

	// Verify live visitor & current consent & expiry
	const [visitor] = target.visitor_id
		? await identity.sql<
				Visitor[]
			>`select * from app.visitor_session where id = ${target.visitor_id}::uuid`
		: [];
	const consent = visitor
		? await currentConsent(
				identity.sql as unknown as Parameters<typeof currentConsent>[0],
				visitor,
			)
		: null;
	const [captured] = target.consent_receipt_id
		? await identity.sql<
				Consent[]
			>`select * from app.consent_receipt where id = ${target.consent_receipt_id}::uuid`
		: [];

	if (
		!visitor ||
		!consent ||
		!captured ||
		!measurementAllowed(consent.choices, platform) ||
		!measurementAllowed(captured.choices, platform)
	) {
		throw new AccessError(409, "CONSENT_SUPPRESSED");
	}

	if (
		Date.parse(target.expires_at) <= nowMs ||
		visitor.status !== "active" ||
		Date.parse(visitor.expires_at) <= nowMs ||
		Date.parse(consent.expires_at) <= nowMs
	) {
		throw new AccessError(409, "EVENT_EXPIRED");
	}

	// If already accepted in local_ad_sink, return idempotent replay confirmation preserving original identity
	if (target.status === "accepted") {
		const opId = target.job_id ?? target.outbox_id;
		return {
			operation_id: String(opId),
			status: "queued" as const,
			delivery_status: "accepted" as const,
			replayed: false,
			event_id: String(target.event_id),
			outbox_id: String(target.outbox_id),
			occurred_at: new Date(target.occurred_at).toISOString(),
			status_url: `/api/v1/operations/${opId}`,
		};
	}

	// Prepare outbox_job for controlled replay
	const jobId = await identity.sql.begin(async (tx) => {
		let jId = target.job_id;
		if (!jId) {
			jId = await enqueueJob(
				tx,
				"advertising.dispatch",
				`ad-dispatch:${target.outbox_id}`,
				{
					outboxId: target.outbox_id,
				},
			);
		} else {
			await tx`
        update app.outbox_job
        set status = 'pending',
            run_at = clock_timestamp(),
            lease_token = null,
            lease_until = null,
            dispatched_at = null,
            completed_at = null,
            last_error = null,
            attempts = 0
        where id = ${jId}::uuid
      `;
		}
		await tx`
      insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
      values (
        ${actorId},
        'advertising.destination.replay',
        ${destination.id},
        'allowed',
        ${reason},
        ${JSON.stringify({ ...trace, job_id: jId, destination_version: Number(destination.revision) })}::jsonb
      )
    `;
		return jId;
	});
	trace.job_id = jobId;

	const [dbRow] = await identity.sql<
		{ name: string }[]
	>`select current_database() as name`;
	const dbTarget: "local" | "test" =
		dbRow.name === "99ribu_test" ? "test" : "local";

	await runLeasedJob(
		identity.sql,
		{ "advertising.dispatch": advertisingAdapter(identity.sql, dbTarget) },
		25000,
		jobId,
	);

	const [afterOutbox] = await identity.sql<
		{ status: string; reason: string }[]
	>`
    select status, reason from app.ad_event_outbox where id = ${target.outbox_id}::uuid
  `;
	if (afterOutbox?.status === "cancelled") {
		if (afterOutbox.reason === "expired")
			throw new AccessError(409, "EVENT_EXPIRED");
		throw new AccessError(409, "CONSENT_SUPPRESSED");
	}

	await identity.sql`
    insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
    values (
      ${actorId},
      'advertising.destination.replay.result',
      ${destination.id},
      'allowed',
      ${reason},
      ${JSON.stringify({ ...trace, delivery_status: afterOutbox?.status ?? "accepted" })}::jsonb
    )
  `;

	return {
		operation_id: String(jobId),
		status: "queued" as const,
		delivery_status: (afterOutbox?.status ?? "accepted") as
			| "accepted"
			| "queued",
		replayed: true,
		event_id: String(target.event_id),
		outbox_id: String(target.outbox_id),
		occurred_at: new Date(target.occurred_at).toISOString(),
		status_url: `/api/v1/operations/${jobId}`,
	};
}

export async function handleAdvertisingDiagnostics(
	request: Request,
	identity: LocalAuth,
	destinationParam?: string,
): Promise<Response> {
	try {
		assertOrigin(request);
		const url = new URL(request.url);
		const segments = url.pathname.split("/").filter(Boolean);
		// /api/v1/admin/advertising/destinations
		if (segments.length === 5 && segments[4] === "destinations") {
			if (request.method === "GET") {
				return privateJson(
					await listAdvertisingDestinations(request, identity),
				);
			}
			if (request.method === "POST") {
				const clone = request.clone();
				const body = await readBody(clone);
				const platform = typeof body.platform === "string" ? body.platform : "";
				if (!(PLATFORMS as string[]).includes(platform)) {
					throw new AccessError(400, "INVALID_INPUT");
				}
				await ensureDefaultDestinations(identity.sql);
				const [target] = await identity.sql<{ id: string }[]>`
          select id from app.ad_destination_config where platform = ${platform}
        `;
				if (!target) throw new AccessError(404, "NOT_FOUND");
				return privateJson(
					await updateAdvertisingDestination(request, identity, target.id),
					201,
				);
			}
		}
		// /api/v1/admin/advertising/destinations/{destinationId}/{diagnostics|pause|replays|versions}
		const destinationId = destinationParam ?? segments[5] ?? "";
		const subAction = segments[6];
		if (
			segments.length === 7 &&
			subAction === "pause" &&
			request.method === "POST"
		) {
			return privateJson(
				await setDestinationPauseState(request, identity, destinationId),
			);
		}
		if (
			segments.length === 7 &&
			subAction === "replays" &&
			request.method === "POST"
		) {
			return privateJson(
				await replayAdvertisingEvent(request, identity, destinationId),
				202,
			);
		}
		if (
			segments.length === 7 &&
			subAction === "diagnostics" &&
			request.method === "GET"
		) {
			return privateJson(
				await getAdvertisingDestination(request, identity, destinationId),
			);
		}
		if (
			segments.length === 7 &&
			subAction === "versions" &&
			request.method === "POST"
		) {
			return privateJson(
				await updateAdvertisingDestination(request, identity, destinationId),
				201,
			);
		}
		throw new AccessError(404, "NOT_FOUND");
	} catch (error) {
		return problem(error);
	}
}
