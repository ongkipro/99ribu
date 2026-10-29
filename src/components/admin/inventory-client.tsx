"use client";

import { CircleCheck, PackagePlus, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { wibDate, wibDateTime } from "@/modules/storefront/format";
import { failureText, getJson } from "./admin-errors";
import { readAll } from "./catalog-model";
import { DataTable } from "./data-table";
import { FilterSheet, FormDialog, FormField, nativeSelectClass } from "./form";
import { send, useOperationKey } from "./ops-api";
import { AdminPage, PageHeader } from "./page-blocks";
import { StatusBadge } from "./status";
import { useKeysetList } from "./use-keyset-list";

// S102 / spec 17 B6: stock per warehouse and SKU (lot), reasoned movements, transfer start and the
// movement history (audit view). Every quantity change is an immutable movement on the position's
// current version; the API rechecks role, MFA and warehouse scope.

export type Warehouse = { id: string; name: string; city: string };
type Position = {
	id: string;
	warehouse_id: string;
	stock_item_id: string;
	sku: string;
	stock_item_name: string;
	lot_id: string | null;
	lot_code: string | null;
	expires_on: string | null;
	expired: boolean;
	on_hand: number;
	reserved: number;
	quarantined: number;
	available: number;
	version: number;
};
type Movement = {
	id: string;
	kind: string;
	quantity: number;
	on_hand_delta: number;
	reserved_delta: number;
	quarantined_delta: number;
	actor_name: string | null;
	reason: string;
	balance_version: number;
	created_at: string;
};
type StockItem = { id: string; sku: string; name: string };

type Kind = "receive" | "adjust_up" | "adjust_down" | "quarantine" | "release_quarantine" | "write_off";
export const MOVEMENT_LABELS: Record<string, string> = {
	receive: "Terima barang",
	adjust_up: "Koreksi tambah",
	adjust_down: "Koreksi kurang",
	quarantine: "Karantina",
	release_quarantine: "Lepas karantina",
	write_off: "Hapus dari stok (rusak/hilang)",
	reserve: "Dipesan pembeli",
	release: "Pesanan dilepas",
	consume: "Dikirim ke pembeli",
	transfer_out: "Transfer keluar",
	transfer_in: "Transfer masuk",
};
const KINDS: Kind[] = ["receive", "adjust_up", "adjust_down", "quarantine", "release_quarantine", "write_off"];
/** Effect of a movement on (fisik, karantina), mirroring inventory/positions.ts createMovement. */
function effect(kind: Kind, n: number, expired: boolean) {
	const onHand = kind === "receive" || kind === "adjust_up" ? n : kind === "adjust_down" || kind === "write_off" ? -n : 0;
	const quarantined =
		kind === "quarantine" || (kind === "receive" && expired) ? n : kind === "release_quarantine" || kind === "write_off" ? -n : 0;
	return { onHand, quarantined };
}

const lotLabel = (p: { lot_code: string | null; expires_on: string | null; expired: boolean }) =>
	p.lot_code
		? `Lot ${p.lot_code}${p.expires_on ? ` · ${p.expired ? "kedaluwarsa" : "s.d."} ${wibDate(`${p.expires_on}T00:00:00+07:00`)}` : ""}`
		: "Tanpa lot";

export function InventoryClient({ canTransfer, canReceiveNew }: { canTransfer: boolean; canReceiveNew: boolean }) {
	const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
	const [warehouse, setWarehouse] = useState("");
	const [q, setQ] = useState("");
	const [query, setQuery] = useState("");
	const [notice, setNotice] = useState<string | null>(null);
	const [dialog, setDialog] = useState<
		| { kind: "movement"; row: Position }
		| { kind: "history"; row: Position }
		| { kind: "transfer"; row: Position }
		| { kind: "receive-new" }
		| null
	>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		void readAll<Warehouse>("/api/v1/admin/warehouses").then((r) => r.ok && setWarehouses(r.data));
	}, []);
	useEffect(() => {
		const timer = setTimeout(() => setQuery(q.trim()), 300);
		return () => clearTimeout(timer);
	}, [q]);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);
	const params = new URLSearchParams({ limit: "50" });
	if (warehouse) params.set("warehouse_id", warehouse);
	if (query) params.set("q", query);
	const list = useKeysetList<Position>(`/api/v1/admin/inventory?${params}`, (row) => row.id);
	const warehouseName = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "Gudang";
	const done = (message: string) => {
		setDialog(null);
		setNotice(message);
		void list.reload();
	};
	const filtered = Boolean(warehouse || query);
	return (
		<AdminPage testId="inventory-page">
			<PageHeader
				title="Stok Gudang"
				description="Saldo fisik per gudang dan barang. Setiap perubahan dicatat sebagai pergerakan dengan alasan; saldo tidak bisa ditimpa langsung."
				actions={
					<>
						<Button asChild variant="outline">
							<Link href="/admin/inventory/transfers">Buka Transfer Stok</Link>
						</Button>
						{canReceiveNew && (
							<Button data-testid="inventory-receive-new" onClick={() => setDialog({ kind: "receive-new" })}>
								<PackagePlus data-icon="inline-start" aria-hidden="true" />
								Terima barang baru
							</Button>
						)}
					</>
				}
			/>
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="border-success/30 bg-success-surface outline-none">
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			<section aria-labelledby="stock-heading" className="flex flex-col gap-4 md:rounded-lg md:border md:bg-card md:p-5">
				<div className="flex items-start justify-between gap-3">
					<h2 id="stock-heading" className="text-base font-semibold">
						Saldo stok
					</h2>
					<Button variant="outline" className="shrink-0" onClick={() => void list.reload()}>
						<RefreshCw aria-hidden="true" />
						Muat ulang
					</Button>
				</div>
				<search className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
					<div className="flex flex-col gap-1.5">
						<label htmlFor="inventory-search" className="text-sm font-medium">
							Cari barang
						</label>
						<div className="relative">
							<Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								id="inventory-search"
								type="search"
								value={q}
								maxLength={100}
								autoComplete="off"
								placeholder="Nama atau kode SKU"
								className="pl-8"
								onChange={(e) => setQ(e.target.value)}
							/>
						</div>
					</div>
					<FilterSheet active={Number(Boolean(warehouse))}>
						<FormField id="inventory-warehouse" label="Gudang">
							<select
								id="inventory-warehouse"
								className={`${nativeSelectClass} w-full`}
								value={warehouse}
								onChange={(e) => setWarehouse(e.target.value)}
							>
								<option value="">Semua gudang Anda</option>
								{warehouses.map((w) => (
									<option key={w.id} value={w.id}>
										{w.name} · {w.city}
									</option>
								))}
							</select>
						</FormField>
					</FilterSheet>
				</search>
				<DataTable
					rows={list.rows}
					rowKey={(row) => row.id}
					status={list.status}
					paging={{ ...list.paging, testId: "inventory-more", summary: list.rows.length ? `${list.rows.length} baris ditampilkan` : null }}
					loadingLabel="Memuat stok…"
					empty={
						filtered ? (
							<>
								<p>Tidak ada stok yang cocok dengan filter ini. Ubah kata kunci atau pilih gudang lain.</p>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										setQ("");
										setWarehouse("");
									}}
								>
									Hapus filter
								</Button>
							</>
						) : (
							canReceiveNew
								? "Belum ada saldo stok di gudang Anda. Catat barang masuk lewat Terima barang baru."
								: "Belum ada saldo stok di gudang Anda. Saldo muncul setelah Admin E-Commerce mencatat barang masuk."
						)
					}
					testId="inventory-positions"
					rowTestId={(row) => `inventory-row-${row.sku}`}
					caption="Saldo stok per gudang dan barang"
					stack
					columns={[
						{
							id: "item",
							header: "Barang",
							stack: "title",
							cellClassName: "min-w-52 whitespace-normal xl:max-w-80",
							// md–xl: warehouse, lot and the counts move under the name so the actions never cover a column.
							cell: (row) => (
								<div className="flex flex-col">
									<span className="font-medium">{row.stock_item_name}</span>
									<span className="font-mono text-xs font-normal text-muted-foreground">{row.sku}</span>
									<span className="hidden text-xs font-normal text-muted-foreground tabular-nums md:max-xl:block">
										{warehouseName(row.warehouse_id)} · {lotLabel(row)}
										<br />
										Fisik {row.on_hand} · Dipesan {row.reserved} · Karantina {row.quarantined}
									</span>
								</div>
							),
						},
						{
							id: "available",
							header: "Tersedia",
							stack: "aside",
							className: "text-right tabular-nums",
							cellClassName: "font-semibold",
							cell: (row) => (
								<>
									{row.available}
									<span className="text-xs font-normal text-muted-foreground md:hidden"> tersedia</span>
								</>
							),
						},
						{
							id: "warehouse",
							header: "Gudang dan lot",
							stack: "meta",
							className: "md:max-xl:hidden",
							cellClassName: "whitespace-normal xl:min-w-48",
							cell: (row) => (
								<div className="flex flex-col">
									<span>{warehouseName(row.warehouse_id)}</span>
									<span className="text-xs text-muted-foreground max-md:hidden">{lotLabel(row)}</span>
								</div>
							),
						},
						{
							id: "lot",
							header: "Lot",
							stack: "status",
							className: "md:hidden",
							cellClassName: "whitespace-normal text-xs",
							cell: (row) =>
								(
									<span className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
										{row.expired ? <StatusBadge tone="danger">{lotLabel(row)}</StatusBadge> : lotLabel(row)}
										<span className="text-muted-foreground">
											Fisik {row.on_hand} · Dipesan {row.reserved} · Karantina {row.quarantined}
										</span>
									</span>
								),
						},
						{ id: "on_hand", header: "Fisik", className: "text-right tabular-nums md:max-xl:hidden", cellClassName: "max-md:hidden", cell: (row) => row.on_hand },
						{ id: "reserved", header: "Dipesan", className: "text-right tabular-nums md:max-xl:hidden", cellClassName: "max-md:hidden", cell: (row) => row.reserved },
						{ id: "quarantined", header: "Karantina", className: "text-right tabular-nums md:max-xl:hidden", cellClassName: "max-md:hidden", cell: (row) => row.quarantined },
						{
							id: "actions",
							header: "Tindakan",
							className: "text-right",
							cell: (row) => (
								<div className="flex flex-col items-end gap-1 max-md:w-full max-md:items-stretch">
								<div className="flex justify-end gap-2 max-md:w-full">
									<Button size="sm" data-testid={`inventory-move-${row.sku}`} onClick={() => setDialog({ kind: "movement", row })}>
										Catat stok
									</Button>
									<Button size="sm" variant="outline" onClick={() => setDialog({ kind: "history", row })}>
										Riwayat
									</Button>
									{canTransfer && (
										<Button
											size="sm"
											variant="outline"
											disabled={row.available < 1}
											aria-describedby={row.available < 1 ? `transfer-none-${row.id}` : undefined}
											onClick={() => setDialog({ kind: "transfer", row })}
										>
											Transfer
										</Button>
									)}
								</div>
								{canTransfer && row.available < 1 && (
									<span id={`transfer-none-${row.id}`} className="text-xs text-muted-foreground">
										Transfer perlu stok tersedia.
									</span>
								)}
								</div>
							),
						},
					]}
				/>
			</section>
			{dialog?.kind === "movement" && (
				<MovementDialog row={dialog.row} warehouse={warehouseName(dialog.row.warehouse_id)} onClose={() => setDialog(null)} onDone={done} />
			)}
			{dialog?.kind === "history" && (
				<HistoryDialog row={dialog.row} warehouse={warehouseName(dialog.row.warehouse_id)} onClose={() => setDialog(null)} />
			)}
			{dialog?.kind === "transfer" && (
				<TransferDialog row={dialog.row} warehouses={warehouses} onClose={() => setDialog(null)} onDone={done} />
			)}
			{dialog?.kind === "receive-new" && <ReceiveNewDialog warehouses={warehouses} onClose={() => setDialog(null)} onDone={done} />}
		</AdminPage>
	);
}

const quantityOf = (value: string) => (/^\d{1,7}$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 1_000_000 ? Number(value) : null);

function MovementDialog({
	row,
	warehouse,
	onClose,
	onDone,
}: {
	row: Position;
	warehouse: string;
	onClose: () => void;
	onDone: (message: string) => void;
}) {
	const [kind, setKind] = useState<Kind>("receive");
	const [amount, setAmount] = useState("");
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const key = useOperationKey();
	const n = quantityOf(amount);
	const change = n === null ? null : effect(kind, n, row.expired);
	const preview = change
		? `Fisik ${row.on_hand} → ${row.on_hand + change.onHand} · Karantina ${row.quarantined} → ${row.quarantined + change.quarantined}`
		: "Isi jumlah satuan, angka bulat 1–1.000.000.";
	async function submit() {
		if (n === null) return setError("Jumlah harus angka bulat 1–1.000.000.");
		if (!reason.trim()) return setError("Alasan wajib diisi.");
		setPending(true);
		setError(null);
		const result = await send("POST", "/api/v1/admin/inventory/movements", {
			warehouse_id: row.warehouse_id,
			stock_item_id: row.stock_item_id,
			lot_id: row.lot_id,
			kind,
			quantity: n,
			reason: reason.trim(),
			expected_version: row.version,
		}, key);
		setPending(false);
		if (!result.ok) return setError(result.text);
		onDone(`${MOVEMENT_LABELS[kind]} ${n} × ${row.stock_item_name} di ${warehouse} dicatat.`);
	}
	return (
		<FormDialog
			title={`Catat stok: ${row.stock_item_name}`}
			description={`${warehouse} · ${lotLabel(row)}. Sekarang fisik ${row.on_hand}, dipesan ${row.reserved}, karantina ${row.quarantined}, tersedia ${row.available}.`}
			pending={pending}
			error={error}
			submitLabel="Simpan pergerakan"
			dirty={Boolean(amount.trim() || reason.trim())}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id="movement-kind" label="Jenis pergerakan">
				<select id="movement-kind" className={`${nativeSelectClass} w-full`} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
					{KINDS.map((k) => (
						<option key={k} value={k}>
							{MOVEMENT_LABELS[k]}
						</option>
					))}
				</select>
			</FormField>
			<FormField id="movement-quantity" label="Jumlah (satuan)" hint={preview}>
				<Input
					id="movement-quantity"
					inputMode="numeric"
					aria-describedby="movement-quantity-hint"
					value={amount}
					onChange={(e) => setAmount(e.target.value)}
				/>
			</FormField>
			<FormField id="movement-reason" label="Alasan" hint="Tercatat di riwayat stok, contoh: surat jalan SJ-0412, hasil hitung ulang rak B.">
				<Input id="movement-reason" maxLength={500} aria-describedby="movement-reason-hint" value={reason} onChange={(e) => setReason(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}

function HistoryDialog({ row, warehouse, onClose }: { row: Position; warehouse: string; onClose: () => void }) {
	const list = useKeysetList<Movement>(`/api/v1/admin/inventory/movements?position_id=${row.id}&limit=20`, (m) => m.id);
	const delta = (n: number) => (n > 0 ? `+${n}` : String(n));
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="md:max-h-[90dvh] md:max-w-2xl md:overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Riwayat stok: {row.stock_item_name}</DialogTitle>
					<DialogDescription>
						{warehouse} · {lotLabel(row)}. Pergerakan terbaru di atas; catatan tidak bisa diubah atau dihapus.
					</DialogDescription>
				</DialogHeader>
				<DataTable
					rows={list.rows}
					rowKey={(m) => m.id}
					status={list.status}
					paging={{ ...list.paging, testId: "inventory-history-more" }}
					loadingLabel="Memuat riwayat…"
					empty="Belum ada pergerakan untuk saldo ini. Pergerakan muncul setelah stok dicatat lewat Catat stok atau transfer."
					testId="inventory-history"
					caption="Riwayat pergerakan stok"
					stack
					columns={[
						{
							id: "kind",
							header: "Pergerakan",
							stack: "title",
							cellClassName: "whitespace-normal",
							cell: (m) => (
								<div className="flex flex-col">
									<span>{MOVEMENT_LABELS[m.kind] ?? m.kind}</span>
									<span className="text-xs font-normal text-muted-foreground">{m.reason}</span>
								</div>
							),
						},
						{
							id: "delta",
							header: "Fisik",
							stack: "aside",
							className: "text-right tabular-nums",
							cell: (m) => delta(m.on_hand_delta),
						},
						{ id: "when", header: "Waktu", stack: "meta", kind: "datetime", cell: (m) => wibDateTime(m.created_at) },
						{ id: "actor", header: "Oleh", stack: "meta", cellClassName: "whitespace-normal", cell: (m) => m.actor_name ?? "Sistem" },
						{
							id: "other",
							header: "Dipesan / karantina",
							className: "text-right tabular-nums",
							cell: (m) => `${delta(m.reserved_delta)} / ${delta(m.quarantined_delta)}`,
						},
					]}
				/>
			</DialogContent>
		</Dialog>
	);
}

function TransferDialog({
	row,
	warehouses,
	onClose,
	onDone,
}: {
	row: Position;
	warehouses: Warehouse[];
	onClose: () => void;
	onDone: (message: string) => void;
}) {
	const targets = warehouses.filter((w) => w.id !== row.warehouse_id);
	const [to, setTo] = useState(targets[0]?.id ?? "");
	const [amount, setAmount] = useState("");
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const key = useOperationKey();
	const from = warehouses.find((w) => w.id === row.warehouse_id)?.name ?? "Gudang asal";
	async function submit() {
		const n = quantityOf(amount);
		if (!to) return setError("Pilih gudang tujuan.");
		if (n === null) return setError("Jumlah harus angka bulat 1–1.000.000.");
		if (!reason.trim()) return setError("Alasan wajib diisi.");
		setPending(true);
		setError(null);
		const result = await send("POST", "/api/v1/admin/inventory/transfers", {
			from_warehouse_id: row.warehouse_id,
			to_warehouse_id: to,
			stock_item_id: row.stock_item_id,
			quantity: n,
			reason: reason.trim(),
		}, key);
		setPending(false);
		if (!result.ok) return setError(result.text);
		onDone(`Transfer ${n} × ${row.stock_item_name} dari ${from} dibuat; stok dipesan sampai gudang asal mengirimnya.`);
	}
	return (
		<FormDialog
			title={`Transfer: ${row.stock_item_name}`}
			description={`Dari ${from}. Stok diambil dari semua lot barang ini di gudang asal, yang paling dulu kedaluwarsa lebih dulu, dan langsung dipesan. Gudang asal lalu mengirim dan gudang tujuan menerima.`}
			pending={pending}
			error={error}
			submitLabel="Buat transfer"
			dirty={Boolean(amount.trim() || reason.trim())}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id="transfer-to" label="Gudang tujuan">
				<select id="transfer-to" className={`${nativeSelectClass} w-full`} value={to} onChange={(e) => setTo(e.target.value)}>
					{targets.length === 0 && <option value="">Tidak ada gudang lain</option>}
					{targets.map((w) => (
						<option key={w.id} value={w.id}>
							{w.name} · {w.city}
						</option>
					))}
				</select>
			</FormField>
			<FormField id="transfer-quantity" label="Jumlah (satuan)">
				<Input id="transfer-quantity" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
			</FormField>
			<FormField id="transfer-reason" label="Alasan">
				<Input id="transfer-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}

/** Receiving a SKU (optionally into a new lot) that has no position row in the list yet. */
function ReceiveNewDialog({
	warehouses,
	onClose,
	onDone,
}: {
	warehouses: Warehouse[];
	onClose: () => void;
	onDone: (message: string) => void;
}) {
	const [items, setItems] = useState<StockItem[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [form, setForm] = useState({ warehouse: warehouses[0]?.id ?? "", item: "", amount: "", lot: "", expires: "", reason: "" });
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const lotKey = useOperationKey();
	const moveKey = useOperationKey();
	// A lot created by an earlier attempt of this dialog is reused, never created twice.
	const [lotId, setLotId] = useState<string | null>(null);
	useEffect(() => {
		void readAll<StockItem>("/api/v1/admin/stock-items").then((r) =>
			r.ok ? setItems(r.data) : setLoadError(`Daftar SKU gagal dimuat. ${failureText(r.failure)}`),
		);
	}, []);
	const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
		setForm({ ...form, [field]: e.target.value });
		if (field === "lot" || field === "expires" || field === "item" || field === "warehouse") setLotId(null);
	};
	const item = items?.find((i) => `${i.sku} · ${i.name}` === form.item || i.sku === form.item.trim().toUpperCase());
	async function submit() {
		const n = quantityOf(form.amount);
		if (!form.warehouse) return setError("Pilih gudang.");
		if (!item) return setError("Pilih SKU dari daftar.");
		if (n === null) return setError("Jumlah harus angka bulat 1–1.000.000.");
		if (!form.reason.trim()) return setError("Alasan wajib diisi.");
		if (form.expires && !form.lot.trim()) return setError("Tanggal kedaluwarsa hanya untuk lot: isi kode lot.");
		setPending(true);
		setError(null);
		let lot = lotId;
		if (form.lot.trim() && !lot) {
			const created = await send<{ id: string }>("POST", "/api/v1/admin/inventory/lots", {
				warehouse_id: form.warehouse,
				stock_item_id: item.id,
				code: form.lot.trim(),
				expires_on: form.expires || null,
				reason: form.reason.trim(),
			}, lotKey);
			if (!created.ok) {
				setPending(false);
				return setError(created.text);
			}
			lot = created.data.id;
			setLotId(lot);
		}
		// The movement needs the position's current version (0 for a new position).
		const current = await getJson<{ data: Position[] }>(
			`/api/v1/admin/inventory?warehouse_id=${form.warehouse}&stock_item_id=${item.id}${lot ? `&lot_id=${lot}` : ""}&limit=100`,
		);
		if (!current.ok) {
			setPending(false);
			return setError(failureText(current.failure));
		}
		const position = current.data.data.find((p) => p.lot_id === lot);
		const result = await send("POST", "/api/v1/admin/inventory/movements", {
			warehouse_id: form.warehouse,
			stock_item_id: item.id,
			lot_id: lot,
			kind: "receive",
			quantity: n,
			reason: form.reason.trim(),
			expected_version: position?.version ?? 0,
		}, moveKey);
		setPending(false);
		if (!result.ok) return setError(result.text);
		onDone(`${n} × ${item.name} diterima di ${warehouses.find((w) => w.id === form.warehouse)?.name ?? "gudang"}.`);
	}
	return (
		<FormDialog
			title="Terima barang baru"
			description="Untuk SKU yang belum punya saldo di gudang ini atau lot baru. SKU yang sudah ada di daftar dicatat lewat Catat stok."
			pending={pending}
			error={error ?? loadError}
			submitLabel="Simpan penerimaan"
			dirty={Boolean(form.item.trim() || form.amount.trim() || form.lot.trim() || form.expires || form.reason.trim())}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id="receive-warehouse" label="Gudang">
				<select id="receive-warehouse" className={`${nativeSelectClass} w-full`} value={form.warehouse} onChange={set("warehouse")}>
					{warehouses.map((w) => (
						<option key={w.id} value={w.id}>
							{w.name} · {w.city}
						</option>
					))}
				</select>
			</FormField>
			<FormField id="receive-item" label="SKU" hint={items === null ? "Memuat daftar SKU…" : item ? item.name : "Ketik kode atau nama lalu pilih dari daftar."}>
				<Input id="receive-item" list="receive-items" autoComplete="off" aria-describedby="receive-item-hint" value={form.item} onChange={set("item")} />
				<datalist id="receive-items">
					{items?.map((i) => (
						<option key={i.id} value={`${i.sku} · ${i.name}`} />
					))}
				</datalist>
			</FormField>
			<FormField id="receive-quantity" label="Jumlah (satuan)">
				<Input id="receive-quantity" inputMode="numeric" value={form.amount} onChange={set("amount")} />
			</FormField>
			<div className="grid gap-3 sm:grid-cols-2">
				<FormField id="receive-lot" label="Kode lot (opsional)">
					<Input id="receive-lot" maxLength={100} value={form.lot} onChange={set("lot")} />
				</FormField>
				<FormField id="receive-expires" label="Kedaluwarsa (opsional)">
					<Input id="receive-expires" type="date" lang="id" value={form.expires} onChange={set("expires")} />
				</FormField>
			</div>
			<FormField id="receive-reason" label="Alasan" hint="Contoh: surat jalan pemasok SJ-0412.">
				<Input id="receive-reason" maxLength={500} aria-describedby="receive-reason-hint" value={form.reason} onChange={set("reason")} />
			</FormField>
		</FormDialog>
	);
}
