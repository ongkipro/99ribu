import type { LocalAuth } from "../access/auth.ts";
import { privateJson, readBody } from "../access/http.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { rateLimit } from "../access/rate-limit.ts";
import { object } from "../catalog/validation.ts";
import { createSupportConversation } from "../support/conversations.ts";
import { resolveSupportCustomer } from "../support/actors.ts";
import { commitPublicMessage } from "../support/messages.ts";

export const DELETION_REQUEST_TEXT =
	"Permintaan penghapusan akun: saya meminta akun dan data pribadi saya dihapus. Mohon kabari langkah berikutnya.";

// Account deletion request (S157): opens ONE support conversation with a fixed first message and deletes
// nothing; staff decide and act. The client ids derive from the buyer, so a repeated request (any
// Idempotency-Key) resolves to the same conversation and the same message instead of a second case.
// lazy: once that conversation is resolved a later request still returns it; a fresh request after
// resolution needs a request counter, which needs a migration.
export async function handleDataRequestRoutes(request: Request, identity: LocalAuth, url: URL, principal: Principal): Promise<Response | undefined> {
	if (url.pathname !== "/api/v1/me/data-requests") return undefined;
	if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
	object(await readBody(request), []);
	await rateLimit(identity.sql, `buyer-data-request:${principal.id}`, [5, 900_000]);
	const { conversation, replay } = await identity.sql.begin(async (tx) => {
		const created = await createSupportConversation(tx, request, identity, { client_conversation_id: `data-request-${principal.id}` });
		// The fixed first message exists only if this buyer's request was already recorded: a replay.
		const [prior] = await tx<{ id: string }[]>`select id from app.support_message where conversation_id = ${created.id} and client_message_id = ${`data-request-delete-${principal.id}`}`;
		const actor = await resolveSupportCustomer(tx, request, identity);
		await commitPublicMessage(tx, request, identity, created.id, { side: "buyer", actor }, { client_message_id: `data-request-delete-${principal.id}`, text: DELETION_REQUEST_TEXT, attachment_ids: [] });
		return { conversation: created, replay: Boolean(prior) };
	});
	return privateJson({ kind: "account_deletion", conversation_id: conversation.id, status: "received" }, replay ? 200 : 201);
}
