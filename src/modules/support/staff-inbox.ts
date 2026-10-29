import type { TransactionSql } from "postgres";
import { AccessError, type Principal } from "../access/policy.ts";
import {
	array,
	id,
	integer,
	invalid,
	object,
	text,
} from "../catalog/validation.ts";
import { digest } from "../checkout/access.ts";
import { mutationKey } from "../checkout/carts.ts";
import { requireStaffConversation } from "./actors.ts";
import { projectStaffConversation } from "./conversations.ts";
import {
	type ConversationRow,
	checkOperation,
	saveOperation,
} from "./shared.ts";

export async function listStaffSupportInbox(
	tx: TransactionSql,
	principal: Principal,
	url: URL,
) {
	const allowedKeys = [
		"cursor",
		"limit",
		"assignment",
		"status",
		"tag_id",
		"priority",
		"unread",
		"assignee_user_id",
		"age_from",
	];
	for (const k of url.searchParams.keys()) {
		if (!allowedKeys.includes(k) || url.searchParams.getAll(k).length !== 1)
			throw invalid();
	}
	const limitRaw = url.searchParams.get("limit") ?? "20";
	if (!/^\d{1,3}$/.test(limitRaw)) throw invalid();
	const limit = integer(Number(limitRaw), 1, 100);
	const cursor = url.searchParams.has("cursor")
		? id(url.searchParams.get("cursor"))
		: null;
	const assignment = url.searchParams.get("assignment") ?? "unassigned";
	if (!["unassigned", "assigned_to_me", "all"].includes(assignment))
		throw invalid();
	const status = url.searchParams.get("status");
	if (
		status !== null &&
		!["open", "waiting_customer", "resolved"].includes(status)
	)
		throw invalid();
	const tagId = url.searchParams.has("tag_id")
		? id(url.searchParams.get("tag_id"))
		: null;
	const priority = url.searchParams.get("priority");
	if (priority !== null && !["low", "normal", "high"].includes(priority))
		throw invalid();
	const unreadParam = url.searchParams.get("unread");
	if (unreadParam !== null && !["true", "false"].includes(unreadParam))
		throw invalid();
	const assigneeUserId = url.searchParams.has("assignee_user_id")
		? text(url.searchParams.get("assignee_user_id"), 200)
		: null;
	const ageFromRaw = url.searchParams.get("age_from");
	if (ageFromRaw !== null && Number.isNaN(Date.parse(ageFromRaw)))
		throw invalid();

	const assignmentFilter =
		assignment === "unassigned"
			? tx`and c.assigned_user_id is null`
			: assignment === "assigned_to_me"
				? tx`and c.assigned_user_id = ${principal.id}`
				: tx``;
	const statusFilter = status ? tx`and c.status = ${status}` : tx``;
	const priorityFilter = priority ? tx`and c.priority = ${priority}` : tx``;
	const assigneeFilter = assigneeUserId
		? tx`and c.assigned_user_id = ${assigneeUserId}`
		: tx``;
	const tagFilter = tagId
		? tx`and exists (
				select 1 from app.support_conversation_tag ct
				where ct.conversation_id = c.id and ct.tag_id = ${tagId}
			)`
		: tx``;
	const ageFilter = ageFromRaw
		? tx`and c.created_at >= ${new Date(ageFromRaw).toISOString()}`
		: tx``;

	// Unread is the projection's own rule (public_sequence beyond this agent's read marker), filtered in SQL
	// so the page is a bounded keyset slice (S104) instead of every matching conversation.
	const unreadFilter =
		unreadParam === "true"
			? tx`and c.public_sequence > coalesce(rp.last_read_sequence, 0)`
			: unreadParam === "false"
				? tx`and c.public_sequence <= coalesce(rp.last_read_sequence, 0)`
				: tx``;
	// The cursor is the last conversation id of the previous page; its current activity key is the position.
	// Activity moves conversations, so a later page can repeat or skip one that changed in between (as before).
	let afterFilter = tx``;
	if (cursor) {
		const [position] = await tx<{ at: string; id: string }[]>`
			select coalesce(last_public_message_at, created_at)::text as at, id
			from app.support_conversation where id = ${cursor}
		`;
		if (!position) throw new AccessError(400, "INVALID_CURSOR");
		afterFilter = tx`and (coalesce(c.last_public_message_at, c.created_at), c.id) < (${position.at}::timestamptz, ${position.id}::uuid)`;
	}

	const rows = await tx<ConversationRow[]>`
		select c.*
		from app.support_conversation c
		left join app.support_read_position rp
			on rp.conversation_id = c.id and rp.participant_scope = ${`user:${principal.id}`}
		where true
		  ${assignmentFilter}
		  ${statusFilter}
		  ${priorityFilter}
		  ${assigneeFilter}
		  ${tagFilter}
		  ${ageFilter}
		  ${unreadFilter}
		  ${afterFilter}
		order by coalesce(c.last_public_message_at, c.created_at) desc, c.id desc
		limit ${limit + 1}
	`;

	const page = [];
	for (const row of rows.slice(0, limit))
		page.push(await projectStaffConversation(tx, row, principal.id));
	const hasMore = rows.length > limit;
	return {
		data: page,
		pagination: {
			next_cursor:
				hasMore && page.length > 0
					? page[page.length - 1].conversation.id
					: null,
			has_more: hasMore,
		},
	};
}

export async function claimStaffConversation(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	conversationIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const body = object(value, ["expected_version"]);
	const expectedVersion = integer(body.expected_version, 1);
	const conv = await requireStaffConversation(tx, conversationIdParam, true);
	const requestHash = digest(JSON.stringify({ expectedVersion }));
	const prior = await checkOperation(
		tx,
		principal.id,
		`support.claim:${conv.id}`,
		key,
		requestHash,
	);
	if (prior) return projectStaffConversation(tx, conv, principal.id);

	if (
		conv.assigned_user_id !== null &&
		conv.assigned_user_id !== principal.id
	) {
		throw new AccessError(409, "ALREADY_CLAIMED");
	}
	if (conv.revision !== expectedVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	if (conv.assigned_user_id === principal.id) {
		const result = await projectStaffConversation(tx, conv, principal.id);
		await saveOperation(
			tx,
			principal.id,
			`support.claim:${conv.id}`,
			key,
			requestHash,
			{ ok: true },
		);
		return result;
	}
	const nextRevision = conv.revision + 1;
	const [updated] = await tx<ConversationRow[]>`
		update app.support_conversation
		set assigned_user_id = ${principal.id},
		    revision = ${nextRevision}
		where id = ${conv.id}
		returning *
	`;
	await tx`
		insert into app.support_assignment_event (
			conversation_id, revision, kind, previous_user_id, assigned_user_id, actor_id, reason
		)
		values (
			${conv.id}, ${nextRevision}, 'claim', null, ${principal.id}, ${principal.id}, 'Claimed conversation'
		)
	`;
	await saveOperation(
		tx,
		principal.id,
		`support.claim:${conv.id}`,
		key,
		requestHash,
		{ ok: true },
	);
	return projectStaffConversation(tx, updated, principal.id);
}

export async function assignStaffConversation(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	conversationIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const body = object(value, [
		"expected_version",
		"assignee_user_id",
		"reason",
	]);
	const expectedVersion = integer(body.expected_version, 1);
	const assigneeUserId =
		body.assignee_user_id === null ? null : text(body.assignee_user_id, 200);
	const reason = text(body.reason, 500);
	const conv = await requireStaffConversation(tx, conversationIdParam, true);

	const requestHash = digest(
		JSON.stringify({ expectedVersion, assigneeUserId, reason }),
	);
	const prior = await checkOperation(
		tx,
		principal.id,
		`support.assign:${conv.id}`,
		key,
		requestHash,
	);
	if (prior) return projectStaffConversation(tx, conv, principal.id);

	if (
		!principal.roles.includes("owner") &&
		conv.assigned_user_id !== principal.id
	) {
		throw new AccessError(403, "CLAIM_REQUIRED");
	}
	if (conv.revision !== expectedVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	if (assigneeUserId !== null) {
		const [targetGrant] = await tx<{ roles: string[] }[]>`
			select g.roles
			from app.auth_user u
			join app.role_grant g on g.user_id = u.id
			where u.id = ${assigneeUserId}
		`;
		if (
			!targetGrant ||
			(!targetGrant.roles.includes("customer_service") &&
				!targetGrant.roles.includes("owner"))
		) {
			throw new AccessError(403, "INVALID_ASSIGNEE_ROLE");
		}
	}
	const nextRevision = conv.revision + 1;
	const [updated] = await tx<ConversationRow[]>`
		update app.support_conversation
		set assigned_user_id = ${assigneeUserId},
		    revision = ${nextRevision}
		where id = ${conv.id}
		returning *
	`;
	await tx`
		insert into app.support_assignment_event (
			conversation_id, revision, kind, previous_user_id, assigned_user_id, actor_id, reason
		)
		values (
			${conv.id},
			${nextRevision},
			${assigneeUserId === null ? "release" : "handoff"},
			${conv.assigned_user_id},
			${assigneeUserId},
			${principal.id},
			${reason}
		)
	`;
	await saveOperation(
		tx,
		principal.id,
		`support.assign:${conv.id}`,
		key,
		requestHash,
		{ ok: true },
	);
	return projectStaffConversation(tx, updated, principal.id);
}

export async function setStaffConversationStatus(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	conversationIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const body = object(value, ["expected_version", "status", "reason"]);
	const expectedVersion = integer(body.expected_version, 1);
	const status = text(body.status, 30) as
		| "open"
		| "waiting_customer"
		| "resolved";
	if (!["open", "waiting_customer", "resolved"].includes(status))
		throw invalid();
	const reason = text(body.reason, 500);
	const conv = await requireStaffConversation(tx, conversationIdParam, true);

	const requestHash = digest(
		JSON.stringify({ expectedVersion, status, reason }),
	);
	const prior = await checkOperation(
		tx,
		principal.id,
		`support.status:${conv.id}`,
		key,
		requestHash,
	);
	if (prior) return projectStaffConversation(tx, conv, principal.id);

	if (
		!principal.roles.includes("owner") &&
		conv.assigned_user_id !== principal.id
	) {
		throw new AccessError(403, "CLAIM_REQUIRED");
	}
	if (conv.revision !== expectedVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	const nextRevision = conv.revision + 1;
	const [updated] = await tx<ConversationRow[]>`
		update app.support_conversation
		set status = ${status},
		    revision = ${nextRevision}
		where id = ${conv.id}
		returning *
	`;
	await tx`
		insert into app.support_assignment_event (
			conversation_id, revision, kind, previous_user_id, assigned_user_id, actor_id, reason
		)
		values (
			${conv.id},
			${nextRevision},
			${`status:${status}`},
			${conv.assigned_user_id},
			${conv.assigned_user_id},
			${principal.id},
			${reason}
		)
	`;
	await saveOperation(
		tx,
		principal.id,
		`support.status:${conv.id}`,
		key,
		requestHash,
		{ ok: true },
	);
	return projectStaffConversation(tx, updated, principal.id);
}

export async function addStaffInternalNote(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	conversationIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const conv = await requireStaffConversation(tx, conversationIdParam, false);
	const body = object(value, ["text"]);
	const noteText = text(body.text, 4000);
	const requestHash = digest(JSON.stringify({ text: noteText }));

	const [existing] = await tx<
		{
			id: string;
			conversation_id: string;
			author_user_id: string;
			request_hash: string;
			body: string;
			created_at: string;
		}[]
	>`
		select *
		from app.support_internal_note
		where conversation_id = ${conv.id}
		  and author_user_id = ${principal.id}
		  and client_note_id = ${key}
	`;
	if (existing) {
		if (existing.request_hash !== requestHash)
			throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
		return {
			id: existing.id,
			conversation_id: existing.conversation_id,
			author_id: existing.author_user_id,
			text: existing.body,
			created_at: new Date(existing.created_at).toISOString(),
		};
	}

	const [inserted] = await tx<
		{
			id: string;
			conversation_id: string;
			author_user_id: string;
			body: string;
			created_at: string;
		}[]
	>`
		insert into app.support_internal_note (
			conversation_id, author_user_id, client_note_id, request_hash, body
		)
		values (${conv.id}, ${principal.id}, ${key}, ${requestHash}, ${noteText})
		returning id, conversation_id, author_user_id, body, created_at
	`;
	return {
		id: inserted.id,
		conversation_id: inserted.conversation_id,
		author_id: inserted.author_user_id,
		text: inserted.body,
		created_at: new Date(inserted.created_at).toISOString(),
	};
}

export async function listStaffInternalNotes(
	tx: TransactionSql,
	conversationIdParam: string,
	url: URL,
) {
	const conv = await requireStaffConversation(tx, conversationIdParam, false);
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

	const allRows = await tx<
		{
			id: string;
			conversation_id: string;
			author_user_id: string;
			body: string;
			created_at: string;
		}[]
	>`
		select id, conversation_id, author_user_id, body, created_at
		from app.support_internal_note
		where conversation_id = ${conv.id}
		order by created_at asc, id asc
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
		data: page.map((r) => ({
			id: r.id,
			conversation_id: r.conversation_id,
			author_id: r.author_user_id,
			text: r.body,
			created_at: new Date(r.created_at).toISOString(),
		})),
		pagination: {
			next_cursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
			has_more: hasMore,
		},
	};
}

export async function searchStaffInternalNotes(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	conversationIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const conv = await requireStaffConversation(tx, conversationIdParam, false);
	const body = object(value, ["query", "cursor", "limit"]);
	const query = text(body.query, 200);
	const limit = body.limit !== undefined ? integer(body.limit, 1, 100) : 20;
	const cursor = body.cursor !== undefined ? id(body.cursor) : null;

	const requestHash = digest(JSON.stringify({ query, cursor, limit }));
	const prior = await checkOperation(
		tx,
		principal.id,
		`support.note.search:${conv.id}`,
		key,
		requestHash,
	);
	if (prior) return prior;

	const pattern = `%${query.toLowerCase()}%`;
	const allRows = await tx<
		{
			id: string;
			conversation_id: string;
			author_user_id: string;
			body: string;
			created_at: string;
		}[]
	>`
		select id, conversation_id, author_user_id, body, created_at
		from app.support_internal_note
		where conversation_id = ${conv.id}
		  and lower(body) like ${pattern}
		order by created_at asc, id asc
	`;
	let startIndex = 0;
	if (cursor) {
		const idx = allRows.findIndex((r) => r.id === cursor);
		if (idx === -1) throw new AccessError(400, "INVALID_CURSOR");
		startIndex = idx + 1;
	}
	const page = allRows.slice(startIndex, startIndex + limit);
	const hasMore = startIndex + limit < allRows.length;
	const response = {
		data: page.map((r) => ({
			id: r.id,
			conversation_id: r.conversation_id,
			author_id: r.author_user_id,
			text: r.body,
			created_at: new Date(r.created_at).toISOString(),
		})),
		pagination: {
			next_cursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
			has_more: hasMore,
		},
	};
	await saveOperation(
		tx,
		principal.id,
		`support.note.search:${conv.id}`,
		key,
		requestHash,
		response,
	);
	return response;
}

export async function getStaffClassification(
	tx: TransactionSql,
	conversationIdParam: string,
) {
	const conv = await requireStaffConversation(tx, conversationIdParam, false);
	const tags = await tx<{ tag_id: string; created_at: string }[]>`
		select tag_id, created_at
		from app.support_conversation_tag
		where conversation_id = ${conv.id}
		order by tag_id asc
	`;
	const latestTagAt = tags.reduce(
		(max, t) => (new Date(t.created_at) > new Date(max) ? t.created_at : max),
		conv.created_at,
	);
	return {
		conversation_id: conv.id,
		version: conv.revision,
		tag_ids: tags.map((t) => t.tag_id),
		priority: conv.priority,
		updated_at: new Date(latestTagAt).toISOString(),
	};
}

export async function setStaffClassification(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	conversationIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const conv = await requireStaffConversation(tx, conversationIdParam, true);
	const body = object(value, [
		"expected_version",
		"tag_ids",
		"priority",
		"reason",
	]);
	const expectedVersion = integer(body.expected_version, 1);
	const tagIds = array(body.tag_ids, (v) => id(v), 0, 20);
	if (new Set(tagIds).size !== tagIds.length) throw invalid();
	const priority = text(body.priority, 20) as "low" | "normal" | "high";
	if (!["low", "normal", "high"].includes(priority)) throw invalid();
	const reason = text(body.reason, 500);

	const requestHash = digest(
		JSON.stringify({ expectedVersion, tagIds, priority, reason }),
	);
	const prior = await checkOperation(
		tx,
		principal.id,
		`support.classification:${conv.id}`,
		key,
		requestHash,
	);
	if (prior) return prior;

	if (conv.revision !== expectedVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	if (tagIds.length > 0) {
		const validTags = await tx<{ id: string }[]>`
			select id from app.support_tag where id in ${tx(tagIds)} and enabled = true
		`;
		if (validTags.length !== tagIds.length) {
			throw new AccessError(400, "INVALID_TAG");
		}
	}
	const nextRevision = conv.revision + 1;
	const priorTags = await tx<{ tag_id: string }[]>`
		select tag_id from app.support_conversation_tag
		where conversation_id = ${conv.id}
		order by tag_id asc
	`;
	await tx`
		update app.support_conversation
		set priority = ${priority},
		    revision = ${nextRevision}
		where id = ${conv.id}
	`;
	await tx`delete from app.support_conversation_tag where conversation_id = ${conv.id}`;
	for (const tid of tagIds) {
		await tx`
			insert into app.support_conversation_tag (conversation_id, tag_id, actor_id)
			values (${conv.id}, ${tid}, ${principal.id})
		`;
	}
	const [clock] = await tx<{ now: string }[]>`select clock_timestamp() as now`;
	const response = {
		conversation_id: conv.id,
		version: nextRevision,
		tag_ids: [...tagIds].sort(),
		priority,
		updated_at: new Date(clock.now).toISOString(),
	};
	await tx`
		insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
		values (
			${principal.id},
			'support.classification.set',
			${conv.id},
			'allowed',
			${reason},
			${JSON.stringify({
				version: nextRevision,
				before: {
					priority: conv.priority,
					tag_ids: priorTags.map((t) => t.tag_id),
				},
				after: { priority, tag_ids: response.tag_ids },
			})}::jsonb
		)
	`;
	await saveOperation(
		tx,
		principal.id,
		`support.classification:${conv.id}`,
		key,
		requestHash,
		response,
	);
	return response;
}
