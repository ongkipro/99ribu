import { randomUUID } from "node:crypto";
import type { LocalAuth } from "../access/auth.ts";
import { privateJson, readBody } from "../access/http.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { id, integer, invalid, object } from "../catalog/validation.ts";
import { intentHash, mutationKey } from "../checkout/carts.ts";
import { boolean, type BuyerAddressResponse, type BuyerAddressListResponse, type BuyerAddressRow, parsePagination, ensureBuyerProfile, formatBuyerAddress, parseShippingAddressInput, checkIdempotency, saveIdempotency, listActiveAddresses } from "./shared.ts";

export async function handleAddressRoutes(
	request: Request,
	identity: LocalAuth,
	url: URL,
	principal: Principal,
): Promise<Response | undefined> {
	// 4. Address book list & create: GET / POST /api/v1/me/addresses
	if (url.pathname === "/api/v1/me/addresses") {
		if (request.method === "GET") {
			const paging = parsePagination(url);
			const list = await identity.sql.begin(async (tx) => {
				const profile = await ensureBuyerProfile(tx, principal, false);
				return listActiveAddresses(
					tx,
					principal.id,
					paging.limit,
					paging.cursor,
					profile.address_book_revision,
				);
			});
			return privateJson(list, 200);
		}
		if (request.method === "POST") {
			const key = mutationKey(request);
			const body = object(await readBody(request), [
				"address",
				"make_default",
				"expected_book_version",
			]);
			const validated = parseShippingAddressInput(body.address);
			const makeDefault =
				body.make_default === undefined ? false : boolean(body.make_default);
			const expectedBookVersion =
				body.expected_book_version === undefined
					? undefined
					: integer(body.expected_book_version, 0, 2147483647);
			const hash = await intentHash(identity, "buyer.address.create", {
				address: validated,
				makeDefault,
				...(expectedBookVersion !== undefined ? { expectedBookVersion } : {}),
			});
			const created = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<BuyerAddressResponse>(
					tx,
					principal.id,
					"buyer.address.create",
					key,
					hash,
				);
				if (prior) return prior;
				const profile = await ensureBuyerProfile(tx, principal, true);
				if (
					expectedBookVersion !== undefined &&
					Number(profile.address_book_revision) !== expectedBookVersion
				) {
					throw new AccessError(409, "ADDRESS_BOOK_VERSION_CONFLICT");
				}
				const [countRow] = await tx<{ n: number }[]>`
					select count(*)::int as n
					from app.buyer_address
					where user_id = ${principal.id} and deleted_at is null
				`;
				const isFirst = (countRow?.n ?? 0) === 0;
				const isDefault = isFirst || makeDefault;
				if (isDefault) {
					await tx`
						update app.buyer_address
						set is_default = false, updated_at = clock_timestamp()
						where user_id = ${principal.id} and deleted_at is null and is_default = true
					`;
				}
				const addressId = randomUUID();
				const [inserted] = await tx<BuyerAddressRow[]>`
					insert into app.buyer_address (
						id,
						user_id,
						label,
						recipient_name,
						phone,
						street,
						province,
						city,
						district,
						subdistrict,
						postcode,
						destination_code,
						rt_rw,
						landmark,
						is_default,
						revision
					)
					values (
						${addressId},
						${principal.id},
						${validated.label ?? ""},
						${validated.recipient_name},
						${validated.phone},
						${validated.street},
						${validated.province},
						${validated.city},
						${validated.district},
						${validated.subdistrict},
						${validated.postcode},
						${validated.destination_code ?? ""},
						${validated.rt_rw ?? null},
						${validated.landmark ?? null},
						${isDefault},
						1
					)
					returning *
				`;
				await tx`
					update app.buyer_profile
					set
						address_book_revision = address_book_revision + 1,
						default_address_id = ${isDefault ? addressId : profile.default_address_id},
						updated_at = clock_timestamp()
					where user_id = ${principal.id}
				`;
				const response = formatBuyerAddress(inserted);
				return saveIdempotency(
					tx,
					principal.id,
					"buyer.address.create",
					key,
					hash,
					addressId,
					"Created buyer shipping address",
					response,
				);
			});
			return privateJson(created, 201);
		}
		throw new AccessError(404, "NOT_FOUND");
	}

	// 5. Default address switch: POST /api/v1/me/address-default
	if (url.pathname === "/api/v1/me/address-default") {
		if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
		const key = mutationKey(request);
		const body = object(await readBody(request), [
			"expected_book_version",
			"address_id",
		]);
		const expectedBookVersion = integer(
			body.expected_book_version,
			0,
			2147483647,
		);
		const addressId = id(body.address_id);
		const hash = await intentHash(identity, "buyer.address.default", {
			expectedBookVersion,
			addressId,
		});
		const list = await identity.sql.begin(async (tx) => {
			const prior = await checkIdempotency<BuyerAddressListResponse>(
				tx,
				principal.id,
				"buyer.address.default",
				key,
				hash,
			);
			if (prior) return prior;
			const profile = await ensureBuyerProfile(tx, principal, true);
			if (Number(profile.address_book_revision) !== expectedBookVersion) {
				throw new AccessError(409, "ADDRESS_BOOK_VERSION_CONFLICT");
			}
			const [target] = await tx<BuyerAddressRow[]>`
				select * from app.buyer_address
				where id = ${addressId} and user_id = ${principal.id} and deleted_at is null
				for update
			`;
			if (!target) throw new AccessError(404, "NOT_FOUND");
			await tx`
				update app.buyer_address
				set is_default = false, updated_at = clock_timestamp()
				where user_id = ${principal.id} and deleted_at is null and id <> ${addressId} and is_default = true
			`;
			await tx`
				update app.buyer_address
				set is_default = true, revision = revision + 1, updated_at = clock_timestamp()
				where id = ${addressId}
			`;
			const [updatedProfile] = await tx<{ address_book_revision: number }[]>`
				update app.buyer_profile
				set
					address_book_revision = address_book_revision + 1,
					default_address_id = ${addressId},
					updated_at = clock_timestamp()
				where user_id = ${principal.id}
				returning address_book_revision
			`;
			const response = await listActiveAddresses(
				tx,
				principal.id,
				20,
				null,
				updatedProfile.address_book_revision,
			);
			return saveIdempotency(
				tx,
				principal.id,
				"buyer.address.default",
				key,
				hash,
				addressId,
				"Switched default buyer address",
				response,
			);
		});
		return privateJson(list, 201);
	}

	// 6. Address item read, update, and soft-delete: /api/v1/me/addresses/[addressId](/deletions)
	const addressMatch =
		/^\/api\/v1\/me\/addresses\/([^/]+)(?:\/(deletions))?$/.exec(
			url.pathname,
		);
	if (addressMatch) {
		const addressId = id(addressMatch[1]);
		const isDeletion = addressMatch[2] === "deletions";
		if (!isDeletion && request.method === "GET") {
			if (url.search) throw invalid();
			const item = await identity.sql.begin(async (tx) => {
				const [row] = await tx<BuyerAddressRow[]>`
					select * from app.buyer_address
					where id = ${addressId} and user_id = ${principal.id} and deleted_at is null
				`;
				if (!row) throw new AccessError(404, "NOT_FOUND");
				return formatBuyerAddress(row);
			});
			return privateJson(item, 200);
		}
		if (!isDeletion && request.method === "POST") {
			const key = mutationKey(request);
			const body = object(await readBody(request), [
				"expected_version",
				"address",
			]);
			const expectedVersion = integer(body.expected_version, 1, 2147483647);
			const validated = parseShippingAddressInput(body.address);
			const hash = await intentHash(identity, "buyer.address.update", {
				addressId,
				expectedVersion,
				address: validated,
			});
			const updated = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<BuyerAddressResponse>(
					tx,
					principal.id,
					"buyer.address.update",
					key,
					hash,
				);
				if (prior) return prior;
				await ensureBuyerProfile(tx, principal, true);
				const [existing] = await tx<BuyerAddressRow[]>`
					select * from app.buyer_address
					where id = ${addressId} and user_id = ${principal.id} and deleted_at is null
					for update
				`;
				if (!existing) throw new AccessError(404, "NOT_FOUND");
				if (Number(existing.revision) !== expectedVersion) {
					throw new AccessError(409, "ADDRESS_VERSION_CONFLICT");
				}
				const [row] = await tx<BuyerAddressRow[]>`
					update app.buyer_address
					set
						label = ${validated.label ?? ""},
						recipient_name = ${validated.recipient_name},
						phone = ${validated.phone},
						street = ${validated.street},
						province = ${validated.province},
						city = ${validated.city},
						district = ${validated.district},
						subdistrict = ${validated.subdistrict},
						postcode = ${validated.postcode},
						destination_code = ${validated.destination_code ?? ""},
						rt_rw = ${validated.rt_rw ?? null},
						landmark = ${validated.landmark ?? null},
						revision = revision + 1,
						updated_at = clock_timestamp()
					where id = ${addressId}
					returning *
				`;
				await tx`
					update app.buyer_profile
					set address_book_revision = address_book_revision + 1, updated_at = clock_timestamp()
					where user_id = ${principal.id}
				`;
				const response = formatBuyerAddress(row);
				return saveIdempotency(
					tx,
					principal.id,
					"buyer.address.update",
					key,
					hash,
					addressId,
					"Updated buyer shipping address",
					response,
				);
			});
			return privateJson(updated, 201);
		}
		if (isDeletion && request.method === "POST") {
			const key = mutationKey(request);
			const body = object(await readBody(request), [
				"expected_version",
				"expected_book_version",
				"replacement_default_id",
				"replacement_default_address_id",
			]);
			const expectedVersion = integer(body.expected_version, 1, 2147483647);
			const expectedBookVersion = integer(
				body.expected_book_version,
				0,
				2147483647,
			);
			const rawReplacement =
				body.replacement_default_id ??
				body.replacement_default_address_id ??
				null;
			const replacementId =
				rawReplacement === null ? null : id(rawReplacement);
			const hash = await intentHash(identity, "buyer.address.delete", {
				addressId,
				expectedVersion,
				expectedBookVersion,
				replacementId,
			});
			const ack = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<{
					id: string;
					version: number;
					status: string;
					as_of: string;
				}>(tx, principal.id, "buyer.address.delete", key, hash);
				if (prior) return prior;
				const profile = await ensureBuyerProfile(tx, principal, true);
				if (Number(profile.address_book_revision) !== expectedBookVersion) {
					throw new AccessError(409, "ADDRESS_BOOK_VERSION_CONFLICT");
				}
				const [existing] = await tx<BuyerAddressRow[]>`
					select * from app.buyer_address
					where id = ${addressId} and user_id = ${principal.id} and deleted_at is null
					for update
				`;
				if (!existing) throw new AccessError(404, "NOT_FOUND");
				if (Number(existing.revision) !== expectedVersion) {
					throw new AccessError(409, "ADDRESS_VERSION_CONFLICT");
				}
				const others = await tx<{ id: string }[]>`
					select id from app.buyer_address
					where user_id = ${principal.id} and deleted_at is null and id <> ${addressId}
					for update
				`;
				let nextDefaultId = profile.default_address_id;
				if (existing.is_default) {
					if (others.length > 0) {
						if (
							!replacementId ||
							!others.some((o) => String(o.id) === replacementId)
						) {
							throw new AccessError(409, "DEFAULT_REPLACEMENT_REQUIRED");
						}
						await tx`
							update app.buyer_address
							set is_default = true, revision = revision + 1, updated_at = clock_timestamp()
							where id = ${replacementId}
						`;
						nextDefaultId = replacementId;
					} else {
						if (replacementId !== null) {
							throw new AccessError(409, "INVALID_DEFAULT_REPLACEMENT");
						}
						nextDefaultId = null;
					}
				} else if (replacementId !== null) {
					throw new AccessError(409, "INVALID_DEFAULT_REPLACEMENT");
				}
				const [deleted] = await tx<
					{ revision: number; updated_at: string }[]
				>`
					update app.buyer_address
					set
						-- S126 data minimization: a deleted address keeps no personal data (nothing reads deleted rows).
						label = '',
						recipient_name = '',
						phone = '',
						street = '',
						province = '',
						city = '',
						district = '',
						subdistrict = '',
						postcode = '',
						destination_code = '',
						rt_rw = null,
						landmark = null,
						is_default = false,
						deleted_at = clock_timestamp(),
						revision = revision + 1,
						updated_at = clock_timestamp()
					where id = ${addressId}
					returning revision, updated_at
				`;
				await tx`
					update app.buyer_profile
					set
						address_book_revision = address_book_revision + 1,
						default_address_id = ${nextDefaultId},
						updated_at = clock_timestamp()
					where user_id = ${principal.id}
				`;
				const response = {
					id: addressId,
					version: Number(deleted.revision),
					status: "deleted",
					as_of: new Date(deleted.updated_at).toISOString(),
				};
				return saveIdempotency(
					tx,
					principal.id,
					"buyer.address.delete",
					key,
					hash,
					addressId,
					"Soft-deleted buyer shipping address",
					response,
				);
			});
			return privateJson(ack, 201);
		}
		throw new AccessError(404, "NOT_FOUND");
	}
}
