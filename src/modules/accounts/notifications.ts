import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { privateJson, readBody } from "../access/http.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { id, integer, invalid, object, } from "../catalog/validation.ts";
import { intentHash, mutationKey } from "../checkout/carts.ts";
import { boolean, type NotificationPreferenceResponse, type PrivateNotificationResponse, parsePagination, checkIdempotency, saveIdempotency } from "./shared.ts";

export async function createBuyerNotification(
	tx: TransactionSql,
	input: {
		userId: string;
		eventKey: string;
		kind: "order_update" | "return_update" | "support_reply";
		title: string;
		body: string;
		conversationId?: string | null;
	},
): Promise<PrivateNotificationResponse | null> {
	await tx`
		insert into app.buyer_notification_preference (user_id)
		values (${input.userId})
		on conflict (user_id) do nothing
	`;
	const [pref] = await tx<
		{
			order_updates_in_app: boolean;
			support_replies_in_app: boolean;
		}[]
	>`
		select order_updates_in_app, support_replies_in_app
		from app.buyer_notification_preference
		where user_id = ${input.userId}
	`;
	if (
		(input.kind === "order_update" || input.kind === "return_update") &&
		pref &&
		!pref.order_updates_in_app
	) {
		return null;
	}
	if (input.kind === "support_reply" && pref && !pref.support_replies_in_app) {
		return null;
	}
	const scope = `user:${input.userId}`;
	const [inserted] = await tx<
		{
			id: string;
			kind: "order_update" | "return_update" | "support_reply";
			title: string;
			summary: string;
			state: "unread" | "read";
			created_at: string;
		}[]
	>`
		insert into app.support_in_app_notification (
			recipient_scope,
			event_key,
			conversation_id,
			kind,
			title,
			summary,
			state
		)
		values (
			${scope},
			${input.eventKey},
			${input.conversationId ?? null},
			${input.kind},
			${input.title.slice(0, 200)},
			${input.body.slice(0, 1000)},
			'unread'
		)
		on conflict (recipient_scope, event_key) do update
			set updated_at = app.support_in_app_notification.updated_at
		returning id, kind, title, summary, state, created_at
	`;
	if (!inserted) return null;
	return {
		id: String(inserted.id),
		kind: inserted.kind,
		title: inserted.title,
		body: inserted.summary,
		state: inserted.state,
		created_at: new Date(inserted.created_at).toISOString(),
	};
}

export async function ensureOrderNotifications(
	tx: TransactionSql,
	userId: string,
	orderUpdatesEnabled: boolean,
) {
	if (!orderUpdatesEnabled) return;
	const orders = await tx<{ id: string; number: string; status: string }[]>`
		select o.id, o.number, o.status
		from app.commerce_order o
		where o.owner_user_id = ${userId}
			or exists (
				select 1 from app.buyer_identity_challenge c
				where c.user_id = ${userId}
					and c.kind = 'guest_order_link'
					and c.status = 'verified'
					and c.order_id = o.id
			)
		order by o.created_at desc
		limit 10
	`;
	for (const ord of orders) {
		await createBuyerNotification(tx, {
			userId,
			eventKey: `order:${ord.id}:${ord.status}`,
			kind: "order_update",
			title: `Pesanan ${ord.number}`,
			body: `Status pesanan ${ord.number}: ${ord.status}.`,
		});
	}
}

export async function handleNotificationRoutes(
	request: Request,
	identity: LocalAuth,
	url: URL,
	principal: Principal,
): Promise<Response | undefined> {
	// 9. Notification preferences: GET / POST /api/v1/me/notification-preferences
	if (url.pathname === "/api/v1/me/notification-preferences") {
		if (request.method === "GET") {
			if (url.search) throw invalid();
			const pref = await identity.sql.begin(async (tx) => {
				await tx`
					insert into app.buyer_notification_preference (user_id)
					values (${principal.id})
					on conflict (user_id) do nothing
				`;
				const [row] = await tx<
					{
						revision: number;
						order_updates_in_app: boolean;
						support_replies_in_app: boolean;
						order_updates_email: boolean;
					}[]
				>`
					select revision, order_updates_in_app, support_replies_in_app, order_updates_email
					from app.buyer_notification_preference
					where user_id = ${principal.id}
				`;
				return {
					version: Number(row.revision),
					in_app_order_updates: Boolean(row.order_updates_in_app),
					in_app_support_updates: Boolean(row.support_replies_in_app),
					email_order_updates: Boolean(row.order_updates_email),
				};
			});
			return privateJson(pref, 200);
		}
		if (request.method === "POST") {
			const key = mutationKey(request);
			const body = object(await readBody(request), [
				"expected_version",
				"in_app_order_updates",
				"in_app_support_updates",
				"email_order_updates",
			]);
			const expectedVersion = integer(body.expected_version, 1, 2147483647);
			const inAppOrderUpdates = boolean(body.in_app_order_updates);
			const inAppSupportUpdates = boolean(body.in_app_support_updates);
			const emailOrderUpdates = boolean(body.email_order_updates);
			const hash = await intentHash(
				identity,
				"buyer.notification_preferences.update",
				{
					expectedVersion,
					inAppOrderUpdates,
					inAppSupportUpdates,
					emailOrderUpdates,
				},
			);
			const updated = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<NotificationPreferenceResponse>(
					tx,
					principal.id,
					"buyer.notification_preferences.update",
					key,
					hash,
				);
				if (prior) return prior;
				await tx`
					insert into app.buyer_notification_preference (user_id)
					values (${principal.id})
					on conflict (user_id) do nothing
				`;
				const [current] = await tx<{ revision: number }[]>`
					select revision from app.buyer_notification_preference
					where user_id = ${principal.id}
					for update
				`;
				if (!current || Number(current.revision) !== expectedVersion) {
					throw new AccessError(409, "PREFERENCE_VERSION_CONFLICT");
				}
				const [row] = await tx<
					{
						revision: number;
						order_updates_in_app: boolean;
						support_replies_in_app: boolean;
						order_updates_email: boolean;
					}[]
				>`
					update app.buyer_notification_preference
					set
						order_updates_in_app = ${inAppOrderUpdates},
						support_replies_in_app = ${inAppSupportUpdates},
						order_updates_email = ${emailOrderUpdates},
						revision = revision + 1,
						updated_at = clock_timestamp()
					where user_id = ${principal.id}
					returning revision, order_updates_in_app, support_replies_in_app, order_updates_email
				`;
				const response: NotificationPreferenceResponse = {
					version: Number(row.revision),
					in_app_order_updates: Boolean(row.order_updates_in_app),
					in_app_support_updates: Boolean(row.support_replies_in_app),
					email_order_updates: Boolean(row.order_updates_email),
				};
				return saveIdempotency(
					tx,
					principal.id,
					"buyer.notification_preferences.update",
					key,
					hash,
					principal.id,
					"Updated buyer notification preferences",
					response,
				);
			});
			return privateJson(updated, 201);
		}
		throw new AccessError(404, "NOT_FOUND");
	}

	// 10. Notifications list & state update: /api/v1/me/notifications(/[notificationId]/state)
	if (url.pathname === "/api/v1/me/notifications") {
		if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
		const paging = parsePagination(url);
		const list = await identity.sql.begin(async (tx) => {
			const scopes = [`user:${principal.id}`, principal.id];
			await tx`
				insert into app.buyer_notification_preference (user_id)
				values (${principal.id})
				on conflict (user_id) do nothing
			`;
			const [pref] = await tx<{ order_updates_in_app: boolean }[]>`
				select order_updates_in_app from app.buyer_notification_preference
				where user_id = ${principal.id}
			`;
			await ensureOrderNotifications(
				tx,
				principal.id,
				Boolean(pref?.order_updates_in_app ?? true),
			);
			let rows: {
				id: string;
				kind: "order_update" | "return_update" | "support_reply";
				title: string;
				summary: string;
				state: "unread" | "read";
				created_at: string;
			}[];
			if (paging.cursor) {
				const [anchor] = await tx<{ created_at: string }[]>`
					select created_at::text
					from app.support_in_app_notification
					where id = ${paging.cursor} and recipient_scope in ${tx(scopes)}
				`;
				if (!anchor) throw invalid();
				rows = await tx`
					select id, kind, title, summary, state, created_at
					from app.support_in_app_notification
					where recipient_scope in ${tx(scopes)}
						and (created_at, id) < (${anchor.created_at}::timestamptz, ${paging.cursor}::uuid)
					order by created_at desc, id desc
					limit ${paging.limit + 1}
				`;
			} else {
				rows = await tx`
					select id, kind, title, summary, state, created_at
					from app.support_in_app_notification
					where recipient_scope in ${tx(scopes)}
					order by created_at desc, id desc
					limit ${paging.limit + 1}
				`;
			}
			const slice = rows.slice(0, paging.limit);
			return {
				data: slice.map((r) => ({
					id: String(r.id),
					kind: r.kind,
					title: r.title,
					body: r.summary,
					state: r.state,
					created_at: new Date(r.created_at).toISOString(),
				})),
				pagination: {
					next_cursor:
						rows.length > paging.limit
							? String(slice.at(-1)?.id ?? null)
							: null,
				},
			};
		});
		return privateJson(list, 200);
	}

	const notifStateMatch =
		/^\/api\/v1\/me\/notifications\/([^/]+)\/state$/.exec(url.pathname);
	if (notifStateMatch) {
		if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
		const notificationId = id(notifStateMatch[1]);
		const key = mutationKey(request);
		const body = object(await readBody(request), ["state"]);
		if (body.state !== "read" && body.state !== "unread") {
			throw invalid();
		}
		const nextState = body.state;
		const hash = await intentHash(identity, "buyer.notification.state", {
			notificationId,
			nextState,
		});
		const updated = await identity.sql.begin(async (tx) => {
			const prior = await checkIdempotency<PrivateNotificationResponse>(
				tx,
				principal.id,
				"buyer.notification.state",
				key,
				hash,
			);
			if (prior) return prior;
			const scopes = [`user:${principal.id}`, principal.id];
			const [row] = await tx<
				{
					id: string;
					kind: "order_update" | "return_update" | "support_reply";
					title: string;
					summary: string;
					state: "unread" | "read";
					created_at: string;
				}[]
			>`
				update app.support_in_app_notification
				set state = ${nextState}, updated_at = clock_timestamp()
				where id = ${notificationId} and recipient_scope in ${tx(scopes)}
				returning id, kind, title, summary, state, created_at
			`;
			if (!row) throw new AccessError(404, "NOT_FOUND");
			const response: PrivateNotificationResponse = {
				id: String(row.id),
				kind: row.kind,
				title: row.title,
				body: row.summary,
				state: row.state,
				created_at: new Date(row.created_at).toISOString(),
			};
			return saveIdempotency(
				tx,
				principal.id,
				"buyer.notification.state",
				key,
				hash,
				notificationId,
				"Updated in-app notification read state",
				response,
			);
		});
		return privateJson(updated, 201);
	}
}
