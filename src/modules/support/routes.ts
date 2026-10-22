import type { LocalAuth } from "../access/auth.ts";
import {
	assertOrigin,
	privateJson,
	problem,
	readBody,
} from "../access/http.ts";
import { AccessError } from "../access/policy.ts";
import { LIMITS, rateLimit } from "../access/rate-limit.ts";
import { invalid } from "../catalog/validation.ts";
import { setCookie } from "../checkout/access.ts";
import {
	addStaffInternalNote,
	advanceReadMarker,
	assignStaffConversation,
	claimStaffConversation,
	commitPublicMessage,
	createGuestSupportSession,
	createOrUpdateSavedReply,
	createOrUpdateSupportTag,
	createSupportConversation,
	formatSseStream,
	getCustomerConversation,
	getCustomerPreferences,
	getStaffClassification,
	getSupportAttachment,
	listCustomerConversations,
	listPublicMessages,
	listStaffInternalNotes,
	listStaffSupportInbox,
	listSupportNotifications,
	listSupportSavedReplies,
	listSupportTags,
	previewSavedReplyDraft,
	readPublicSupportEvents,
	requestContactBinding,
	requestRecoveryChallenge,
	requireOwnedConversation,
	requireStaffConversation,
	resolveSupportCustomer,
	resolveSupportStaff,
	searchCustomerConversations,
	searchPublicMessages,
	searchStaffInternalNotes,
	setCustomerPreferences,
	setStaffClassification,
	setStaffConversationStatus,
	supportCookieName,
	updateSupportNotificationState,
	uploadSupportAttachment,
	verifyContactBinding,
	verifyRecoveryChallenge,
} from "./service.ts";

function eventResponse(
	request: Request,
	result: Awaited<ReturnType<typeof readPublicSupportEvents>>,
) {
	const accept = request.headers.get("accept") ?? "";
	if (accept.includes("text/event-stream")) {
		return new Response(formatSseStream(result.events), {
			status: 200,
			headers: {
				"Content-Type": "text/event-stream; charset=utf-8",
				"Cache-Control": "no-store",
				"Referrer-Policy": "no-referrer",
				"X-Content-Type-Options": "nosniff",
			},
		});
	}
	return privateJson(result.page);
}

export async function handleSupport(request: Request, identity: LocalAuth) {
	try {
		assertOrigin(request);
		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;
		if (method !== "GET" && url.search) throw invalid();

		if (path === "/api/v1/guest-support-sessions" && method === "POST") {
			const body = await readBody(request);
			const result = await identity.sql.begin((tx) =>
				createGuestSupportSession(tx, request, identity, body),
			);
			const response = privateJson(result.state, 201);
			setCookie(
				response,
				await supportCookieName(identity),
				result.cookieValue,
				"/",
				result.maxAge,
			);
			return response;
		}

		if (path === "/api/v1/support/conversations") {
			if (method === "GET") {
				return privateJson(
					await identity.sql.begin((tx) =>
						listCustomerConversations(tx, request, identity, url),
					),
				);
			}
			if (method === "POST") {
				const body = await readBody(request);
				return privateJson(
					await identity.sql.begin((tx) =>
						createSupportConversation(tx, request, identity, body),
					),
				);
			}
		}

		if (path === "/api/v1/support/conversation-searches" && method === "POST") {
			const body = await readBody(request);
			return privateJson(
				await identity.sql.begin((tx) =>
					searchCustomerConversations(tx, request, identity, body),
				),
			);
		}

		if (path === "/api/v1/support/contact-challenges" && method === "POST") {
			if (request.headers.has("x-order-token"))
				throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
			const body = await readBody(request);
			return privateJson(
				await identity.sql.begin((tx) =>
					requestContactBinding(tx, request, identity, body),
				),
				201,
			);
		}

		const contactVerifyMatch =
			/^\/api\/v1\/support\/contact-challenges\/([^/]+)\/verifications$/.exec(
				path,
			);
		if (contactVerifyMatch && method === "POST") {
			if (request.headers.has("x-order-token"))
				throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
			const body = await readBody(request);
			return privateJson(
				await verifyContactBinding(
					request,
					identity,
					contactVerifyMatch[1],
					body,
				),
				201,
			);
		}

		if (path === "/api/v1/support/recovery-challenges" && method === "POST") {
			if (request.headers.has("x-order-token"))
				throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
			const body = await readBody(request);
			return privateJson(
				await identity.sql.begin((tx) =>
					requestRecoveryChallenge(tx, request, identity, body),
				),
				201,
			);
		}

		const recoveryVerifyMatch =
			/^\/api\/v1\/support\/recovery-challenges\/([^/]+)\/verifications$/.exec(
				path,
			);
		if (recoveryVerifyMatch && method === "POST") {
			if (request.headers.has("x-order-token"))
				throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
			const body = await readBody(request);
			const result = await verifyRecoveryChallenge(
				request,
				identity,
				recoveryVerifyMatch[1],
				body,
			);
			const response = privateJson(result.state, 201);
			if (result.rotatedCookie) {
				setCookie(
					response,
					await supportCookieName(identity),
					result.rotatedCookie,
					"/",
					604800,
				);
			}
			return response;
		}

		if (path === "/api/v1/support/notifications" && method === "GET") {
			return privateJson(
				await identity.sql.begin((tx) =>
					listSupportNotifications(tx, request, identity, url),
				),
			);
		}

		const notifStateMatch =
			/^\/api\/v1\/support\/notifications\/([^/]+)\/state$/.exec(path);
		if (notifStateMatch && method === "POST") {
			const body = await readBody(request);
			return privateJson(
				await identity.sql.begin((tx) =>
					updateSupportNotificationState(
						tx,
						request,
						identity,
						notifStateMatch[1],
						body,
					),
				),
				201,
			);
		}

		const attachmentGetMatch =
			/^\/api\/v1\/support\/conversations\/([^/]+)\/attachments\/([^/]+)$/.exec(
				path,
			);
		if (attachmentGetMatch && method === "GET") {
			if (url.search) throw invalid();
			const result = await identity.sql.begin((tx) =>
				getSupportAttachment(
					tx,
					request,
					identity,
					attachmentGetMatch[1],
					attachmentGetMatch[2],
				),
			);
			if (result.kind === "json") return privateJson(result.body);
			return new Response(new Uint8Array(result.bytes), {
				status: 200,
				headers: {
					"Content-Type": result.contentType,
					"Content-Disposition": `inline; filename="${result.filename}"`,
					"Cache-Control": "no-store",
					"Referrer-Policy": "no-referrer",
					"X-Content-Type-Options": "nosniff",
				},
			});
		}

		const customerConvMatch =
			/^\/api\/v1\/support\/conversations\/([^/]+)(?:\/(messages|read-markers|events|attachments|message-searches|preferences))?$/.exec(
				path,
			);
		if (customerConvMatch) {
			const [, convId, sub] = customerConvMatch;
			if (!sub && method === "GET") {
				if (url.search) throw invalid();
				return privateJson(
					await identity.sql.begin((tx) =>
						getCustomerConversation(tx, request, identity, convId),
					),
				);
			}
			if (sub === "messages") {
				if (method === "GET") {
					if (request.headers.has("x-order-token")) {
						throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
					}
					return privateJson(
						await identity.sql.begin(async (tx) => {
							const actor = await resolveSupportCustomer(tx, request, identity);
							const conv = await requireOwnedConversation(
								tx,
								actor,
								convId,
								false,
							);
							return listPublicMessages(tx, conv, url);
						}),
					);
				}
				if (method === "POST") {
					const body = await readBody(request, 32768);
					return privateJson(
						await identity.sql.begin(async (tx) => {
							const actor = await resolveSupportCustomer(tx, request, identity);
							if (actor.kind === "guest") {
								await rateLimit(
									tx,
									`support-guest-message:${actor.id}`,
									LIMITS.guestSupportMessagePerGuest,
								);
							}
							return commitPublicMessage(
								tx,
								request,
								identity,
								convId,
								{ side: "buyer", actor },
								body,
							);
						}),
					);
				}
			}
			if (sub === "read-markers" && method === "POST") {
				if (request.headers.has("x-order-token"))
					throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
				const body = await readBody(request);
				return privateJson(
					await identity.sql.begin(async (tx) => {
						const actor = await resolveSupportCustomer(tx, request, identity);
						const conv = await requireOwnedConversation(
							tx,
							actor,
							convId,
							true,
						);
						return advanceReadMarker(
							tx,
							request,
							conv,
							actor.scope,
							"customer",
							body,
						);
					}),
				);
			}
			if (sub === "events" && method === "GET") {
				if (request.headers.has("x-order-token"))
					throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
				const result = await identity.sql.begin(async (tx) => {
					const actor = await resolveSupportCustomer(tx, request, identity);
					const conv = await requireOwnedConversation(tx, actor, convId, false);
					return readPublicSupportEvents(tx, request, conv, url);
				});
				return eventResponse(request, result);
			}
			if (sub === "attachments" && method === "POST") {
				return privateJson(
					await identity.sql.begin((tx) =>
						uploadSupportAttachment(tx, request, identity, convId),
					),
				);
			}
			if (sub === "message-searches" && method === "POST") {
				if (request.headers.has("x-order-token"))
					throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
				const body = await readBody(request);
				return privateJson(
					await identity.sql.begin(async (tx) => {
						const actor = await resolveSupportCustomer(tx, request, identity);
						const conv = await requireOwnedConversation(
							tx,
							actor,
							convId,
							false,
						);
						return searchPublicMessages(tx, request, conv, actor.scope, body);
					}),
				);
			}
			if (sub === "preferences") {
				if (method === "GET") {
					if (url.search) throw invalid();
					return privateJson(
						await identity.sql.begin((tx) =>
							getCustomerPreferences(tx, request, identity, convId),
						),
					);
				}
				if (method === "POST") {
					const body = await readBody(request);
					return privateJson(
						await identity.sql.begin((tx) =>
							setCustomerPreferences(tx, request, identity, convId, body),
						),
						201,
					);
				}
			}
		}

		if (path.startsWith("/api/v1/admin/support/")) {
			const principal = await resolveSupportStaff(request, identity);

			if (path === "/api/v1/admin/support/conversations" && method === "GET") {
				return privateJson(
					await identity.sql.begin((tx) =>
						listStaffSupportInbox(tx, principal, url),
					),
				);
			}

			if (path === "/api/v1/admin/support/saved-replies") {
				if (method === "GET") {
					return privateJson(
						await identity.sql.begin((tx) => listSupportSavedReplies(tx, url)),
					);
				}
				if (method === "POST") {
					const body = await readBody(request, 32768);
					return privateJson(
						await identity.sql.begin((tx) =>
							createOrUpdateSavedReply(tx, request, principal, null, body),
						),
						201,
					);
				}
			}

			const savedReplyVersionMatch =
				/^\/api\/v1\/admin\/support\/saved-replies\/([^/]+)\/versions$/.exec(
					path,
				);
			if (savedReplyVersionMatch && method === "POST") {
				const body = await readBody(request, 32768);
				return privateJson(
					await identity.sql.begin((tx) =>
						createOrUpdateSavedReply(
							tx,
							request,
							principal,
							savedReplyVersionMatch[1],
							body,
						),
					),
					201,
				);
			}

			if (path === "/api/v1/admin/support/tags") {
				if (method === "GET") {
					return privateJson(
						await identity.sql.begin((tx) => listSupportTags(tx, url)),
					);
				}
				if (method === "POST") {
					const body = await readBody(request);
					return privateJson(
						await identity.sql.begin((tx) =>
							createOrUpdateSupportTag(tx, request, principal, null, body),
						),
						201,
					);
				}
			}

			const tagVersionMatch =
				/^\/api\/v1\/admin\/support\/tags\/([^/]+)\/versions$/.exec(path);
			if (tagVersionMatch && method === "POST") {
				const body = await readBody(request);
				return privateJson(
					await identity.sql.begin((tx) =>
						createOrUpdateSupportTag(
							tx,
							request,
							principal,
							tagVersionMatch[1],
							body,
						),
					),
					201,
				);
			}

			const adminConvMatch =
				/^\/api\/v1\/admin\/support\/conversations\/([^/]+)\/(claims|assignments|status|messages|notes|read-markers|events|message-searches|note-searches|classification|saved-reply-previews)$/.exec(
					path,
				);
			if (adminConvMatch) {
				const [, convId, sub] = adminConvMatch;
				if (sub === "claims" && method === "POST") {
					const body = await readBody(request);
					return privateJson(
						await identity.sql.begin((tx) =>
							claimStaffConversation(tx, request, principal, convId, body),
						),
					);
				}
				if (sub === "assignments" && method === "POST") {
					const body = await readBody(request);
					return privateJson(
						await identity.sql.begin((tx) =>
							assignStaffConversation(tx, request, principal, convId, body),
						),
					);
				}
				if (sub === "status" && method === "POST") {
					const body = await readBody(request);
					return privateJson(
						await identity.sql.begin((tx) =>
							setStaffConversationStatus(tx, request, principal, convId, body),
						),
					);
				}
				if (sub === "messages") {
					if (method === "GET") {
						return privateJson(
							await identity.sql.begin(async (tx) => {
								const conv = await requireStaffConversation(tx, convId, false);
								return listPublicMessages(tx, conv, url);
							}),
						);
					}
					if (method === "POST") {
						const body = await readBody(request, 32768);
						return privateJson(
							await identity.sql.begin((tx) =>
								commitPublicMessage(
									tx,
									request,
									identity,
									convId,
									{ side: "customer_service", principal },
									body,
								),
							),
						);
					}
				}
				if (sub === "notes") {
					if (method === "GET") {
						return privateJson(
							await identity.sql.begin((tx) =>
								listStaffInternalNotes(tx, convId, url),
							),
						);
					}
					if (method === "POST") {
						const body = await readBody(request, 32768);
						return privateJson(
							await identity.sql.begin((tx) =>
								addStaffInternalNote(tx, request, principal, convId, body),
							),
						);
					}
				}
				if (sub === "read-markers" && method === "POST") {
					const body = await readBody(request);
					return privateJson(
						await identity.sql.begin(async (tx) => {
							const conv = await requireStaffConversation(tx, convId, true);
							return advanceReadMarker(
								tx,
								request,
								conv,
								`user:${principal.id}`,
								"staff",
								body,
							);
						}),
					);
				}
				if (sub === "events" && method === "GET") {
					const result = await identity.sql.begin(async (tx) => {
						const conv = await requireStaffConversation(tx, convId, false);
						return readPublicSupportEvents(tx, request, conv, url);
					});
					return eventResponse(request, result);
				}
				if (sub === "message-searches" && method === "POST") {
					const body = await readBody(request);
					return privateJson(
						await identity.sql.begin(async (tx) => {
							const conv = await requireStaffConversation(tx, convId, false);
							return searchPublicMessages(
								tx,
								request,
								conv,
								`user:${principal.id}`,
								body,
							);
						}),
					);
				}
				if (sub === "note-searches" && method === "POST") {
					const body = await readBody(request);
					return privateJson(
						await identity.sql.begin((tx) =>
							searchStaffInternalNotes(tx, request, principal, convId, body),
						),
					);
				}
				if (sub === "classification") {
					if (method === "GET") {
						if (url.search) throw invalid();
						return privateJson(
							await identity.sql.begin((tx) =>
								getStaffClassification(tx, convId),
							),
						);
					}
					if (method === "POST") {
						const body = await readBody(request);
						return privateJson(
							await identity.sql.begin((tx) =>
								setStaffClassification(tx, request, principal, convId, body),
							),
							201,
						);
					}
				}
				if (sub === "saved-reply-previews" && method === "POST") {
					const body = await readBody(request);
					return privateJson(
						await identity.sql.begin((tx) =>
							previewSavedReplyDraft(tx, request, principal, convId, body),
						),
					);
				}
			}
		}

		throw new AccessError(404, "NOT_FOUND");
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			["23505", "23514", "40001", "40P01"].includes(String(error.code))
		) {
			return problem(new AccessError(409, "SUPPORT_CONFLICT"));
		}
		return problem(error);
	}
}
