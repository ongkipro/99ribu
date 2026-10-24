"use client";

import { CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { describeFailure, failureText, getJson, readFailure } from "./admin-errors";
import { DataTable, type DataTableColumn } from "./data-table";
import { wibInputToIso } from "@/modules/storefront/format";
import { formatCm, formatKg, formatWib, rupiah } from "./format";

// DEC-007: every resi comes from 99ribu's own Mengantar account. Operators book
// in the Mengantar dashboard, then record courier + resi here.
const COURIERS: [string, string][] = [
	["jne", "JNE"],
	["jnt", "J&T Express"],
	["sicepat", "SiCepat"],
	["sap", "SAP Express"],
	["ninja", "Ninja Xpress"],
	["anteraja", "AnterAja"],
	["idexpress", "ID Express"],
	["lion", "Lion Parcel"],
	["pos", "Pos Indonesia"],
];
const TRACKING_LABELS: Record<string, string> = {
	picked_up: "Diambil kurir",
	in_transit: "Dalam perjalanan",
	delivered: "Terkirim",
	failed: "Gagal kirim, dicoba ulang",
};
const CODE_MESSAGES: Record<string, string> = {
	INVALID_COURIER: "Pilih kurir dari daftar.",
	INVALID_TRACKING_NUMBER:
		"Nomor resi harus 8–40 karakter huruf, angka atau tanda hubung.",
	INVALID_PURCHASE_REFERENCE:
		"Referensi pembelian hanya huruf, angka dan . _ : / # -",
	FULFILLMENT_PATH_BOOKED:
		"Paket ini sudah dipesan lewat jalur otomatis, tidak bisa diisi manual.",
	FULFILLMENT_ALREADY_SHIPPED: "Resi paket ini sudah tercatat.",
	FULFILLMENT_NOT_READY: "Paket belum siap dikirim.",
	FULFILLMENT_MODE_AUTOMATED:
		"Gudang ini sudah memakai pemesanan otomatis Mengantar.",
	TRACKING_UNCHANGED: "Kurir dan resi sama dengan yang tercatat.",
	TRACKING_ALREADY_DELIVERED: "Paket sudah terkirim; resi tidak bisa dikoreksi.",
	CORRECTION_REASON_REQUIRED: "Alasan koreksi wajib diisi.",
	TRACKING_NUMBER_IN_USE: "Resi ini sudah dipakai paket lain dengan kurir yang sama.",
	TRACKING_STATUS_NOT_ADVANCING:
		"Status ini sudah tercatat atau lebih lama dari status terakhir.",
	INVALID_TRACKING_TIME:
		"Waktu status harus setelah paket diserahkan dan tidak di masa depan.",
	INVALID_STREET_ADDRESS: "Alamat jalan minimal 10 karakter.",
	INVALID_PIC_NAME: "Nama PIC minimal 2 karakter.",
	INVALID_PIC_PHONE: "Nomor telepon PIC tidak valid (contoh 0812xxxxxxxx).",
	INVALID_PINPOINT: "Titik lokasi di luar wilayah Indonesia.",
};
function message(status: number, code: string | null) {
	return code && CODE_MESSAGES[code]
		? `${CODE_MESSAGES[code]} (kode: ${code})`
		: failureText(describeFailure(status, code));
}
const formatTime = formatWib;

type Manual = {
	courier: string | null;
	courier_name: string | null;
	tracking_number: string | null;
	tracking_status: string | null;
	purchase_reference: { version: number; reference: string } | null;
	purchase_reference_version: number;
	tracking_versions: { version: number; tracking_number: string; reason: string }[];
};
// S99: everything the operator needs to book the parcel in the Mengantar dashboard.
type Booking = {
	cod_amount_due: number;
	cod_fee_amount: number;
	cancelled_units: number;
	quoted_courier: {
		courier_name: string;
		service_name: string;
		code: string | null;
	} | null;
	parcel: {
		weight_grams: number;
		length_mm: number;
		width_mm: number;
		height_mm: number;
	};
	destination_area: {
		subdistrict: string;
		district: string;
		city: string;
		province: string;
		postal_code: string;
	};
	parcel_items: { name: string; variant_label: string; quantity: number }[];
};
type Row = {
	id: string;
	order_id: string;
	version: number;
	status: string;
	order_number: string;
	payment_method: "prepaid" | "cod";
	warehouse_id: string;
	warehouse_name: string;
	warehouse_city: string;
	packing_due_at: string | null;
	handover_at: string | null;
	calendar_error: string | null;
	tracking_number: string | null;
	items: unknown[];
	pick_items: { sku: string; name: string; quantity: number }[];
	recipient: {
		recipient_name: string;
		phone: string;
		address_line: string;
		postal_code: string;
	};
	manual?: Manual;
	booking: Booking;
};
type Warehouse = { id: string; name: string; city: string };
type Queue = "to_book" | "shipped";
type Notice = { kind: "info" | "error"; text: string };

async function post(url: string, body: unknown, key: string) {
	try {
		const res = await fetch(url, {
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json", "idempotency-key": key },
			body: JSON.stringify(body),
		});
		if (res.ok) return { ok: true as const, data: await res.json() };
		const failure = await readFailure(res);
		return {
			ok: false as const,
			code: failure.code,
			text: message(res.status, failure.code),
		};
	} catch {
		return { ok: false as const, code: "NETWORK_ERROR", text: message(0, null) };
	}
}

const selectClass =
	"h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none";

function Field({
	id,
	label,
	hint,
	error,
	children,
}: {
	id: string;
	label: string;
	hint?: string;
	error?: string | null;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor={id} className="text-sm font-medium">
				{label}
			</label>
			{children}
			{hint && !error && (
				<p id={`${id}-hint`} className="text-xs text-muted-foreground">
					{hint}
				</p>
			)}
			{error && (
				<p id={`${id}-error`} className="text-sm text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}

type DialogKind = "ship" | "correct" | "status";

const PAGE_SIZE = "50";

/** Pick list: component units summed by SKU across the parcel's allocations. */
function pickList(row: Row) {
	const totals = new Map<string, { name: string; quantity: number }>();
	for (const pick of row.pick_items) {
		const current = totals.get(pick.sku);
		totals.set(pick.sku, {
			name: pick.name,
			quantity: (current?.quantity ?? 0) + pick.quantity,
		});
	}
	return [...totals].map(([sku, value]) => ({ sku, ...value }));
}
const areaText = (row: Row) => {
	const a = row.booking.destination_area;
	return `${a.subdistrict}, ${a.district}, ${a.city}, ${a.province} ${a.postal_code}`;
};
const courierText = (row: Row) =>
	row.booking.quoted_courier
		? `${row.booking.quoted_courier.courier_name} · ${row.booking.quoted_courier.service_name}`
		: "—";

const toBookColumns: DataTableColumn<Row>[] = [
	{
		id: "contents",
		header: "Isi paket",
		cellClassName: "min-w-48 whitespace-normal",
		cell: (row) => (
			<>
				<ul className="flex flex-col gap-0.5">
					{row.booking.parcel_items.map((item) => (
						<li key={`${item.name}:${item.variant_label}`}>
							{item.quantity}× {item.name}
							<span className="text-muted-foreground"> · {item.variant_label}</span>
						</li>
					))}
				</ul>
				<span className="mt-1 block text-xs text-muted-foreground">
					Berat awal {formatKg(row.booking.parcel.weight_grams)}
					{row.booking.cancelled_units > 0 &&
						`; ${row.booking.cancelled_units} unit batal, timbang ulang`}
				</span>
			</>
		),
	},
	{
		id: "courier",
		header: "Kurir pilihan pembeli",
		cellClassName: "min-w-36 whitespace-normal",
		cell: courierText,
	},
	{
		id: "cod",
		header: "Tagihan COD",
		className: "text-right",
		cellClassName: "font-medium tabular-nums",
		cell: (row) =>
			row.payment_method === "cod" ? (
				rupiah(row.booking.cod_amount_due)
			) : (
				<span className="font-normal text-muted-foreground">Prabayar</span>
			),
	},
	{
		id: "deadline",
		header: "Batas resi",
		cell: (row) =>
			row.packing_due_at ? (
				formatTime(row.packing_due_at)
			) : (
				<span className="text-muted-foreground">Jadwal gudang belum diatur</span>
			),
	},
];
const shippedColumns: DataTableColumn<Row>[] = [
	{
		id: "tracking",
		header: "Kurir & resi",
		cell: (row) => (
			<>
				{row.manual?.courier_name ?? "—"}
				<span className="block font-mono text-xs">
					{row.manual?.tracking_number ?? row.tracking_number}
				</span>
			</>
		),
	},
	{
		id: "status",
		header: "Status",
		cell: (row) =>
			row.manual?.tracking_status
				? TRACKING_LABELS[row.manual.tracking_status]
				: "Menunggu pembaruan kurir",
	},
];

function OrderLink({ row, enabled }: { row: Row; enabled: boolean }) {
	if (!enabled) return <span className="font-medium">{row.order_number}</span>;
	return (
		<Link
			href={`/admin/orders/${row.order_id}`}
			className="font-medium text-primary underline-offset-4 hover:underline"
		>
			{row.order_number}
		</Link>
	);
}

export function ManualFulfillmentClient({
	canManageProfiles,
	canViewOrders,
}: {
	canManageProfiles: boolean;
	canViewOrders: boolean;
}) {
	const [queue, setQueue] = useState<Queue>("to_book");
	const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
	const [warehouseId, setWarehouseId] = useState("");
	const [rows, setRows] = useState<Row[]>([]);
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [loadError, setLoadError] = useState("");
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [more, setMore] = useState<"idle" | "loading" | "error">("idle");
	const [notice, setNotice] = useState<Notice | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);

	const page = useCallback(
		(cursor: string | null) => {
			const params = new URLSearchParams({ queue, limit: PAGE_SIZE });
			if (warehouseId) params.set("warehouse_id", warehouseId);
			if (cursor) params.set("cursor", cursor);
			return getJson<{ data: Row[]; pagination: { next_cursor: string | null } }>(
				`/api/v1/admin/manual-shipments?${params}`,
			);
		},
		[queue, warehouseId],
	);
	const load = useCallback(async () => {
		setState("loading");
		setMore("idle");
		const result = await page(null);
		if (result.ok) {
			setRows(result.data.data);
			setNextCursor(result.data.pagination.next_cursor);
			setState("ready");
		} else {
			setLoadError(failureText(result.failure));
			setState("error");
		}
	}, [page]);
	const loadMore = async () => {
		if (!nextCursor) return;
		setMore("loading");
		const result = await page(nextCursor);
		if (!result.ok) {
			setMore("error");
			return;
		}
		// Keyset pages never overlap; the guard only keeps keys unique after a concurrent change.
		setRows((current) => {
			const seen = new Set(current.map((r) => r.id));
			return [...current, ...result.data.data.filter((r) => !seen.has(r.id))];
		});
		setNextCursor(result.data.pagination.next_cursor);
		setMore("idle");
	};

	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => {
		void getJson<{ data: Warehouse[] }>(
			"/api/v1/admin/warehouses?limit=100",
		).then((result) => {
			if (result.ok) setWarehouses(result.data.data);
		});
	}, []);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);

	const [dialog, setDialog] = useState<{ kind: DialogKind; row: Row } | null>(
		null,
	);
	const done = (text: string) => {
		setDialog(null);
		setNotice({ kind: "info", text });
		void load();
	};

	return (
		<div className="flex flex-col gap-6">
			{notice && (
				<Alert
					ref={noticeRef}
					tabIndex={-1}
					role={notice.kind === "error" ? "alert" : "status"}
					className="outline-none"
					data-testid="manual-notice"
				>
					{notice.kind === "error" ? (
						<CircleAlert aria-hidden="true" />
					) : (
						<CircleCheck aria-hidden="true" />
					)}
					<AlertDescription className="text-foreground">
						{notice.text}
					</AlertDescription>
				</Alert>
			)}
			<section aria-labelledby="manual-queue-heading" className="flex flex-col gap-4">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div className="flex flex-col gap-1">
						<h2 id="manual-queue-heading" className="text-lg font-semibold">
							Antrean pengiriman
						</h2>
						<p className="max-w-prose text-sm text-muted-foreground">
							Pesanan lunas (prabayar) dan COD terkonfirmasi dari gudang mode
							manual, urut batas resi terdekat lalu pesanan terlama. Pesan kurir
							di dashboard Mengantar 99ribu, lalu catat kurir dan resinya di sini.
						</p>
						<p
							className="max-w-prose text-sm text-muted-foreground"
							data-testid="manual-scope-rule"
						>
							Super Admin melihat semua gudang. Admin E-Commerce dan staf gudang
							hanya melihat gudang yang ditugaskan ke akunnya; minta Super Admin
							menambah penugasan bila gudang tidak muncul.
						</p>
					</div>
					<div className="flex flex-wrap items-end gap-2">
						<div className="flex flex-col gap-1">
							<label htmlFor="manual-warehouse" className="text-xs font-medium">
								Gudang
							</label>
							<select
								id="manual-warehouse"
								className={selectClass}
								value={warehouseId}
								onChange={(e) => setWarehouseId(e.target.value)}
							>
								<option value="">Semua gudang saya</option>
								{warehouses.map((w) => (
									<option key={w.id} value={w.id}>
										{w.name}
									</option>
								))}
							</select>
						</div>
						<Button
							type="button"
							variant="outline"
							onClick={() => void load()}
							aria-label="Muat ulang antrean"
						>
							<RefreshCw aria-hidden="true" />
							Muat ulang
						</Button>
					</div>
				</div>
				<div
					role="tablist"
					aria-label="Tahap pengiriman manual"
					className="inline-flex w-fit gap-1 rounded-lg border bg-muted p-1"
				>
					{(
						[
							["to_book", "Perlu dipesan kurir"],
							["shipped", "Menunggu terkirim"],
						] as const
					).map(([key, label]) => (
						<button
							key={key}
							type="button"
							role="tab"
							aria-selected={queue === key}
							data-testid={`manual-tab-${key}`}
							className={`rounded-md px-3 py-1.5 text-sm font-medium ${queue === key ? "bg-background shadow-sm" : "text-muted-foreground"}`}
							onClick={() => setQueue(key)}
						>
							{label}
						</button>
					))}
				</div>
				<DataTable
					rows={rows}
					rowKey={(row) => row.id}
					status={
						state === "loading"
							? { kind: "loading" }
							: state === "error"
								? { kind: "error", message: loadError, onRetry: () => void load() }
								: { kind: "ready" }
					}
					loadingLabel="Memuat antrean…"
					empty={
						queue === "to_book"
							? "Tidak ada paket yang menunggu dipesan kurir."
							: "Tidak ada paket yang menunggu status terkirim."
					}
					testId="manual-queue"
					caption={
						queue === "to_book"
							? "Paket yang perlu dipesan kurir, urut batas resi"
							: "Paket yang menunggu status terkirim"
					}
					rowTestId={() => "manual-row"}
					rowClassName="align-top"
					columns={[
						{
							id: "order",
							header: "Pesanan",
							cell: (row) => (
								<>
									<OrderLink row={row} enabled={canViewOrders} />
									<span className="mt-1 block">
										<Badge variant="outline">
											{row.payment_method === "cod" ? "COD" : "Prabayar"}
										</Badge>
									</span>
									<span className="mt-1 block text-xs text-muted-foreground">
										{row.warehouse_name}
									</span>
								</>
							),
						},
						{
							id: "recipient",
							header: "Penerima & tujuan",
							cellClassName: "min-w-48 whitespace-normal",
							cell: (row) => (
								<>
									<span className="block font-medium">{row.recipient.recipient_name}</span>
									<span className="block font-mono text-xs">{row.recipient.phone}</span>
									<span className="block max-w-64 text-xs text-muted-foreground">
										{areaText(row)}
									</span>
								</>
							),
						},
						...(queue === "to_book" ? toBookColumns : shippedColumns),
						{
							id: "actions",
							header: "Tindakan",
							className: "text-right",
							cell: (row) =>
								queue === "to_book" ? (
									<Button size="sm" onClick={() => setDialog({ kind: "ship", row })}>
										Catat resi
									</Button>
								) : (
									<div className="flex justify-end gap-2">
										<Button
											size="sm"
											variant="outline"
											onClick={() => setDialog({ kind: "correct", row })}
										>
											Koreksi resi
										</Button>
										<Button
											size="sm"
											variant="outline"
											onClick={() => setDialog({ kind: "status", row })}
										>
											Catat status
										</Button>
									</div>
								),
						},
					]}
					paging={{
						hasMore: nextCursor !== null,
						loading: more === "loading",
						onMore: () => void loadMore(),
						error: more === "error" ? "Halaman berikutnya gagal dimuat. Coba lagi." : null,
						summary: `${rows.length} paket ditampilkan${nextCursor ? ", masih ada paket berikutnya." : "."}`,
					}}
				/>
			</section>
			{dialog && (
				<ActionDialog
					key={`${dialog.kind}:${dialog.row.id}`}
					kind={dialog.kind}
					row={dialog.row}
					onClose={() => setDialog(null)}
					onDone={done}
				/>
			)}
			{canManageProfiles && <PickupProfiles warehouses={warehouses} />}
		</div>
	);
}

function ActionDialog({
	kind,
	row,
	onClose,
	onDone,
}: {
	kind: DialogKind;
	row: Row;
	onClose: () => void;
	onDone: (text: string) => void;
}) {
	// One idempotency key per dialog session: a network retry replays, not duplicates.
	const key = useRef(crypto.randomUUID());
	// S99: a new resi starts from the buyer's quoted courier when it maps to a Mengantar code.
	const [courier, setCourier] = useState(
		row.manual?.courier ??
			(kind === "ship" ? row.booking.quoted_courier?.code : null) ??
			"",
	);
	const [resi, setResi] = useState("");
	const [reference, setReference] = useState("");
	const [reason, setReason] = useState("");
	const [status, setStatus] = useState("delivered");
	const [occurred, setOccurred] = useState("");
	const [evidence, setEvidence] = useState("");
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const titles: Record<DialogKind, string> = {
		ship: `Catat resi ${row.order_number}`,
		correct: `Koreksi resi ${row.order_number}`,
		status: `Catat status ${row.order_number}`,
	};
	async function submit() {
		const next: Record<string, string> = {};
		if (kind !== "status" && !courier) next.courier = "Pilih kurir.";
		if (kind !== "status" && !resi.trim()) next.resi = "Nomor resi wajib diisi.";
		if (kind !== "ship" && !reason.trim()) next.reason = "Alasan wajib diisi.";
		if (kind === "status" && !occurred) next.occurred = "Isi waktu status.";
		else if (kind === "status" && !wibInputToIso(occurred))
			next.occurred = "Waktu status tidak valid.";
		if (kind === "status" && !evidence.trim())
			next.evidence = "Tulis bukti dari dashboard Mengantar.";
		setErrors(next);
		if (Object.keys(next).length) return;
		setPending(true);
		setError(null);
		const base = `/api/v1/admin/fulfillments/${row.id}`;
		const result =
			kind === "ship"
				? await post(
						`${base}/manual-shipment`,
						{
							expected_version: row.version,
							courier,
							tracking_number: resi,
							...(reference.trim() ? { purchase_reference: reference.trim() } : {}),
							...(reason.trim() ? { reason: reason.trim() } : {}),
						},
						key.current,
					)
				: kind === "correct"
					? await post(
							`${base}/tracking-corrections`,
							{
								expected_version: row.version,
								courier,
								tracking_number: resi,
								reason: reason.trim(),
							},
							key.current,
						)
					: await post(
							`${base}/tracking-statuses`,
							{
								status,
								// Read as WIB whatever the device timezone (validated above).
								occurred_at: wibInputToIso(occurred),
								reason: reason.trim(),
								evidence: evidence.trim(),
							},
							key.current,
						);
		setPending(false);
		if (result.ok) {
			onDone(
				kind === "ship"
					? `Resi ${result.data.manual.tracking_number} tercatat; paket ${row.order_number} berstatus dikirim.`
					: kind === "correct"
						? `Resi ${row.order_number} dikoreksi menjadi ${result.data.manual.tracking_number}.`
						: `Status ${TRACKING_LABELS[status]} tercatat untuk ${row.order_number}.`,
			);
			return;
		}
		if (result.code === "INVALID_TRACKING_NUMBER")
			setErrors({ resi: CODE_MESSAGES.INVALID_TRACKING_NUMBER });
		else if (result.code === "INVALID_PURCHASE_REFERENCE")
			setErrors({ reference: CODE_MESSAGES.INVALID_PURCHASE_REFERENCE });
		else setError(result.text);
		// A rejected attempt is final; a corrected resubmission gets a new key.
		key.current = crypto.randomUUID();
	}
	const describe = (id: string) =>
		errors[id] ? `${id}-error` : undefined;
	const quoted = row.booking.quoted_courier;
	const courierHint =
		kind !== "ship" || !quoted
			? undefined
			: quoted.code
				? `Pilihan pembeli: ${quoted.courier_name} · ${quoted.service_name}. Ganti hanya bila layanan itu tidak tersedia di Mengantar.`
				: `Pilihan pembeli: ${quoted.courier_name} · ${quoted.service_name}. Pilih kurir yang dipesan di Mengantar.`;
	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next && !pending) onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
				<form
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						void submit();
					}}
				>
					<DialogHeader>
						<DialogTitle>{titles[kind]}</DialogTitle>
						<DialogDescription>
							{kind === "ship"
								? "Pastikan pengiriman sudah dipesan di dashboard Mengantar 99ribu dengan penjemputan di gudang seller. Menyimpan resi menandai paket dikirim dan stok berkurang."
								: kind === "correct"
									? "Resi lama tetap tersimpan di riwayat audit. Pembeli melihat resi terbaru."
									: "Gunakan bila pembaruan otomatis dari kurir tidak tersedia. Status hanya bisa maju dan tercatat di audit."}
						</DialogDescription>
					</DialogHeader>
					{kind === "ship" && <BookingSheet row={row} />}
					{kind !== "status" && (
						<>
							<Field
								id="manual-courier"
								label="Kurir"
								hint={courierHint}
								error={errors.courier}
							>
								<select
									id="manual-courier"
									className={selectClass}
									value={courier}
									onChange={(e) => setCourier(e.target.value)}
									aria-invalid={errors.courier ? true : undefined}
									aria-describedby={
										errors.courier
											? "manual-courier-error"
											: courierHint
												? "manual-courier-hint"
												: undefined
									}
								>
									<option value="">Pilih kurir</option>
									{COURIERS.map(([value, label]) => (
										<option key={value} value={value}>
											{label}
										</option>
									))}
								</select>
							</Field>
							<Field
								id="manual-resi"
								label="Nomor resi"
								hint="Spasi dihapus dan huruf dijadikan kapital otomatis."
								error={errors.resi}
							>
								<Input
									id="manual-resi"
									value={resi}
									autoComplete="off"
									maxLength={80}
									onChange={(e) => setResi(e.target.value)}
									aria-invalid={errors.resi ? true : undefined}
									aria-describedby={errors.resi ? "manual-resi-error" : "manual-resi-hint"}
								/>
							</Field>
						</>
					)}
					{kind === "ship" && (
						<Field
							id="manual-reference"
							label="Referensi pembelian Berlapak (opsional)"
							error={errors.reference}
						>
							<Input
								id="manual-reference"
								value={reference}
								maxLength={80}
								onChange={(e) => setReference(e.target.value)}
								aria-invalid={errors.reference ? true : undefined}
								aria-describedby={describe("manual-reference")}
							/>
						</Field>
					)}
					{kind === "status" && (
						<>
							<Field id="manual-status" label="Status kurir">
								<select
									id="manual-status"
									className={selectClass}
									value={status}
									onChange={(e) => setStatus(e.target.value)}
								>
									{Object.entries(TRACKING_LABELS).map(([value, label]) => (
										<option key={value} value={value}>
											{label}
										</option>
									))}
								</select>
							</Field>
							<Field
								id="manual-occurred"
								label="Waktu status (WIB)"
								hint="Jam WIB seperti di dashboard Mengantar, tidak boleh di masa depan."
								error={errors.occurred}
							>
								<Input
									id="manual-occurred"
									type="datetime-local"
									value={occurred}
									onChange={(e) => setOccurred(e.target.value)}
									aria-invalid={errors.occurred ? true : undefined}
									aria-describedby={
										errors.occurred ? "manual-occurred-error" : "manual-occurred-hint"
									}
								/>
							</Field>
							<Field id="manual-evidence" label="Bukti dari dashboard Mengantar" error={errors.evidence}>
								<Textarea
									id="manual-evidence"
									value={evidence}
									maxLength={500}
									onChange={(e) => setEvidence(e.target.value)}
									aria-invalid={errors.evidence ? true : undefined}
									aria-describedby={describe("manual-evidence")}
								/>
							</Field>
						</>
					)}
					<Field
						id="manual-reason"
						label={kind === "ship" ? "Catatan (opsional)" : "Alasan (wajib)"}
						error={errors.reason}
					>
						<Textarea
							id="manual-reason"
							value={reason}
							maxLength={200}
							onChange={(e) => setReason(e.target.value)}
							aria-invalid={errors.reason ? true : undefined}
							aria-describedby={describe("manual-reason")}
						/>
					</Field>
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="outline" disabled={pending} onClick={onClose}>
							Batal
						</Button>
						<Button type="submit" disabled={pending}>
							{pending ? "Menyimpan…" : "Simpan"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/** What the operator copies into the Mengantar booking form. */
function BookingSheet({ row }: { row: Row }) {
	const b = row.booking;
	const fact = (label: string, value: React.ReactNode) => (
		<div className="grid grid-cols-[7.5rem_1fr] gap-2">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="min-w-0 break-words">{value}</dd>
		</div>
	);
	return (
		<section
			aria-label="Data pemesanan Mengantar"
			data-testid="booking-sheet"
			className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 text-sm"
		>
			<dl className="flex flex-col gap-1.5">
				{fact(
					"Penerima",
					<>
						{row.recipient.recipient_name}
						<span className="block font-mono text-xs">{row.recipient.phone}</span>
					</>,
				)}
				{fact("Alamat", row.recipient.address_line)}
				{fact("Wilayah", areaText(row))}
				{fact("Kurir pembeli", courierText(row))}
				{fact(
					"Berat awal",
					<>
						{`${formatKg(b.parcel.weight_grams)} · ${formatCm(b.parcel.length_mm)} × ${formatCm(b.parcel.width_mm)} × ${formatCm(b.parcel.height_mm)} cm`}
						<span className="block text-xs text-muted-foreground" data-testid="booking-weight-note">
							{b.cancelled_units > 0
								? `Hitungan saat checkout; ${b.cancelled_units} unit sudah dibatalkan. Timbang ulang paket sebelum memesan.`
								: "Hitungan saat checkout. Pastikan sesuai timbangan."}
						</span>
					</>,
				)}
				{fact(
					"Tagihan COD",
					row.payment_method === "cod" ? (
						<>
							<strong className="tabular-nums" data-testid="booking-cod-due">
								{rupiah(b.cod_amount_due)}
							</strong>
							<span className="block text-xs text-muted-foreground">
								Nilai saat ini untuk unit yang masih dikirim, termasuk biaya COD{" "}
								{rupiah(b.cod_fee_amount)}. Isi nilai ini persis di Mengantar.
							</span>
						</>
					) : (
						"Tidak ada (prabayar)"
					),
				)}
			</dl>
			<div className="flex flex-col gap-1">
				<p className="font-medium">Ambil dari rak</p>
				<ul className="flex flex-col gap-0.5">
					{pickList(row).map((pick) => (
						<li key={pick.sku}>
							{pick.quantity}× {pick.name}{" "}
							<span className="font-mono text-xs text-muted-foreground">
								{pick.sku}
							</span>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}

type Profile = {
	warehouse_id: string;
	warehouse_name: string;
	version: number;
	readiness: "complete" | "incomplete";
	mode: "mengantar_api" | "manual_dashboard";
	street_address: string | null;
	pic_name: string | null;
	pic_phone: string | null;
	pinpoint: { latitude: number; longitude: number } | null;
	updated_at: string | null;
};

function PickupProfiles({ warehouses }: { warehouses: Warehouse[] }) {
	const [selected, setSelected] = useState("");
	const [profile, setProfile] = useState<Profile | null>(null);
	const [form, setForm] = useState({
		street: "",
		pic: "",
		phone: "",
		lat: "",
		lng: "",
		reason: "",
	});
	const [notice, setNotice] = useState<Notice | null>(null);
	const [pending, setPending] = useState(false);
	const key = useRef(crypto.randomUUID());

	useEffect(() => {
		if (!selected) return;
		setProfile(null);
		setNotice(null);
		void getJson<Profile>(`/api/v1/admin/warehouses/${selected}/pickup-profile`).then(
			(result) => {
				if (!result.ok) {
					setNotice({ kind: "error", text: failureText(result.failure) });
					return;
				}
				const p = result.data;
				setProfile(p);
				setForm({
					street: p.street_address ?? "",
					pic: p.pic_name ?? "",
					phone: p.pic_phone ? `0${p.pic_phone.slice(2)}` : "",
					lat: p.pinpoint ? String(p.pinpoint.latitude) : "",
					lng: p.pinpoint ? String(p.pinpoint.longitude) : "",
					reason: "",
				});
				key.current = crypto.randomUUID();
			},
		);
	}, [selected]);

	async function save() {
		if (!profile) return;
		if (!form.reason.trim()) {
			setNotice({ kind: "error", text: "Alasan perubahan wajib diisi." });
			return;
		}
		setPending(true);
		const result = await post(
			`/api/v1/admin/warehouses/${profile.warehouse_id}/pickup-profile`,
			{
				expected_version: profile.version,
				street_address: form.street.trim() || null,
				pic_name: form.pic.trim() || null,
				pic_phone: form.phone.trim() || null,
				pinpoint:
					form.lat && form.lng
						? { latitude: Number(form.lat), longitude: Number(form.lng) }
						: null,
				reason: form.reason.trim(),
			},
			key.current,
		);
		setPending(false);
		key.current = crypto.randomUUID();
		if (result.ok) {
			setProfile(result.data);
			setForm((f) => ({ ...f, reason: "" }));
			setNotice({
				kind: "info",
				text: `Profil penjemputan versi ${result.data.version} tersimpan (${result.data.readiness === "complete" ? "lengkap" : "belum lengkap"}).`,
			});
		} else setNotice({ kind: "error", text: result.text });
	}

	return (
		<section
			aria-labelledby="pickup-heading"
			className="flex flex-col gap-4 border-t pt-6"
		>
			<div className="flex flex-col gap-1">
				<h2 id="pickup-heading" className="text-lg font-semibold">
					Profil penjemputan gudang
				</h2>
				<p className="max-w-prose text-sm text-muted-foreground">
					Data pribadi (alamat jalan, nama dan telepon PIC) untuk pemesanan
					otomatis Mengantar di masa depan. Selama integrasi otomatis belum
					aktif, semua gudang tetap mode manual.
				</p>
			</div>
			<div className="flex max-w-sm flex-col gap-1.5">
				<label htmlFor="pickup-warehouse" className="text-sm font-medium">
					Gudang
				</label>
				<select
					id="pickup-warehouse"
					className={selectClass}
					value={selected}
					onChange={(e) => setSelected(e.target.value)}
				>
					<option value="">Pilih gudang</option>
					{warehouses.map((w) => (
						<option key={w.id} value={w.id}>
							{w.name}
						</option>
					))}
				</select>
			</div>
			{notice && (
				<p
					role={notice.kind === "error" ? "alert" : "status"}
					className={notice.kind === "error" ? "text-sm text-destructive" : "text-sm text-success"}
				>
					{notice.text}
				</p>
			)}
			{profile && (
				<form
					noValidate
					className="grid max-w-2xl gap-4 md:grid-cols-2"
					onSubmit={(e) => {
						e.preventDefault();
						void save();
					}}
				>
					<div className="flex flex-wrap items-center gap-2 md:col-span-2">
						<Badge variant={profile.readiness === "complete" ? "default" : "outline"}>
							{profile.readiness === "complete" ? "Lengkap" : "Belum lengkap"}
						</Badge>
						<Badge variant="outline">
							{profile.mode === "mengantar_api" ? "Mode otomatis" : "Mode manual"}
						</Badge>
						<span className="text-xs text-muted-foreground">
							Versi {profile.version}
							{profile.updated_at ? ` · ${formatTime(profile.updated_at)}` : ""}
						</span>
					</div>
					<div className="md:col-span-2">
						<Field id="pickup-street" label="Alamat jalan penjemputan">
							<Textarea
								id="pickup-street"
								value={form.street}
								maxLength={300}
								autoComplete="off"
								onChange={(e) => setForm({ ...form, street: e.target.value })}
							/>
						</Field>
					</div>
					<Field id="pickup-pic" label="Nama PIC">
						<Input
							id="pickup-pic"
							value={form.pic}
							maxLength={120}
							autoComplete="off"
							onChange={(e) => setForm({ ...form, pic: e.target.value })}
						/>
					</Field>
					<Field id="pickup-phone" label="Telepon PIC">
						<Input
							id="pickup-phone"
							type="tel"
							inputMode="tel"
							value={form.phone}
							maxLength={24}
							autoComplete="off"
							onChange={(e) => setForm({ ...form, phone: e.target.value })}
						/>
					</Field>
					<Field id="pickup-lat" label="Lintang (opsional, kurir instan)">
						<Input
							id="pickup-lat"
							inputMode="decimal"
							value={form.lat}
							onChange={(e) => setForm({ ...form, lat: e.target.value })}
						/>
					</Field>
					<Field id="pickup-lng" label="Bujur (opsional, kurir instan)">
						<Input
							id="pickup-lng"
							inputMode="decimal"
							value={form.lng}
							onChange={(e) => setForm({ ...form, lng: e.target.value })}
						/>
					</Field>
					<div className="md:col-span-2">
						<Field id="pickup-reason" label="Alasan perubahan (wajib)">
							<Input
								id="pickup-reason"
								value={form.reason}
								maxLength={200}
								onChange={(e) => setForm({ ...form, reason: e.target.value })}
							/>
						</Field>
					</div>
					<div className="md:col-span-2">
						<Button type="submit" disabled={pending}>
							{pending ? "Menyimpan…" : "Simpan profil"}
						</Button>
					</div>
				</form>
			)}
		</section>
	);
}
