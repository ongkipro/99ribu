import type { LocalAuth } from "../access/auth.ts";
import { privateJson } from "../access/http.ts";
import { AccessError, getPrincipal, type Principal } from "../access/policy.ts";
import { invalid, } from "../catalog/validation.ts";
import { type OrderRow, projectOrder } from "../checkout/orders.ts";
import { summarizeAccountOrder, type AccountOrder } from "./order-summary.ts";
import { type NotificationPreferenceResponse, type PrivateNotificationResponse, parsePagination, ensureBuyerProfile, formatBuyerProfile, listActiveAddresses } from "./shared.ts";
import { ensureOrderNotifications } from "./notifications.ts";

// `orders: false` skips the per-order summaries for account pages that do not list orders.
export async function readBuyerAccountWorkspace(
	request: Request,
	identity: LocalAuth,
	options: { orders?: boolean } = {},
) {
	try {
		const principal = await getPrincipal(request, identity);
		return await identity.sql.begin(async (tx) => {
			const profileRow = await ensureBuyerProfile(tx, principal, false);
			const profile = formatBuyerProfile(profileRow);
			const addresses = await listActiveAddresses(
				tx,
				principal.id,
				50,
				null,
				profileRow.address_book_revision,
			);
			await tx`
				insert into app.buyer_notification_preference (user_id)
				values (${principal.id})
				on conflict (user_id) do nothing
			`;
			const [prefRow] = await tx<
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
			const preferences: NotificationPreferenceResponse = {
				version: Number(prefRow?.revision ?? 1),
				in_app_order_updates: Boolean(prefRow?.order_updates_in_app ?? true),
				in_app_support_updates: Boolean(
					prefRow?.support_replies_in_app ?? true,
				),
				email_order_updates: Boolean(prefRow?.order_updates_email ?? true),
			};
			await ensureOrderNotifications(
				tx,
				principal.id,
				preferences.in_app_order_updates,
			);
			const notifRows = await tx<
				{
					id: string;
					kind: "order_update" | "return_update" | "support_reply";
					title: string;
					summary: string;
					state: "unread" | "read";
					created_at: string;
				}[]
			>`
				select id, kind, title, summary, state, created_at
				from app.support_in_app_notification
				where recipient_scope in (${`user:${principal.id}`}, ${principal.id})
				order by created_at desc, id desc
				limit 20
			`;
			const notifications: PrivateNotificationResponse[] = notifRows.map(
				(row) => ({
					id: String(row.id),
					kind: row.kind,
					title: row.title,
					body: row.summary,
					state: row.state,
					created_at: new Date(row.created_at).toISOString(),
				}),
			);
			const orderRows = options.orders === false ? [] : await tx<{ id: string }[]>`
				select o.id
				from app.commerce_order o
				where o.owner_user_id = ${principal.id}
					or exists (
						select 1 from app.buyer_identity_challenge c
						where c.user_id = ${principal.id}
							and c.kind = 'guest_order_link'
							and c.status = 'verified'
							and c.order_id = o.id
					)
				order by o.created_at desc, o.id desc
				limit 20
			`;
			const orders: AccountOrder[] = [];
			for (const row of orderRows) {
				orders.push(await summarizeAccountOrder(tx, row.id));
			}
			return {
				authenticated: true as const,
				profile,
				addresses,
				preferences,
				notifications,
				orders,
			};
		});
	} catch {
		return {
			authenticated: false as const,
			profile: null,
			addresses: null,
			preferences: null,
			notifications: [],
			orders: [],
		};
	}
}

export async function handleOrderHistoryRoutes(
	request: Request,
	identity: LocalAuth,
	url: URL,
	principal: Principal,
): Promise<Response | undefined> {
	// 12. Buyer order history: GET /api/v1/me/orders
	if (url.pathname === "/api/v1/me/orders") {
		if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
		const paging = parsePagination(url);
		const list = await identity.sql.begin(async (tx) => {
			let rows: OrderRow[];
			if (paging.cursor) {
				const [anchor] = await tx<{ created_at: string }[]>`
					select o.created_at::text
					from app.commerce_order o
					where o.id = ${paging.cursor}
						and (
							o.owner_user_id = ${principal.id}
							or exists (
								select 1 from app.buyer_identity_challenge c
								where c.user_id = ${principal.id}
									and c.kind = 'guest_order_link'
									and c.status = 'verified'
									and c.order_id = o.id
							)
						)
				`;
				if (!anchor) throw invalid();
				rows = await tx<OrderRow[]>`
					select o.*
					from app.commerce_order o
					where (
							o.owner_user_id = ${principal.id}
							or exists (
								select 1 from app.buyer_identity_challenge c
								where c.user_id = ${principal.id}
									and c.kind = 'guest_order_link'
									and c.status = 'verified'
									and c.order_id = o.id
							)
						)
						and (o.created_at, o.id) < (${anchor.created_at}::timestamptz, ${paging.cursor}::uuid)
					order by o.created_at desc, o.id desc
					limit ${paging.limit + 1}
				`;
			} else {
				rows = await tx<OrderRow[]>`
					select o.*
					from app.commerce_order o
					where o.owner_user_id = ${principal.id}
						or exists (
							select 1 from app.buyer_identity_challenge c
							where c.user_id = ${principal.id}
								and c.kind = 'guest_order_link'
								and c.status = 'verified'
								and c.order_id = o.id
						)
					order by o.created_at desc, o.id desc
					limit ${paging.limit + 1}
				`;
			}
			const slice = rows.slice(0, paging.limit);
			const data = [];
			for (const row of slice) {
				data.push(await projectOrder(tx, row.id));
			}
			return {
				data,
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
}
