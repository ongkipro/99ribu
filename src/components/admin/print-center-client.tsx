"use client";

import { CircleAlert, CircleCheck, FileText, Printer } from "lucide-react";
import { Fragment, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type {
	PrintQueueShipment,
	ShippingLabelArtifactResponse,
	ShippingLabelBatchResponse,
	ShippingLabelFormat,
	ShippingLabelJobResponse,
	ShippingLabelTemplateResponse,
	ShippingPrintAttemptResponse,
} from "@/modules/documents/labels";
import { rupiah } from "@/modules/storefront/format";
import { describeFailure, failureText, readFailure } from "./admin-errors";

type ShipmentItem = PrintQueueShipment;

type Props = {
	initialTemplates: ShippingLabelTemplateResponse[];
	initialShipments: ShipmentItem[];
	initialArtifacts: ShippingLabelArtifactResponse[];
	initialAttempts: ShippingPrintAttemptResponse[];
	initialNextCursor: string | null;
};

const FORMAT_LABELS: Record<ShippingLabelFormat, string> = {
	thermal_100x150: "Thermal 100×150 mm",
	a4: "A4",
};
const ARTIFACT_LABELS: Record<ShippingLabelArtifactResponse["status"], string> =
	{
		valid: "Siap cetak",
		invalidated_by_reissue: "Diganti resi baru",
		invalidated_by_cancellation: "Batal, jangan dicetak",
		expired: "Kedaluwarsa",
	};
const FULFILLMENT_LABELS: Record<string, string> = {
	preparing: "Disiapkan",
	ready: "Siap diambil",
	picking: "Diambil dari rak",
	packed: "Dikemas",
	handover_pending: "Menunggu serah terima",
	handed_over: "Diserahkan ke kurir",
	exception: "Bermasalah",
};
const BRAND_LABELS: Record<string, string> = {
	"99ribu": "Merek 99ribu",
	neutral_partner: "Netral (mitra)",
};
const PRIVACY_LABELS: Record<string, string> = {
	masked_phone: "Telepon disamarkan",
	carrier_required_full_phone: "Telepon lengkap (wajib kurir)",
};
const ATTEMPT_KIND_LABELS: Record<
	ShippingPrintAttemptResponse["kind"],
	string
> = { initial_print: "Cetak awal", reprint: "Cetak ulang" };
const ATTEMPT_OUTCOME_LABELS: Record<
	ShippingPrintAttemptResponse["outcome"],
	string
> = {
	sent_to_printer: "Dikirim ke printer",
	completed: "Selesai",
	failed: "Gagal",
};

type Notice = { kind: "info" | "error"; message: string };

const dateTime = new Intl.DateTimeFormat("id-ID", {
	timeZone: "Asia/Jakarta",
	dateStyle: "medium",
	timeStyle: "short",
});

const NETWORK_ERROR = failureText(describeFailure(0));

async function postJson(url: string, body: unknown) {
	return fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"idempotency-key": crypto.randomUUID(),
		},
		body: JSON.stringify(body),
	});
}

export function PrintCenterClient({
	initialTemplates,
	initialShipments,
	initialArtifacts,
	initialAttempts,
	initialNextCursor,
}: Props) {
	const [format, setFormat] = useState<ShippingLabelFormat>("thermal_100x150");
	const [shipments, setShipments] = useState(initialShipments);
	const [nextCursor, setNextCursor] = useState(initialNextCursor);
	const [loadingMore, setLoadingMore] = useState(false);
	const [selectedShipments, setSelectedShipments] = useState<string[]>([]);
	const [artifacts, setArtifacts] = useState(initialArtifacts);
	const [attempts, setAttempts] = useState(initialAttempts);
	const [reprintReason, setReprintReason] = useState("");
	const [activeShipmentForReprint, setActiveShipmentForReprint] = useState<
		string | null
	>(null);
	const [notice, setNotice] = useState<Notice | null>(null);
	const [pending, setPending] = useState(false);

	const parcelName = (shipmentId: string) => {
		const s = shipments.find((x) => x.shipment_id === shipmentId);
		return s ? `${s.order_number} · ${s.parcel_id}` : shipmentId.slice(0, 8);
	};

	// The inline reprint form unmounts on close; put focus back on its opener.
	function closeReprint(shipmentId: string) {
		setActiveShipmentForReprint(null);
		setReprintReason("");
		requestAnimationFrame(() =>
			Array.from(
				document.querySelectorAll<HTMLElement>(
					`[data-reprint-opener="${shipmentId}"]`,
				),
			)
				.find((el) => el.offsetParent !== null)
				?.focus(),
		);
	}

	function toggleShipmentSelection(shipmentId: string) {
		setSelectedShipments((prev) =>
			prev.includes(shipmentId)
				? prev.filter((id) => id !== shipmentId)
				: [...prev, shipmentId],
		);
	}

	async function refreshArtifact(artifactId: string) {
		const res = await fetch(`/api/v1/admin/label-artifacts/${artifactId}`);
		if (!res.ok) return false;
		const art = (await res.json()) as ShippingLabelArtifactResponse;
		setArtifacts((prev) => [art, ...prev.filter((a) => a.id !== art.id)]);
		return true;
	}

	async function run(task: () => Promise<void>) {
		setPending(true);
		try {
			await task();
		} catch {
			setNotice({ kind: "error", message: NETWORK_ERROR });
		} finally {
			setPending(false);
		}
	}

	const handleGenerateSingle = (shipmentId: string) =>
		run(async () => {
			const res = await postJson(
				`/api/v1/admin/shipments/${shipmentId}/label-jobs`,
				{ format },
			);
			if (res.status !== 202) {
				setNotice({
					kind: "error",
					message: `Label ${parcelName(shipmentId)} gagal dibuat. ${failureText(await readFailure(res))}`,
				});
				return;
			}
			const job = (await res.json()) as ShippingLabelJobResponse;
			if (job.status === "failed") {
				setNotice({
					kind: "error",
					message: `Label ${parcelName(shipmentId)} gagal dibuat. ${failureText(describeFailure(422, job.failure_code))}`,
				});
				return;
			}
			if (job.artifact_id) await refreshArtifact(job.artifact_id);
			setNotice({
				kind: "info",
				message: job.artifact_id
					? `Label ${FORMAT_LABELS[format]} untuk ${parcelName(shipmentId)} siap dicetak.`
					: `Label ${parcelName(shipmentId)} sedang dibuat. Muat ulang halaman sebentar lagi.`,
			});
		});

	const handleGenerateBatch = () =>
		run(async () => {
			if (selectedShipments.length === 0) return;
			const res = await postJson("/api/v1/admin/label-batches", {
				shipment_ids: selectedShipments,
				format,
			});
			if (res.status !== 202) {
				setNotice({
					kind: "error",
					message: `Label sekaligus gagal dibuat. ${failureText(await readFailure(res))}`,
				});
				return;
			}
			const batch = (await res.json()) as ShippingLabelBatchResponse;
			const ok = batch.items.filter((i) => i.status === "succeeded");
			const failed = batch.items.filter((i) => i.status === "failed");
			const queued = batch.items.filter((i) => i.status === "queued");
			await Promise.all(
				ok.flatMap((i) =>
					i.artifact_id ? [refreshArtifact(i.artifact_id)] : [],
				),
			);
			const parts = [`${ok.length} label siap`];
			if (queued.length) parts.push(`${queued.length} masih diproses`);
			if (failed.length)
				parts.push(
					`${failed.length} gagal: ${failed
						.map(
							(i) =>
								`${parcelName(i.shipment_id)} (${describeFailure(422, i.failure_code).message})`,
						)
						.join("; ")}`,
				);
			setNotice({
				kind: failed.length ? "error" : "info",
				message: `Label ${FORMAT_LABELS[batch.format]} untuk ${batch.items.length} paket: ${parts.join(", ")}.`,
			});
			if (!failed.length) setSelectedShipments([]);
		});

	const handleRecordPrint = (
		shipmentId: string,
		artifactId: string,
		kind: "initial_print" | "reprint",
		reason?: string,
	) =>
		run(async () => {
			const res = await postJson(
				`/api/v1/admin/shipments/${shipmentId}/print-attempts`,
				{
					artifact_id: artifactId,
					kind,
					outcome: "completed",
					...(reason ? { reason } : {}),
				},
			);
			if (res.status !== 201) {
				setNotice({
					kind: "error",
					message: `Cetakan ${parcelName(shipmentId)} tidak tercatat. ${failureText(await readFailure(res))}`,
				});
				return;
			}
			const created = (await res.json()) as ShippingPrintAttemptResponse;
			setAttempts((prev) => [created, ...prev]);
			if (kind === "reprint") closeReprint(shipmentId);
			setNotice({
				kind: "info",
				message:
					kind === "initial_print"
						? `Cetak awal ${parcelName(shipmentId)} tercatat.`
						: `Cetak ulang ${parcelName(shipmentId)} tercatat beserta alasannya.`,
			});
		});

	// Next page of the server-ordered queue; rows already shown keep their place.
	async function loadMore() {
		if (!nextCursor) return;
		setLoadingMore(true);
		try {
			const res = await fetch(
				`/api/v1/admin/label-queue?cursor=${encodeURIComponent(nextCursor)}`,
			);
			if (!res.ok) {
				setNotice({
					kind: "error",
					message: `Paket berikutnya gagal dimuat. ${failureText(await readFailure(res))}`,
				});
				return;
			}
			const page = (await res.json()) as {
				data: ShipmentItem[];
				artifacts: ShippingLabelArtifactResponse[];
				pagination: { next_cursor: string | null };
			};
			setShipments((prev) => [
				...prev,
				...page.data.filter(
					(s) => !prev.some((x) => x.shipment_id === s.shipment_id),
				),
			]);
			setArtifacts((prev) => [
				...prev,
				...page.artifacts.filter((a) => !prev.some((x) => x.id === a.id)),
			]);
			setNextCursor(page.pagination.next_cursor);
		} catch {
			setNotice({ kind: "error", message: NETWORK_ERROR });
		} finally {
			setLoadingMore(false);
		}
	}

	const allSelected =
		shipments.length > 0 && selectedShipments.length === shipments.length;

	const latestArtifactFor = (shipmentId: string) =>
		artifacts.find((a) => a.shipment_id === shipmentId);
	const toggleAll = () =>
		setSelectedShipments(
			allSelected ? [] : shipments.map((x) => x.shipment_id),
		);
	// `p` prefixes test ids/ids in the mobile card variant so the hidden
	// desktop table and the cards never share a DOM id.
	const selectBox = (s: ShipmentItem, p: string) => (
		<label className="-m-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center">
			<input
				type="checkbox"
				aria-label={`Pilih paket ${s.parcel_id}`}
				data-testid={`${p}select-shipment-${s.shipment_id}`}
				className={checkboxClass}
				checked={selectedShipments.includes(s.shipment_id)}
				onChange={() => toggleShipmentSelection(s.shipment_id)}
			/>
		</label>
	);
	const parcelCell = (s: ShipmentItem) => (
		<div className="flex min-w-0 flex-col">
			<span className="font-medium">{s.order_number}</span>
			<span className="font-mono text-xs text-muted-foreground">
				{s.parcel_id}
			</span>
			{s.due_at && (
				<span
					data-testid={`shipment-due-${s.shipment_id}`}
					className="text-xs text-muted-foreground tabular-nums"
				>
					Batas {dateTime.format(new Date(s.due_at))}
				</span>
			)}
		</div>
	);
	const statusBadge = (s: ShipmentItem, p: string) => (
		<Badge
			variant="outline"
			data-testid={`${p}fulfillment-status-${s.shipment_id}`}
		>
			{FULFILLMENT_LABELS[s.fulfillment_status ?? "preparing"] ??
				s.fulfillment_status}
		</Badge>
	);
	const waybill = (s: ShipmentItem, p: string) => (
		<span
			data-testid={`${p}shipment-waybill-${s.shipment_id}`}
			className={
				s.tracking_number
					? "font-mono text-xs font-medium break-all"
					: "text-xs text-muted-foreground"
			}
		>
			{s.tracking_number ?? "Belum terbit"}
		</span>
	);
	const codText = (s: ShipmentItem) =>
		s.cod_due > 0 ? rupiah(s.cod_due) : "Non-COD";
	const artifactCell = (
		art: ShippingLabelArtifactResponse | undefined,
		p: string,
	) =>
		art ? (
			<div className="flex flex-col gap-0.5">
				<Badge
					variant={art.status === "valid" ? "success" : "warning"}
					data-testid={`${p}artifact-status-badge-${art.id}`}
					data-status={art.status}
				>
					{ARTIFACT_LABELS[art.status]}
				</Badge>
				<span className="text-xs text-muted-foreground">
					{FORMAT_LABELS[art.format]} · sidik{" "}
					<code className="font-mono">{art.content_sha256.slice(0, 12)}</code>
				</span>
			</div>
		) : (
			<span className="text-xs text-muted-foreground">Belum dibuat</span>
		);
	const actions = (
		s: ShipmentItem,
		art: ShippingLabelArtifactResponse | undefined,
		p: string,
	) => (
		<>
			<Button
				type="button"
				variant="outline"
				size="sm"
				data-testid={`${p}generate-label-${s.shipment_id}`}
				disabled={pending}
				onClick={() => void handleGenerateSingle(s.shipment_id)}
			>
				Buat label
			</Button>
			{art && art.status === "valid" && (
				<>
					<Button asChild variant="outline" size="sm">
						<a
							data-testid={`${p}download-pdf-${art.id}`}
							href={`/api/v1/admin/label-artifacts/${art.id}/content`}
							target="_blank"
							rel="noreferrer"
						>
							<FileText data-icon="inline-start" aria-hidden="true" />
							Unduh PDF
						</a>
					</Button>
					<Button
						type="button"
						size="sm"
						data-testid={`${p}initial-print-${s.shipment_id}`}
						disabled={pending}
						onClick={() =>
							void handleRecordPrint(s.shipment_id, art.id, "initial_print")
						}
					>
						Catat cetak awal
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						aria-expanded={activeShipmentForReprint === s.shipment_id}
						data-reprint-opener={s.shipment_id}
						data-testid={`${p}open-reprint-${s.shipment_id}`}
						onClick={() => setActiveShipmentForReprint(s.shipment_id)}
					>
						Cetak ulang
					</Button>
				</>
			)}
		</>
	);
	const reprintForm = (
		s: ShipmentItem,
		art: ShippingLabelArtifactResponse,
		p: string,
	) => (
		<div
			data-testid={`${p}reprint-modal-${s.shipment_id}`}
			className="flex flex-wrap items-end gap-2"
		>
			<div className="flex min-w-0 flex-[1_1_14rem] flex-col gap-1.5">
				<label
					htmlFor={`${p}reprint-reason-${s.shipment_id}`}
					className="text-sm font-medium"
				>
					Alasan cetak ulang (wajib, tercatat di audit)
				</label>
				<Input
					id={`${p}reprint-reason-${s.shipment_id}`}
					data-testid={`${p}reprint-reason-input-${s.shipment_id}`}
					type="text"
					value={reprintReason}
					onChange={(e) => setReprintReason(e.target.value)}
					placeholder="Contoh: Kertas thermal kusut"
					className="bg-background"
				/>
			</div>
			<Button
				type="button"
				data-testid={`${p}confirm-reprint-${s.shipment_id}`}
				disabled={!reprintReason.trim() || pending}
				onClick={() =>
					void handleRecordPrint(
						s.shipment_id,
						art.id,
						"reprint",
						reprintReason.trim(),
					)
				}
			>
				Catat cetak ulang
			</Button>
			<Button
				type="button"
				variant="ghost"
				onClick={() => closeReprint(s.shipment_id)}
			>
				Batal
			</Button>
		</div>
	);

	return (
		<div className="flex flex-col gap-6" data-testid="print-center-root">
			{notice && (
				<Alert
					role="status"
					data-testid="print-center-status-banner"
					variant={notice.kind === "error" ? "destructive" : "default"}
					className={
						notice.kind === "error"
							? "border-destructive/40 bg-destructive-surface"
							: "border-success/30 bg-success-surface"
					}
				>
					{notice.kind === "error" ? (
						<CircleAlert aria-hidden="true" />
					) : (
						<CircleCheck aria-hidden="true" />
					)}
					<AlertDescription className="text-foreground">
						{notice.message}
					</AlertDescription>
				</Alert>
			)}

			<section
				aria-labelledby="print-controls-heading"
				data-testid="print-controls-section"
				className="flex flex-col gap-3 rounded-lg border bg-card p-4"
			>
				<h2 id="print-controls-heading" className="text-base font-semibold">
					Format label dan cetak sekaligus
				</h2>
				<div className="flex flex-wrap items-end gap-3">
					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="label-format-select"
							className="text-sm font-medium"
						>
							Format Kertas Label
						</label>
						<select
							id="label-format-select"
							data-testid="label-format-select"
							value={format}
							onChange={(e) => setFormat(e.target.value as ShippingLabelFormat)}
							className={nativeSelectClass}
						>
							<option value="thermal_100x150">Thermal 100×150 mm</option>
							<option value="a4">A4</option>
						</select>
					</div>
					<Button
						type="button"
						data-testid="batch-generate-button"
						disabled={selectedShipments.length === 0 || pending}
						onClick={() => void handleGenerateBatch()}
					>
						<Printer data-icon="inline-start" aria-hidden="true" />
						Buat label {selectedShipments.length} paket
					</Button>
					{selectedShipments.length === 0 && (
						<p className="text-xs text-muted-foreground">
							Pilih paket di daftar untuk membuat label sekaligus.
						</p>
					)}
				</div>
			</section>

			<section
				aria-labelledby="shipments-queue-heading"
				data-testid="shipments-queue-section"
				className="flex flex-col gap-3 rounded-lg border bg-card p-4"
			>
				<div className="flex flex-col gap-1">
					<h2 id="shipments-queue-heading" className="text-base font-semibold">
						Daftar Paket & Status Resi Gudang
					</h2>
					<p className="text-xs text-muted-foreground">
						Urutan: belum punya label, lalu sudah berlabel tetapi belum
						diserahkan ke kurir, masing-masing dari batas waktu terdekat. Paket
						selesai di urutan terakhir.
					</p>
				</div>
				{shipments.length === 0 ? (
					<p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
						Belum ada paket gudang yang siap dicetak labelnya.
					</p>
				) : (
					<>
						<div className="hidden md:block">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-12">
											<label className="-m-2 inline-flex size-11 cursor-pointer items-center justify-center">
												<input
													type="checkbox"
													aria-label="Pilih semua paket"
													className={checkboxClass}
													checked={allSelected}
													ref={(el) => {
														if (el)
															el.indeterminate =
																selectedShipments.length > 0 && !allSelected;
													}}
													onChange={toggleAll}
												/>
											</label>
										</TableHead>
										<TableHead>Pesanan · Paket</TableHead>
										<TableHead className="hidden lg:table-cell">
											Gudang
										</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Resi</TableHead>
										<TableHead className="text-right">COD</TableHead>
										<TableHead>Label</TableHead>
										<TableHead>
											<span className="sr-only">Tindakan</span>
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody data-testid="print-shipment-list">
									{shipments.map((s) => {
										const art = latestArtifactFor(s.shipment_id);
										const selected = selectedShipments.includes(s.shipment_id);
										return (
											<Fragment key={s.shipment_id}>
												<TableRow
													data-testid={`print-shipment-row-${s.shipment_id}`}
													data-state={selected ? "selected" : undefined}
													className="h-12"
												>
													<TableCell>{selectBox(s, "")}</TableCell>
													<TableCell>{parcelCell(s)}</TableCell>
													<TableCell className="hidden lg:table-cell">
														{s.warehouse_name}
													</TableCell>
													<TableCell>{statusBadge(s, "")}</TableCell>
													<TableCell>{waybill(s, "")}</TableCell>
													<TableCell className="text-right tabular-nums">
														{codText(s)}
													</TableCell>
													<TableCell>{artifactCell(art, "")}</TableCell>
													<TableCell>
														<div className="flex flex-wrap justify-end gap-1.5">
															{actions(s, art, "")}
														</div>
													</TableCell>
												</TableRow>
												{activeShipmentForReprint === s.shipment_id && art && (
													<TableRow className="bg-muted/50 hover:bg-muted/50">
														<TableCell colSpan={8}>
															{reprintForm(s, art, "")}
														</TableCell>
													</TableRow>
												)}
											</Fragment>
										);
									})}
								</TableBody>
							</Table>
						</div>
						<div className="flex flex-col gap-2 md:hidden">
							<label className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium">
								<input
									type="checkbox"
									className={checkboxClass}
									checked={allSelected}
									onChange={toggleAll}
								/>
								Pilih semua paket
							</label>
							<ul className="flex flex-col divide-y rounded-md border">
								{shipments.map((s) => {
									const art = latestArtifactFor(s.shipment_id);
									return (
										<li
											key={s.shipment_id}
											data-testid={`card-print-shipment-row-${s.shipment_id}`}
											className="flex items-start gap-2 p-3"
										>
											{selectBox(s, "card-")}
											<div className="flex min-w-0 flex-1 flex-col gap-2">
												<div className="flex flex-wrap items-start justify-between gap-2">
													{parcelCell(s)}
													{statusBadge(s, "card-")}
												</div>
												<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
													<dt className="text-muted-foreground">Resi</dt>
													<dd>{waybill(s, "card-")}</dd>
													<dt className="text-muted-foreground">COD</dt>
													<dd className="tabular-nums">{codText(s)}</dd>
													<dt className="text-muted-foreground">Label</dt>
													<dd>{artifactCell(art, "card-")}</dd>
												</dl>
												<div className="flex flex-wrap gap-1.5">
													{actions(s, art, "card-")}
												</div>
												{activeShipmentForReprint === s.shipment_id &&
													art &&
													reprintForm(s, art, "card-")}
											</div>
										</li>
									);
								})}
							</ul>
						</div>
						{nextCursor && (
							<Button
								type="button"
								variant="outline"
								className="self-center"
								data-testid="print-queue-load-more"
								disabled={loadingMore}
								onClick={() => void loadMore()}
							>
								{loadingMore ? "Memuat…" : "Muat paket berikutnya"}
							</Button>
						)}
					</>
				)}
			</section>

			<section
				aria-labelledby="templates-heading"
				data-testid="templates-section"
				className="flex flex-col gap-3 rounded-lg border bg-card p-4"
			>
				<h2 id="templates-heading" className="text-base font-semibold">
					Template label
				</h2>
				{initialTemplates.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						Belum ada template label.
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Nama</TableHead>
								<TableHead>Format</TableHead>
								<TableHead>Merek</TableHead>
								<TableHead>Privasi Telepon</TableHead>
								<TableHead className="text-right">Versi</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody data-testid="template-list">
							{initialTemplates.map((tpl) => (
								<TableRow key={tpl.id} data-testid={`template-row-${tpl.id}`}>
									<TableCell>
										<div className="flex flex-col">
											<span className="font-medium">{tpl.name}</span>
											{tpl.partner_brand_name && (
												<span className="text-xs text-muted-foreground">
													Mitra: {tpl.partner_brand_name} ·{" "}
													{tpl.disclosure_text}
												</span>
											)}
										</div>
									</TableCell>
									<TableCell>{FORMAT_LABELS[tpl.format]}</TableCell>
									<TableCell>
										{BRAND_LABELS[tpl.brand_mode] ?? tpl.brand_mode}
									</TableCell>
									<TableCell>
										{PRIVACY_LABELS[tpl.privacy_mode] ?? tpl.privacy_mode}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										v{tpl.active_version}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</section>

			<section
				aria-labelledby="print-audit-heading"
				data-testid="print-audit-section"
				className="flex flex-col gap-3 rounded-lg border bg-card p-4"
			>
				<h2 id="print-audit-heading" className="text-base font-semibold">
					Riwayat cetak
				</h2>
				{attempts.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						Belum ada cetakan yang tercatat.
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Jenis</TableHead>
								<TableHead>Hasil</TableHead>
								<TableHead>Paket</TableHead>
								<TableHead>Waktu (WIB)</TableHead>
								<TableHead>Alasan</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody data-testid="print-attempts-list">
							{attempts.map((att) => (
								<TableRow
									key={att.id}
									data-testid={`print-attempt-row-${att.id}`}
								>
									<TableCell className="font-medium">
										{ATTEMPT_KIND_LABELS[att.kind]}
									</TableCell>
									<TableCell>{ATTEMPT_OUTCOME_LABELS[att.outcome]}</TableCell>
									<TableCell>{parcelName(att.shipment_id)}</TableCell>
									<TableCell className="tabular-nums">
										{dateTime.format(new Date(att.created_at))}
									</TableCell>
									<TableCell className="whitespace-normal text-muted-foreground">
										{att.reason ?? "—"}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</section>
		</div>
	);
}

const nativeSelectClass =
	"h-9 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const checkboxClass =
	"size-4 accent-primary align-middle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
