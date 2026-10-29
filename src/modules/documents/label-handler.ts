import { createHash, randomUUID } from "node:crypto";
import { readPrivateArtifact } from "../../storage/private.ts";
import type { LocalAuth } from "../access/auth.ts";
import { consumeAccessProof } from "../access/grants.ts";
import {
	assertOrigin,
	privateJson,
	problem,
	readBody,
} from "../access/http.ts";
import { AccessError, getPrincipal } from "../access/policy.ts";
import {
	array,
	id,
	integer,
	invalid,
	object,
	text,
} from "../catalog/validation.ts";
import { intentHash, mutationKey } from "../checkout/carts.ts";
import {
	generateOrReuseLabelForShipment,
	revalidateShipmentArtifacts,
} from "./label-artifacts.ts";
import {
	assertLabelGeneratePermission,
	assertLabelPrintPermission,
	assertLabelReadPermission,
	assertTemplateManagePermission,
	assertTemplateReadPermission,
	assertWarehouseScope,
	checkIdempotency,
	parsePagination,
	type ShippingLabelArtifactResponse,
	type ShippingLabelBatchResponse,
	type ShippingLabelFormat,
	type ShippingLabelJobResponse,
	type ShippingLabelTemplateResponse,
	type ShippingPrintAttemptResponse,
	saveIdempotency,
} from "./label-shared.ts";
import { resolveShipment } from "./label-shipment.ts";
import { ensureDefaultTemplates, formatTemplate } from "./label-templates.ts";
import { printQueueInput, readPrintQueue } from "./print-queue.ts";

export async function handleShippingLabels(
	request: Request,
	identity: LocalAuth,
) {
	try {
		assertOrigin(request);
		if (
			["authorization", "x-cart-token", "x-order-token"].some((name) =>
				request.headers.has(name),
			)
		) {
			throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
		}
		const url = new URL(request.url);
		if (request.method !== "GET" && url.search) throw invalid();
		const principal = await getPrincipal(request, identity);

		// 0. Print-center queue: GET /api/v1/admin/label-queue (cursor-paged, warehouse-scoped)
		if (url.pathname === "/api/v1/admin/label-queue") {
			if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
			assertLabelReadPermission(principal);
			const page = printQueueInput(url);
			return privateJson(
				await identity.sql.begin((tx) => readPrintQueue(tx, principal, page)),
				200,
			);
		}

		// 1. Templates: GET / POST /api/v1/admin/shipping-label-templates & POST /api/v1/admin/shipping-label-templates/[templateId]/versions
		if (url.pathname === "/api/v1/admin/shipping-label-templates") {
			if (request.method === "GET") {
				assertTemplateReadPermission(principal);
				const paging = parsePagination(url);
				const list = await identity.sql.begin(async (tx) => {
					await ensureDefaultTemplates(tx, principal.id);
					let rows: { id: string; created_at: string }[];
					if (paging.cursor) {
						const [anchor] = await tx<{ created_at: string }[]>`
							select created_at::text
							from app.shipping_label_template
							where id = ${paging.cursor}
						`;
						if (!anchor) throw invalid();
						rows = await tx`
							select id, created_at
							from app.shipping_label_template
							where (created_at, id) < (${anchor.created_at}::timestamptz, ${paging.cursor}::uuid)
							order by created_at desc, id desc
							limit ${paging.limit + 1}
						`;
					} else {
						rows = await tx`
							select id, created_at
							from app.shipping_label_template
							order by created_at desc, id desc
							limit ${paging.limit + 1}
						`;
					}
					const slice = rows.slice(0, paging.limit);
					const data: ShippingLabelTemplateResponse[] = [];
					for (const r of slice) {
						data.push(await formatTemplate(tx, r.id));
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
			if (request.method === "POST") {
				assertTemplateManagePermission(principal);
				const key = mutationKey(request);
				const body = object(await readBody(request), [
					"name",
					"code",
					"carrier_code",
					"service_code",
					"format",
					"privacy_mode",
					"brand_mode",
					"partner_brand_name",
					"permission_evidence",
					"disclosure_text",
					"renderer_version",
					"reason",
					"expected_version",
					"reauthentication_proof",
				]);
				const expectedVersion =
					body.expected_version === undefined
						? undefined
						: integer(body.expected_version, 0, 2147483647);
				if (
					typeof body.reauthentication_proof !== "string" ||
					!body.reauthentication_proof.length ||
					body.reauthentication_proof.length > 100
				) {
					throw new AccessError(403, "REAUTHENTICATION_REQUIRED");
				}
				const reauthenticationProof = body.reauthentication_proof;
				if (expectedVersion !== undefined && expectedVersion !== 0) {
					throw new AccessError(409, "TEMPLATE_VERSION_CONFLICT");
				}
				const name = text(body.name ?? body.code, 120).trim();
				if (!name) throw invalid();
				if (body.format !== "thermal_100x150" && body.format !== "a4") {
					throw invalid();
				}
				if (
					body.privacy_mode !== "masked_phone" &&
					body.privacy_mode !== "carrier_required_full_phone"
				) {
					throw invalid();
				}
				if (
					body.brand_mode !== "99ribu" &&
					body.brand_mode !== "neutral_partner"
				) {
					throw invalid();
				}
				const format = body.format;
				const privacyMode = body.privacy_mode;
				const brandMode = body.brand_mode;
				const rawPartnerBrand =
					body.partner_brand_name ?? body.permission_evidence ?? null;
				const partnerBrandName =
					rawPartnerBrand === null || String(rawPartnerBrand).trim() === ""
						? null
						: text(rawPartnerBrand, 500).trim();
				const rawDisclosure = body.disclosure_text ?? null;
				const disclosureText =
					rawDisclosure === null || String(rawDisclosure).trim() === ""
						? null
						: text(rawDisclosure, 500).trim();
				if (
					brandMode === "neutral_partner" &&
					(!partnerBrandName || !disclosureText)
				) {
					throw new AccessError(422, "PARTNER_BRAND_GOVERNANCE_REQUIRED");
				}
				const carrierCode =
					body.carrier_code === undefined
						? "LOCAL"
						: text(body.carrier_code, 60).trim() || "LOCAL";
				const serviceCode =
					body.service_code === undefined
						? "REG"
						: text(body.service_code, 60).trim() || "REG";
				const rendererVersion =
					body.renderer_version === undefined
						? "v1"
						: text(body.renderer_version, 40).trim() || "v1";
				const reason =
					body.reason === undefined
						? "Created shipping label template"
						: text(body.reason, 500).trim() ||
							"Created shipping label template";
				const hash = await intentHash(identity, "shipping.template.create", {
					name,
					format,
					privacyMode,
					brandMode,
					partnerBrandName,
					disclosureText,
					carrierCode,
					serviceCode,
					rendererVersion,
				});
				const created = await identity.sql.begin(async (tx) => {
					const prior = await checkIdempotency<ShippingLabelTemplateResponse>(
						tx,
						principal.id,
						"shipping.template.create",
						key,
						hash,
					);
					if (prior) return prior;
					const [dup] = await tx<{ id: string }[]>`
						select id from app.shipping_label_template where code = ${name.slice(0, 80)}
					`;
					if (dup) {
						throw new AccessError(409, "TEMPLATE_NAME_CONFLICT");
					}
					await consumeAccessProof(
						tx,
						principal,
						"shipping_label_template.version",
						"shipping-label-templates",
						reauthenticationProof,
					);
					const templateId = randomUUID();
					await tx`
						insert into app.shipping_label_template (
							id,
							code,
							carrier_code,
							service_code,
							format,
							brand_mode,
							privacy_mode,
							active_revision,
							enabled
						)
						values (
							${templateId},
							${name.slice(0, 80)},
							${carrierCode},
							${serviceCode},
							${format},
							${brandMode},
							${privacyMode},
							1,
							true
						)
					`;
					await tx`
						insert into app.shipping_label_template_version (
							template_id,
							revision,
							renderer_version,
							permission_evidence,
							disclosure_text,
							actor_id,
							reason
						)
						values (
							${templateId},
							1,
							${rendererVersion},
							${partnerBrandName ?? ""},
							${disclosureText ?? ""},
							${principal.id},
							${reason}
						)
					`;
					const response = await formatTemplate(tx, templateId);
					return saveIdempotency(
						tx,
						principal.id,
						"shipping.template.create",
						key,
						hash,
						templateId,
						reason,
						response,
					);
				});
				return privateJson(created, 201);
			}
			throw new AccessError(404, "NOT_FOUND");
		}

		const tplVersionMatch =
			/^\/api\/v1\/admin\/shipping-label-templates\/([^/]+)\/versions$/.exec(
				url.pathname,
			);
		if (tplVersionMatch) {
			if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
			assertTemplateManagePermission(principal);
			const templateId = id(tplVersionMatch[1]);
			const key = mutationKey(request);
			const body = object(await readBody(request), [
				"name",
				"code",
				"format",
				"privacy_mode",
				"brand_mode",
				"partner_brand_name",
				"permission_evidence",
				"disclosure_text",
				"renderer_version",
				"reason",
				"expected_version",
				"reauthentication_proof",
			]);
			if (
				typeof body.reauthentication_proof !== "string" ||
				!body.reauthentication_proof.length ||
				body.reauthentication_proof.length > 100
			) {
				throw new AccessError(403, "REAUTHENTICATION_REQUIRED");
			}
			const reauthenticationProof = body.reauthentication_proof;
			if (body.format !== "thermal_100x150" && body.format !== "a4") {
				throw invalid();
			}
			if (
				body.privacy_mode !== "masked_phone" &&
				body.privacy_mode !== "carrier_required_full_phone"
			) {
				throw invalid();
			}
			if (
				body.brand_mode !== "99ribu" &&
				body.brand_mode !== "neutral_partner"
			) {
				throw invalid();
			}
			const format = body.format;
			const privacyMode = body.privacy_mode;
			const brandMode = body.brand_mode;
			const expectedVersion =
				body.expected_version === undefined
					? undefined
					: integer(body.expected_version, 1, 2147483647);
			const rawPartnerBrand =
				body.partner_brand_name ?? body.permission_evidence ?? null;
			const partnerBrandName =
				rawPartnerBrand === null || String(rawPartnerBrand).trim() === ""
					? null
					: text(rawPartnerBrand, 500).trim();
			const rawDisclosure = body.disclosure_text ?? null;
			const disclosureText =
				rawDisclosure === null || String(rawDisclosure).trim() === ""
					? null
					: text(rawDisclosure, 500).trim();
			if (
				brandMode === "neutral_partner" &&
				(!partnerBrandName || !disclosureText)
			) {
				throw new AccessError(422, "PARTNER_BRAND_GOVERNANCE_REQUIRED");
			}
			const rendererVersion =
				body.renderer_version === undefined
					? "v2"
					: text(body.renderer_version, 40).trim() || "v2";
			const reason =
				body.reason === undefined
					? "Published new shipping label template version"
					: text(body.reason, 500).trim() ||
						"Published new shipping label template version";
			const nameOverride =
				(body.name ?? body.code)
					? text(body.name ?? body.code, 120).trim()
					: null;
			const hash = await intentHash(identity, "shipping.template.version", {
				templateId,
				nameOverride,
				format,
				privacyMode,
				brandMode,
				partnerBrandName,
				disclosureText,
				expectedVersion,
				rendererVersion,
			});

			const updated = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<ShippingLabelTemplateResponse>(
					tx,
					principal.id,
					"shipping.template.version",
					key,
					hash,
				);
				if (prior) return prior;
				const [current] = await tx<
					{ id: string; code: string; active_revision: number }[]
				>`
					select id, code, active_revision
					from app.shipping_label_template
					where id = ${templateId}
					for update
				`;
				if (!current) throw new AccessError(404, "NOT_FOUND");
				if (
					expectedVersion !== undefined &&
					Number(current.active_revision) !== expectedVersion
				) {
					throw new AccessError(409, "TEMPLATE_VERSION_CONFLICT");
				}
				await consumeAccessProof(
					tx,
					principal,
					"shipping_label_template.version",
					"shipping-label-templates",
					reauthenticationProof,
				);
				const nextRevision = Number(current.active_revision) + 1;
				const nextCode = nameOverride
					? nameOverride.slice(0, 80)
					: current.code;
				await tx`
					update app.shipping_label_template
					set
						code = ${nextCode},
						format = ${format},
						brand_mode = ${brandMode},
						privacy_mode = ${privacyMode},
						active_revision = ${nextRevision},
						updated_at = clock_timestamp()
					where id = ${templateId}
				`;
				await tx`
					insert into app.shipping_label_template_version (
						template_id,
						revision,
						renderer_version,
						permission_evidence,
						disclosure_text,
						actor_id,
						reason
					)
					values (
						${templateId},
						${nextRevision},
						${rendererVersion},
						${partnerBrandName ?? ""},
						${disclosureText ?? ""},
						${principal.id},
						${reason}
					)
				`;
				const response = await formatTemplate(tx, templateId);
				return saveIdempotency(
					tx,
					principal.id,
					"shipping.template.version",
					key,
					hash,
					templateId,
					reason,
					response,
				);
			});
			return privateJson(updated, 201);
		}

		// 2. Single-parcel label job & current label PDF: /api/v1/admin/shipments/[shipmentId]/(label-jobs|label|print-attempts)
		const shipmentLabelMatch =
			/^\/api\/v1\/admin\/shipments\/([^/]+)\/(label-jobs|label|print-attempts)$/.exec(
				url.pathname,
			);
		if (shipmentLabelMatch) {
			const shipmentIdParam = id(shipmentLabelMatch[1]);
			const actionKind = shipmentLabelMatch[2];

			if (actionKind === "label-jobs") {
				if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
				assertLabelGeneratePermission(principal);
				const key = mutationKey(request);
				const body = object(await readBody(request), ["format", "template_id"]);
				if (body.format !== "thermal_100x150" && body.format !== "a4") {
					throw invalid();
				}
				const format = body.format;
				const templateId =
					body.template_id === undefined || body.template_id === null
						? null
						: id(body.template_id);
				const hash = await intentHash(identity, "shipping.label.generate", {
					shipmentId: shipmentIdParam,
					format,
					templateId,
				});
				const job = await identity.sql.begin(async (tx) => {
					const prior = await checkIdempotency<ShippingLabelJobResponse>(
						tx,
						principal.id,
						"shipping.label.generate",
						key,
						hash,
					);
					if (prior) return prior;
					const shipment = await resolveShipment(tx, shipmentIdParam);
					if (!shipment) throw new AccessError(404, "NOT_FOUND");
					assertWarehouseScope(principal, shipment.warehouse_id);
					const generated = await generateOrReuseLabelForShipment(
						tx,
						principal,
						shipment,
						format,
						templateId,
					);
					return saveIdempotency(
						tx,
						principal.id,
						"shipping.label.generate",
						key,
						hash,
						shipment.shipment_id,
						"Generated or reused shipment label artifact",
						generated.job,
						{ artifact_id: generated.artifact.id },
					);
				});
				return privateJson(job, 202);
			}

			if (actionKind === "label") {
				if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
				if (url.search) throw invalid();
				assertLabelReadPermission(principal);
				const { storageKey, sha256, byteSize, trackingNumber } =
					await identity.sql.begin(async (tx) => {
						const shipment = await resolveShipment(tx, shipmentIdParam);
						if (!shipment) throw new AccessError(404, "NOT_FOUND");
						assertWarehouseScope(principal, shipment.warehouse_id);
						await revalidateShipmentArtifacts(tx, shipment);
						const [artifact] = await tx<
							{
								id: string;
								storage_key: string;
								sha256: string;
								byte_size: number;
								tracking_number: string;
								status: string;
							}[]
						>`
							select id, storage_key, sha256, byte_size, tracking_number, status
							from app.shipping_label_artifact
							where shipment_id = ${shipment.shipment_id}
							order by (status = 'valid') desc, created_at desc
							limit 1
						`;
						if (!artifact) throw new AccessError(404, "NOT_FOUND");
						if (artifact.status !== "valid") {
							throw new AccessError(409, "LABEL_ARTIFACT_INVALIDATED");
						}
						return {
							storageKey: artifact.storage_key,
							sha256: artifact.sha256,
							byteSize: Number(artifact.byte_size),
							trackingNumber: artifact.tracking_number,
						};
					});
				const bytes = await readPrivateArtifact(storageKey);
				const actualSha = createHash("sha256").update(bytes).digest("hex");
				if (actualSha !== sha256 || bytes.byteLength !== byteSize) {
					throw new AccessError(500, "LABEL_CHECKSUM_MISMATCH");
				}
				return new Response(new Uint8Array(bytes), {
					status: 200,
					headers: {
						"content-type": "application/pdf",
						"cache-control": "no-store",
						"x-content-type-options": "nosniff",
						"content-disposition": `inline; filename="label-${trackingNumber}.pdf"`,
					},
				});
			}

			// actionKind === "print-attempts"
			if (request.method === "GET") {
				assertLabelReadPermission(principal);
				const paging = parsePagination(url);
				const list = await identity.sql.begin(async (tx) => {
					const shipment = await resolveShipment(tx, shipmentIdParam);
					if (!shipment) throw new AccessError(404, "NOT_FOUND");
					assertWarehouseScope(principal, shipment.warehouse_id);
					let rows: {
						id: string;
						shipment_id: string;
						artifact_id: string;
						actor_id: string;
						kind: "initial_print" | "reprint";
						reported_outcome: "sent_to_printer" | "completed" | "failed";
						reason: string | null;
						created_at: string;
					}[];
					if (paging.cursor) {
						const [anchor] = await tx<{ created_at: string }[]>`
							select created_at::text
							from app.shipping_print_attempt
							where id = ${paging.cursor} and shipment_id = ${shipment.shipment_id}
						`;
						if (!anchor) throw invalid();
						rows = await tx`
							select id, shipment_id, artifact_id, actor_id, kind, reported_outcome, reason, created_at
							from app.shipping_print_attempt
							where shipment_id = ${shipment.shipment_id}
								and (created_at, id) < (${anchor.created_at}::timestamptz, ${paging.cursor}::uuid)
							order by created_at desc, id desc
							limit ${paging.limit + 1}
						`;
					} else {
						rows = await tx`
							select id, shipment_id, artifact_id, actor_id, kind, reported_outcome, reason, created_at
							from app.shipping_print_attempt
							where shipment_id = ${shipment.shipment_id}
							order by created_at desc, id desc
							limit ${paging.limit + 1}
						`;
					}
					const slice = rows.slice(0, paging.limit);
					return {
						data: slice.map((r) => ({
							id: String(r.id),
							shipment_id: String(r.shipment_id),
							artifact_id: String(r.artifact_id),
							actor_user_id: r.actor_id,
							kind: r.kind,
							outcome: r.reported_outcome,
							reason: r.reason || null,
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

			if (request.method === "POST") {
				assertLabelPrintPermission(principal);
				const key = mutationKey(request);
				const body = object(await readBody(request), [
					"artifact_id",
					"kind",
					"outcome",
					"reason",
				]);
				const artifactId = id(body.artifact_id);
				if (body.kind !== "initial_print" && body.kind !== "reprint") {
					throw invalid();
				}
				if (
					body.outcome !== "sent_to_printer" &&
					body.outcome !== "completed" &&
					body.outcome !== "failed"
				) {
					throw invalid();
				}
				const kind = body.kind;
				const outcome = body.outcome;
				const reason =
					body.reason === undefined ||
					body.reason === null ||
					String(body.reason).trim() === ""
						? null
						: text(body.reason, 500).trim();
				if (kind === "reprint" && !reason) {
					throw new AccessError(422, "REPRINT_REASON_REQUIRED");
				}
				const hash = await intentHash(identity, "shipping.label.print", {
					shipmentId: shipmentIdParam,
					artifactId,
					kind,
					outcome,
					reason,
				});
				const attempt = await identity.sql.begin(async (tx) => {
					const prior = await checkIdempotency<ShippingPrintAttemptResponse>(
						tx,
						principal.id,
						"shipping.label.print",
						key,
						hash,
					);
					if (prior) return prior;
					const shipment = await resolveShipment(tx, shipmentIdParam);
					if (!shipment) throw new AccessError(404, "NOT_FOUND");
					assertWarehouseScope(principal, shipment.warehouse_id);
					await revalidateShipmentArtifacts(tx, shipment);

					const [artifact] = await tx<
						{ id: string; shipment_id: string; status: string }[]
					>`
						select id, shipment_id, status
						from app.shipping_label_artifact
						where id = ${artifactId} and shipment_id = ${shipment.shipment_id}
						for share
					`;
					if (!artifact) throw new AccessError(404, "NOT_FOUND");
					if (artifact.status !== "valid") {
						throw new AccessError(409, "LABEL_ARTIFACT_INVALIDATED");
					}
					if (kind === "initial_print") {
						const [completedInitial] = await tx<{ id: string }[]>`
							select id from app.shipping_print_attempt
							where shipment_id = ${shipment.shipment_id}
								and artifact_id = ${artifactId}
								and reported_outcome = 'completed'
							limit 1
						`;
						if (completedInitial) {
							throw new AccessError(409, "INITIAL_PRINT_ALREADY_COMPLETED");
						}
					}
					const attemptId = randomUUID();
					const [inserted] = await tx<
						{
							id: string;
							shipment_id: string;
							artifact_id: string;
							actor_id: string;
							kind: "initial_print" | "reprint";
							reported_outcome: "sent_to_printer" | "completed" | "failed";
							reason: string | null;
							created_at: string;
						}[]
					>`
						insert into app.shipping_print_attempt (
							id,
							shipment_id,
							artifact_id,
							warehouse_id,
							actor_id,
							kind,
							reported_outcome,
							reason
						)
						values (
							${attemptId},
							${shipment.shipment_id},
							${artifactId},
							${shipment.warehouse_id},
							${principal.id},
							${kind},
							${outcome},
							${reason ?? ""}
						)
						returning id, shipment_id, artifact_id, actor_id, kind, reported_outcome, reason, created_at
					`;
					const response: ShippingPrintAttemptResponse = {
						id: String(inserted.id),
						shipment_id: String(inserted.shipment_id),
						artifact_id: String(inserted.artifact_id),
						actor_user_id: inserted.actor_id,
						kind: inserted.kind,
						outcome: inserted.reported_outcome,
						reason: inserted.reason || null,
						created_at: new Date(inserted.created_at).toISOString(),
					};
					return saveIdempotency(
						tx,
						principal.id,
						"shipping.label.print",
						key,
						hash,
						shipment.shipment_id,
						reason ?? `Recorded ${kind} (${outcome})`,
						response,
						{ attempt_id: attemptId, artifact_id: artifactId, kind, outcome },
					);
				});
				return privateJson(attempt, 201);
			}
			throw new AccessError(404, "NOT_FOUND");
		}

		// 3. Label job lookup: GET /api/v1/admin/label-jobs/[labelJobId]
		const labelJobMatch = /^\/api\/v1\/admin\/label-jobs\/([^/]+)$/.exec(
			url.pathname,
		);
		if (labelJobMatch) {
			if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
			if (url.search) throw invalid();
			assertLabelReadPermission(principal);
			const jobId = id(labelJobMatch[1]);
			const job = await identity.sql.begin(async (tx) => {
				const [row] = await tx<
					{
						id: string;
						shipment_id: string;
						warehouse_id: string;
						format: ShippingLabelFormat;
						status: "queued" | "rendering" | "succeeded" | "failed";
						artifact_id: string | null;
						created_at: string;
					}[]
				>`
					select id, shipment_id, warehouse_id, format, status, artifact_id, created_at
					from app.shipping_label_job
					where id = ${jobId}
				`;
				if (!row) throw new AccessError(404, "NOT_FOUND");
				assertWarehouseScope(principal, String(row.warehouse_id));
				return {
					id: String(row.id),
					shipment_id: String(row.shipment_id),
					format: row.format,
					status: row.status,
					artifact_id: row.artifact_id ? String(row.artifact_id) : null,
					failure_code: null,
					created_at: new Date(row.created_at).toISOString(),
				};
			});
			return privateJson(job, 200);
		}

		// 4. Label artifact metadata & content: GET /api/v1/admin/label-artifacts/[artifactId](/content)
		const artifactMatch =
			/^\/api\/v1\/admin\/label-artifacts\/([^/]+)(?:\/(content))?$/.exec(
				url.pathname,
			);
		if (artifactMatch) {
			if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
			if (url.search) throw invalid();
			assertLabelReadPermission(principal);
			const artifactId = id(artifactMatch[1]);
			const isContent = artifactMatch[2] === "content";

			const info = await identity.sql.begin(async (tx) => {
				const [row] = await tx<
					{
						id: string;
						shipment_id: string;
						warehouse_id: string;
						tracking_number: string;
						format: ShippingLabelFormat;
						storage_key: string;
						sha256: string;
						byte_size: number;
						status:
							| "valid"
							| "invalidated_by_reissue"
							| "invalidated_by_cancellation"
							| "expired";
						snapshot: Record<string, unknown>;
						created_at: string;
					}[]
				>`
					select id, shipment_id, warehouse_id, tracking_number, format, storage_key, sha256, byte_size, status, snapshot, created_at
					from app.shipping_label_artifact
					where id = ${artifactId}
				`;
				if (!row) throw new AccessError(404, "NOT_FOUND");
				assertWarehouseScope(principal, String(row.warehouse_id));
				const shipment = await resolveShipment(tx, String(row.shipment_id));
				if (shipment) {
					await revalidateShipmentArtifacts(tx, shipment);
				}
				const [reloaded] = await tx<(typeof row)[]>`
					select id, shipment_id, warehouse_id, tracking_number, format, storage_key, sha256, byte_size, status, snapshot, created_at
					from app.shipping_label_artifact
					where id = ${artifactId}
				`;
				return reloaded;
			});

			if (!isContent) {
				const metadata: ShippingLabelArtifactResponse = {
					id: String(info.id),
					shipment_id: String(info.shipment_id),
					tracking_number: info.tracking_number,
					format: info.format,
					template_version: Number(info.snapshot?.template_version ?? 1),
					content_sha256: info.sha256,
					size_bytes: Number(info.byte_size),
					status: info.status,
					created_at: new Date(info.created_at).toISOString(),
				};
				return privateJson(metadata, 200);
			}

			if (info.status !== "valid") {
				throw new AccessError(409, "LABEL_ARTIFACT_INVALIDATED");
			}
			const bytes = await readPrivateArtifact(info.storage_key);
			const actualSha = createHash("sha256").update(bytes).digest("hex");
			if (
				actualSha !== info.sha256 ||
				bytes.byteLength !== Number(info.byte_size)
			) {
				throw new AccessError(500, "LABEL_CHECKSUM_MISMATCH");
			}
			return new Response(new Uint8Array(bytes), {
				status: 200,
				headers: {
					"content-type": "application/pdf",
					"cache-control": "no-store",
					"x-content-type-options": "nosniff",
					"content-disposition": `inline; filename="label-${info.tracking_number}.pdf"`,
				},
			});
		}

		// 5. Batch label generation & lookup: /api/v1/admin/label-batches(/[batchId])
		if (url.pathname === "/api/v1/admin/label-batches") {
			if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
			assertLabelGeneratePermission(principal);
			const key = mutationKey(request);
			const body = object(await readBody(request), [
				"shipment_ids",
				"format",
				"template_id",
			]);
			const shipmentIds = array(body.shipment_ids, (v) => id(v), 1, 100);
			if (new Set(shipmentIds).size !== shipmentIds.length) {
				throw invalid();
			}
			if (body.format !== "thermal_100x150" && body.format !== "a4") {
				throw invalid();
			}
			const format = body.format;
			const templateId =
				body.template_id === undefined || body.template_id === null
					? null
					: id(body.template_id);
			const hash = await intentHash(identity, "shipping.label.batch", {
				shipmentIds,
				format,
				templateId,
			});

			const batch = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<ShippingLabelBatchResponse>(
					tx,
					principal.id,
					"shipping.label.batch",
					key,
					hash,
				);
				if (prior) return prior;

				const items: Array<{
					shipment_id: string;
					shipment_exists: boolean;
					ordinal: number;
					outcome: "ready" | "reused" | "failed";
					label_job_id: string | null;
					artifact_id: string | null;
					failure_code: string | null;
				}> = [];
				let batchWarehouseId: string | null = principal.warehouseIds[0] ?? null;

				for (let index = 0; index < shipmentIds.length; index++) {
					const targetShipmentId = shipmentIds[index];
					const shipment = await resolveShipment(tx, targetShipmentId);
					if (!shipment) {
						items.push({
							shipment_id: targetShipmentId,
							shipment_exists: false,
							ordinal: index + 1,
							outcome: "failed",
							label_job_id: null,
							artifact_id: null,
							failure_code: "SHIPMENT_NOT_FOUND",
						});
						continue;
					}
					if (
						!principal.roles.includes("owner") &&
						!principal.warehouseIds.includes(shipment.warehouse_id)
					) {
						items.push({
							shipment_id: shipment.shipment_id,
							shipment_exists: true,
							ordinal: index + 1,
							outcome: "failed",
							label_job_id: null,
							artifact_id: null,
							failure_code: "WAREHOUSE_SCOPE_DENIED",
						});
						continue;
					}
					if (!batchWarehouseId) {
						batchWarehouseId = shipment.warehouse_id;
					}
					try {
						const res = await generateOrReuseLabelForShipment(
							tx,
							principal,
							shipment,
							format,
							templateId,
						);
						items.push({
							shipment_id: shipment.shipment_id,
							shipment_exists: true,
							ordinal: index + 1,
							outcome: "ready",
							label_job_id: res.job.id,
							artifact_id: res.artifact.id,
							failure_code: null,
						});
					} catch (err) {
						const code =
							err instanceof AccessError ? err.code : "GENERATION_FAILED";
						items.push({
							shipment_id: shipment.shipment_id,
							shipment_exists: true,
							ordinal: index + 1,
							outcome: "failed",
							label_job_id: null,
							artifact_id: null,
							failure_code: code,
						});
					}
				}

				if (!batchWarehouseId) {
					const [anyWh] = await tx<{ id: string }[]>`
						select id from app.warehouse order by id limit 1
					`;
					if (!anyWh) throw new AccessError(409, "WAREHOUSE_REQUIRED");
					batchWarehouseId = String(anyWh.id);
				}

				const succeededCount = items.filter(
					(i) => i.outcome !== "failed",
				).length;
				const failedCount = items.length - succeededCount;
				const dbStatus =
					failedCount === 0
						? "succeeded"
						: succeededCount === 0
							? "failed"
							: "partial";
				const apiStatus: ShippingLabelBatchResponse["status"] =
					failedCount === 0
						? "succeeded"
						: succeededCount === 0
							? "failed"
							: "partially_failed";

				const batchId = randomUUID();
				const summaryItems = items.map((i) => ({
					shipment_id: i.shipment_id,
					status:
						i.outcome === "failed"
							? ("failed" as const)
							: ("succeeded" as const),
					label_job_id: i.label_job_id,
					artifact_id: i.artifact_id,
					failure_code: i.failure_code,
				}));
				const summary = {
					total: items.length,
					succeeded: succeededCount,
					failed: failedCount,
					items: summaryItems,
				};
				const [batchRow] = await tx<{ id: string; created_at: string }[]>`
					insert into app.shipping_print_batch (
						id,
						warehouse_id,
						actor_id,
						format,
						status,
						summary
					)
					values (
						${batchId},
						${batchWarehouseId},
						${principal.id},
						${format},
						${dbStatus},
						${JSON.stringify(summary)}::jsonb
					)
					returning id, created_at
				`;

				for (const item of items) {
					if (!item.shipment_exists) continue;
					await tx`
						insert into app.shipping_print_batch_item (
							batch_id,
							shipment_id,
							ordinal,
							label_job_id,
							artifact_id,
							outcome,
							reason
						)
						values (
							${batchId},
							${item.shipment_id},
							${item.ordinal},
							${item.label_job_id},
							${item.artifact_id},
							${item.outcome},
							${item.failure_code ?? ""}
						)
					`;
				}

				const response: ShippingLabelBatchResponse = {
					id: String(batchRow.id),
					format,
					status: apiStatus,
					items: summaryItems,
					created_at: new Date(batchRow.created_at).toISOString(),
				};
				return saveIdempotency(
					tx,
					principal.id,
					"shipping.label.batch",
					key,
					hash,
					batchId,
					"Created shipping label print batch",
					response,
					summary,
				);
			});
			return privateJson(batch, 202);
		}

		const batchMatch = /^\/api\/v1\/admin\/label-batches\/([^/]+)$/.exec(
			url.pathname,
		);
		if (batchMatch) {
			if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
			if (url.search) throw invalid();
			assertLabelReadPermission(principal);
			const batchId = id(batchMatch[1]);
			const batch = await identity.sql.begin(async (tx) => {
				const [row] = await tx<
					{
						id: string;
						warehouse_id: string;
						format: ShippingLabelFormat;
						status: string;
						summary: {
							items?: Array<{
								shipment_id: string;
								status: "succeeded" | "failed";
								label_job_id: string | null;
								artifact_id: string | null;
								failure_code: string | null;
							}>;
						};
						created_at: string;
					}[]
				>`
					select id, warehouse_id, format, status, summary, created_at
					from app.shipping_print_batch
					where id = ${batchId}
				`;
				if (!row) throw new AccessError(404, "NOT_FOUND");
				assertWarehouseScope(principal, String(row.warehouse_id));
				const itemRows = await tx<
					{
						shipment_id: string;
						ordinal: number;
						label_job_id: string | null;
						artifact_id: string | null;
						outcome: string;
						reason: string | null;
					}[]
				>`
					select shipment_id, ordinal, label_job_id, artifact_id, outcome, reason
					from app.shipping_print_batch_item
					where batch_id = ${batchId}
					order by ordinal asc
				`;
				const apiStatus: ShippingLabelBatchResponse["status"] =
					row.status === "partial"
						? "partially_failed"
						: (row.status as ShippingLabelBatchResponse["status"]);
				const mappedItems =
					Array.isArray(row.summary?.items) &&
					row.summary.items.length > itemRows.length
						? row.summary.items
						: itemRows.map((i) => ({
								shipment_id: String(i.shipment_id),
								status:
									i.outcome === "failed"
										? ("failed" as const)
										: ("succeeded" as const),
								label_job_id: i.label_job_id ? String(i.label_job_id) : null,
								artifact_id: i.artifact_id ? String(i.artifact_id) : null,
								failure_code:
									i.outcome === "failed" ? i.reason || "FAILED" : null,
							}));
				return {
					id: String(row.id),
					format: row.format,
					status: apiStatus,
					items: mappedItems,
					created_at: new Date(row.created_at).toISOString(),
				};
			});
			return privateJson(batch, 200);
		}

		throw new AccessError(404, "NOT_FOUND");
	} catch (error) {
		return problem(error);
	}
}
