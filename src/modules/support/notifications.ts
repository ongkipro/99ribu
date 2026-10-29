import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { AccessError } from "../access/policy.ts";
import { id, integer, invalid, object, text } from "../catalog/validation.ts";
import { digest } from "../checkout/access.ts";
import { mutationKey } from "../checkout/carts.ts";
import { requireOwnedConversation, resolveSupportCustomer } from "./actors.ts";
import {
	type ConversationRow,
	checkOperation,
	saveOperation,
} from "./shared.ts";

export async function advanceReadMarker(
	tx: TransactionSql,
	request: Request,
	conversation: ConversationRow,
	participantScope: string,
	readerSide: "customer" | "staff",
	value: unknown,
) {
	const key = mutationKey(request);
	const body = object(value, ["last_seen_sequence"]);
	const lastSeen = integer(body.last_seen_sequence, 0);
	if (lastSeen > conversation.public_sequence) {
		throw new AccessError(400, "INVALID_READ_SEQUENCE");
	}
	const requestHash = digest(JSON.stringify({ last_seen_sequence: lastSeen }));
	await checkOperation(
		tx,
		participantScope,
		`support.read:${conversation.id}`,
		key,
		requestHash,
	);
	const [row] = await tx<{ last_read_sequence: number; updated_at: string }[]>`
		insert into app.support_read_position (
			conversation_id, participant_scope, reader_side, last_read_sequence, updated_at
		)
		values (${conversation.id}, ${participantScope}, ${readerSide}, ${lastSeen}, clock_timestamp())
		on conflict (conversation_id, participant_scope) do update
		set last_read_sequence = greatest(app.support_read_position.last_read_sequence, ${lastSeen}),
		    updated_at = clock_timestamp()
		returning last_read_sequence, updated_at
	`;
	const response = {
		conversation_id: conversation.id,
		last_seen_sequence: row.last_read_sequence,
		updated_at: new Date(row.updated_at).toISOString(),
		reader_side: readerSide,
	};
	await saveOperation(
		tx,
		participantScope,
		`support.read:${conversation.id}`,
		key,
		requestHash,
		response,
	);
	return response;
}

export async function getCustomerPreferences(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	conversationIdParam: string,
) {
	if (request.headers.has("x-order-token"))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	const actor = await resolveSupportCustomer(tx, request, identity);
	const conv = await requireOwnedConversation(
		tx,
		actor,
		conversationIdParam,
		false,
	);
	const [pref] = await tx<
		{
			archived: boolean;
			muted: boolean;
			revision: number;
			updated_at: string;
		}[]
	>`
		select archived, muted, revision, updated_at
		from app.support_participant_preference
		where conversation_id = ${conv.id} and participant_scope = ${actor.scope}
	`;
	return {
		conversation_id: conv.id,
		version: pref?.revision ?? 1,
		archived: pref?.archived ?? false,
		muted: pref?.muted ?? false,
		updated_at: new Date(pref?.updated_at ?? conv.created_at).toISOString(),
	};
}

export async function setCustomerPreferences(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	conversationIdParam: string,
	value: unknown,
) {
	if (request.headers.has("x-order-token"))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	const key = mutationKey(request);
	const actor = await resolveSupportCustomer(tx, request, identity);
	const conv = await requireOwnedConversation(
		tx,
		actor,
		conversationIdParam,
		false,
	);
	const body = object(value, ["expected_version", "archived", "muted"]);
	const expectedVersion = integer(body.expected_version, 0);
	if (typeof body.archived !== "boolean" || typeof body.muted !== "boolean")
		throw invalid();
	const archived = body.archived;
	const muted = body.muted;

	const requestHash = digest(
		JSON.stringify({ expectedVersion, archived, muted }),
	);
	const prior = await checkOperation(
		tx,
		actor.scope,
		`support.preferences:${conv.id}`,
		key,
		requestHash,
	);
	if (prior) return prior;

	const [existing] = await tx<
		{
			archived: boolean;
			muted: boolean;
			revision: number;
			updated_at: string;
		}[]
	>`
		select archived, muted, revision, updated_at
		from app.support_participant_preference
		where conversation_id = ${conv.id} and participant_scope = ${actor.scope}
		for update
	`;
	const currentVersion = existing ? existing.revision : 0;
	if (
		expectedVersion !== currentVersion &&
		!(existing === undefined && expectedVersion === 1)
	) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	const nextRevision = (existing?.revision ?? 0) + 1;
	const [saved] = await tx<
		{
			archived: boolean;
			muted: boolean;
			revision: number;
			updated_at: string;
		}[]
	>`
		insert into app.support_participant_preference (
			conversation_id, participant_scope, archived, muted, revision, updated_at
		)
		values (${conv.id}, ${actor.scope}, ${archived}, ${muted}, ${nextRevision}, clock_timestamp())
		on conflict (conversation_id, participant_scope) do update
		set archived = ${archived},
		    muted = ${muted},
		    revision = ${nextRevision},
		    updated_at = clock_timestamp()
		returning archived, muted, revision, updated_at
	`;
	const response = {
		conversation_id: conv.id,
		version: saved.revision,
		archived: saved.archived,
		muted: saved.muted,
		updated_at: new Date(saved.updated_at).toISOString(),
	};
	await saveOperation(
		tx,
		actor.scope,
		`support.preferences:${conv.id}`,
		key,
		requestHash,
		response,
	);
	return response;
}

function projectNotification(row: {
	id: string;
	conversation_id: string | null;
	kind: string;
	state: "unread" | "seen" | "dismissed";
	created_at: string;
	updated_at: string;
}) {
	const version = row.state === "unread" ? 1 : row.state === "seen" ? 2 : 3;
	return {
		id: row.id,
		kind: "support_attention" as const,
		target_kind: "conversation" as const,
		target_id: row.conversation_id ?? row.id,
		created_at: new Date(row.created_at).toISOString(),
		seen_at:
			row.state === "seen" || row.state === "dismissed"
				? new Date(row.updated_at).toISOString()
				: null,
		dismissed_at:
			row.state === "dismissed" ? new Date(row.updated_at).toISOString() : null,
		version,
	};
}

export async function listSupportNotifications(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	url: URL,
) {
	if (request.headers.has("x-order-token"))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	const actor = await resolveSupportCustomer(tx, request, identity);
	for (const k of url.searchParams.keys()) {
		if (
			!["cursor", "limit"].includes(k) ||
			url.searchParams.getAll(k).length !== 1
		)
			throw invalid();
	}
	const limitRaw = url.searchParams.get("limit") ?? "20";
	if (!/^\d{1,3}$/.test(limitRaw)) throw invalid();
	const limit = integer(Number(limitRaw), 1, 100);
	const cursor = url.searchParams.has("cursor")
		? id(url.searchParams.get("cursor"))
		: null;

	const scopes =
		actor.kind === "user" && actor.linkedGuestIds.length > 0
			? [actor.scope, ...actor.linkedGuestIds.map((g) => `guest_support:${g}`)]
			: [actor.scope];
	const allRows = await tx<
		{
			id: string;
			conversation_id: string | null;
			kind: string;
			state: "unread" | "seen" | "dismissed";
			created_at: string;
			updated_at: string;
		}[]
	>`
		select id, conversation_id, kind, state, created_at, updated_at
		from app.support_in_app_notification
		where recipient_scope in ${tx(scopes)}
		order by created_at desc, id desc
	`;
	let startIndex = 0;
	if (cursor) {
		const idx = allRows.findIndex((r) => r.id === cursor);
		if (idx === -1) throw new AccessError(400, "INVALID_CURSOR");
		startIndex = idx + 1;
	}
	const page = allRows.slice(startIndex, startIndex + limit);
	const hasMore = startIndex + limit < allRows.length;
	return {
		data: page.map(projectNotification),
		pagination: {
			next_cursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
			has_more: hasMore,
		},
	};
}

export async function updateSupportNotificationState(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	notificationIdParam: string,
	value: unknown,
) {
	if (request.headers.has("x-order-token"))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	const key = mutationKey(request);
	const actor = await resolveSupportCustomer(tx, request, identity);
	const notificationId = id(notificationIdParam);
	const body = object(value, ["expected_version", "state"]);
	const expectedVersion = integer(body.expected_version, 1);
	const nextState = text(body.state, 20);
	if (!["seen", "dismissed"].includes(nextState)) throw invalid();

	const requestHash = digest(
		JSON.stringify({ expectedVersion, state: nextState }),
	);
	const prior = await checkOperation(
		tx,
		actor.scope,
		`support.notification:${notificationId}`,
		key,
		requestHash,
	);
	if (prior) return prior;

	const scopes =
		actor.kind === "user" && actor.linkedGuestIds.length > 0
			? [actor.scope, ...actor.linkedGuestIds.map((g) => `guest_support:${g}`)]
			: [actor.scope];
	const [row] = await tx<
		{
			id: string;
			conversation_id: string | null;
			kind: string;
			state: "unread" | "seen" | "dismissed";
			created_at: string;
			updated_at: string;
		}[]
	>`
		select id, conversation_id, kind, state, created_at, updated_at
		from app.support_in_app_notification
		where id = ${notificationId} and recipient_scope in ${tx(scopes)}
		for update
	`;
	if (!row) throw new AccessError(404, "NOT_FOUND");
	const currentVersion =
		row.state === "unread" ? 1 : row.state === "seen" ? 2 : 3;
	if (expectedVersion !== currentVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	if (row.state === "dismissed" && nextState === "seen") {
		throw new AccessError(409, "INVALID_NOTIFICATION_STATE");
	}
	const [updated] = await tx<
		{
			id: string;
			conversation_id: string | null;
			kind: string;
			state: "unread" | "seen" | "dismissed";
			created_at: string;
			updated_at: string;
		}[]
	>`
		update app.support_in_app_notification
		set state = ${nextState}, updated_at = clock_timestamp()
		where id = ${row.id}
		returning id, conversation_id, kind, state, created_at, updated_at
	`;
	const response = projectNotification(updated);
	await saveOperation(
		tx,
		actor.scope,
		`support.notification:${notificationId}`,
		key,
		requestHash,
		response,
	);
	return response;
}
