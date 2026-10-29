import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
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
import { authorizeOrder } from "../checkout/orders.ts";
import {
	requireOwnedConversation,
	requireStaffConversation,
	toCommerceActor,
} from "./actors.ts";
import { verifyPublishedProduct } from "./conversations.ts";
import {
	type ConversationRow,
	checkOperation,
	escapeExcerpt,
	type MessageRow,
	orderContextTitle,
	type SupportCustomerActor,
	saveOperation,
} from "./shared.ts";

export async function projectMessage(
	tx: TransactionSql,
	row: MessageRow,
	conversation: ConversationRow,
) {
	const attachments = row.redacted_at
		? []
		: await tx<
				{
					id: string;
					content_type: "image/jpeg" | "image/png" | "image/webp";
					byte_size: number;
					scan_status: "pending_scan" | "ready" | "rejected";
				}[]
			>`
				select id, content_type, byte_size, scan_status
				from app.support_attachment
				where message_id = ${row.id} and conversation_id = ${row.conversation_id}
				order by created_at asc, id asc
			`;

	let reply: {
		message_id: string;
		state: "visible" | "redacted" | "expired";
		excerpt: string;
	} | null = null;
	if (row.reply_to_message_id) {
		const [target] = await tx<MessageRow[]>`
			select * from app.support_message
			where id = ${row.reply_to_message_id} and conversation_id = ${row.conversation_id}
		`;
		if (!target) {
			reply = {
				message_id: row.reply_to_message_id,
				state: "expired",
				excerpt: "",
			};
		} else if (target.redacted_at) {
			reply = { message_id: target.id, state: "redacted", excerpt: "" };
		} else {
			reply = {
				message_id: target.id,
				state: "visible",
				excerpt: escapeExcerpt(target.body || "[Lampiran gambar]", 500),
			};
		}
	}

	let context: {
		kind: "product" | "order";
		product_id?: string;
		variant_id?: string;
		order_id?: string;
		title: string;
		availability: "available" | "unavailable" | "redacted";
		snapshot_at: string;
	} | null = null;

	const [card] = await tx<
		{
			kind: "product" | "order";
			resource_id: string;
			snapshot: {
				title?: string;
				variant_id?: string;
				snapshot_at?: string;
				revoked?: boolean;
			};
			created_at: string;
		}[]
	>`
		select kind, resource_id, snapshot, created_at
		from app.support_context_card
		where message_id = ${row.id} and conversation_id = ${row.conversation_id}
		limit 1
	`;
	if (card) {
		const snapshotAt = new Date(
			card.snapshot.snapshot_at ?? card.created_at,
		).toISOString();
		if (row.redacted_at) {
			context =
				card.kind === "product"
					? {
							kind: "product",
							product_id: card.resource_id,
							title: "Konteks dihapus",
							availability: "redacted",
							snapshot_at: snapshotAt,
						}
					: {
							kind: "order",
							order_id: card.resource_id,
							title: "Konteks dihapus",
							availability: "redacted",
							snapshot_at: snapshotAt,
						};
		} else if (card.kind === "product") {
			const [prod] = await tx<{ revision: number }[]>`
				select h.revision from app.publication_head h join app.publication_version pub
					on pub.product_id = h.product_id and pub.revision = h.revision
				where h.product_id = ${card.resource_id} and not exists (select 1 from app.publication_withdrawal w where w.publication_id = pub.id)
			`;
			const available =
				Boolean(prod && prod.revision > 0) && !card.snapshot.revoked;
			context = {
				kind: "product",
				product_id: card.resource_id,
				...(card.snapshot.variant_id
					? { variant_id: card.snapshot.variant_id }
					: {}),
				title: available
					? (card.snapshot.title ?? "Produk 99ribu")
					: "Produk tidak tersedia",
				availability: available ? "available" : "unavailable",
				snapshot_at: snapshotAt,
			};
		} else {
			const [ord] = await tx<{ id: string; number: string; status: string }[]>`
				select id, number, status from app.commerce_order where id = ${card.resource_id}
			`;
			const available =
				Boolean(ord) &&
				!card.snapshot.revoked &&
				conversation.primary_order_id === card.resource_id;
			context = {
				kind: "order",
				order_id: card.resource_id,
				title:
					available && ord
						? orderContextTitle(ord.number, ord.status)
						: "Pesanan tidak tersedia",
				availability: available ? "available" : "unavailable",
				snapshot_at: snapshotAt,
			};
		}
	}

	return {
		id: row.id,
		conversation_id: row.conversation_id,
		sequence: row.public_sequence,
		client_message_id: row.client_message_id,
		sender: row.sender_side,
		text: row.redacted_at ? "[Pesan dihapus]" : row.body,
		attachments: attachments.map((a) => ({
			id: a.id,
			media_type: a.content_type,
			size_bytes: a.byte_size,
			status: a.scan_status,
		})),
		created_at: new Date(row.created_at).toISOString(),
		...(reply ? { reply } : {}),
		...(context ? { context } : {}),
	};
}

export async function listPublicMessages(
	tx: TransactionSql,
	conversation: ConversationRow,
	url: URL,
) {
	for (const k of url.searchParams.keys()) {
		if (
			!["cursor", "limit", "around_sequence"].includes(k) ||
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
	const aroundRaw = url.searchParams.get("around_sequence");
	if (cursor && aroundRaw !== null) throw invalid();

	let rows: MessageRow[];
	let hasMore = false;
	if (aroundRaw !== null) {
		if (!/^\d+$/.test(aroundRaw)) throw invalid();
		const around = integer(Number(aroundRaw), 1);
		const half = Math.max(1, Math.floor(limit / 2));
		rows = await tx<MessageRow[]>`
			select * from app.support_message
			where conversation_id = ${conversation.id}
			  and public_sequence between ${Math.max(1, around - half)} and ${around + half}
			order by public_sequence asc
		`;
	} else {
		const allRows = await tx<MessageRow[]>`
			select * from app.support_message
			where conversation_id = ${conversation.id}
			order by public_sequence asc
		`;
		let startIndex = 0;
		if (cursor) {
			const idx = allRows.findIndex((r) => r.id === cursor);
			if (idx === -1) throw new AccessError(400, "INVALID_CURSOR");
			startIndex = idx + 1;
		}
		rows = allRows.slice(startIndex, startIndex + limit);
		hasMore = startIndex + limit < allRows.length;
	}
	const data = [];
	for (const row of rows) {
		data.push(await projectMessage(tx, row, conversation));
	}
	return {
		data,
		pagination: {
			next_cursor: hasMore && rows.length > 0 ? rows[rows.length - 1].id : null,
			has_more: hasMore,
		},
	};
}

function parseContextInput(value: unknown): {
	kind: "product" | "order";
	product_id?: string;
	variant_id?: string;
	order_id?: string;
} {
	const data = object(value, ["kind", "product_id", "variant_id", "order_id"]);
	if (data.kind === "product") {
		if (data.order_id !== undefined) throw invalid();
		const productId = id(data.product_id);
		const variantId =
			data.variant_id !== undefined ? id(data.variant_id) : undefined;
		return {
			kind: "product",
			product_id: productId,
			...(variantId ? { variant_id: variantId } : {}),
		};
	}
	if (data.kind === "order") {
		if (data.product_id !== undefined || data.variant_id !== undefined)
			throw invalid();
		return { kind: "order", order_id: id(data.order_id) };
	}
	throw invalid();
}

export async function commitPublicMessage(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	conversationIdParam: string,
	sender:
		| { side: "buyer"; actor: SupportCustomerActor }
		| { side: "customer_service"; principal: Principal },
	value: unknown,
) {
	const key = mutationKey(request);
	const body = object(value, [
		"client_message_id",
		"text",
		"attachment_ids",
		"reply_to_message_id",
		"context",
	]);
	const clientMessageId = text(body.client_message_id, 100);
	if (
		clientMessageId.length < 16 ||
		!/^[A-Za-z0-9_-]{16,100}$/.test(clientMessageId)
	) {
		throw invalid();
	}
	const rawText = text(body.text, 4000, true);
	const attachmentIds = array(body.attachment_ids, (v) => id(v), 0, 3);
	if (new Set(attachmentIds).size !== attachmentIds.length) throw invalid();
	const replyToMessageId =
		body.reply_to_message_id !== undefined
			? id(body.reply_to_message_id)
			: null;
	const contextInput =
		body.context !== undefined ? parseContextInput(body.context) : null;

	if (contextInput?.kind !== "order" && request.headers.has("x-order-token")) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}
	if (!rawText.trim() && attachmentIds.length === 0) {
		throw invalid();
	}
	if (contextInput && !rawText.trim()) {
		throw invalid();
	}

	const conversation =
		sender.side === "buyer"
			? await requireOwnedConversation(
					tx,
					sender.actor,
					conversationIdParam,
					true,
				)
			: await requireStaffConversation(tx, conversationIdParam, true);

	if (
		sender.side === "customer_service" &&
		conversation.assigned_user_id !== sender.principal.id
	) {
		throw new AccessError(409, "CLAIM_REQUIRED");
	}

	const senderScope =
		sender.side === "buyer"
			? sender.actor.scope
			: `user:${sender.principal.id}`;
	const requestHash = digest(
		JSON.stringify({
			text: rawText,
			attachment_ids: attachmentIds,
			reply_to_message_id: replyToMessageId,
			context: contextInput,
		}),
	);

	const [existingMsg] = await tx<MessageRow[]>`
		select * from app.support_message
		where conversation_id = ${conversation.id}
		  and sender_side = ${sender.side}
		  and client_message_id = ${clientMessageId}
	`;
	if (existingMsg) {
		if (existingMsg.request_hash !== requestHash) {
			throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
		}
		return projectMessage(tx, existingMsg, conversation);
	}

	const priorByKey = await checkOperation(
		tx,
		senderScope,
		`support.message.send:${conversation.id}`,
		key,
		requestHash,
	);
	if (priorByKey) {
		const [msg] = await tx<MessageRow[]>`
			select * from app.support_message where id = ${(priorByKey as { id: string }).id}
		`;
		if (msg) return projectMessage(tx, msg, conversation);
	}

	if (replyToMessageId) {
		const [replyTarget] = await tx<MessageRow[]>`
			select * from app.support_message
			where id = ${replyToMessageId} and conversation_id = ${conversation.id}
		`;
		if (!replyTarget || replyTarget.redacted_at) {
			throw new AccessError(400, "INVALID_REPLY_TARGET");
		}
	}

	if (attachmentIds.length > 0) {
		const attachments = await tx<
			{
				id: string;
				conversation_id: string;
				message_id: string | null;
				uploader_scope: string;
				scan_status: string;
			}[]
		>`
			select id, conversation_id, message_id, uploader_scope, scan_status
			from app.support_attachment
			where id in ${tx(attachmentIds)}
			for update
		`;
		if (attachments.length !== attachmentIds.length) {
			throw new AccessError(404, "NOT_FOUND");
		}
		for (const att of attachments) {
			if (
				att.conversation_id !== conversation.id ||
				att.uploader_scope !== senderScope
			) {
				throw new AccessError(403, "FORBIDDEN");
			}
			if (att.scan_status !== "ready") {
				throw new AccessError(409, "ATTACHMENT_NOT_READY");
			}
			if (att.message_id !== null) {
				throw new AccessError(409, "ATTACHMENT_ALREADY_USED");
			}
		}
	}

	let contextCardData: {
		kind: "product" | "order";
		resourceId: string;
		snapshot: Record<string, unknown>;
	} | null = null;
	const [clock] = await tx<{ now: string }[]>`select clock_timestamp() as now`;
	const nowIso = new Date(clock.now).toISOString();

	if (contextInput) {
		if (contextInput.kind === "product" && contextInput.product_id) {
			const prod = await verifyPublishedProduct(
				tx,
				contextInput.product_id,
				contextInput.variant_id,
			);
			contextCardData = {
				kind: "product",
				resourceId: prod.productId,
				snapshot: {
					title: prod.title,
					...(prod.variantId ? { variant_id: prod.variantId } : {}),
					snapshot_at: nowIso,
				},
			};
		} else if (contextInput.kind === "order" && contextInput.order_id) {
			if (sender.side === "buyer") {
				const ord = await authorizeOrder(
					tx,
					request,
					identity,
					toCommerceActor(sender.actor),
					contextInput.order_id,
				);
				contextCardData = {
					kind: "order",
					resourceId: ord.id,
					snapshot: {
						title: orderContextTitle(ord.number, ord.status),
						snapshot_at: nowIso,
					},
				};
			} else {
				const [ord] = await tx<
					{
						id: string;
						number: string;
						status: string;
						owner_user_id: string | null;
					}[]
				>`
					select id, number, status, owner_user_id
					from app.commerce_order
					where id = ${contextInput.order_id}
				`;
				if (
					!ord ||
					(conversation.primary_order_id !== ord.id &&
						(!conversation.buyer_user_id ||
							ord.owner_user_id !== conversation.buyer_user_id))
				) {
					throw new AccessError(403, "FORBIDDEN");
				}
				contextCardData = {
					kind: "order",
					resourceId: ord.id,
					snapshot: {
						title: orderContextTitle(ord.number, ord.status),
						snapshot_at: nowIso,
					},
				};
			}
		}
	}

	const nextSequence = conversation.public_sequence + 1;
	const reopen = sender.side === "buyer" && conversation.status !== "open";
	const nextStatus = reopen ? "open" : conversation.status;
	const nextRevision =
		sender.side === "buyer" ? conversation.revision + 1 : conversation.revision;
	const nextProductId =
		contextCardData?.kind === "product"
			? (conversation.primary_product_id ?? contextCardData.resourceId)
			: conversation.primary_product_id;
	const nextOrderId =
		contextCardData?.kind === "order"
			? contextCardData.resourceId
			: conversation.primary_order_id;

	const [updatedConv] = await tx<ConversationRow[]>`
		update app.support_conversation
		set public_sequence = ${nextSequence},
		    status = ${nextStatus},
		    revision = ${nextRevision},
		    primary_product_id = ${nextProductId},
		    primary_order_id = ${nextOrderId},
		    last_public_message_at = ${clock.now},
		    updated_at = ${clock.now}
		where id = ${conversation.id}
		returning *
	`;

	if (reopen) {
		await tx`
			insert into app.support_assignment_event (
				conversation_id, revision, kind, previous_user_id, assigned_user_id, actor_id, reason, created_at
			)
			values (
				${conversation.id},
				${nextRevision},
				'reopen',
				${conversation.assigned_user_id},
				${conversation.assigned_user_id},
				${senderScope},
				'Reopened by new customer message',
				${clock.now}
			)
		`;
	}

	const messageId = randomUUID();
	const [insertedMsg] = await tx<MessageRow[]>`
		insert into app.support_message (
			id, conversation_id, public_sequence, sender_side, sender_user_id, sender_guest_id,
			client_message_id, request_hash, body, reply_to_message_id, created_at
		)
		values (
			${messageId},
			${conversation.id},
			${nextSequence},
			${sender.side},
			${sender.side === "customer_service" ? sender.principal.id : sender.actor.kind === "user" ? sender.actor.id : null},
			${sender.side === "buyer" && sender.actor.kind === "guest" ? sender.actor.id : null},
			${clientMessageId},
			${requestHash},
			${rawText},
			${replyToMessageId},
			${clock.now}
		)
		returning *
	`;

	if (attachmentIds.length > 0) {
		await tx`
			update app.support_attachment
			set message_id = ${messageId}
			where id in ${tx(attachmentIds)} and conversation_id = ${conversation.id}
		`;
	}

	if (contextCardData) {
		await tx`
			insert into app.support_context_card (
				conversation_id, message_id, kind, resource_id, snapshot, created_at
			)
			values (
				${conversation.id},
				${messageId},
				${contextCardData.kind},
				${contextCardData.resourceId},
				${JSON.stringify(contextCardData.snapshot)}::jsonb,
				${clock.now}
			)
		`;
	}

	const readerSide = sender.side === "buyer" ? "customer" : "staff";
	await tx`
		insert into app.support_read_position (
			conversation_id, participant_scope, reader_side, last_read_sequence, updated_at
		)
		values (${conversation.id}, ${senderScope}, ${readerSide}, ${nextSequence}, ${clock.now})
		on conflict (conversation_id, participant_scope) do update
		set last_read_sequence = greatest(app.support_read_position.last_read_sequence, ${nextSequence}),
		    updated_at = ${clock.now}
	`;

	await tx`
		update app.support_participant_preference
		set archived = false,
		    revision = revision + 1,
		    updated_at = ${clock.now}
		where conversation_id = ${conversation.id}
		  and participant_scope <> ${senderScope}
		  and archived = true
	`;

	if (sender.side === "customer_service") {
		const recipientScope = updatedConv.buyer_user_id
			? `user:${updatedConv.buyer_user_id}`
			: updatedConv.guest_support_id
				? `guest_support:${updatedConv.guest_support_id}`
				: null;
		if (recipientScope) {
			const [pref] = await tx<{ muted: boolean }[]>`
				select muted from app.support_participant_preference
				where conversation_id = ${conversation.id} and participant_scope = ${recipientScope}
			`;
			if (!pref?.muted) {
				await tx`
					insert into app.support_in_app_notification (
						recipient_scope, event_key, conversation_id, kind, title, summary, state, created_at, updated_at
					)
					values (
						${recipientScope},
						${`msg:${messageId}`},
						${conversation.id},
						'support_attention',
						'Balasan layanan pelanggan',
						'Tim bantuan telah membalas percakapan Anda.',
						'unread',
						${clock.now},
						${clock.now}
					)
					on conflict (recipient_scope, event_key) do nothing
				`;
			}
		}
	} else if (updatedConv.assigned_user_id) {
		const recipientScope = `user:${updatedConv.assigned_user_id}`;
		await tx`
			insert into app.support_in_app_notification (
				recipient_scope, event_key, conversation_id, kind, title, summary, state, created_at, updated_at
			)
			values (
				${recipientScope},
				${`msg:${messageId}`},
				${conversation.id},
				'support_attention',
				'Pesan pelanggan baru',
				'Pelanggan mengirim pesan baru pada percakapan yang Anda klaim.',
				'unread',
				${clock.now},
				${clock.now}
			)
			on conflict (recipient_scope, event_key) do nothing
		`;
	}

	await saveOperation(
		tx,
		senderScope,
		`support.message.send:${conversation.id}`,
		key,
		requestHash,
		{
			id: messageId,
		},
	);
	return projectMessage(tx, insertedMsg, updatedConv);
}

export async function redactSupportMessage(
	tx: TransactionSql,
	messageIdParam: string,
	reason = "Redacted by authorized moderation",
) {
	const mid = id(messageIdParam);
	await tx`
		update app.support_message
		set redacted_at = clock_timestamp(),
		    redacted_reason = ${reason}
		where id = ${mid}
	`;
}

export async function revokeConversationOrderLink(
	tx: TransactionSql,
	conversationIdParam: string,
) {
	const cid = id(conversationIdParam);
	await tx`
		update app.support_conversation
		set primary_order_id = null,
		    revision = revision + 1,
		    updated_at = clock_timestamp()
		where id = ${cid}
	`;
}

export async function searchPublicMessages(
	tx: TransactionSql,
	request: Request,
	conversation: ConversationRow,
	callerScope: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const body = object(value, ["query", "cursor", "limit"]);
	const query = text(body.query, 200);
	const limit = body.limit !== undefined ? integer(body.limit, 1, 100) : 20;
	const cursorRaw = body.cursor !== undefined ? text(body.cursor, 2000) : null;

	const requestHash = digest(
		JSON.stringify({ query, cursor: cursorRaw, limit }),
	);
	const prior = await checkOperation(
		tx,
		callerScope,
		`support.message.search:${conversation.id}`,
		key,
		requestHash,
	);
	if (prior) return prior;

	let afterSeq = 0;
	if (cursorRaw) {
		const expectedPrefix = `msearch:${conversation.id}:${digest(query.toLowerCase())}:`;
		if (!cursorRaw.startsWith(expectedPrefix))
			throw new AccessError(400, "INVALID_CURSOR");
		const seqStr = cursorRaw.slice(expectedPrefix.length);
		if (!/^\d+$/.test(seqStr)) throw new AccessError(400, "INVALID_CURSOR");
		afterSeq = integer(Number(seqStr), 1);
	}

	const pattern = `%${query.toLowerCase()}%`;
	const matches = await tx<MessageRow[]>`
		select *
		from app.support_message
		where conversation_id = ${conversation.id}
		  and redacted_at is null
		  and public_sequence > ${afterSeq}
		  and lower(body) like ${pattern}
		order by public_sequence asc
		limit ${limit + 1}
	`;
	const hasMore = matches.length > limit;
	const page = matches.slice(0, limit);
	const data = page.map((m) => ({
		message_id: m.id,
		sequence: m.public_sequence,
		excerpt: escapeExcerpt(m.body, 500),
		created_at: new Date(m.created_at).toISOString(),
	}));
	const nextCursor =
		hasMore && page.length > 0
			? `msearch:${conversation.id}:${digest(query.toLowerCase())}:${page[page.length - 1].public_sequence}`
			: null;
	const response = {
		data,
		pagination: {
			next_cursor: nextCursor,
			has_more: hasMore,
		},
	};
	await saveOperation(
		tx,
		callerScope,
		`support.message.search:${conversation.id}`,
		key,
		requestHash,
		response,
	);
	return response;
}
