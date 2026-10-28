import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { handleCommerceExceptions } from "../../src/modules/checkout/exceptions/routes.ts";
import { handleShippingLabels } from "../../src/modules/documents/labels.ts";
import {
	ingestWaybillEvent,
	simulateWaybillIssue,
} from "../../src/modules/fulfillment/local.ts";
import { actor, enroll, labelTemplateProof } from "../contract/access-fixture.ts";
import {
	closeFulfillmentActor,
	fulfillmentFixture,
} from "./fulfillment-fixture.ts";

test("S54 integration: shipping label templates, thermal & A4 PDF generation, privacy/brand governance, batch print, reprint reason enforcement, and waybill invalidation", async () => {
	const f = await fulfillmentFixture("cod");
	const sql = f.identity.sql;
	const [parcelA, parcelB] = f.parcels;
	assert.ok(parcelA && parcelB);

	// Create a warehouse operator scoped ONLY to parcelA.warehouse_id
	const warehouseStaff = await actor(f.identity, "warehouse", [
		String(parcelA.warehouse_id),
	]);
	await enroll(warehouseStaff.browser, warehouseStaff.password);

	try {
		const callOwner = async (
			path: string,
			body?: Record<string, unknown>,
			key = randomUUID(),
		) => {
			const req = f.owner.browser.request(path, body);
			if (body !== undefined) req.headers.set("idempotency-key", key);
			const res = await handleShippingLabels(req, f.identity);
			const contentType = res.headers.get("content-type") ?? "";
			if (contentType.includes("application/pdf")) {
				const bytes = Buffer.from(await res.arrayBuffer());
				return {
					status: res.status,
					headers: res.headers,
					bytes,
					payload: null,
				};
			}
			return {
				status: res.status,
				headers: res.headers,
				bytes: null,
				payload: await res.json(),
			};
		};

		const callWarehouse = async (
			path: string,
			body?: Record<string, unknown>,
			key = randomUUID(),
		) => {
			const req = warehouseStaff.browser.request(path, body);
			if (body !== undefined) req.headers.set("idempotency-key", key);
			const res = await handleShippingLabels(req, f.identity);
			const contentType = res.headers.get("content-type") ?? "";
			if (contentType.includes("application/pdf")) {
				const bytes = Buffer.from(await res.arrayBuffer());
				return {
					status: res.status,
					headers: res.headers,
					bytes,
					payload: null,
				};
			}
			return {
				status: res.status,
				headers: res.headers,
				bytes: null,
				payload: await res.json(),
			};
		};

		// 1. Default templates & neutral_partner governance
		const initialTemplates = await callOwner(
			"/api/v1/admin/shipping-label-templates",
		);
		assert.equal(initialTemplates.status, 200);
		assert.ok(initialTemplates.payload.data.length >= 2);

		// Warehouse staff cannot create templates (owner-only)
		const forbiddenTpl = await callWarehouse(
			"/api/v1/admin/shipping-label-templates",
			{
				name: "warehouse-unauthorized-tpl",
				format: "thermal_100x150",
				privacy_mode: "masked_phone",
				brand_mode: "99ribu",
			},
		);
		assert.equal(forbiddenTpl.status, 403);

		// neutral_partner without partner_brand_name or disclosure_text must fail with 422
		const invalidPartnerTpl = await callOwner(
			"/api/v1/admin/shipping-label-templates",
			{
				name: `partner-invalid-${randomUUID().slice(0, 8)}`,
				format: "thermal_100x150",
				privacy_mode: "masked_phone",
				brand_mode: "neutral_partner",
				reauthentication_proof: await labelTemplateProof(f.identity, f.owner),
			},
		);
		assert.equal(invalidPartnerTpl.status, 422);
		assert.equal(
			invalidPartnerTpl.payload.code,
			"PARTNER_BRAND_GOVERNANCE_REQUIRED",
		);

		// Valid neutral_partner template creation + version bump
		const partnerTplName = `partner-valid-${randomUUID().slice(0, 8)}`;
		const createdPartnerTpl = await callOwner(
			"/api/v1/admin/shipping-label-templates",
			{
				name: partnerTplName,
				format: "a4",
				privacy_mode: "masked_phone",
				brand_mode: "neutral_partner",
				partner_brand_name: "Mitra Logistik Nusantara",
				disclosure_text: "Dikirim melalui jaringan mitra resmi 99ribu",
				reauthentication_proof: await labelTemplateProof(f.identity, f.owner),
			},
		);
		assert.equal(createdPartnerTpl.status, 201);
		assert.equal(createdPartnerTpl.payload.brand_mode, "neutral_partner");
		assert.equal(
			createdPartnerTpl.payload.partner_brand_name,
			"Mitra Logistik Nusantara",
		);
		assert.equal(createdPartnerTpl.payload.active_version, 1);
		const partnerTemplateId = createdPartnerTpl.payload.id as string;

		const updatedPartnerTpl = await callOwner(
			`/api/v1/admin/shipping-label-templates/${partnerTemplateId}/versions`,
			{
				format: "a4",
				privacy_mode: "carrier_required_full_phone",
				brand_mode: "neutral_partner",
				partner_brand_name: "Mitra Logistik Nusantara",
				disclosure_text: "Dikirim melalui jaringan mitra resmi 99ribu v2",
				expected_version: 1,
				reason: "Enable full phone for carrier handoff",
				reauthentication_proof: await labelTemplateProof(f.identity, f.owner),
			},
		);
		assert.equal(updatedPartnerTpl.status, 201);
		assert.equal(updatedPartnerTpl.payload.active_version, 2);
		assert.equal(
			updatedPartnerTpl.payload.privacy_mode,
			"carrier_required_full_phone",
		);

		// 2. Waybill precondition: generating label before waybill is issued must fail with 409 WAYBILL_REQUIRED
		const beforeWaybill = await callOwner(
			`/api/v1/admin/shipments/${parcelA.shipment_id}/label-jobs`,
			{
				format: "thermal_100x150",
			},
		);
		assert.equal(beforeWaybill.status, 409);
		assert.equal(beforeWaybill.payload.code, "WAYBILL_REQUIRED");

		// Issue waybill for parcelA only (leave parcelB unbooked for batch partial-failure test)
		const bookingA = await f.book(parcelA);
		await f.run(bookingA.creation_job_id);
		for (const callback of await sql`
			select callback_job_id from app.waybill_provider_event where booking_id = ${bookingA.id}
		`) {
			await f.run(callback.callback_job_id);
		}
		const issuedEventA = await simulateWaybillIssue(sql, "test", bookingA.id);
		await f.run(await ingestWaybillEvent(sql, issuedEventA));

		// 3. Warehouse scope enforcement
		const deniedOtherWarehouse = await callWarehouse(
			`/api/v1/admin/shipments/${parcelB.shipment_id}/label-jobs`,
			{
				format: "thermal_100x150",
			},
		);
		assert.equal(deniedOtherWarehouse.status, 403);
		assert.equal(deniedOtherWarehouse.payload.code, "WAREHOUSE_SCOPE_DENIED");

		// 4. Generate thermal_100x150 label (default masked_phone template) as assigned warehouse staff
		const genKey = randomUUID();
		const thermalJob1 = await callWarehouse(
			`/api/v1/admin/shipments/${parcelA.shipment_id}/label-jobs`,
			{
				format: "thermal_100x150",
			},
			genKey,
		);
		assert.equal(thermalJob1.status, 202);
		assert.equal(thermalJob1.payload.status, "succeeded");
		assert.equal(thermalJob1.payload.format, "thermal_100x150");
		const thermalArtifactId = thermalJob1.payload.artifact_id as string;
		assert.ok(thermalArtifactId);

		// Idempotent replay with same key or new key reuses the same valid artifact
		const thermalJobReplay = await callWarehouse(
			`/api/v1/admin/shipments/${parcelA.shipment_id}/label-jobs`,
			{
				format: "thermal_100x150",
			},
			genKey,
		);
		assert.equal(thermalJobReplay.status, 202);
		assert.equal(thermalJobReplay.payload.id, thermalJob1.payload.id);

		const thermalJobReuse = await callWarehouse(
			`/api/v1/admin/shipments/${parcelA.shipment_id}/label-jobs`,
			{
				format: "thermal_100x150",
			},
		);
		assert.equal(thermalJobReuse.status, 202);
		assert.equal(thermalJobReuse.payload.artifact_id, thermalArtifactId);

		// Lookup job & artifact metadata
		const jobLookup = await callWarehouse(
			`/api/v1/admin/label-jobs/${thermalJob1.payload.id}`,
		);
		assert.equal(jobLookup.status, 200);
		assert.equal(jobLookup.payload.artifact_id, thermalArtifactId);

		const artifactMeta = await callWarehouse(
			`/api/v1/admin/label-artifacts/${thermalArtifactId}`,
		);
		assert.equal(artifactMeta.status, 200);
		assert.equal(artifactMeta.payload.status, "valid");
		assert.equal(artifactMeta.payload.format, "thermal_100x150");

		// Download PDF via /api/v1/admin/label-artifacts/[artifactId]/content and /api/v1/admin/shipments/[shipmentId]/label
		const pdfContent = await callWarehouse(
			`/api/v1/admin/label-artifacts/${thermalArtifactId}/content`,
		);
		assert.equal(pdfContent.status, 200);
		assert.ok(pdfContent.bytes);
		const computedSha = createHash("sha256")
			.update(pdfContent.bytes)
			.digest("hex");
		assert.equal(computedSha, artifactMeta.payload.content_sha256);
		const pdfText = pdfContent.bytes.toString("utf8");
		assert.ok(pdfText.startsWith("%PDF-1.4"));
		assert.ok(pdfText.includes("99RIBU OFFICIAL LOGISTICS"));
		assert.ok(pdfText.includes("TELEPON \\(masked_phone\\):"));
		assert.ok(pdfText.includes("****"));

		const shipmentPdf = await callWarehouse(
			`/api/v1/admin/shipments/${parcelA.shipment_id}/label`,
		);
		assert.equal(shipmentPdf.status, 200);
		assert.deepEqual(shipmentPdf.bytes, pdfContent.bytes);

		// Generate A4 label with neutral_partner + carrier_required_full_phone template
		const a4Job = await callOwner(
			`/api/v1/admin/shipments/${parcelA.shipment_id}/label-jobs`,
			{
				format: "a4",
				template_id: partnerTemplateId,
			},
		);
		assert.equal(a4Job.status, 202);
		const a4ArtifactId = a4Job.payload.artifact_id as string;
		const a4Pdf = await callOwner(
			`/api/v1/admin/label-artifacts/${a4ArtifactId}/content`,
		);
		assert.equal(a4Pdf.status, 200);
		assert.ok(a4Pdf.bytes);
		const a4Text = a4Pdf.bytes.toString("utf8");
		assert.ok(
			a4Text.includes("Mitra Logistik Nusantara \\(Fulfilled via 99ribu\\)"),
		);
		assert.ok(
			a4Text.includes("Dikirim melalui jaringan mitra resmi 99ribu v2"),
		);
		assert.ok(a4Text.includes("TELEPON \\(carrier_required_full_phone\\):"));

		// 5. Print attempts & reprint governance + fulfillment boundary check
		const [fulfillmentBeforePrint] = await sql`
			select status, revision from app.fulfillment where id = ${parcelA.id}
		`;
		const initialPrint = await callWarehouse(
			`/api/v1/admin/shipments/${parcelA.shipment_id}/print-attempts`,
			{
				artifact_id: thermalArtifactId,
				kind: "initial_print",
				outcome: "completed",
			},
		);
		assert.equal(initialPrint.status, 201);
		assert.equal(initialPrint.payload.kind, "initial_print");
		assert.equal(initialPrint.payload.outcome, "completed");

		// Second initial_print after completed must be rejected with 409
		const duplicateInitialPrint = await callWarehouse(
			`/api/v1/admin/shipments/${parcelA.shipment_id}/print-attempts`,
			{
				artifact_id: thermalArtifactId,
				kind: "initial_print",
				outcome: "completed",
			},
		);
		assert.equal(duplicateInitialPrint.status, 409);
		assert.equal(
			duplicateInitialPrint.payload.code,
			"INITIAL_PRINT_ALREADY_COMPLETED",
		);

		// Reprint without reason must be rejected with 422
		const reprintWithoutReason = await callWarehouse(
			`/api/v1/admin/shipments/${parcelA.shipment_id}/print-attempts`,
			{
				artifact_id: thermalArtifactId,
				kind: "reprint",
				outcome: "completed",
			},
		);
		assert.equal(reprintWithoutReason.status, 422);
		assert.equal(reprintWithoutReason.payload.code, "REPRINT_REASON_REQUIRED");

		// Reprint with reason succeeds
		const validReprint = await callWarehouse(
			`/api/v1/admin/shipments/${parcelA.shipment_id}/print-attempts`,
			{
				artifact_id: thermalArtifactId,
				kind: "reprint",
				outcome: "completed",
				reason: "Kertas thermal kusut saat keluar dari printer",
			},
		);
		assert.equal(validReprint.status, 201);
		assert.equal(validReprint.payload.kind, "reprint");
		assert.equal(
			validReprint.payload.reason,
			"Kertas thermal kusut saat keluar dari printer",
		);

		const printHistory = await callWarehouse(
			`/api/v1/admin/shipments/${parcelA.shipment_id}/print-attempts`,
		);
		assert.equal(printHistory.status, 200);
		assert.equal(printHistory.payload.data.length, 2);

		// Verify printing did NOT advance fulfillment status
		const [fulfillmentAfterPrint] = await sql`
			select status, revision from app.fulfillment where id = ${parcelA.id}
		`;
		assert.equal(fulfillmentAfterPrint.status, fulfillmentBeforePrint.status);
		assert.equal(
			fulfillmentAfterPrint.revision,
			fulfillmentBeforePrint.revision,
		);

		// 6. Batch label generation with mixed ready + unbooked shipments preserves input order
		const batchRes = await callOwner("/api/v1/admin/label-batches", {
			shipment_ids: [String(parcelB.shipment_id), String(parcelA.shipment_id)],
			format: "thermal_100x150",
		});
		assert.equal(batchRes.status, 202);
		assert.equal(batchRes.payload.status, "partially_failed");
		assert.equal(batchRes.payload.items.length, 2);
		assert.equal(
			batchRes.payload.items[0].shipment_id,
			String(parcelB.shipment_id),
		);
		assert.equal(batchRes.payload.items[0].status, "failed");
		assert.equal(batchRes.payload.items[0].failure_code, "WAYBILL_REQUIRED");
		assert.equal(
			batchRes.payload.items[1].shipment_id,
			String(parcelA.shipment_id),
		);
		assert.equal(batchRes.payload.items[1].status, "succeeded");
		assert.equal(batchRes.payload.items[1].artifact_id, thermalArtifactId);

		const batchLookup = await callOwner(
			`/api/v1/admin/label-batches/${batchRes.payload.id}`,
		);
		assert.equal(batchLookup.status, 200);
		assert.equal(batchLookup.payload.status, "partially_failed");
		assert.deepEqual(
			batchLookup.payload.items.map(
				(i: { shipment_id: string }) => i.shipment_id,
			),
			[String(parcelB.shipment_id), String(parcelA.shipment_id)],
		);

		// 7. Waybill reissue invalidation: a valid artifact from an earlier waybill tracking_number is automatically marked invalidated_by_reissue
		const supersededJobId = randomUUID();
		const supersededArtifactId = randomUUID();
		const [tplVer] = await sql`
			select id from app.shipping_label_template_version limit 1
		`;
		await sql`
			insert into app.shipping_label_job (
				id,
				shipment_id,
				fulfillment_id,
				booking_id,
				warehouse_id,
				tracking_number,
				template_version_id,
				format,
				status,
				operation_id,
				artifact_id
			)
			values (
				${supersededJobId},
				${parcelA.shipment_id},
				${parcelA.id},
				${bookingA.id},
				${parcelA.warehouse_id},
				'LOCAL-00000000000000000000000000000001',
				${tplVer.id},
				'thermal_100x150',
				'succeeded',
				${randomUUID()},
				${supersededArtifactId}
			)
		`;
		await sql`
			insert into app.shipping_label_artifact (
				id,
				label_job_id,
				shipment_id,
				warehouse_id,
				tracking_number,
				format,
				storage_key,
				sha256,
				byte_size,
				page_count,
				status,
				snapshot,
				expires_at
			)
			values (
				${supersededArtifactId},
				${supersededJobId},
				${parcelA.shipment_id},
				${parcelA.warehouse_id},
				'LOCAL-00000000000000000000000000000001',
				'thermal_100x150',
				'superseded-key',
				${"a".repeat(64)},
				128,
				1,
				'valid',
				'{"template_version":1}'::jsonb,
				clock_timestamp() + interval '30 days'
			)
		`;

		const invalidatedMeta = await callWarehouse(
			`/api/v1/admin/label-artifacts/${supersededArtifactId}`,
		);
		assert.equal(invalidatedMeta.status, 200);
		assert.equal(invalidatedMeta.payload.status, "invalidated_by_reissue");

		const invalidatedContent = await callWarehouse(
			`/api/v1/admin/label-artifacts/${supersededArtifactId}/content`,
		);
		assert.equal(invalidatedContent.status, 409);
		assert.equal(invalidatedContent.payload.code, "LABEL_ARTIFACT_INVALIDATED");

		const invalidatedPrint = await callWarehouse(
			`/api/v1/admin/shipments/${parcelA.shipment_id}/print-attempts`,
			{
				artifact_id: supersededArtifactId,
				kind: "reprint",
				outcome: "completed",
				reason: "Attempt to print superseded waybill",
			},
		);
		assert.equal(invalidatedPrint.status, 409);
		assert.equal(invalidatedPrint.payload.code, "LABEL_ARTIFACT_INVALIDATED");

		// 8. Cancellation invalidation: when a shipment's units are cancelled, its artifacts become invalidated_by_cancellation
		const cancelledJobId = randomUUID();
		const cancelledArtifactId = randomUUID();
		await sql`
			insert into app.shipping_label_job (
				id,
				shipment_id,
				fulfillment_id,
				booking_id,
				warehouse_id,
				tracking_number,
				template_version_id,
				format,
				status,
				operation_id,
				artifact_id
			)
			values (
				${cancelledJobId},
				${parcelB.shipment_id},
				${parcelB.id},
				${bookingA.id},
				${parcelB.warehouse_id},
				'LOCAL-00000000000000000000000000000002',
				${tplVer.id},
				'thermal_100x150',
				'succeeded',
				${randomUUID()},
				${cancelledArtifactId}
			)
		`;
		await sql`
			insert into app.shipping_label_artifact (
				id,
				label_job_id,
				shipment_id,
				warehouse_id,
				tracking_number,
				format,
				storage_key,
				sha256,
				byte_size,
				page_count,
				status,
				snapshot,
				expires_at
			)
			values (
				${cancelledArtifactId},
				${cancelledJobId},
				${parcelB.shipment_id},
				${parcelB.warehouse_id},
				'LOCAL-00000000000000000000000000000002',
				'thermal_100x150',
				'cancelled-key',
				${"b".repeat(64)},
				128,
				1,
				'valid',
				'{"template_version":1}'::jsonb,
				clock_timestamp() + interval '30 days'
			)
		`;

		const unitsB = await sql<{ id: string }[]>`
			select id from app.fulfillment_item where shipment_id = ${parcelB.shipment_id} order by id
		`;
		const balancesB = await sql<
			{ balance_id: string; stock_item_id: string; revision: number }[]
		>`
			select distinct a.balance_id, a.stock_item_id, b.revision
			from app.fulfillment_component_allocation a
			join app.inventory_balance b on b.id = a.balance_id
			where a.fulfillment_item_id in ${sql(unitsB.map((u) => u.id))}
			order by a.balance_id
		`;
		const callExceptionStaff = async (
			path: string,
			body: Record<string, unknown>,
		) => {
			const req = f.owner.browser.request(path, body);
			req.headers.set("idempotency-key", randomUUID());
			const res = await handleCommerceExceptions(req, f.identity);
			return { status: res.status, payload: await res.json() };
		};
		const reported = await callExceptionStaff(
			"/api/v1/admin/commerce-exceptions",
			{
				fulfillment_id: parcelB.id,
				fulfillment_item_ids: unitsB.map((u) => u.id),
				expected_version: 1,
				reason: "SYNTHETIC shortage cancelling parcelB",
				observed_components: balancesB.map((b, idx) => ({
					balance_id: b.balance_id,
					stock_item_id: b.stock_item_id,
					expected_balance_version: Number(b.revision),
					missing_quantity: idx === 0 ? 1 : 0,
				})),
			},
		);
		assert.equal(reported.status, 201);
		const excId = String(reported.payload.id);

		const proposed = await callExceptionStaff(
			`/api/v1/admin/commerce-exceptions/${excId}/decisions`,
			{
				expected_version: 1,
				decision: "propose_cancellation",
				reason: "Propose cancelling parcelB units",
			},
		);
		assert.equal(proposed.status, 201);
		const proposalId = String(proposed.payload.proposal.id);

		const acceptReq = f.client.request(
			`/api/v1/orders/${f.order.id}/recovery-actions`,
			{
				exception_id: excId,
				expected_version: 2,
				action: "accept_proposal",
				proposal_id: proposalId,
			},
		);
		acceptReq.headers.set("idempotency-key", randomUUID());
		const accepted = await handleCommerceExceptions(acceptReq, f.identity);
		assert.equal(accepted.status, 201);

		const applied = await callExceptionStaff(
			`/api/v1/admin/commerce-exceptions/${excId}/decisions`,
			{
				expected_version: 3,
				proposal_id: proposalId,
				reason: "Apply buyer-accepted parcelB cancellation",
			},
		);
		assert.equal(applied.status, 201);

		const cancelledContent = await callOwner(
			`/api/v1/admin/label-artifacts/${cancelledArtifactId}/content`,
		);
		assert.equal(cancelledContent.status, 409);
		assert.equal(cancelledContent.payload.code, "LABEL_ARTIFACT_INVALIDATED");

		const cancelledMeta = await callOwner(
			`/api/v1/admin/label-artifacts/${cancelledArtifactId}`,
		);
		assert.equal(cancelledMeta.status, 200);
		assert.equal(cancelledMeta.payload.status, "invalidated_by_cancellation");

		const cancelledGen = await callOwner(
			`/api/v1/admin/shipments/${parcelB.shipment_id}/label-jobs`,
			{
				format: "thermal_100x150",
			},
		);
		assert.equal(cancelledGen.status, 409);
		assert.equal(cancelledGen.payload.code, "SHIPMENT_CANCELLED");
	} finally {
		await closeFulfillmentActor(f.identity, warehouseStaff);
		await f.close();
	}
});

test("Print-center queue: needs-label parcels first, then labelled not handed over, keyset pages without gaps, warehouse-scoped", async () => {
	const f = await fulfillmentFixture("cod");
	const sql = f.identity.sql;
	const [parcelA, parcelB] = f.parcels;
	assert.ok(parcelA && parcelB);
	const both = await actor(f.identity, "warehouse", [
		...new Set([String(parcelA.warehouse_id), String(parcelB.warehouse_id)]),
	]);
	await enroll(both.browser, both.password);
	const onlyA = await actor(f.identity, "warehouse", [
		String(parcelA.warehouse_id),
	]);
	await enroll(onlyA.browser, onlyA.password);
	const finance = await actor(f.identity, "finance", []);
	await enroll(finance.browser, finance.password);
	type Row = {
		shipment_id: string;
		warehouse_id: string;
		due_at: string | null;
	};
	type Page = {
		data: Row[];
		artifacts: { shipment_id: string; status: string }[];
		pagination: { next_cursor: string | null };
	};
	const get = async (user: typeof both, query: string) => {
		const res = await handleShippingLabels(
			user.browser.request(`/api/v1/admin/label-queue${query}`),
			f.identity,
		);
		return { status: res.status, payload: await res.json() };
	};
	// Walks every page one row at a time; a gap or repeat would break the order assertions.
	const walk = async (user: typeof both) => {
		const rows: Row[] = [];
		const artifacts: Page["artifacts"] = [];
		let cursor: string | null = null;
		for (let i = 0; i < 50; i++) {
			const page: { status: number; payload: Page } = await get(
				user,
				`?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
			);
			assert.equal(page.status, 200);
			assert.ok(page.payload.data.length <= 1);
			rows.push(...page.payload.data);
			artifacts.push(...page.payload.artifacts);
			cursor = page.payload.pagination.next_cursor;
			if (!cursor) return { rows, artifacts };
		}
		assert.fail("print queue did not terminate");
	};
	try {
		const ids = [parcelA.shipment_id, parcelB.shipment_id].map(String);
		const deadlines = await sql<{ id: string; due: string | null }[]>`
			select s.id, coalesce(d.packing_due_at, d.handover_due_at) as due
			from app.order_shipment s left join app.fulfillment fl on fl.shipment_id = s.id
			left join app.fulfillment_deadline d on d.id = fl.deadline_id
			where s.id in ${sql(ids)}`;
		const key = (id: string) => {
			const due = deadlines.find((d) => d.id === id)?.due;
			return [due ? new Date(due).getTime() : Number.POSITIVE_INFINITY, id] as const;
		};
		const expectedInitial = [...ids].sort((x, y) => {
			const [dx, ix] = key(x);
			const [dy, iy] = key(y);
			return dx - dy || (ix < iy ? -1 : 1);
		});

		// Neither parcel has a label: both rank first, ordered by packing deadline then id.
		let walked = await walk(both);
		assert.equal(
			new Set(walked.rows.map((r) => r.shipment_id)).size,
			walked.rows.length,
		);
		assert.deepEqual(
			walked.rows.map((r) => r.shipment_id).filter((id) => ids.includes(id)),
			expectedInitial,
		);
		for (const r of walked.rows)
			assert.ok(
				[parcelA, parcelB].some(
					(p) => String(p.warehouse_id) === r.warehouse_id,
				),
			);

		// A valid label moves parcelA behind every parcel that still needs one.
		const booking = await f.book(parcelA);
		await f.run(booking.creation_job_id);
		for (const callback of await sql`
			select callback_job_id from app.waybill_provider_event where booking_id = ${booking.id}
		`)
			await f.run(callback.callback_job_id);
		await f.run(
			await ingestWaybillEvent(
				sql,
				await simulateWaybillIssue(sql, "test", booking.id),
			),
		);
		const job = await handleShippingLabels(
			(() => {
				const req = both.browser.request(
					`/api/v1/admin/shipments/${parcelA.shipment_id}/label-jobs`,
					{ format: "thermal_100x150" },
				);
				req.headers.set("idempotency-key", randomUUID());
				return req;
			})(),
			f.identity,
		);
		assert.equal(job.status, 202);
		walked = await walk(both);
		const order = walked.rows.map((r) => r.shipment_id);
		assert.ok(
			order.indexOf(String(parcelB.shipment_id)) <
				order.indexOf(String(parcelA.shipment_id)),
		);
		assert.ok(
			walked.artifacts.some(
				(a) =>
					a.shipment_id === String(parcelA.shipment_id) && a.status === "valid",
			),
			"page carries the label artifact of its parcel",
		);

		// Scope: an operator of parcelA's warehouse never sees the other warehouse's parcel.
		if (String(parcelA.warehouse_id) !== String(parcelB.warehouse_id)) {
			const scoped = await walk(onlyA);
			assert.ok(
				scoped.rows.every(
					(r) => r.warehouse_id === String(parcelA.warehouse_id),
				),
			);
			assert.ok(
				!scoped.rows.some((r) => r.shipment_id === String(parcelB.shipment_id)),
			);
		}

		// Role and input boundaries.
		assert.equal((await get(finance, "")).status, 403);
		for (const bad of [
			"?cursor=abc",
			`?cursor=3.-.${parcelA.shipment_id}`,
			"?limit=0",
			"?limit=101",
			"?limit=1&limit=2",
			"?sort=due_at",
		])
			assert.equal((await get(both, bad)).status, 400, bad);
	} finally {
		for (const user of [both, onlyA, finance])
			await closeFulfillmentActor(f.identity, user);
		await f.close();
	}
});
