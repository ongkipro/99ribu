import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { AccessError } from "../access/policy.ts";
import type {
	ShippingLabelBrandMode,
	ShippingLabelFormat,
	ShippingLabelPrivacyMode,
	ShippingLabelTemplateResponse,
} from "./label-shared.ts";

export async function ensureDefaultTemplates(
	tx: TransactionSql,
	actorId: string,
) {
	const defaults: Array<{
		code: string;
		format: ShippingLabelFormat;
	}> = [
		{ code: "99ribu-thermal-default", format: "thermal_100x150" },
		{ code: "99ribu-a4-default", format: "a4" },
	];
	for (const def of defaults) {
		const [existing] = await tx<{ id: string }[]>`
			select id from app.shipping_label_template where code = ${def.code}
		`;
		if (!existing) {
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
					${def.code},
					'LOCAL',
					'REG',
					${def.format},
					'99ribu',
					'masked_phone',
					1,
					true
				)
				on conflict (code) do nothing
			`;
			const [tpl] = await tx<{ id: string }[]>`
				select id from app.shipping_label_template where code = ${def.code}
			`;
			if (tpl) {
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
						${tpl.id},
						1,
						'v1',
						'',
						'',
						${actorId},
						'Default 99ribu shipping label template'
					)
					on conflict (template_id, revision) do nothing
				`;
			}
		}
	}
}

export async function formatTemplate(
	tx: TransactionSql,
	templateId: string,
): Promise<ShippingLabelTemplateResponse> {
	const [row] = await tx<
		{
			id: string;
			code: string;
			format: ShippingLabelFormat;
			privacy_mode: ShippingLabelPrivacyMode;
			brand_mode: ShippingLabelBrandMode;
			active_revision: number;
			updated_at: string;
			permission_evidence: string | null;
			disclosure_text: string | null;
		}[]
	>`
		select
			t.id,
			t.code,
			t.format,
			t.privacy_mode,
			t.brand_mode,
			t.active_revision,
			t.updated_at,
			v.permission_evidence,
			v.disclosure_text
		from app.shipping_label_template t
		left join app.shipping_label_template_version v
			on v.template_id = t.id and v.revision = t.active_revision
		where t.id = ${templateId}
	`;
	if (!row) throw new AccessError(404, "NOT_FOUND");
	const versions = await tx<
		{
			revision: number;
			renderer_version: string;
			permission_evidence: string | null;
			disclosure_text: string | null;
			actor_id: string;
			reason: string;
			created_at: string;
		}[]
	>`
		select revision, renderer_version, permission_evidence, disclosure_text, actor_id, reason, created_at
		from app.shipping_label_template_version
		where template_id = ${templateId}
		order by revision desc
		limit 50
	`;
	return {
		id: String(row.id),
		name: row.code,
		format: row.format,
		privacy_mode: row.privacy_mode,
		brand_mode: row.brand_mode,
		partner_brand_name: row.permission_evidence || null,
		disclosure_text: row.disclosure_text || null,
		active_version: Number(row.active_revision),
		updated_at: new Date(row.updated_at).toISOString(),
		history: versions.map((v) => ({
			version: Number(v.revision),
			renderer_version: v.renderer_version,
			partner_brand_name: v.permission_evidence || null,
			disclosure_text: v.disclosure_text || null,
			actor_id: v.actor_id,
			reason: v.reason,
			created_at: new Date(v.created_at).toISOString(),
		})),
	};
}
