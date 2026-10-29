import { timingSafeEqual } from "node:crypto";
import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { AccessError, getPrincipal, type Principal } from "../access/policy.ts";
import { id } from "../catalog/validation.ts";
import {
	type CommerceActor,
	cookie,
	digest,
	lockActor,
	prefix,
} from "../checkout/access.ts";
import type { ConversationRow, SupportCustomerActor } from "./shared.ts";

export async function resolveSupportStaff(
	request: Request,
	identity: LocalAuth,
): Promise<Principal> {
	if (
		request.headers.has("authorization") ||
		request.headers.has("x-cart-token") ||
		request.headers.has("x-order-token")
	) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}
	const principal = await getPrincipal(request, identity);
	if (
		!principal.roles.includes("owner") &&
		!principal.roles.includes("customer_service")
	) {
		throw new AccessError(403, "FORBIDDEN");
	}
	return principal;
}

export function canManageSupportTools(principal: Principal) {
	return (
		principal.roles.includes("owner") ||
		(principal.roles.includes("customer_service") &&
			(principal.permissions as readonly string[]).includes(
				"support.tools.manage",
			))
	);
}

export async function resolveSupportCustomer(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
): Promise<SupportCustomerActor> {
	if (
		request.headers.has("authorization") ||
		request.headers.has("x-cart-token")
	) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}
	const p = await prefix(identity);
	const session = await identity.auth.api.getSession({
		headers: request.headers,
		query: { disableCookieCache: true },
	});
	if (session) {
		const principal = await getPrincipal(request, identity);
		await lockActor(tx, { kind: "user", id: principal.id, principal });
		const linked = await tx<{ id: string }[]>`
			select id from app.guest_support_identity where linked_user_id = ${principal.id}
		`;
		return {
			kind: "user",
			id: principal.id,
			scope: `user:${principal.id}`,
			principal,
			linkedGuestIds: linked.map((r) => r.id),
		};
	}
	if (cookie(request, `${p}.session_token`)) {
		throw new AccessError(401, "UNAUTHENTICATED");
	}
	const raw = cookie(request, `${p}.support_guest`);
	const match =
		raw &&
		/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i.exec(
			raw,
		);
	if (!match) throw new AccessError(401, "UNAUTHENTICATED");
	const [guest] = await tx<
		{
			id: string;
			token_digest: string;
			guest_id: string | null;
			expires_at: string;
		}[]
	>`
		select id, token_digest, guest_id, expires_at
		from app.guest_support_identity
		where id = ${match[1].toLowerCase()}
	`;
	const [clock] = await tx<{ now: string }[]>`select clock_timestamp() as now`;
	if (!guest || new Date(guest.expires_at) <= new Date(clock.now)) {
		throw new AccessError(401, "UNAUTHENTICATED");
	}
	const expectedBuf = Buffer.from(guest.token_digest, "hex");
	const actualBuf = Buffer.from(digest(match[2]), "hex");
	if (
		expectedBuf.length !== actualBuf.length ||
		!timingSafeEqual(expectedBuf, actualBuf)
	) {
		throw new AccessError(401, "UNAUTHENTICATED");
	}
	let commerceGuestId: string | null = guest.guest_id;
	const commerceCookie = cookie(request, `${p}.commerce_guest`);
	if (commerceCookie && /^[A-Za-z0-9_-]{43}$/.test(commerceCookie)) {
		const [cg] = await tx<{ id: string }[]>`
			select id from app.commerce_guest_context
			where digest = ${digest(commerceCookie)} and revoked_at is null and expires_at > clock_timestamp()
		`;
		if (cg) commerceGuestId = cg.id;
	}
	return {
		kind: "guest",
		id: guest.id,
		scope: `guest_support:${guest.id}`,
		commerceGuestId,
	};
}

export function toCommerceActor(actor: SupportCustomerActor): CommerceActor | null {
	if (actor.kind === "user") {
		return { kind: "user", id: actor.id, principal: actor.principal };
	}
	if (actor.commerceGuestId) {
		return { kind: "guest", id: actor.commerceGuestId };
	}
	return null;
}

function ownsConversation(actor: SupportCustomerActor, row: ConversationRow) {
	if (actor.kind === "user") {
		return (
			row.buyer_user_id === actor.id ||
			(row.guest_support_id !== null &&
				actor.linkedGuestIds.includes(row.guest_support_id))
		);
	}
	return row.guest_support_id === actor.id;
}

export async function requireOwnedConversation(
	tx: TransactionSql,
	actor: SupportCustomerActor,
	conversationId: string,
	forUpdate = false,
): Promise<ConversationRow> {
	const cid = id(conversationId);
	const [row] = forUpdate
		? await tx<
				ConversationRow[]
			>`select * from app.support_conversation where id = ${cid} for update`
		: await tx<
				ConversationRow[]
			>`select * from app.support_conversation where id = ${cid} for share`;
	if (!row || !ownsConversation(actor, row)) {
		throw new AccessError(404, "NOT_FOUND");
	}
	return row;
}

export async function requireStaffConversation(
	tx: TransactionSql,
	conversationId: string,
	forUpdate = false,
): Promise<ConversationRow> {
	const cid = id(conversationId);
	const [row] = forUpdate
		? await tx<
				ConversationRow[]
			>`select * from app.support_conversation where id = ${cid} for update`
		: await tx<
				ConversationRow[]
			>`select * from app.support_conversation where id = ${cid} for share`;
	if (!row) throw new AccessError(404, "NOT_FOUND");
	return row;
}
