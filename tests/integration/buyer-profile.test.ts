import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
	favouriteCategoryChoices,
	handleProfileCompletion,
	MARKETING_POLICY_VERSION,
} from "../../src/modules/accounts/profile-completion.ts";
import { handleAccounts } from "../../src/modules/accounts/service.ts";
import { profileDraft } from "../../src/modules/storefront/checkout.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { shippingFixture } from "./shipping-fixture.ts";

// S126 / DEC-017 against the isolated TEST database: optional profile details (edit, delete, validation), per-channel
// promo consent (explicit, withdrawable, policy version, append-only audit trail), own-principal scope, aggregate-only
// admin segments, checkout prefill from the main address, and the 0039 database guards.
test("S126 buyer profile completion, promo consent, segments and checkout prefill", async () => {
	const f = await shippingFixture();
	const { identity } = f;
	const sql = identity.sql;
	const buyer = await actor(identity, "buyer", []);
	const other = await actor(identity, "buyer", []);
	const admin = await actor(identity, "ecommerce_admin", []);
	const cs = await actor(identity, "customer_service", []);
	await enroll(admin.browser, admin.password);
	await enroll(cs.browser, cs.password);
	const buyers = [buyer, other];
	type Session = typeof buyer;
	const call = async (
		who: Session,
		path: string,
		body?: Record<string, unknown>,
		key: string = randomUUID(),
	) => {
		const request = who.browser.request(path, body);
		if (body !== undefined) request.headers.set("idempotency-key", key);
		const route =
			path.startsWith("/api/v1/me/addresses") || path === "/api/v1/me/profile"
				? handleAccounts
				: handleProfileCompletion;
		const response = await route(request, identity);
		assert.equal(response.headers.get("cache-control"), "no-store");
		return { status: response.status, body: await response.json() };
	};
	const details = (who: Session) => call(who, "/api/v1/me/profile-details");
	const save = (
		who: Session,
		body: Record<string, unknown>,
		key: string = randomUUID(),
	) => call(who, "/api/v1/me/profile-details", body, key);
	const consents = (who: Session) => call(who, "/api/v1/me/marketing-consents");
	const consent = (
		who: Session,
		body: Record<string, unknown>,
		key: string = randomUUID(),
	) => call(who, "/api/v1/me/marketing-consents", body, key);
	const empty = {
		birth_day: null,
		birth_month: null,
		birth_year: null,
		gender: null,
		favourite_category_ids: [],
	};

	try {
		const categories = await favouriteCategoryChoices(identity);
		assert.ok(
			categories.length > 0,
			"The fixture publishes products, so a top-level department is public",
		);
		assert.ok(categories.every((c) => c.parent_id === null));
		const before = await call(f.owner, "/api/v1/admin/buyer-segments");
		assert.equal(before.status, 200);

		// 1. Details start empty and optional; completion counts what is set.
		const initial = await details(buyer);
		assert.equal(initial.status, 200);
		assert.deepEqual(
			{ ...initial.body, version: 1 },
			{
				version: 1,
				...empty,
				completion: {
					completed: 0,
					total: 5,
					fields: {
						main_address: false,
						whatsapp: false,
						birthday: false,
						gender: false,
						favourite_categories: false,
					},
				},
			},
		);

		// 2. Validation: whole replacement with every key; day+month together; real dates; enums; ≤5 public departments.
		const v = initial.body.version as number;
		for (const [body, status, code] of [
			[
				{
					expected_version: v,
					birth_day: 1,
					birth_month: 1,
					birth_year: null,
					gender: null,
				},
				400,
				"INVALID_INPUT",
			],
			[
				{ expected_version: v, ...empty, user_id: other.id },
				400,
				"INVALID_INPUT",
			],
			[
				{ expected_version: v, ...empty, birth_day: 31, birth_month: 2 },
				422,
				"INVALID_BIRTHDAY",
			],
			[
				{
					expected_version: v,
					...empty,
					birth_day: 29,
					birth_month: 2,
					birth_year: 2023,
				},
				422,
				"INVALID_BIRTHDAY",
			],
			[
				{ expected_version: v, ...empty, birth_day: 10 },
				422,
				"INVALID_BIRTHDAY",
			],
			[
				{ expected_version: v, ...empty, birth_year: 1990 },
				422,
				"INVALID_BIRTHDAY",
			],
			[
				{
					expected_version: v,
					...empty,
					birth_day: 1,
					birth_month: 1,
					birth_year: new Date().getUTCFullYear() + 1,
				},
				400,
				"INVALID_INPUT",
			],
			[
				{ expected_version: v, ...empty, gender: "other" },
				400,
				"INVALID_INPUT",
			],
			[
				{
					expected_version: v,
					...empty,
					favourite_category_ids: Array.from({ length: 6 }, () => randomUUID()),
				},
				400,
				"INVALID_INPUT",
			],
			[
				{
					expected_version: v,
					...empty,
					favourite_category_ids: [categories[0].id, categories[0].id],
				},
				400,
				"INVALID_INPUT",
			],
			[
				{
					expected_version: v,
					...empty,
					favourite_category_ids: [randomUUID()],
				},
				422,
				"CATEGORY_UNAVAILABLE",
			],
		] as const) {
			const result = await save(buyer, body);
			assert.deepEqual(
				[result.status, result.body.code],
				[status, code],
				JSON.stringify(body),
			);
		}

		// 3. Save (29 February without a year is valid), replay, stale version, partial delete, delete all.
		const full = {
			...empty,
			birth_day: 29,
			birth_month: 2,
			gender: "undisclosed",
			favourite_category_ids: [categories[0].id],
		};
		const key = randomUUID();
		const saved = await save(buyer, { expected_version: v, ...full }, key);
		assert.equal(saved.status, 201);
		assert.equal(saved.body.version, v + 1);
		assert.deepEqual(
			[
				saved.body.birth_day,
				saved.body.birth_month,
				saved.body.birth_year,
				saved.body.gender,
			],
			[29, 2, null, "undisclosed"],
		);
		assert.deepEqual(saved.body.favourite_category_ids, [categories[0].id]);
		assert.equal(saved.body.completion.completed, 3);
		assert.deepEqual(
			(await save(buyer, { expected_version: v, ...full }, key)).body,
			saved.body,
			"Same key replays",
		);
		assert.equal(
			(await save(buyer, { expected_version: v, ...full })).body.code,
			"PROFILE_VERSION_CONFLICT",
		);
		const withYear = await save(buyer, {
			expected_version: v + 1,
			...full,
			birth_day: 12,
			birth_month: 8,
			birth_year: 1990,
			gender: "female",
		});
		assert.equal(withYear.status, 201);
		const noGender = await save(buyer, {
			expected_version: v + 2,
			...full,
			birth_day: 12,
			birth_month: 8,
			birth_year: 1990,
			gender: null,
		});
		assert.deepEqual(
			[
				noGender.body.gender,
				noGender.body.birth_year,
				noGender.body.completion.fields.gender,
			],
			[null, 1990, false],
		);
		const [audit] = await sql<{ details: Record<string, unknown> }[]>`
			select details from app.audit_event where actor_id=${buyer.id} and action='buyer.profile_details.update' order by created_at desc, id desc limit 1`;
		assert.deepEqual(
			audit.details,
			{ fields_set: ["birthday", "favourite_categories"] },
			"The audit names fields, never values",
		);
		assert.doesNotMatch(JSON.stringify(audit.details), /1990|female|12/);

		// 4. Own principal only: another buyer sees and changes only its own row.
		const otherView = await details(other);
		assert.deepEqual(
			[otherView.body.birth_day, otherView.body.favourite_category_ids],
			[null, []],
		);
		assert.equal(
			(
				await save(other, {
					expected_version: otherView.body.version,
					...empty,
					birth_day: 1,
					birth_month: 3,
				})
			).status,
			201,
		);
		assert.equal(
			(await details(buyer)).body.birth_month,
			8,
			"The other buyer's write never touches this row",
		);

		// 5. Promo consent: unticked by default, needs the contact, names the policy version, withdrawable.
		const none = await consents(buyer);
		assert.equal(none.status, 200);
		assert.equal(none.body.policy_version, MARKETING_POLICY_VERSION);
		assert.deepEqual(
			none.body.channels.map((c: { channel: string; granted: boolean }) => [
				c.channel,
				c.granted,
			]),
			[
				["whatsapp", false],
				["email", false],
			],
		);
		assert.deepEqual(
			none.body.channels.map(
				(c: { contact_available: boolean }) => c.contact_available,
			),
			[false, true],
		);
		assert.deepEqual(none.body.history, []);
		assert.equal(
			(
				await consent(buyer, {
					channel: "whatsapp",
					granted: true,
					policy_version: MARKETING_POLICY_VERSION,
				})
			).body.code,
			"CONTACT_REQUIRED",
		);
		assert.equal(
			(await consent(buyer, { channel: "email", granted: true })).status,
			400,
			"A grant names the policy version",
		);
		assert.equal(
			(
				await consent(buyer, {
					channel: "email",
					granted: true,
					policy_version: "old-v0",
				})
			).body.code,
			"CONSENT_POLICY_CHANGED",
		);
		assert.equal(
			(
				await consent(buyer, {
					channel: "sms",
					granted: true,
					policy_version: MARKETING_POLICY_VERSION,
				})
			).status,
			400,
		);
		const profile = await call(buyer, "/api/v1/me/profile");
		assert.equal(
			(
				await call(buyer, "/api/v1/me/profile", {
					expected_version: profile.body.version,
					display_name: profile.body.display_name,
					phone: "081234560001",
				})
			).status,
			201,
		);
		const grantKey = randomUUID();
		const granted = await consent(
			buyer,
			{
				channel: "whatsapp",
				granted: true,
				policy_version: MARKETING_POLICY_VERSION,
			},
			grantKey,
		);
		assert.equal(granted.status, 201);
		assert.equal(granted.body.channels[0].granted, true);
		assert.equal(
			granted.body.channels[0].policy_version,
			MARKETING_POLICY_VERSION,
		);
		assert.deepEqual(
			(
				await consent(
					buyer,
					{
						channel: "whatsapp",
						granted: true,
						policy_version: MARKETING_POLICY_VERSION,
					},
					grantKey,
				)
			).body,
			granted.body,
		);
		assert.equal(
			(await consent(buyer, { channel: "whatsapp", granted: false }, grantKey))
				.body.code,
			"IDEMPOTENCY_CONFLICT",
		);
		assert.equal(
			(
				await consent(buyer, {
					channel: "whatsapp",
					granted: true,
					policy_version: MARKETING_POLICY_VERSION,
				})
			).status,
			201,
			"Granting again is a no-op",
		);
		assert.equal(
			(
				await consent(buyer, {
					channel: "email",
					granted: true,
					policy_version: MARKETING_POLICY_VERSION,
				})
			).status,
			201,
		);
		const rows = async () =>
			sql<
				{
					channel: string;
					policy_version: string;
					source: string;
					withdrawn: boolean;
				}[]
			>`
				select channel, policy_version, source, withdrawn_at is not null as withdrawn from app.marketing_consent where user_id=${buyer.id} order by granted_at, id`.then((r) => r.map((x) => ({ ...x })));
		assert.deepEqual(await rows(), [
			{
				channel: "whatsapp",
				policy_version: MARKETING_POLICY_VERSION,
				source: "account",
				withdrawn: false,
			},
			{
				channel: "email",
				policy_version: MARKETING_POLICY_VERSION,
				source: "account",
				withdrawn: false,
			},
		]);
		// A withdrawal is never blocked by a policy version; then a re-grant appends a new record.
		const withdrawn = await consent(buyer, {
			channel: "email",
			granted: false,
			policy_version: "anything",
		});
		assert.equal(withdrawn.status, 201);
		assert.equal(withdrawn.body.channels[1].granted, false);
		assert.equal(
			(await consent(buyer, { channel: "email", granted: false })).status,
			201,
			"Withdrawing twice is a no-op",
		);
		assert.equal(
			(
				await consent(buyer, {
					channel: "email",
					granted: true,
					policy_version: MARKETING_POLICY_VERSION,
				})
			).status,
			201,
		);
		assert.deepEqual(
			(await rows()).map((r) => [r.channel, r.withdrawn]),
			[
				["whatsapp", false],
				["email", true],
				["email", false],
			],
		);
		const history = (await consents(buyer)).body.history as {
			channel: string;
			withdrawn_at: string | null;
		}[];
		assert.equal(history.length, 3);
		assert.equal(history.filter((h) => h.withdrawn_at).length, 1);
		// Changing the WhatsApp number withdraws the WhatsApp consent: it covered the number the buyer saw.
		const p2 = (await call(buyer, "/api/v1/me/profile")).body;
		assert.equal(
			(
				await call(buyer, "/api/v1/me/profile", {
					expected_version: p2.version,
					display_name: p2.display_name,
					phone: "081234560002",
				})
			).status,
			201,
		);
		const afterChange = (await consents(buyer)).body;
		assert.deepEqual(
			afterChange.channels.map((c: { granted: boolean }) => c.granted),
			[false, true],
		);
		assert.equal(
			(
				await consent(buyer, {
					channel: "whatsapp",
					granted: true,
					policy_version: MARKETING_POLICY_VERSION,
				})
			).status,
			201,
		);
		const consentAudit = await sql<
			{ reason: string; details: Record<string, unknown> }[]
		>`
			select reason, details from app.audit_event where actor_id=${buyer.id} and action='buyer.marketing_consent.update' order by created_at, id`;
		assert.ok(
			consentAudit.length >= 6,
			"Every consent call leaves an audit row",
		);
		assert.ok(
			consentAudit.every(
				(row) => !/0812345600|@/.test(JSON.stringify(row.details)),
			),
			"Audit rows carry no contact value",
		);
		assert.deepEqual(Object.keys(consentAudit[0].details).sort(), [
			"changed",
			"channel",
			"granted",
			"policy_version",
			"source",
		]);

		// 6. Database guards (0039): consent records only gain a withdrawal time; profile birthday check.
		const [active] =
			await sql`select id from app.marketing_consent where user_id=${buyer.id} and channel='whatsapp' and withdrawn_at is null`;
		await assert.rejects(
			sql`update app.marketing_consent set policy_version='forged' where id=${active.id}`,
			{ code: "23514" },
		);
		await assert.rejects(
			sql`insert into app.marketing_consent (user_id,channel,policy_version,source,withdrawn_at) values (${buyer.id},'email','v','account',clock_timestamp())`,
			{ code: "23514" },
		);
		await assert.rejects(
			sql`insert into app.marketing_consent (user_id,channel,policy_version,source) values (${buyer.id},'whatsapp','v','account')`,
			{ code: "23505" },
		);
		await assert.rejects(
			sql`insert into app.marketing_consent (user_id,channel,policy_version,source) values (${other.id},'whatsapp','v','import')`,
			{ code: "23514" },
		);
		const [closed] =
			await sql`select id from app.marketing_consent where user_id=${buyer.id} and withdrawn_at is not null limit 1`;
		await assert.rejects(
			sql`update app.marketing_consent set withdrawn_at=clock_timestamp() where id=${closed.id}`,
			{ code: "23514" },
		);
		await assert.rejects(
			sql`update app.buyer_profile set birth_day=31, birth_month=4 where user_id=${buyer.id}`,
			{ code: "23514" },
		);
		await assert.rejects(
			sql`update app.buyer_profile set gender='x' where user_id=${buyer.id}`,
			{ code: "23514" },
		);

		// 7. Segments: owner and e-commerce admin read counts only; buyers and other staff are refused.
		const after = await call(admin, "/api/v1/admin/buyer-segments");
		assert.equal(after.status, 200);
		const month = (r: typeof after, m: number) =>
			r.body.birth_months[m - 1].count as number;
		assert.equal(month(after, 8) - month(before, 8), 1);
		assert.equal(month(after, 3) - month(before, 3), 1);
		const channel = (r: typeof after, c: string) =>
			r.body.consent_channels.find((x: { channel: string }) => x.channel === c)
				.count as number;
		assert.equal(channel(after, "whatsapp") - channel(before, "whatsapp"), 1);
		assert.equal(channel(after, "email") - channel(before, "email"), 1);
		assert.ok(
			after.body.favourite_categories.some(
				(c: { category_id: string; count: number }) =>
					c.category_id === categories[0].id && c.count >= 1,
			),
		);
		assert.deepEqual(
			after.body.programs.map((p: { key: string; status: string }) => [
				p.key,
				p.status,
			]),
			[
				["birthday_voucher", "terms_pending"],
				["category_promo", "terms_pending"],
				["doorprize", "coming_soon"],
			],
		);
		const text = JSON.stringify(after.body);
		for (const leak of [buyer.id, buyer.email, other.id, "6281234560002"])
			assert.ok(
				!text.includes(leak),
				"Segments carry no buyer identity or contact",
			);
		assert.equal(
			(await call(buyer, "/api/v1/admin/buyer-segments")).status,
			403,
		);
		assert.equal((await call(cs, "/api/v1/admin/buyer-segments")).status, 403);
		assert.equal(
			(await call(admin, "/api/v1/admin/buyer-segments", {})).status,
			404,
			"Read-only: no write route",
		);
		const anonymous = await handleProfileCompletion(
			new Request("http://127.0.0.1:3099/api/v1/me/profile-details", {
				headers: { host: "127.0.0.1:3099" },
			}),
			identity,
		);
		assert.equal(anonymous.status, 401);

		// 8. Checkout prefill from the main address; a guest gets nothing; address delete keeps no personal data.
		const book = (await call(buyer, "/api/v1/me/addresses")).body;
		const address = {
			label: "Rumah",
			recipient_name: "Penerima Uji",
			phone: "081234560003",
			street: "Jl. Contoh No. 1",
			district: "Kecamatan Contoh A",
			city: "Malang",
			province: "Jawa Timur",
			postcode: "00001",
			destination_code: "test-malang",
		};
		const created = await call(buyer, "/api/v1/me/addresses", {
			address,
			make_default: true,
			expected_book_version: book.book_version,
		});
		assert.equal(created.status, 201);
		assert.equal(
			(await details(buyer)).body.completion.fields.main_address,
			true,
		);
		assert.deepEqual(
			await profileDraft(buyer.browser.request("/checkout"), identity),
			{
				recipient_name: "Penerima Uji",
				phone: "081234560003",
				email: buyer.email,
				destination_id: "test-malang",
				address_line: "Jl. Contoh No. 1",
				buyer_note: "",
				payment_method: "prepaid",
			},
		);
		assert.deepEqual(
			await profileDraft(other.browser.request("/checkout"), identity),
			{
				recipient_name: "",
				phone: "",
				email: other.email,
				destination_id: "",
				address_line: "",
				buyer_note: "",
				payment_method: "prepaid",
			},
			"No main address: only the profile contact",
		);
		assert.equal(
			await profileDraft(
				new Request("http://127.0.0.1:3099/checkout", {
					headers: { host: "127.0.0.1:3099" },
				}),
				identity,
			),
			null,
		);
		const current = (await call(buyer, "/api/v1/me/addresses")).body;
		const deleted = await call(
			buyer,
			`/api/v1/me/addresses/${created.body.id}/deletions`,
			{
				expected_version: current.data[0].version,
				expected_book_version: current.book_version,
				replacement_default_id: null,
			},
		);
		assert.equal(deleted.status, 201);
		const [scrubbed] =
			await sql`select recipient_name, phone, street, label, landmark, deleted_at is not null as gone from app.buyer_address where id=${created.body.id}`;
		assert.deepEqual(
			{ ...scrubbed },
			{
				recipient_name: "",
				phone: "",
				street: "",
				label: "",
				landmark: null,
				gone: true,
			},
		);
		assert.equal(
			(await profileDraft(buyer.browser.request("/checkout"), identity))
				?.address_line,
			"",
		);

		// 9. Delete all optional details.
		const last = (await details(buyer)).body;
		const cleared = await save(buyer, {
			expected_version: last.version,
			...empty,
		});
		assert.deepEqual(
			[
				cleared.body.birth_day,
				cleared.body.birth_month,
				cleared.body.birth_year,
				cleared.body.gender,
				cleared.body.favourite_category_ids,
			],
			[null, null, null, null, []],
		);
	} finally {
		for (const user of buyers) {
			await sql`delete from app.marketing_consent where user_id=${user.id}`;
			await sql`delete from app.buyer_address where user_id=${user.id}`;
			await sql`delete from app.buyer_notification_preference where user_id=${user.id}`;
			await sql`delete from app.buyer_profile where user_id=${user.id}`;
		}
		await cleanup(identity, [...buyers, admin, cs]);
		await f.close();
	}
});
