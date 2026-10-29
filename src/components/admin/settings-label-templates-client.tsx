"use client";

import { CircleCheck, History, Pencil, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
	ShippingLabelBrandMode,
	ShippingLabelFormat,
	ShippingLabelPrivacyMode,
	ShippingLabelTemplateResponse,
} from "@/modules/documents/labels";
import { failureText, getJson } from "./admin-errors";
import { DataTable, type DataTableStatus } from "./data-table";
import { formatWib } from "./format";
import { FormDialog, FormField, nativeSelectClass } from "./form";
import { useSettingsIntent } from "./settings-intent";
import { StatusBadge } from "./status";

// S130 / spec 17 B23 (DEC-018 Q3): shipping label template governance. Owner creates templates and
// appends new versions with reauth proof; finance, ecommerce_admin and warehouse read current
// templates and their version history.

type TemplatePage = {
	data: ShippingLabelTemplateResponse[];
	pagination: { next_cursor: string | null };
};

const FORMAT_LABELS: Record<ShippingLabelFormat, string> = {
	thermal_100x150: "Termal 100×150 mm",
	a4: "A4",
};

const BRAND_LABELS: Record<ShippingLabelBrandMode, string> = {
	"99ribu": "99ribu",
	neutral_partner: "Mitra netral",
};

const PRIVACY_LABELS: Record<ShippingLabelPrivacyMode, string> = {
	masked_phone: "Nomor telepon disamarkan",
	carrier_required_full_phone: "Nomor penuh untuk kurir",
};

const PAGE = 20;

export function SettingsLabelTemplatesClient({
	canWrite,
}: {
	canWrite: boolean;
}) {
	const [rows, setRows] = useState<ShippingLabelTemplateResponse[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [status, setStatus] = useState<DataTableStatus>({ kind: "loading" });
	const [more, setMore] = useState<{ loading: boolean; error: string | null }>({
		loading: false,
		error: null,
	});
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [dialogTarget, setDialogTarget] = useState<
		{ mode: "create" } | { mode: "version"; template: ShippingLabelTemplateResponse } | null
	>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	const requestRef = useRef(0);

	const load = useCallback(async () => {
		const runId = ++requestRef.current;
		setStatus({ kind: "loading" });
		const res = await getJson<TemplatePage>(
			`/api/v1/admin/shipping-label-templates?limit=${PAGE}`,
		);
		if (runId !== requestRef.current) return;
		if (res.ok) {
			setRows(res.data.data);
			setNextCursor(res.data.pagination.next_cursor);
			setStatus({ kind: "ready" });
		} else {
			setRows([]);
			setNextCursor(null);
			setStatus(
				res.failure.status === 403
					? { kind: "denied", message: res.failure.message }
					: {
							kind: "error",
							message: failureText(res.failure),
							onRetry: () => void load(),
						},
			);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);

	async function loadMore() {
		if (!nextCursor || more.loading) return;
		setMore({ loading: true, error: null });
		const res = await getJson<TemplatePage>(
			`/api/v1/admin/shipping-label-templates?limit=${PAGE}&cursor=${encodeURIComponent(nextCursor)}`,
		);
		if (!res.ok) {
			setMore({
				loading: false,
				error: `Template berikutnya gagal dimuat. ${failureText(res.failure)}`,
			});
			return;
		}
		setMore({ loading: false, error: null });
		setRows((prev) => [
			...prev,
			...res.data.data.filter(
				(row) => !prev.some((seen) => seen.id === row.id),
			),
		]);
		setNextCursor(res.data.pagination.next_cursor);
	}

	return (
		<div
			className="flex flex-col gap-6"
			data-testid="settings-label-templates-root"
		>
			{notice && (
				<Alert
					ref={noticeRef}
					tabIndex={-1}
					role="status"
					className="outline-none"
					data-testid="label-templates-notice"
				>
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">
						{notice}
					</AlertDescription>
				</Alert>
			)}

			{!canWrite && (
				<p
					data-testid="label-templates-readonly"
					className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
				>
					Hanya baca: Anda dapat melihat daftar template label pengiriman yang
					aktif beserta riwayat versinya. Penambahan atau pembaruan versi
					template memerlukan Super Admin dengan autentikasi ulang.
				</p>
			)}

			<section
				aria-labelledby="label-templates-heading"
				className="flex flex-col gap-4"
			>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex flex-col gap-1">
						<h2 id="label-templates-heading" className="text-base font-semibold">
							Daftar template label pengiriman
						</h2>
						<p className="text-sm text-muted-foreground">
							Mode merek mitra netral mewajibkan nama merek mitra dan teks
							keterbukaan pengiriman. Artefak PDF label yang sudah terbit
							mempertahankan versi template saat label dibuat.
						</p>
					</div>
					<div className="flex flex-wrap gap-2 max-md:w-full">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void load()}
						>
							<RefreshCw aria-hidden="true" />
							Muat ulang
						</Button>
						{canWrite && (
							<Button
								type="button"
								size="sm"
								data-testid="label-template-new"
								onClick={() => setDialogTarget({ mode: "create" })}
							>
								<Plus aria-hidden="true" />
								Tambah template
							</Button>
						)}
					</div>
				</div>

				<DataTable
					rows={rows}
					rowKey={(row) => row.id}
					status={status}
					loadingLabel="Memuat template label…"
					empty="Belum ada template label pengiriman."
					caption="Daftar template label pengiriman"
					testId="label-templates-table"
					rowTestId={(row) => `label-template-row-${row.id}`}
					activeKey={expandedId}
					stack
					paging={{
						hasMore: Boolean(nextCursor),
						loading: more.loading,
						onMore: () => void loadMore(),
						error: more.error,
						testId: "label-templates-more",
					}}
					expanded={(row) =>
						expandedId === row.id ? (
							<div
								className="flex flex-col gap-2 py-2 text-sm"
								data-testid={`label-template-history-${row.id}`}
							>
								<p className="text-xs font-semibold text-muted-foreground">
									Riwayat versi {row.name} ({row.history?.length ?? 1} versi)
								</p>
								<ol className="flex flex-col divide-y">
									{(
										row.history ?? [
											{
												version: row.active_version,
												renderer_version: "v1",
												partner_brand_name: row.partner_brand_name,
												disclosure_text: row.disclosure_text,
												actor_id: "system",
												reason: "Versi aktif",
												created_at: row.updated_at,
											},
										]
									).map((ver) => (
										<li
											key={ver.version}
											data-testid={`label-template-version-${row.id}-${ver.version}`}
											className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0"
										>
											<div className="flex flex-wrap items-center gap-2">
												<span className="font-medium tabular-nums">
													Versi v{ver.version}
												</span>
												{ver.version === row.active_version && (
													<StatusBadge tone="success">Aktif</StatusBadge>
												)}
												<span className="text-xs text-muted-foreground">
													Perender {ver.renderer_version} ·{" "}
													{formatWib(ver.created_at)}
												</span>
											</div>
											{ver.partner_brand_name && (
												<span className="text-xs text-muted-foreground">
													Mitra: {ver.partner_brand_name}
													{ver.disclosure_text
														? ` · ${ver.disclosure_text}`
														: ""}
												</span>
											)}
											<span className="text-xs break-words">{ver.reason}</span>
										</li>
									))}
								</ol>
							</div>
						) : null
					}
					columns={[
						{
							id: "name",
							header: "Template",
							stack: "title",
							cell: (row) => (
								<div className="flex flex-col gap-0.5">
									<span className="font-medium">{row.name}</span>
									{row.partner_brand_name && (
										<span className="text-xs text-muted-foreground">
											{row.partner_brand_name}
											{row.disclosure_text ? ` · ${row.disclosure_text}` : ""}
										</span>
									)}
								</div>
							),
						},
						{
							id: "format",
							header: "Format",
							cell: (row) => FORMAT_LABELS[row.format] ?? row.format,
						},
						{
							id: "brand",
							header: "Mode merek",
							// Lower-priority columns give way so "Privasi telepon" never slides under the pinned actions.
							hideBelow: "5xl",
							cell: (row) => BRAND_LABELS[row.brand_mode] ?? row.brand_mode,
						},
						{
							id: "privacy",
							header: "Privasi telepon",
							cellClassName: "whitespace-normal",
							cell: (row) =>
								PRIVACY_LABELS[row.privacy_mode] ?? row.privacy_mode,
						},
						{
							id: "version",
							header: "Versi aktif",
							stack: "aside",
							className: "text-right tabular-nums",
							cell: (row) => (
								<span className="inline-flex items-center gap-1.5">
									<StatusBadge tone="success">v{row.active_version}</StatusBadge>
								</span>
							),
						},
						{
							id: "updated",
							header: "Diperbarui (WIB)",
							stack: "meta",
							kind: "datetime",
							hideBelow: "6xl",
							cell: (row) => formatWib(row.updated_at),
						},
						{
							id: "actions",
							header: "Tindakan",
							className: "text-right",
							cell: (row) => (
								<div className="flex flex-wrap justify-end gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										aria-expanded={expandedId === row.id}
										data-testid={`label-template-history-toggle-${row.id}`}
										onClick={() =>
											setExpandedId((prev) =>
												prev === row.id ? null : row.id,
											)
										}
									>
										<History aria-hidden="true" />
										Riwayat versi
									</Button>
									{canWrite && (
										<Button
											type="button"
											size="sm"
											data-testid={`label-template-edit-${row.id}`}
											onClick={() =>
												setDialogTarget({ mode: "version", template: row })
											}
										>
											<Pencil aria-hidden="true" />
											Versi baru
										</Button>
									)}
								</div>
							),
						},
					]}
				/>
			</section>

			{dialogTarget && (
				<LabelTemplateDialog
					template={
						dialogTarget.mode === "version" ? dialogTarget.template : null
					}
					onClose={() => setDialogTarget(null)}
					onStale={() => void load()}
					onDone={(saved, created) => {
						setDialogTarget(null);
						setNotice(
							created
								? `Template label ${saved.name} dibuat (versi v${saved.active_version}).`
								: `Template label ${saved.name} diperbarui ke versi v${saved.active_version}.`,
						);
						void load();
					}}
				/>
			)}
		</div>
	);
}

function LabelTemplateDialog({
	template,
	onClose,
	onStale,
	onDone,
}: {
	template: ShippingLabelTemplateResponse | null;
	onClose: () => void;
	onStale: () => void;
	onDone: (saved: ShippingLabelTemplateResponse, created: boolean) => void;
}) {
	const id = useId();
	// Frozen on mount: a background reload after 409 conflict must not silently advance the version an open dialog submits.
	const [capturedVersion] = useState(template ? template.active_version : 0);
	const [name, setName] = useState(template?.name ?? "");
	const [format, setFormat] = useState<ShippingLabelFormat>(
		template?.format ?? "thermal_100x150",
	);
	const [privacyMode, setPrivacyMode] = useState<ShippingLabelPrivacyMode>(
		template?.privacy_mode ?? "masked_phone",
	);
	const [brandMode, setBrandMode] = useState<ShippingLabelBrandMode>(
		template?.brand_mode ?? "99ribu",
	);
	const [partnerBrandName, setPartnerBrandName] = useState(
		template?.partner_brand_name ?? "",
	);
	const [disclosureText, setDisclosureText] = useState(
		template?.disclosure_text ?? "",
	);
	const [rendererVersion, setRendererVersion] = useState(
		template ? `v${template.active_version + 1}` : "v1",
	);
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const intent = useSettingsIntent();

	async function submit() {
		if (!name.trim()) {
			intent.setError("Nama atau kode template wajib diisi.");
			return;
		}
		if (
			brandMode === "neutral_partner" &&
			(!partnerBrandName.trim() || !disclosureText.trim())
		) {
			intent.setError(
				"Mode merek mitra netral wajib menyertakan nama merek mitra dan teks keterbukaan pengiriman.",
			);
			return;
		}
		if (!reason.trim() || !password) {
			intent.setError("Alasan perubahan dan kata sandi wajib diisi.");
			return;
		}

		const url = template
			? `/api/v1/admin/shipping-label-templates/${template.id}/versions`
			: "/api/v1/admin/shipping-label-templates";

		const saved = await intent.run<ShippingLabelTemplateResponse>(
			url,
			() => ({
				name: name.trim(),
				format,
				privacy_mode: privacyMode,
				brand_mode: brandMode,
				partner_brand_name:
					brandMode === "neutral_partner"
						? partnerBrandName.trim()
						: partnerBrandName.trim() || null,
				disclosure_text:
					brandMode === "neutral_partner"
						? disclosureText.trim()
						: disclosureText.trim() || null,
				renderer_version: rendererVersion.trim() || "v1",
				expected_version: capturedVersion,
				reason: reason.trim(),
			}),
			{
				proof: {
					password,
					action: "shipping_label_template.version",
					subject: "shipping-label-templates",
				},
				onStale,
				onUncertain: onStale,
			},
		);
		if (saved) {
			onDone(saved, template === null);
		}
	}

	return (
		<FormDialog
			title={
				template
					? `Versi baru template ${template.name}`
					: "Tambah template label pengiriman"
			}
			description={
				template
					? `Menambah versi v${capturedVersion + 1} (didasarkan pada versi aktif v${capturedVersion}). Artefak PDF lama tetap memakai versi saat dicetak.`
					: "Membuat template label baru (versi v1). Memerlukan autentikasi ulang Super Admin."
			}
			pending={intent.pending}
			error={intent.error}
			submitLabel={template ? "Simpan versi template" : "Buat template"}
			pendingLabel="Menyimpan…"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField
				id={`${id}-name`}
				label="Nama / kode template"
				hint="Maksimal 80 karakter, contoh 99ribu-thermal-mitra."
			>
				<Input
					id={`${id}-name`}
					data-testid="label-template-name"
					maxLength={80}
					autoComplete="off"
					aria-describedby={`${id}-name-hint`}
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
			</FormField>

			<div className="grid gap-4 sm:grid-cols-2">
				<FormField id={`${id}-format`} label="Format kertas">
					<select
						id={`${id}-format`}
						data-testid="label-template-format"
						className={nativeSelectClass}
						value={format}
						onChange={(e) => setFormat(e.target.value as ShippingLabelFormat)}
					>
						<option value="thermal_100x150">Termal 100×150 mm</option>
						<option value="a4">A4</option>
					</select>
				</FormField>

				<FormField id={`${id}-privacy`} label="Privasi telepon penerima">
					<select
						id={`${id}-privacy`}
						data-testid="label-template-privacy"
						className={nativeSelectClass}
						value={privacyMode}
						onChange={(e) =>
							setPrivacyMode(e.target.value as ShippingLabelPrivacyMode)
						}
					>
						<option value="masked_phone">Nomor telepon disamarkan</option>
						<option value="carrier_required_full_phone">
							Nomor penuh untuk kurir
						</option>
					</select>
				</FormField>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<FormField id={`${id}-brand`} label="Mode merek">
					<select
						id={`${id}-brand`}
						data-testid="label-template-brand"
						className={nativeSelectClass}
						value={brandMode}
						onChange={(e) =>
							setBrandMode(e.target.value as ShippingLabelBrandMode)
						}
					>
						<option value="99ribu">99ribu</option>
						<option value="neutral_partner">Mitra netral</option>
					</select>
				</FormField>

				<FormField id={`${id}-renderer`} label="Versi perender">
					<Input
						id={`${id}-renderer`}
						data-testid="label-template-renderer"
						maxLength={40}
						autoComplete="off"
						value={rendererVersion}
						onChange={(e) => setRendererVersion(e.target.value)}
					/>
				</FormField>
			</div>

			<FormField
				id={`${id}-partner`}
				label={
					brandMode === "neutral_partner"
						? "Nama merek mitra (wajib untuk mitra netral)"
						: "Nama merek mitra (opsional)"
				}
			>
				<Input
					id={`${id}-partner`}
					data-testid="label-template-partner"
					maxLength={500}
					autoComplete="off"
					value={partnerBrandName}
					onChange={(e) => setPartnerBrandName(e.target.value)}
				/>
			</FormField>

			<FormField
				id={`${id}-disclosure`}
				label={
					brandMode === "neutral_partner"
						? "Teks keterbukaan pengiriman (wajib untuk mitra netral)"
						: "Teks keterbukaan pengiriman (opsional)"
				}
			>
				<Textarea
					id={`${id}-disclosure`}
					data-testid="label-template-disclosure"
					rows={2}
					maxLength={500}
					value={disclosureText}
					onChange={(e) => setDisclosureText(e.target.value)}
				/>
			</FormField>

			<FormField id={`${id}-reason`} label="Alasan perubahan">
				<Input
					id={`${id}-reason`}
					data-testid="label-template-reason"
					maxLength={500}
					autoComplete="off"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>

			<FormField
				id={`${id}-password`}
				label="Konfirmasi kata sandi"
				hint="Dipakai satu kali untuk menerbitkan bukti autentikasi Super Admin."
			>
				<Input
					id={`${id}-password`}
					data-testid="label-template-password"
					type="password"
					autoComplete="current-password"
					maxLength={128}
					aria-describedby={`${id}-password-hint`}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
			</FormField>
		</FormDialog>
	);
}
