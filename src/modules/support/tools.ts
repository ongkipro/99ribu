import { randomUUID } from "node:crypto";
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
import { canManageSupportTools, requireStaffConversation } from "./actors.ts";
import {
	ALLOWED_PLACEHOLDERS,
	checkOperation,
	HISTORY_LIMIT,
	saveOperation,
	slugify,
} from "./shared.ts";

export async function listSupportSavedReplies(tx: TransactionSql, url: URL) {
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
			title: string;
			body_template: string;
			placeholders: string[];
			enabled: boolean;
			revision: number;
			actor_id: string;
			updated_at: string;
		}[]
	>`
		select id, title, body_template, placeholders, enabled, revision, actor_id, updated_at
		from app.support_saved_reply
		order by title asc, id asc
	`;
	let startIndex = 0;
	if (cursor) {
		const idx = allRows.findIndex((r) => r.id === cursor);
		if (idx === -1) throw new AccessError(400, "INVALID_CURSOR");
		startIndex = idx + 1;
	}
	const page = allRows.slice(startIndex, startIndex + limit);
	const hasMore = startIndex + limit < allRows.length;
	const auditRows =
		page.length > 0
			? await tx<
					{
						subject_id: string;
						actor_id: string | null;
						reason: string | null;
						details: {
							version?: number;
							after?: {
								title?: string;
								text?: string;
								placeholders?: string[];
								enabled?: boolean;
							};
						};
						created_at: string;
					}[]
				>`
					select subject_id, actor_id, reason, details, created_at from (
						select subject_id, actor_id, reason, details, created_at, id,
							row_number() over (partition by subject_id order by created_at desc, id desc) as n
						from app.audit_event
						where subject_id in ${tx(page.map((r) => r.id))}
							and action in ('support.saved_reply.create', 'support.saved_reply.version')
							and outcome = 'allowed'
					) latest
					-- The newest HISTORY_LIMIT versions per item; older ones stay in the audit log.
					where n <= ${HISTORY_LIMIT}
					order by created_at desc, id desc
				`
			: [];
	return {
		data: page.map((r) => {
			const history = auditRows
				.filter((a) => a.subject_id === r.id)
				.map((a) => ({
					version: Number(a.details?.version ?? r.revision),
					title: String(a.details?.after?.title ?? r.title),
					text: String(a.details?.after?.text ?? r.body_template),
					placeholders: Array.isArray(a.details?.after?.placeholders)
						? a.details.after.placeholders
						: r.placeholders,
					enabled: Boolean(a.details?.after?.enabled ?? r.enabled),
					actor_id: a.actor_id ?? r.actor_id,
					reason: a.reason ?? "",
					created_at: new Date(a.created_at).toISOString(),
				}))
				.sort((a, b) => b.version - a.version);
			return {
				id: r.id,
				version: r.revision,
				title: r.title,
				text: r.body_template,
				placeholders: r.placeholders,
				enabled: r.enabled,
				history:
					history.length > 0
						? history
						: [
								{
									version: r.revision,
									title: r.title,
									text: r.body_template,
									placeholders: r.placeholders,
									enabled: r.enabled,
									actor_id: r.actor_id,
									reason: "",
									created_at: new Date(r.updated_at).toISOString(),
								},
							],
			};
		}),
		pagination: {
			next_cursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
			has_more: hasMore,
		},
	};
}

function parseSavedReplyInput(value: unknown) {
	const body = object(value, [
		"expected_version",
		"title",
		"text",
		"placeholders",
		"enabled",
		"reason",
	]);
	const expectedVersion = integer(body.expected_version, 0);
	const title = text(body.title, 120);
	const templateText = text(body.text, 4000);
	const placeholders = array(
		body.placeholders,
		(v) => {
			const s = text(v, 40);
			if (
				!ALLOWED_PLACEHOLDERS.includes(
					s as (typeof ALLOWED_PLACEHOLDERS)[number],
				)
			)
				throw invalid();
			return s;
		},
		0,
		10,
	);
	if (new Set(placeholders).size !== placeholders.length) throw invalid();
	const matches = [...templateText.matchAll(/\{\{([a-z0-9_]+)\}\}/gi)].map(
		(m) => m[1],
	);
	for (const token of matches) {
		if (
			!ALLOWED_PLACEHOLDERS.includes(
				token as (typeof ALLOWED_PLACEHOLDERS)[number],
			)
		) {
			throw invalid();
		}
	}
	if (typeof body.enabled !== "boolean") throw invalid();
	const reason = text(body.reason, 500);
	return {
		expectedVersion,
		title,
		templateText,
		placeholders,
		enabled: body.enabled,
		reason,
	};
}

// lazy: support definitions have no *_version table; the immutable audit row keeps
// each prior/next snapshot until a dedicated version table exists.
async function auditSupportDefinition(
	tx: TransactionSql,
	actorId: string,
	action: string,
	subjectId: string,
	reason: string,
	details: Record<string, unknown>,
) {
	await tx`
		insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
		values (${actorId}, ${action}, ${subjectId}, 'allowed', ${reason}, ${JSON.stringify(details)}::jsonb)
	`;
}

export async function createOrUpdateSavedReply(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	definitionIdParam: string | null,
	value: unknown,
) {
	if (!canManageSupportTools(principal)) {
		throw new AccessError(403, "FORBIDDEN");
	}
	const key = mutationKey(request);
	const parsed = parseSavedReplyInput(value);
	const requestHash = digest(JSON.stringify({ definitionIdParam, ...parsed }));
	const action = definitionIdParam
		? `support.saved_reply.version:${definitionIdParam}`
		: "support.saved_reply.create";
	const prior = await checkOperation(
		tx,
		principal.id,
		action,
		key,
		requestHash,
	);
	if (prior) return prior;

	if (definitionIdParam === null) {
		if (parsed.expectedVersion !== 0)
			throw new AccessError(409, "VERSION_CONFLICT");
		const defId = randomUUID();
		const [inserted] = await tx<
			{
				id: string;
				title: string;
				body_template: string;
				placeholders: string[];
				enabled: boolean;
				revision: number;
			}[]
		>`
			insert into app.support_saved_reply (
				id, slug, title, body_template, placeholders, enabled, revision, actor_id
			)
			values (
				${defId},
				${slugify(parsed.title, defId)},
				${parsed.title},
				${parsed.templateText},
				${JSON.stringify(parsed.placeholders)}::jsonb,
				${parsed.enabled},
				1,
				${principal.id}
			)
			returning id, title, body_template, placeholders, enabled, revision
		`;
		const response = {
			id: inserted.id,
			version: inserted.revision,
			title: inserted.title,
			text: inserted.body_template,
			placeholders: inserted.placeholders,
			enabled: inserted.enabled,
		};
		await auditSupportDefinition(
			tx,
			principal.id,
			"support.saved_reply.create",
			inserted.id,
			parsed.reason,
			{ version: inserted.revision, before: null, after: response },
		);
		await saveOperation(tx, principal.id, action, key, requestHash, response);
		return response;
	}

	const defId = id(definitionIdParam);
	const [existing] = await tx<
		{
			id: string;
			title: string;
			body_template: string;
			placeholders: string[];
			enabled: boolean;
			revision: number;
		}[]
	>`
		select id, title, body_template, placeholders, enabled, revision
		from app.support_saved_reply where id = ${defId} for update
	`;
	if (!existing) throw new AccessError(404, "NOT_FOUND");
	if (existing.revision !== parsed.expectedVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	const nextRevision = existing.revision + 1;
	const [updated] = await tx<
		{
			id: string;
			title: string;
			body_template: string;
			placeholders: string[];
			enabled: boolean;
			revision: number;
		}[]
	>`
		update app.support_saved_reply
		set title = ${parsed.title},
		    body_template = ${parsed.templateText},
		    placeholders = ${JSON.stringify(parsed.placeholders)}::jsonb,
		    enabled = ${parsed.enabled},
		    revision = ${nextRevision},
		    actor_id = ${principal.id},
		    updated_at = clock_timestamp()
		where id = ${defId}
		returning id, title, body_template, placeholders, enabled, revision
	`;
	const response = {
		id: updated.id,
		version: updated.revision,
		title: updated.title,
		text: updated.body_template,
		placeholders: updated.placeholders,
		enabled: updated.enabled,
	};
	await auditSupportDefinition(
		tx,
		principal.id,
		"support.saved_reply.version",
		updated.id,
		parsed.reason,
		{
			version: updated.revision,
			before: {
				id: existing.id,
				version: existing.revision,
				title: existing.title,
				text: existing.body_template,
				placeholders: existing.placeholders,
				enabled: existing.enabled,
			},
			after: response,
		},
	);
	await saveOperation(tx, principal.id, action, key, requestHash, response);
	return response;
}

export async function previewSavedReplyDraft(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	conversationIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const conv = await requireStaffConversation(tx, conversationIdParam, false);
	if (conv.assigned_user_id !== principal.id) {
		throw new AccessError(409, "CLAIM_REQUIRED");
	}
	const body = object(value, ["saved_reply_id", "saved_reply_version"]);
	const savedReplyId = id(body.saved_reply_id);
	const savedReplyVersion = integer(body.saved_reply_version, 1);
	const requestHash = digest(
		JSON.stringify({ savedReplyId, savedReplyVersion }),
	);
	const prior = await checkOperation(
		tx,
		principal.id,
		`support.saved_reply.preview:${conv.id}`,
		key,
		requestHash,
	);
	if (prior) return prior;

	const [template] = await tx<
		{
			id: string;
			body_template: string;
			placeholders: string[];
			enabled: boolean;
			revision: number;
		}[]
	>`
		select id, body_template, placeholders, enabled, revision
		from app.support_saved_reply
		where id = ${savedReplyId}
	`;
	if (!template?.enabled) throw new AccessError(404, "NOT_FOUND");
	if (template.revision !== savedReplyVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}

	let customerName: string | null = null;
	if (conv.buyer_user_id) {
		const [profile] = await tx<{ display_name: string }[]>`
			select display_name from app.buyer_profile where user_id = ${conv.buyer_user_id}
		`;
		if (profile?.display_name) {
			customerName = profile.display_name;
		} else {
			const [u] = await tx<{ name: string }[]>`
				select name from app.auth_user where id = ${conv.buyer_user_id}
			`;
			customerName = u?.name ?? null;
		}
	}

	let productTitle: string | null = null;
	if (conv.primary_product_id) {
		const [prod] = await tx<{ name: string }[]>`
			select pv.name
			from app.publication_head ph
			join app.publication_version pub
				on pub.product_id = ph.product_id and pub.revision = ph.revision
			join app.product_revision pv
				on pv.product_id = ph.product_id and pv.revision = pub.product_revision
			where ph.product_id = ${conv.primary_product_id} and ph.revision > 0
				and not exists (select 1 from app.publication_withdrawal w where w.publication_id = pub.id)
		`;
		productTitle = prod?.name ?? null;
	}

	let orderReference: string | null = null;
	if (conv.primary_order_id) {
		const [ord] = await tx<{ number: string }[]>`
			select number from app.commerce_order where id = ${conv.primary_order_id}
		`;
		orderReference = ord?.number ?? null;
	}

	const values: Record<string, string | null> = {
		customer_name: customerName,
		product_title: productTitle,
		order_reference: orderReference,
	};

	const unresolved = new Set<string>();
	let rendered = template.body_template;
	for (const pName of ALLOWED_PLACEHOLDERS) {
		const token = `{{${pName}}}`;
		if (rendered.includes(token) || template.placeholders.includes(pName)) {
			const resolved = values[pName];
			if (resolved) {
				rendered = rendered.replaceAll(token, resolved);
			} else {
				unresolved.add(pName);
			}
		}
	}
	const unresolvedList = [...unresolved];
	const response = {
		text: rendered,
		unresolved_placeholders: unresolvedList,
		can_send: unresolvedList.length === 0 && rendered.trim().length > 0,
	};
	await saveOperation(
		tx,
		principal.id,
		`support.saved_reply.preview:${conv.id}`,
		key,
		requestHash,
		response,
	);
	return response;
}

/**
 * S113: staff who can hold a conversation (the assignment target rule: owner or customer_service),
 * by display name for the handoff picker and the assignee label. Names only: no email or contact.
 */
export async function listSupportAgents(tx: TransactionSql, url: URL) {
	if ([...url.searchParams.keys()].length > 0) throw invalid();
	const rows = await tx<{ id: string; name: string }[]>`
		select u.id, u.name
		from app.auth_user u
		join app.role_grant g on g.user_id = u.id
		where g.roles && array['owner', 'customer_service']::text[]
		order by u.name asc, u.id asc
		limit 200
	`;
	return { data: rows.map((r) => ({ id: String(r.id), name: String(r.name) })) };
}

export async function listSupportTags(tx: TransactionSql, url: URL) {
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
			label: string;
			enabled: boolean;
			revision: number;
			actor_id: string;
			updated_at: string;
		}[]
	>`
		select id, label, enabled, revision, actor_id, updated_at
		from app.support_tag
		order by label asc, id asc
	`;
	let startIndex = 0;
	if (cursor) {
		const idx = allRows.findIndex((r) => r.id === cursor);
		if (idx === -1) throw new AccessError(400, "INVALID_CURSOR");
		startIndex = idx + 1;
	}
	const page = allRows.slice(startIndex, startIndex + limit);
	const hasMore = startIndex + limit < allRows.length;
	const auditRows =
		page.length > 0
			? await tx<
					{
						subject_id: string;
						actor_id: string | null;
						reason: string | null;
						details: {
							version?: number;
							after?: {
								label?: string;
								enabled?: boolean;
							};
						};
						created_at: string;
					}[]
				>`
					select subject_id, actor_id, reason, details, created_at from (
						select subject_id, actor_id, reason, details, created_at, id,
							row_number() over (partition by subject_id order by created_at desc, id desc) as n
						from app.audit_event
						where subject_id in ${tx(page.map((r) => r.id))}
							and action in ('support.tag.create', 'support.tag.version')
							and outcome = 'allowed'
					) latest
					-- The newest HISTORY_LIMIT versions per item; older ones stay in the audit log.
					where n <= ${HISTORY_LIMIT}
					order by created_at desc, id desc
				`
			: [];
	return {
		data: page.map((r) => {
			const history = auditRows
				.filter((a) => a.subject_id === r.id)
				.map((a) => ({
					version: Number(a.details?.version ?? r.revision),
					label: String(a.details?.after?.label ?? r.label),
					enabled: Boolean(a.details?.after?.enabled ?? r.enabled),
					actor_id: a.actor_id ?? r.actor_id,
					reason: a.reason ?? "",
					created_at: new Date(a.created_at).toISOString(),
				}))
				.sort((a, b) => b.version - a.version);
			return {
				id: r.id,
				version: r.revision,
				label: r.label,
				enabled: r.enabled,
				history:
					history.length > 0
						? history
						: [
								{
									version: r.revision,
									label: r.label,
									enabled: r.enabled,
									actor_id: r.actor_id,
									reason: "",
									created_at: new Date(r.updated_at).toISOString(),
								},
							],
			};
		}),
		pagination: {
			next_cursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
			has_more: hasMore,
		},
	};
}

export async function createOrUpdateSupportTag(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	definitionIdParam: string | null,
	value: unknown,
) {
	if (!canManageSupportTools(principal)) {
		throw new AccessError(403, "FORBIDDEN");
	}
	const key = mutationKey(request);
	const body = object(value, [
		"expected_version",
		"label",
		"enabled",
		"reason",
	]);
	const expectedVersion = integer(body.expected_version, 0);
	const label = text(body.label, 80);
	if (typeof body.enabled !== "boolean") throw invalid();
	const enabled = body.enabled;
	const reason = text(body.reason, 500);
	const requestHash = digest(
		JSON.stringify({
			definitionIdParam,
			expectedVersion,
			label,
			enabled,
			reason,
		}),
	);
	const action = definitionIdParam
		? `support.tag.version:${definitionIdParam}`
		: "support.tag.create";
	const prior = await checkOperation(
		tx,
		principal.id,
		action,
		key,
		requestHash,
	);
	if (prior) return prior;

	if (definitionIdParam === null) {
		if (expectedVersion !== 0) throw new AccessError(409, "VERSION_CONFLICT");
		const tagId = randomUUID();
		const [inserted] = await tx<
			{ id: string; label: string; enabled: boolean; revision: number }[]
		>`
			insert into app.support_tag (id, slug, label, enabled, revision, actor_id)
			values (${tagId}, ${slugify(label, tagId)}, ${label}, ${enabled}, 1, ${principal.id})
			returning id, label, enabled, revision
		`;
		const response = {
			id: inserted.id,
			version: inserted.revision,
			label: inserted.label,
			enabled: inserted.enabled,
		};
		await auditSupportDefinition(
			tx,
			principal.id,
			"support.tag.create",
			inserted.id,
			reason,
			{ version: inserted.revision, before: null, after: response },
		);
		await saveOperation(tx, principal.id, action, key, requestHash, response);
		return response;
	}

	const tagId = id(definitionIdParam);
	const [existing] = await tx<
		{ id: string; label: string; enabled: boolean; revision: number }[]
	>`
		select id, label, enabled, revision from app.support_tag where id = ${tagId} for update
	`;
	if (!existing) throw new AccessError(404, "NOT_FOUND");
	if (existing.revision !== expectedVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	const nextRevision = existing.revision + 1;
	const [updated] = await tx<
		{ id: string; label: string; enabled: boolean; revision: number }[]
	>`
		update app.support_tag
		set label = ${label},
		    enabled = ${enabled},
		    revision = ${nextRevision},
		    actor_id = ${principal.id},
		    updated_at = clock_timestamp()
		where id = ${tagId}
		returning id, label, enabled, revision
	`;
	const response = {
		id: updated.id,
		version: updated.revision,
		label: updated.label,
		enabled: updated.enabled,
	};
	await auditSupportDefinition(
		tx,
		principal.id,
		"support.tag.version",
		updated.id,
		reason,
		{
			version: updated.revision,
			before: {
				id: existing.id,
				version: existing.revision,
				label: existing.label,
				enabled: existing.enabled,
			},
			after: response,
		},
	);
	await saveOperation(tx, principal.id, action, key, requestHash, response);
	return response;
}
