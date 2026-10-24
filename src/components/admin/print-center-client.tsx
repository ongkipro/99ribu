"use client";

import { CircleAlert, CircleCheck, FileText, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
	PrintQueueShipment,
	ShippingLabelArtifactResponse,
	ShippingLabelBatchResponse,
	ShippingLabelFormat,
	ShippingLabelJobResponse,
	ShippingLabelTemplateResponse,
	ShippingPrintAttemptResponse,
} from "@/modules/documents/labels";
import { rupiah, wibDateTime } from "@/modules/storefront/format";
import { describeFailure, failureText, readFailure } from "./admin-errors";
import { CardActions, CardStatus, CardTitle, DataTable } from "./data-table";
import { nativeSelectClass } from "./form";
import { DEADLINE_GROUPS, Deadline, deadlineGroup, OrderNumberLink, type StatusTone, StatusBadge, useNow } from "./status";

type ShipmentItem = PrintQueueShipment;

type Props = {
	initialTemplates: ShippingLabelTemplateResponse[];
	initialShipments: ShipmentItem[];
	initialArtifacts: ShippingLabelArtifactResponse[];
	initialAttempts: ShippingPrintAttemptResponse[];
	initialNextCursor: string | null;
	/** orders.history.read: order numbers link to the order search. */
	canOrders?: boolean;
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
const PHONE_PAGE = 20;
const FULFILLMENT_LABELS: Record<string, string> = {
	preparing: "Disiapkan",
	ready: "Siap diambil",
	picking: "Diambil dari rak",
	packed: "Dikemas",
	handover_pending: "Menunggu serah terima",
	handed_over: "Diserahkan ke kurir",
	exception: "Bermasalah",
};
const FULFILLMENT_TONE: Record<string, StatusTone> = {
	handed_over: "done",
	exception: "problem",
};
/** Seeded templates carry a slug as name ("99ribu-a4-default"); staff read the format instead. */
const templateName = (tpl: ShippingLabelTemplateResponse) =>
	/^[a-z0-9-]+$/.test(tpl.name)
		? `Label ${FORMAT_LABELS[tpl.format]}${tpl.name.endsWith("-default") ? " (bawaan)" : ""}`
		: tpl.name;
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
	canOrders = false,
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

	const now = useNow();
	// Phones list 20 parcels at first (set after mount: the server render shows the full page).
	const [phoneLimit, setPhoneLimit] = useState<number | null>(null);
	useEffect(() => {
		if (window.matchMedia("(max-width: 767px)").matches) setPhoneLimit(PHONE_PAGE);
	}, []);
	// Grouped by deadline (Lewat batas, Hari ini, Berikutnya, Tanpa batas, Sudah diserahkan);
	// within a group the queue's own order holds (no label first, then nearest deadline).
	const groupOf = (s: ShipmentItem) => deadlineGroup(s.due_at, now, s.fulfillment_status === "handed_over");
	const groupKeys = Object.keys(DEADLINE_GROUPS);
	const ordered = now === null ? shipments : shipments.map((s, i) => ({ s, i, g: groupKeys.indexOf(groupOf(s) ?? "none") })).sort((a, b) => a.g - b.g || a.i - b.i).map(({ s }) => s);
	const shownShipments = phoneLimit === null ? ordered : ordered.slice(0, phoneLimit);
	// "Paket 1/2" among the loaded rows of the same order; the parcel hash is not shown to staff.
	const parcelIndex = (s: ShipmentItem) => {
		const siblings = shipments
			.filter((x) => x.order_number === s.order_number)
			.map((x) => x.parcel_id)
			.sort();
		return siblings.length > 1 ? `Paket ${siblings.indexOf(s.parcel_id) + 1}/${siblings.length}` : null;
	};
	const parcelName = (shipmentId: string) => {
		const s = shipments.find((x) => x.shipment_id === shipmentId);
		if (!s) return "paket ini";
		const index = parcelIndex(s);
		return index ? `${s.order_number} · ${index}` : s.order_number;
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

	const latestArtifactFor = (shipmentId: string) =>
		artifacts.find((a) => a.shipment_id === shipmentId);
	// `p` prefixes test ids/ids in the mobile card variant so the hidden
	// desktop table and the cards never share a DOM id.
	const deadline = (s: ShipmentItem, p: string) =>
		s.due_at && (
			<span className="text-xs font-normal text-muted-foreground">
				<Deadline
					iso={s.due_at}
					prefix="Batas"
					done={s.fulfillment_status === "handed_over"}
					testId={`${p}shipment-due-${s.shipment_id}`}
					overdueTestId={`${p}shipment-overdue-${s.shipment_id}`}
				/>
			</span>
		);
	// The card moves the deadline into its badge row (one wrapped row of badges).
	const parcelCell = (s: ShipmentItem, withDeadline = true) => (
		<div className="flex min-w-0 flex-col items-start gap-0.5">
			<OrderNumberLink number={s.order_number} enabled={canOrders} />
			{parcelIndex(s) && (
				<span className="text-xs font-normal text-muted-foreground">{parcelIndex(s)}</span>
			)}
			{withDeadline && deadline(s, "")}
		</div>
	);
	const statusBadge = (s: ShipmentItem, p: string) => (
		<StatusBadge
			tone={FULFILLMENT_TONE[s.fulfillment_status ?? "preparing"] ?? "open"}
			testId={`${p}fulfillment-status-${s.shipment_id}`}
		>
			{FULFILLMENT_LABELS[s.fulfillment_status ?? "preparing"] ??
				s.fulfillment_status}
		</StatusBadge>
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
		s.cod_due > 0 ? rupiah(s.cod_due) : "Prabayar";
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
					{FORMAT_LABELS[art.format]}
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
							Format kertas label
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
					{/* The batch action lives in the list's selection bar (sticky on phones) once a parcel
					    is selected; until then the hint says how. */}
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
				className="flex flex-col gap-3 md:rounded-lg md:border md:bg-card md:p-4"
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
				<DataTable
					rows={shownShipments}
					group={(s) => {
						const key = groupOf(s);
						return key && DEADLINE_GROUPS[key];
					}}
					rowKey={(s) => s.shipment_id}
					status={{ kind: "ready" }}
					loadingLabel="Memuat paket…"
					empty="Belum ada paket gudang yang siap dicetak labelnya."
					caption="Paket gudang dan status labelnya"
					bodyTestId="print-shipment-list"
					rowTestId={(s) => `print-shipment-row-${s.shipment_id}`}
					rowClassName="h-12"
					selection={{
						selected: selectedShipments,
						onChange: setSelectedShipments,
						label: (s) => `Pilih paket ${parcelName(s.shipment_id)}`,
						allLabel: "Pilih semua paket",
						testId: (s, p) => `${p}select-shipment-${s.shipment_id}`,
						summary: (n) => `${n} paket dipilih`,
						actions: (
							<Button
								type="button"
								size="sm"
								data-testid="batch-generate-button"
								disabled={pending}
								onClick={() => void handleGenerateBatch()}
							>
								<Printer data-icon="inline-start" aria-hidden="true" />
								Buat label {selectedShipments.length} paket
							</Button>
						),
					}}
					columns={[
						{ id: "parcel", header: "Pesanan · Paket", cell: parcelCell },
						{
							// Low value per row (staff work one warehouse at a time): wide screens only.
							id: "warehouse",
							header: "Gudang",
							className: "hidden xl:table-cell",
							cell: (s) => s.warehouse_name,
						},
						{ id: "status", header: "Status", cell: (s) => statusBadge(s, "") },
						// md–xl: Resi and Label give way so the pinned actions never cover COD; the
						// actions already say whether a label exists (Buat label / Cetak ulang).
						{ id: "waybill", header: "Resi", className: "md:max-xl:hidden", cell: (s) => waybill(s, "") },
						{ id: "cod", header: "COD", className: "text-right tabular-nums", cell: codText },
						{
							id: "label",
							header: "Label",
							className: "md:max-xl:hidden",
							cell: (s) => artifactCell(latestArtifactFor(s.shipment_id), ""),
						},
						{
							id: "actions",
							header: <span className="sr-only">Tindakan</span>,
							cell: (s) => (
								<div className="flex flex-wrap justify-end gap-1.5 [&_a]:whitespace-nowrap [&_button]:whitespace-nowrap">
									{actions(s, latestArtifactFor(s.shipment_id), "")}
								</div>
							),
						},
					]}
					expanded={(s) => {
						const art = latestArtifactFor(s.shipment_id);
						return activeShipmentForReprint === s.shipment_id && art
							? reprintForm(s, art, "")
							: null;
					}}
					cardTestId={(s) => `card-print-shipment-row-${s.shipment_id}`}
					card={(s) => {
						const art = latestArtifactFor(s.shipment_id);
						return (
							<>
								<CardTitle title={parcelCell(s, false)} aside={codText(s)} />
								<CardStatus>
									{statusBadge(s, "card-")}
									{deadline(s, "card-")}
								</CardStatus>
								<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
									<dt className="text-muted-foreground">Resi</dt>
									<dd>{waybill(s, "card-")}</dd>
									<dt className="text-muted-foreground">Label</dt>
									<dd>{artifactCell(art, "card-")}</dd>
								</dl>
								<CardActions>{actions(s, art, "card-")}</CardActions>
								{activeShipmentForReprint === s.shipment_id &&
									art &&
									reprintForm(s, art, "card-")}
							</>
						);
					}}
					paging={{
						hasMore: nextCursor !== null || shownShipments.length < shipments.length,
						loading: loadingMore,
						onMore: () => {
							// Phones reveal the loaded parcels 20 at a time, then page the API.
							const next = phoneLimit === null ? null : phoneLimit + PHONE_PAGE;
							if (next !== null) setPhoneLimit(next);
							if (next === null || next > ordered.length) void loadMore();
						},
						testId: "print-queue-load-more",
					}}
				/>
			</section>

			<section
				aria-labelledby="templates-heading"
				data-testid="templates-section"
				className="flex flex-col gap-3 md:rounded-lg md:border md:bg-card md:p-4"
			>
				<h2 id="templates-heading" className="text-base font-semibold">
					Template label
				</h2>
				<DataTable
					rows={initialTemplates}
					rowKey={(tpl) => tpl.id}
					status={{ kind: "ready" }}
					loadingLabel="Memuat template…"
					empty="Belum ada template label."
					bodyTestId="template-list"
					rowTestId={(tpl) => `template-row-${tpl.id}`}
					stack
					columns={[
						{
							id: "name",
							header: "Nama",
							stack: "title",
							cellClassName: "whitespace-normal max-md:block md:max-w-64",
							cell: (tpl) => (
								<div className="flex flex-col">
									<span className="font-medium">{templateName(tpl)}</span>
									<span className="hidden text-xs font-normal text-muted-foreground md:max-xl:block">
										{BRAND_LABELS[tpl.brand_mode] ?? tpl.brand_mode}
									</span>
									{tpl.partner_brand_name && (
										<span className="text-xs text-muted-foreground">
											Mitra: {tpl.partner_brand_name} · {tpl.disclosure_text}
										</span>
									)}
								</div>
							),
						},
						{ id: "format", header: "Format", cell: (tpl) => FORMAT_LABELS[tpl.format] },
						{ id: "brand", header: "Merek", className: "md:max-xl:hidden", cell: (tpl) => BRAND_LABELS[tpl.brand_mode] ?? tpl.brand_mode },
						{
							id: "privacy",
							header: "Privasi telepon",
							cell: (tpl) => PRIVACY_LABELS[tpl.privacy_mode] ?? tpl.privacy_mode,
						},
						{
							id: "version",
							header: "Versi",
							stack: "aside",
							className: "text-right tabular-nums",
							cell: (tpl) => `v${tpl.active_version}`,
						},
					]}
				/>
			</section>

			<section
				aria-labelledby="print-audit-heading"
				data-testid="print-audit-section"
				className="flex flex-col gap-3 md:rounded-lg md:border md:bg-card md:p-4"
			>
				<h2 id="print-audit-heading" className="text-base font-semibold">
					Riwayat cetak
				</h2>
				<DataTable
					rows={attempts}
					rowKey={(att) => att.id}
					status={{ kind: "ready" }}
					loadingLabel="Memuat riwayat…"
					empty="Belum ada cetakan yang tercatat."
					bodyTestId="print-attempts-list"
					rowTestId={(att) => `print-attempt-row-${att.id}`}
					stack
					columns={[
						{
							id: "kind",
							header: "Jenis",
							stack: "title",
							cellClassName: "font-medium",
							cell: (att) => ATTEMPT_KIND_LABELS[att.kind],
						},
						{ id: "outcome", header: "Hasil", cell: (att) => ATTEMPT_OUTCOME_LABELS[att.outcome] },
						{ id: "parcel", header: "Paket", cell: (att) => parcelName(att.shipment_id) },
						{
							id: "time",
							header: "Waktu (WIB)",
							stack: "meta",
							className: "tabular-nums",
							cell: (att) => wibDateTime(att.created_at),
						},
						{
							id: "reason",
							header: "Alasan",
							cellClassName: "whitespace-normal text-muted-foreground",
							cell: (att) => att.reason ?? "—",
						},
					]}
				/>
			</section>
		</div>
	);
}

