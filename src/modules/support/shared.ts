import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { mac, prefix } from "../checkout/access.ts";

export type SupportCustomerActor =
	| {
			kind: "user";
			id: string;
			scope: string;
			principal: Principal;
			linkedGuestIds: string[];
	  }
	| {
			kind: "guest";
			id: string;
			scope: string;
			commerceGuestId: string | null;
	  };

export type ConversationRow = {
	id: string;
	buyer_user_id: string | null;
	guest_support_id: string | null;
	primary_product_id: string | null;
	primary_order_id: string | null;
	status: "open" | "waiting_customer" | "resolved";
	assigned_user_id: string | null;
	priority: "low" | "normal" | "high";
	public_sequence: number;
	revision: number;
	last_public_message_at: string | null;
	created_at: string;
	updated_at: string;
};

export type MessageRow = {
	id: string;
	conversation_id: string;
	public_sequence: number;
	sender_side: "buyer" | "customer_service";
	sender_user_id: string | null;
	sender_guest_id: string | null;
	client_message_id: string;
	request_hash: string;
	body: string;
	reply_to_message_id: string | null;
	redacted_at: string | null;
	redacted_reason: string | null;
	created_at: string;
};

export const ALLOWED_PLACEHOLDERS = [
	"customer_name",
	"product_title",
	"order_reference",
] as const;

export const MAX_IMAGE_BYTES = 5_242_880;

// Version history shown per saved reply or tag (OpenAPI maxItems); the audit log keeps every version.
export const HISTORY_LIMIT = 50;

export async function supportCookieName(identity: LocalAuth) {
	return `${await prefix(identity)}.support_guest`;
}

export async function supportChallengeProof(
	identity: LocalAuth,
	challengeId: string,
	kind: "contact_binding" | "session_recovery",
	targetReference: string,
) {
	return mac(identity, "support-challenge", [
		challengeId,
		kind,
		targetReference,
	]);
}

export function escapeExcerpt(raw: string, maxLen = 500) {
	const cleaned = raw
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
		.trim();
	return Array.from(cleaned).slice(0, maxLen).join("");
}

export function slugify(input: string, suffix: string) {
	const base = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return `${base || "item"}-${suffix.slice(0, 8)}`;
}

export async function checkOperation(
	tx: TransactionSql,
	actorId: string,
	action: string,
	key: string,
	requestHash: string,
): Promise<unknown | null> {
	const [prior] = await tx<{ request_hash: string; response: unknown }[]>`
		select request_hash, response
		from app.access_operation
		where actor_id = ${actorId} and action = ${action} and key = ${key}
	`;
	if (!prior) return null;
	if (prior.request_hash !== requestHash)
		throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
	return prior.response;
}

export async function saveOperation(
	tx: TransactionSql,
	actorId: string,
	action: string,
	key: string,
	requestHash: string,
	response: unknown,
) {
	await tx`
		insert into app.access_operation (actor_id, action, key, request_hash, response)
		values (${actorId}, ${action}, ${key}, ${requestHash}, ${JSON.stringify(response)}::jsonb)
		on conflict (actor_id, action, key) do nothing
	`;
}

// Order context card title in the buyer's and staff's language (no raw status codes).
const ORDER_STATUS_ID: Record<string, string> = {
	preparing: "disiapkan",
	pending: "menunggu",
	processing: "diproses",
	partially_completed: "sebagian selesai",
	cancelled: "dibatalkan",
};

export const orderContextTitle = (number: string, status: string) =>
	`Pesanan ${number} (${ORDER_STATUS_ID[status] ?? "status lain"})`;
