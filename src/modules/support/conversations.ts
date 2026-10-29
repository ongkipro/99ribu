import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { AccessError } from "../access/policy.ts";
import { id, integer, invalid, object, text } from "../catalog/validation.ts";
import { digest } from "../checkout/access.ts";
import { mutationKey } from "../checkout/carts.ts";
import { authorizeOrder } from "../checkout/orders.ts";
import {
	requireOwnedConversation,
	resolveSupportCustomer,
	toCommerceActor,
} from "./actors.ts";
import {
	type ConversationRow,
	checkOperation,
	type SupportCustomerActor,
	saveOperation,
} from "./shared.ts";

export async function projectPublicConversation(
	tx: TransactionSql,
	row: ConversationRow,
) {
	const [reads] = await tx<{ buyer_read: number; staff_read: number }[]>`
		select
			coalesce(max(last_read_sequence) filter (where reader_side = 'customer'), 0)::int as buyer_read,
			coalesce(max(last_read_sequence) filter (where reader_side = 'staff'), 0)::int as staff_read
		from app.support_read_position
		where conversation_id = ${row.id}
	`;
	return {
		id: row.id,
		status: row.status,
		version: row.revision,
		created_at: new Date(row.created_at).toISOString(),
		updated_at: new Date(row.updated_at).toISOString(),
		last_message_sequence: row.public_sequence,
		...(row.primary_product_id ? { product_id: row.primary_product_id } : {}),
		...(row.primary_order_id ? { order_id: row.primary_order_id } : {}),
		buyer_last_read_sequence: reads?.buyer_read ?? 0,
		staff_last_read_sequence: reads?.staff_read ?? 0,
	};
}

export async function projectStaffConversation(
	tx: TransactionSql,
	row: ConversationRow,
	staffUserId: string,
) {
	const conversation = await projectPublicConversation(tx, row);
	// S113: the printed order number for the inbox (staff never read the raw order id there).
	// The admin numbers address the order and product pages (`/admin/pesanan/{n}`, `/admin/produk/{n}`); staff-only.
	const [facts] = await tx<
		{
			last_read_sequence: number | null;
			order_number: string | null;
			order_admin_no: string | null;
			product_admin_no: string | null;
		}[]
	>`
		select
			(select last_read_sequence from app.support_read_position
			 where conversation_id = ${row.id} and participant_scope = ${`user:${staffUserId}`}) as last_read_sequence,
			(select number from app.commerce_order where id = ${row.primary_order_id ?? null}::uuid) as order_number,
			(select admin_no::text from app.commerce_order where id = ${row.primary_order_id ?? null}::uuid) as order_admin_no,
			(select admin_no::text from app.product where id = ${row.primary_product_id ?? null}::uuid) as product_admin_no
	`;
	const currentAgentRead = facts?.last_read_sequence ?? 0;
	const unread = Math.max(0, row.public_sequence - currentAgentRead);
	return {
		conversation,
		order_number: facts?.order_number ?? null,
		order_admin_no: facts?.order_admin_no == null ? null : Number(facts.order_admin_no),
		product_admin_no: facts?.product_admin_no == null ? null : Number(facts.product_admin_no),
		assignee_user_id: row.assigned_user_id ?? null,
		assignment_version: row.revision,
		current_agent_last_read_sequence: currentAgentRead,
		current_agent_unread_messages: unread,
	};
}

export async function verifyPublishedProduct(
	tx: TransactionSql,
	productId: string,
	variantId?: string | null,
) {
	const pid = id(productId);
	const [prod] = await tx<
		{
			id: string;
			publication_revision: number | null;
			published_revision: number | null;
		}[]
	>`
		select p.id, ph.revision as publication_revision, pub.product_revision as published_revision
		from app.product p
		left join app.publication_head ph on ph.product_id = p.id and ph.revision > 0
		left join app.publication_version pub on pub.product_id = p.id and pub.revision = ph.revision
			and not exists (select 1 from app.publication_withdrawal w where w.publication_id = pub.id)
		where p.id = ${pid}
	`;
	if (!prod?.publication_revision || prod.published_revision === null) {
		throw new AccessError(404, "NOT_FOUND");
	}
	const [rev] = await tx<{ name: string }[]>`
		select name from app.product_revision
		where product_id = ${pid} and revision = ${prod.published_revision}
	`;
	let title = rev?.name ?? "Produk 99ribu";
	if (variantId) {
		const vid = id(variantId);
		const [offer] = await tx<{ label: string }[]>`
			select v.label
			from app.offer o
			join app.offer_revision v
				on v.product_id = o.product_id
				and v.offer_id = o.id
				and v.revision = ${prod.published_revision}
			where o.id = ${vid} and o.product_id = ${pid} and v.retired = false
		`;
		if (!offer) throw new AccessError(404, "NOT_FOUND");
		title = `${title} — ${offer.label}`;
	}
	return {
		productId: pid,
		variantId: variantId ? id(variantId) : null,
		title: title.slice(0, 200),
	};
}

export async function createSupportConversation(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	value: unknown,
) {
	const key = mutationKey(request);
	const actor = await resolveSupportCustomer(tx, request, identity);
	const body = object(value, [
		"client_conversation_id",
		"product_id",
		"order_id",
	]);
	const clientConversationId = text(body.client_conversation_id, 100);
	if (
		clientConversationId.length < 16 ||
		!/^[A-Za-z0-9_-]{16,100}$/.test(clientConversationId)
	) {
		throw invalid();
	}
	const productId = body.product_id !== undefined ? id(body.product_id) : null;
	const orderId = body.order_id !== undefined ? id(body.order_id) : null;
	if (!orderId && request.headers.has("x-order-token")) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}

	if (productId) {
		await verifyPublishedProduct(tx, productId);
	}
	if (orderId) {
		await authorizeOrder(
			tx,
			request,
			identity,
			toCommerceActor(actor),
			orderId,
		);
	}

	const requestHash = digest(
		JSON.stringify({
			client_conversation_id: clientConversationId,
			product_id: productId,
			order_id: orderId,
		}),
	);

	await tx`select pg_advisory_xact_lock(hashtextextended(${`support.conv:${actor.scope}`}, 0))`;
	const priorByKey = await checkOperation(
		tx,
		actor.scope,
		"support.conversation.create",
		key,
		requestHash,
	);
	if (priorByKey) {
		const [existing] = await tx<ConversationRow[]>`
			select * from app.support_conversation where id = ${(priorByKey as { id: string }).id}
		`;
		if (existing) return projectPublicConversation(tx, existing);
	}
	const priorByClient = await checkOperation(
		tx,
		actor.scope,
		"support.conversation.client",
		clientConversationId,
		requestHash,
	);
	if (priorByClient) {
		const [existing] = await tx<ConversationRow[]>`
			select * from app.support_conversation where id = ${(priorByClient as { id: string }).id}
		`;
		if (existing) return projectPublicConversation(tx, existing);
	}

	const [converged] = await tx<ConversationRow[]>`
		select *
		from app.support_conversation
		where status in ('open', 'waiting_customer')
		  and ${actor.kind === "user" ? tx`buyer_user_id = ${actor.id}` : tx`guest_support_id = ${actor.id}`}
		  and primary_product_id is not distinct from ${productId}
		  and primary_order_id is not distinct from ${orderId}
		order by created_at desc
		limit 1
		for update
	`;
	const row =
		converged ??
		(
			await tx<ConversationRow[]>`
				insert into app.support_conversation (
					buyer_user_id, guest_support_id, primary_product_id, primary_order_id, status, priority, public_sequence, revision
				)
				values (
					${actor.kind === "user" ? actor.id : null},
					${actor.kind === "guest" ? actor.id : null},
					${productId},
					${orderId},
					'open',
					'normal',
					0,
					1
				)
				returning *
			`
		)[0];
	const projected = await projectPublicConversation(tx, row);
	await saveOperation(
		tx,
		actor.scope,
		"support.conversation.create",
		key,
		requestHash,
		{ id: row.id },
	);
	await saveOperation(
		tx,
		actor.scope,
		"support.conversation.client",
		clientConversationId,
		requestHash,
		{
			id: row.id,
		},
	);
	return projected;
}

export async function listCustomerConversations(
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
			!["cursor", "limit", "view", "status"].includes(k) ||
			url.searchParams.getAll(k).length !== 1
		) {
			throw invalid();
		}
	}
	const limitRaw = url.searchParams.get("limit") ?? "20";
	if (!/^\d{1,3}$/.test(limitRaw)) throw invalid();
	const limit = integer(Number(limitRaw), 1, 100);
	const cursor = url.searchParams.has("cursor")
		? id(url.searchParams.get("cursor"))
		: null;
	const view = url.searchParams.get("view") ?? "active";
	if (!["active", "archived", "all"].includes(view)) throw invalid();
	const status = url.searchParams.get("status");
	if (
		status !== null &&
		!["open", "waiting_customer", "resolved"].includes(status)
	)
		throw invalid();

	return queryCustomerConversationList(tx, actor, {
		limit,
		cursor,
		view,
		status,
		query: null,
	});
}

export async function searchCustomerConversations(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	value: unknown,
) {
	if (request.headers.has("x-order-token"))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	const key = mutationKey(request);
	const actor = await resolveSupportCustomer(tx, request, identity);
	const body = object(value, ["query", "cursor", "limit", "view", "status"]);
	const query = text(body.query, 200);
	const limit = body.limit !== undefined ? integer(body.limit, 1, 100) : 20;
	const cursor = body.cursor !== undefined ? id(body.cursor) : null;
	const view = body.view !== undefined ? text(body.view, 20) : "all";
	if (!["active", "archived", "all"].includes(view)) throw invalid();
	const status = body.status !== undefined ? text(body.status, 30) : null;
	if (
		status !== null &&
		!["open", "waiting_customer", "resolved"].includes(status)
	)
		throw invalid();

	const requestHash = digest(
		JSON.stringify({ query, cursor, limit, view, status }),
	);
	const prior = await checkOperation(
		tx,
		actor.scope,
		"support.conversation.search",
		key,
		requestHash,
	);
	if (prior) return prior;

	const result = await queryCustomerConversationList(tx, actor, {
		limit,
		cursor,
		view,
		status,
		query,
	});
	await saveOperation(
		tx,
		actor.scope,
		"support.conversation.search",
		key,
		requestHash,
		result,
	);
	return result;
}

async function queryCustomerConversationList(
	tx: TransactionSql,
	actor: SupportCustomerActor,
	opts: {
		limit: number;
		cursor: string | null;
		view: string;
		status: string | null;
		query: string | null;
	},
) {
	const ownerFilter =
		actor.kind === "user"
			? actor.linkedGuestIds.length > 0
				? tx`(c.buyer_user_id = ${actor.id} or c.guest_support_id in ${tx(actor.linkedGuestIds)})`
				: tx`c.buyer_user_id = ${actor.id}`
			: tx`c.guest_support_id = ${actor.id}`;
	const viewFilter =
		opts.view === "active"
			? tx`and coalesce(p.archived, false) = false`
			: opts.view === "archived"
				? tx`and coalesce(p.archived, false) = true`
				: tx``;
	const statusFilter = opts.status ? tx`and c.status = ${opts.status}` : tx``;
	const pattern = opts.query ? `%${opts.query.toLowerCase()}%` : null;
	const searchFilter = pattern
		? tx`and (
				lower(c.status) like ${pattern}
				or lower(c.id::text) like ${pattern}
				or exists (
					select 1 from app.commerce_order o
					where o.id = c.primary_order_id and lower(o.number) like ${pattern}
				)
				or exists (
					select 1 from app.product_revision pv
					where pv.product_id = c.primary_product_id and lower(pv.name) like ${pattern}
				)
			)`
		: tx``;

	const allRows = await tx<ConversationRow[]>`
		select c.*
		from app.support_conversation c
		left join app.support_participant_preference p
			on p.conversation_id = c.id and p.participant_scope = ${actor.scope}
		where ${ownerFilter}
		  ${viewFilter}
		  ${statusFilter}
		  ${searchFilter}
		order by coalesce(c.last_public_message_at, c.created_at) desc, c.id desc
	`;
	let startIndex = 0;
	if (opts.cursor) {
		const idx = allRows.findIndex((r) => r.id === opts.cursor);
		if (idx === -1) throw new AccessError(400, "INVALID_CURSOR");
		startIndex = idx + 1;
	}
	const pageRows = allRows.slice(startIndex, startIndex + opts.limit);
	const hasMore = startIndex + opts.limit < allRows.length;
	const data = [];
	for (const row of pageRows) {
		data.push(await projectPublicConversation(tx, row));
	}
	return {
		data,
		pagination: {
			next_cursor:
				hasMore && pageRows.length > 0
					? pageRows[pageRows.length - 1].id
					: null,
			has_more: hasMore,
		},
	};
}

export async function getCustomerConversation(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	conversationId: string,
) {
	if (request.headers.has("x-order-token"))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	const actor = await resolveSupportCustomer(tx, request, identity);
	const row = await requireOwnedConversation(tx, actor, conversationId, false);
	return projectPublicConversation(tx, row);
}
