import type { TransactionSql } from "postgres";
import { AccessError } from "../access/policy.ts";
import { integer, invalid } from "../catalog/validation.ts";
import { projectMessage } from "./messages.ts";
import type { ConversationRow, MessageRow } from "./shared.ts";

export async function readPublicSupportEvents(
	tx: TransactionSql,
	request: Request,
	conversation: ConversationRow,
	url: URL,
) {
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
	const queryCursor = url.searchParams.get("cursor");
	const headerCursor = request.headers.get("last-event-id");
	if (
		queryCursor !== null &&
		headerCursor !== null &&
		queryCursor !== headerCursor
	) {
		throw new AccessError(400, "CURSOR_MISMATCH");
	}
	const effectiveCursor = queryCursor ?? headerCursor;
	let afterSequence = 0;
	if (effectiveCursor !== null) {
		if (effectiveCursor.startsWith("expired:")) {
			throw new AccessError(409, "CURSOR_EXPIRED");
		}
		const prefixStr = `evt:${conversation.id}:`;
		if (!effectiveCursor.startsWith(prefixStr)) {
			throw new AccessError(400, "INVALID_CURSOR");
		}
		const seqPart = effectiveCursor.slice(prefixStr.length);
		if (!/^\d+$/.test(seqPart)) throw new AccessError(400, "INVALID_CURSOR");
		afterSequence = integer(Number(seqPart), 0);
		if (afterSequence > conversation.public_sequence) {
			throw new AccessError(409, "CURSOR_EXPIRED");
		}
	}

	const rows = await tx<MessageRow[]>`
		select *
		from app.support_message
		where conversation_id = ${conversation.id}
		  and public_sequence > ${afterSequence}
		order by public_sequence asc
		limit ${limit + 1}
	`;
	const hasMore = rows.length > limit;
	const page = rows.slice(0, limit);
	const events = [];
	for (const msgRow of page) {
		const projected = await projectMessage(tx, msgRow, conversation);
		events.push({
			cursor: `evt:${conversation.id}:${msgRow.public_sequence}`,
			kind: "message" as const,
			conversation_id: conversation.id,
			message: projected,
		});
	}
	const nextCursor =
		hasMore && events.length > 0 ? events[events.length - 1].cursor : null;
	return {
		events,
		page: {
			data: events,
			pagination: {
				next_cursor: nextCursor,
				has_more: hasMore,
			},
		},
	};
}

export function formatSseStream(
	events: readonly { cursor: string; kind: string }[],
) {
	let out = ": heartbeat\n\n";
	for (const ev of events) {
		out += `id: ${ev.cursor}\nevent: ${ev.kind}\ndata: ${JSON.stringify(ev)}\n\n`;
	}
	return out;
}
