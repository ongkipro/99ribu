import type { TransactionSql } from "postgres";
import {
	scanImagePayload,
	sniffImageContentType,
} from "../../storage/media-sniff.ts";
import {
	deletePrivateArtifact,
	readPrivateArtifact,
	savePrivateArtifact,
} from "../../storage/private.ts";
import type { LocalAuth } from "../access/auth.ts";
import { AccessError, getPrincipal } from "../access/policy.ts";
import { id, invalid, text } from "../catalog/validation.ts";
import { digest } from "../checkout/access.ts";
import { mutationKey } from "../checkout/carts.ts";
import {
	requireOwnedConversation,
	requireStaffConversation,
	resolveSupportCustomer,
} from "./actors.ts";
import {
	type ConversationRow,
	checkOperation,
	MAX_IMAGE_BYTES,
	saveOperation,
} from "./shared.ts";

async function resolveAttachmentCaller(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	conversationIdParam: string,
): Promise<{
	conversation: ConversationRow;
	callerScope: string;
	isStaff: boolean;
}> {
	if (
		request.headers.has("authorization") ||
		request.headers.has("x-cart-token") ||
		request.headers.has("x-order-token")
	) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}
	const session = await identity.auth.api.getSession({
		headers: request.headers,
		query: { disableCookieCache: true },
	});
	if (session) {
		const principal = await getPrincipal(request, identity);
		if (
			principal.roles.includes("owner") ||
			principal.roles.includes("customer_service")
		) {
			const conv = await requireStaffConversation(
				tx,
				conversationIdParam,
				false,
			);
			if (conv.buyer_user_id === principal.id) {
				return {
					conversation: conv,
					callerScope: `user:${principal.id}`,
					isStaff: false,
				};
			}
			if (conv.assigned_user_id !== principal.id) {
				throw new AccessError(403, "CLAIM_REQUIRED");
			}
			return {
				conversation: conv,
				callerScope: `user:${principal.id}`,
				isStaff: true,
			};
		}
	}
	const actor = await resolveSupportCustomer(tx, request, identity);
	const conv = await requireOwnedConversation(
		tx,
		actor,
		conversationIdParam,
		false,
	);
	return { conversation: conv, callerScope: actor.scope, isStaff: false };
}

export async function uploadSupportAttachment(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	conversationIdParam: string,
) {
	const key = mutationKey(request);
	const { conversation, callerScope } = await resolveAttachmentCaller(
		tx,
		request,
		identity,
		conversationIdParam,
	);
	const contentTypeHeader =
		request.headers.get("content-type")?.toLowerCase() ?? "";
	if (!contentTypeHeader.startsWith("multipart/form-data")) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		throw new AccessError(400, "INVALID_INPUT");
	}
	const keys = [...form.keys()];
	if (
		keys.length !== 2 ||
		!keys.includes("client_attachment_id") ||
		!keys.includes("file") ||
		form.getAll("client_attachment_id").length !== 1 ||
		form.getAll("file").length !== 1
	) {
		throw invalid();
	}
	const clientAttachmentId = text(form.get("client_attachment_id"), 100);
	if (
		clientAttachmentId.length < 16 ||
		!/^[A-Za-z0-9_-]{16,100}$/.test(clientAttachmentId)
	) {
		throw invalid();
	}
	const fileEntry = form.get("file");
	if (!(fileEntry instanceof Blob)) throw invalid();
	const bytes = new Uint8Array(await fileEntry.arrayBuffer());
	if (bytes.byteLength < 1 || bytes.byteLength > MAX_IMAGE_BYTES) {
		throw new AccessError(400, "INVALID_IMAGE_SIZE");
	}
	const mediaType = sniffImageContentType(bytes);
	const scanStatus = scanImagePayload(bytes);
	const sha256 = digest(Buffer.from(bytes).toString("base64"));
	const requestHash = digest(
		JSON.stringify({
			clientAttachmentId,
			sha256,
			byteLength: bytes.byteLength,
		}),
	);

	const prior = await checkOperation(
		tx,
		callerScope,
		`support.attachment.upload:${conversation.id}`,
		key,
		requestHash,
	);
	if (prior) return prior;

	const priorClient = await checkOperation(
		tx,
		callerScope,
		`support.attachment.client:${conversation.id}`,
		clientAttachmentId,
		requestHash,
	);
	if (priorClient) return priorClient;

	const storageKey = await savePrivateArtifact(bytes);
	// Remove the file if the row is never written so a failed request leaves no orphan.
	// lazy: a failure at COMMIT after this point can still orphan; a sweeper owns that case.
	try {
		const [inserted] = await tx<
			{
				id: string;
				content_type: "image/jpeg" | "image/png" | "image/webp";
				byte_size: number;
				scan_status: "pending_scan" | "ready" | "rejected";
			}[]
		>`
			insert into app.support_attachment (
				conversation_id, uploader_scope, content_type, byte_size, sha256, storage_key, scan_status
			)
			values (
				${conversation.id}, ${callerScope}, ${mediaType}, ${bytes.byteLength}, ${sha256}, ${storageKey}, ${scanStatus}
			)
			returning id, content_type, byte_size, scan_status
		`;
		const response = {
			id: inserted.id,
			media_type: inserted.content_type,
			size_bytes: inserted.byte_size,
			status: inserted.scan_status,
		};
		await saveOperation(
			tx,
			callerScope,
			`support.attachment.upload:${conversation.id}`,
			key,
			requestHash,
			response,
		);
		await saveOperation(
			tx,
			callerScope,
			`support.attachment.client:${conversation.id}`,
			clientAttachmentId,
			requestHash,
			response,
		);
		return response;
	} catch (error) {
		await deletePrivateArtifact(storageKey).catch(() => undefined);
		throw error;
	}
}

export async function getSupportAttachment(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	conversationIdParam: string,
	attachmentIdParam: string,
) {
	const { conversation, callerScope } = await resolveAttachmentCaller(
		tx,
		request,
		identity,
		conversationIdParam,
	);
	const attachmentId = id(attachmentIdParam);
	const [row] = await tx<
		{
			id: string;
			conversation_id: string;
			message_id: string | null;
			uploader_scope: string;
			content_type: "image/jpeg" | "image/png" | "image/webp";
			byte_size: number;
			storage_key: string;
			scan_status: "pending_scan" | "ready" | "rejected";
		}[]
	>`
		select * from app.support_attachment
		where id = ${attachmentId} and conversation_id = ${conversation.id}
	`;
	if (!row) throw new AccessError(404, "NOT_FOUND");
	if (row.message_id === null && row.uploader_scope !== callerScope) {
		throw new AccessError(404, "NOT_FOUND");
	}
	if (row.message_id !== null) {
		const [msg] = await tx<{ redacted_at: string | null }[]>`
			select redacted_at from app.support_message where id = ${row.message_id}
		`;
		if (!msg || msg.redacted_at !== null) {
			throw new AccessError(404, "NOT_FOUND");
		}
	}
	const accept = request.headers.get("accept") ?? "";
	if (accept.includes("application/json")) {
		return {
			kind: "json" as const,
			body: {
				id: row.id,
				media_type: row.content_type,
				size_bytes: row.byte_size,
				status: row.scan_status,
			},
		};
	}
	if (row.scan_status !== "ready") {
		throw new AccessError(404, "ATTACHMENT_NOT_READY");
	}
	const bytes = await readPrivateArtifact(row.storage_key);
	const ext =
		row.content_type === "image/png"
			? "png"
			: row.content_type === "image/webp"
				? "webp"
				: "jpg";
	return {
		kind: "binary" as const,
		bytes,
		contentType: row.content_type,
		filename: `support-${row.id}.${ext}`,
	};
}
