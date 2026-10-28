// S135 audit log redaction (R3 privacy). `app.audit_event.details` was written by ~70 call sites over many
// slices and is free-form JSON: some of it is personal (a buyer's new phone/email in a contact-change challenge,
// bank account numbers on manual transfers, saved-reply text), some is credential-adjacent (proof/evidence
// digests, session ids). A denylist would have to know every bad key that any past or future writer might add.
// This is an ALLOWLIST per action kind instead: only the keys named below leave the server, only as plain
// scalars (or short lists of scalar ids), and an action without an entry exposes no details at all. A new writer
// field therefore stays hidden until someone reviews it and adds it here (fail closed). `redacted` tells the
// reader that something stored was withheld; it never names the withheld keys.

type Leaf = "scalar" | "ids";
type Spec = { [key: string]: Leaf | Spec };

const S: Leaf = "scalar";
const IDS: Leaf = "ids";

// Defence in depth for the policy table itself: no allowlisted key may look like secret material, so a later
// edit that adds `token` or `proof_digest` to a spec fails at import (and in tests) instead of shipping.
const SENSITIVE_KEY =
	/secret|otp|token|proof|password|passcode|hash|hmac|digest|sha256|signature|cookie|authorization|credential|(^|_)session(_id)?$|account_number|bank_reference|target_value|private|api_key|(^|_)code$/i;

const JOB: Spec = {
	job_id: S,
	operation_id: S,
	source_id: S,
	previous_status: S,
	previous_attempts: S,
	previous_max_attempts: S,
	next_max_attempts: S,
	budget_rearmed: S,
	source_absence_verified: S,
};
const VERSIONED: Spec = {
	version: S,
	version_id: S,
	effective_at: S,
	default_application: S,
};
const DESTINATION_STATE: Spec = {
	destination_version: S,
	public_identifier: S,
	paused: S,
};

// Exact action -> allowed keys.
const EXACT: Record<string, Spec> = {
	"finance.reconcile": {
		operation_id: S,
		action: S,
		version: S,
		source_reference: S,
		current_match_id: S,
	},
	"finance.cod_remittance": {
		operation_id: S,
		reference: S,
		gross_amount: S,
		net_amount: S,
		parcels: S,
	},
	// bank_reference and account_number are stored on this event and deliberately not listed.
	"finance.manual_transfer": {
		operation_id: S,
		order_id: S,
		amount: S,
		expected_amount: S,
		transferred_at: S,
		late_transfer: S,
	},
	"finance.autolaris_confirm": {
		operation_id: S,
		order_id: S,
		trx_id: S,
		amount: S,
		expected_amount: S,
	},
	"finance.costs.append": { kind: S, version_id: S, version: S },
	"finance.costs.read": { kind: S },
	"finance.summary.read": { from: S, to: S },
	"finance.contribution.read": { product_revision: S },
	"payout.claim": { operation_id: S, revision: S, amount_idr: S },
	"payout.evidence_upload": {
		operation_id: S,
		evidence_id: S,
		replaced_evidence_id: S,
		media_type: S,
		size_bytes: S,
		revision: S,
	},
	// The stored file digest is proof material and is not listed.
	"payout.evidence_uploaded": { evidence_id: S, size_bytes: S, media_type: S },
	"payout.verify": { operation_id: S, finance_transaction_id: S, amount_idr: S },
	"payout.reconcile": { operation_id: S, status: S },
	"affiliate.enroll": { operation_id: S, terms_version: S },
	"affiliate.beneficiary_change": { operation_id: S, change_id: S, revision: S },
	"affiliate_rate.version": {
		operation_id: S,
		version_id: S,
		version: S,
		basis_points: S,
		effective_at: S,
	},
	"staff_roles.replace": {
		id: S,
		user_id: S,
		roles: IDS,
		warehouse_ids: IDS,
		permissions: IDS,
		version: S,
		previous_roles: IDS,
	},
	// S137: a lookup records only whether an account was found; a reset only whether two-step was on.
	"staff.lookup": { found: S },
	"staff_mfa.reset": { previous_mfa_enabled: S },
	"catalog.product.publish": {
		publication_id: S,
		product_revision: S,
		exception_applied: S,
	},
	"catalog.product.withdraw": { publication_id: S, publication_version: S },
	"catalog.warehouse.create": { origin_key: S },
	"support.classification.set": {
		version: S,
		before: { priority: S, tag_ids: IDS },
		after: { priority: S, tag_ids: IDS },
	},
	"warehouse.pickup_profile": { version: S, changed_fields: IDS, readiness: S },
	"warehouse_calendar.version": VERSIONED,
	"warehouse_calendar.default_apply": { warehouses: S, version_ids: IDS },
	"company_policy.version": VERSIONED,
	"payment_policy.version": VERSIONED,
	"promotion.configure": { version_id: S, version: S },
	// The one-time code and the buyer's new contact value are stored on these events: only the challenge id leaves.
	"guest_order_access.challenge": { challenge_id: S },
	"buyer.contact_change.challenge": { challenge_id: S },
	"buyer.guest_order_link.challenge": { challenge_id: S },
	"outbox.expiry_job.recover": {
		job_id: S,
		kind: S,
		reservation_id: S,
		reservation_status: S,
		attempts: S,
	},
	"auth.undelivered_session.recover": {
		user_id: S,
		session_revoked: S,
		guest_context_id: S,
		guest_context_active: S,
	},
	"local_fixture.orphan_operator.recover": {
		namespace: S,
		recovered_user_ids: IDS,
		revoked_sessions: S,
	},
	// The read of the log itself (see log.ts): filter names, never actor/object values.
	"audit.read": { scope: S, filters: IDS, action_filter: S, page: S, returned: S },
	// S138 buyer account lookup (accounts/lookup.ts): the kind, how many accounts matched and their ids. The
	// searched phone/email is never stored.
	"support.customer_lookup": { kind: S, matches: S, account_ids: IDS },
};

// Action family prefix -> allowed keys (longest prefix wins, exact entries win over both).
const PREFIX: [string, Spec][] = [
	[
		"advertising.destination.",
		{
			platform: S,
			version: S,
			destination_id: S,
			event_id: S,
			outbox_id: S,
			job_id: S,
			destination_version: S,
			delivery_status: S,
			before: DESTINATION_STATE,
			after: DESTINATION_STATE,
		},
	],
	["commerce_exception.", { operation_id: S, exception_id: S }],
	["fulfillment.", { operation_id: S, warehouse_id: S, tracking_id: S }],
	[
		"home_banner.",
		{
			version_id: S,
			version: S,
			byte_size: S,
			width: S,
			height: S,
			created: S,
			order: IDS,
			moved: S,
		},
	],
	["inventory.", { warehouse_ids: IDS }],
	["local.", JOB],
	[
		"refund.",
		{ operation_id: S, version: S, refund_id: S, units: S },
	],
	["replacement.", { operation_id: S, case_id: S, version: S }],
	[
		"return.",
		{
			operation_id: S,
			version: S,
			decision: S,
			result: S,
			units: S,
			goods_records: S,
		},
	],
	["shipping.", { artifact_id: S, attempt_id: S, kind: S, outcome: S }],
	// Saved-reply and tag audit rows keep full before/after snapshots with template text: version only.
	["support.", { version: S }],
	["catalog.", { version: S }],
];

function assertSafe(spec: Spec, where: string) {
	for (const [key, value] of Object.entries(spec)) {
		if (SENSITIVE_KEY.test(key))
			throw new Error(`Audit redaction policy key ${where}.${key} looks sensitive`);
		if (typeof value === "object") assertSafe(value, `${where}.${key}`);
	}
}
for (const [action, spec] of Object.entries(EXACT)) assertSafe(spec, action);
for (const [prefix, spec] of PREFIX) assertSafe(spec, prefix);
PREFIX.sort((a, b) => b[0].length - a[0].length);

/** Actions whose stored subject is a credential-adjacent identifier (a session id): the subject is withheld too. */
const SUBJECT_WITHHELD: Record<string, true> = {
	"auth.undelivered_session.recover": true,
};

export function detailPolicy(action: string): Spec | null {
	if (Object.hasOwn(EXACT, action)) return EXACT[action];
	return PREFIX.find(([prefix]) => action.startsWith(prefix))?.[1] ?? null;
}

// Free text we cannot allowlist (a staff reason, an allowlisted string value): control characters out, bounded
// length, and any unbroken run of 40+ token characters (hex/base64 digests, keys, bearer tokens) masked. UUIDs
// are 36 characters and stay readable.
const TOKEN_RUN = /[A-Za-z0-9_+/=-]{40,}/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
export const MASK = "[disembunyikan]";
export function cleanText(value: string, max: number) {
	const text = value.replace(CONTROL, " ").replace(TOKEN_RUN, MASK).trim();
	return Array.from(text).length > max
		? `${Array.from(text).slice(0, max).join("")}…`
		: text;
}

function scalar(value: unknown): string | number | boolean | null | undefined {
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string") return cleanText(value, 200);
	return undefined;
}

function project(
	stored: unknown,
	spec: Spec,
): { value: Record<string, unknown>; withheld: boolean } {
	const out: Record<string, unknown> = {};
	let withheld = false;
	if (!stored || typeof stored !== "object" || Array.isArray(stored))
		return { value: out, withheld: stored !== undefined && stored !== null };
	for (const [key, raw] of Object.entries(stored as Record<string, unknown>)) {
		const rule = Object.hasOwn(spec, key) ? spec[key] : undefined;
		if (rule === undefined) {
			withheld = true;
			continue;
		}
		if (rule === "scalar") {
			const value = scalar(raw);
			if (value === undefined) withheld = true;
			else out[key] = value;
		} else if (rule === "ids") {
			const list = Array.isArray(raw) ? raw.slice(0, 100) : null;
			const values = list?.map(scalar);
			if (
				!list ||
				!values ||
				values.some((v) => v === undefined || v === null) ||
				(raw as unknown[]).length > 100
			)
				withheld = true;
			else out[key] = values;
		} else {
			const nested = project(raw, rule);
			out[key] = nested.value;
			withheld ||= nested.withheld;
		}
	}
	return { value: out, withheld };
}

/** Allowlisted details of one stored event; `redacted` is true when any stored field was withheld. */
export function redactDetails(action: string, stored: unknown) {
	const spec = detailPolicy(action);
	const empty =
		stored === null ||
		stored === undefined ||
		(typeof stored === "object" &&
			!Array.isArray(stored) &&
			Object.keys(stored as object).length === 0);
	if (!spec) return { details: {}, redacted: !empty };
	const { value, withheld } = project(stored, spec);
	return { details: value, redacted: withheld };
}

const SUBJECT = /^[A-Za-z0-9:_.-]{1,120}$/;
/** The stored subject when it is an opaque identifier; null for a session id or anything shaped like free text. */
export function redactSubject(action: string, subject: string | null) {
	if (subject === null) return { subject: null, redacted: false };
	if (Object.hasOwn(SUBJECT_WITHHELD, action) || !SUBJECT.test(subject))
		return { subject: null, redacted: true };
	return { subject, redacted: false };
}

/**
 * Money actions (DEC-018 Q4: reconcile, payout, refund, cost writes) that a finance reader may see. Money
 * reads (`finance.*.read`), affiliate beneficiary/rate changes, policy writes and everything else are owner-only.
 * `local.*.reconcile` are the host-requested recoveries of the original payment/COD/settlement/refund callbacks.
 */
export const MONEY_ACTIONS = [
	"finance.reconcile",
	"finance.cod_remittance",
	"finance.manual_transfer",
	"finance.autolaris_confirm",
	"finance.costs.append",
	"payout.claim",
	"payout.evidence_upload",
	"payout.evidence_uploaded",
	"payout.verify",
	"payout.reconcile",
	"refund.queue",
	"refund.destination",
	"refund.reconcile",
	"refund.retry",
	"commerce_exception.refund_queue",
	"commerce_exception.refund_retry",
	"commerce_exception.refund_reconcile",
	"commerce_exception.destination",
	"local.payment.reconcile",
	"local.cod.reconcile",
	"local.settlement.reconcile",
	"local.refund.reconcile",
	"local.recovery_refund.reconcile",
] as const;

/**
 * A finance reader needs the same permission the underlying money surface needs (spec 07): reconciliation
 * actions `finance.reconciliation.read`, refund actions `finance.refunds.read`, cost writes `finance.costs.read`.
 * Payout actions follow the finance role alone, as the payout routes do.
 */
const MONEY_ACTION_PERMISSION: Record<(typeof MONEY_ACTIONS)[number], string | null> = {
	"finance.reconcile": "finance.reconciliation.read",
	"finance.cod_remittance": "finance.reconciliation.read",
	"finance.manual_transfer": "finance.reconciliation.read",
	"finance.autolaris_confirm": "finance.reconciliation.read",
	"finance.costs.append": "finance.costs.read",
	"payout.claim": null,
	"payout.evidence_upload": null,
	"payout.evidence_uploaded": null,
	"payout.verify": null,
	"payout.reconcile": null,
	"refund.queue": "finance.refunds.read",
	"refund.destination": "finance.refunds.read",
	"refund.reconcile": "finance.refunds.read",
	"refund.retry": "finance.refunds.read",
	"commerce_exception.refund_queue": "finance.refunds.read",
	"commerce_exception.refund_retry": "finance.refunds.read",
	"commerce_exception.refund_reconcile": "finance.refunds.read",
	"commerce_exception.destination": "finance.refunds.read",
	"local.payment.reconcile": "finance.reconciliation.read",
	"local.cod.reconcile": "finance.reconciliation.read",
	"local.settlement.reconcile": "finance.reconciliation.read",
	"local.refund.reconcile": "finance.refunds.read",
	"local.recovery_refund.reconcile": "finance.refunds.read",
};

/** The money actions a finance grant with these permissions may read. */
export function moneyActionsFor(permissions: readonly string[]) {
	return MONEY_ACTIONS.filter((action) => {
		const needed = MONEY_ACTION_PERMISSION[action];
		return needed === null || permissions.includes(needed);
	});
}
