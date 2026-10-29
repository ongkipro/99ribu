"use client";

import { CircleCheck, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { wibDate, wibDateTime } from "@/modules/storefront/format";
import { getJson } from "./admin-errors";
import { DataTable } from "./data-table";
import { FormDialog, FormField, SegmentedControl } from "./form";
import { send, useOperationKey } from "./ops-api";
import { AdminPage, PageHeader } from "./page-blocks";
import { StatusBadge, type StatusTone } from "./status";
import { useKeysetList } from "./use-keyset-list";

// S102 / spec 17 B7: inter-warehouse transfers. Created on Stok Gudang (owner/ecommerce_admin);
// the source warehouse dispatches or cancels, the destination receives per lot (with damaged units
// to quarantine). Actions show only where the caller's warehouse scope allows them; the API rechecks.

type Transfer = {
	id: string;
	from_warehouse_id: string;
	to_warehouse_id: string;
	sku: string | null;
	stock_item_name: string | null;
	from_warehouse_name: string | null;
	to_warehouse_name: string | null;
	quantity: number;
	status: Status;
	version: number;
	received_quantity: number;
	quarantined_quantity: number;
	outstanding_quantity: number;
	created_at: string;
	allocations: {
		source_balance_id: string;
		lot_code: string | null;
		expires_on: string | null;
		quantity: number;
		received_quantity: number;
		quarantined_quantity: number;
	}[];
};
type Status = "requested" | "dispatched" | "received" | "exception" | "cancelled";
const STATUS: Record<Status, [string, StatusTone]> = {
	requested: ["Menunggu dikirim", "open"],
	dispatched: ["Dalam perjalanan", "progress"],
	received: ["Diterima", "success"],
	exception: ["Diterima sebagian", "problem"],
	cancelled: ["Dibatalkan", "closed"],
};
type Filter = Status | "all";

export function TransfersClient({ owner }: { owner: boolean }) {
	const [filter, setFilter] = useState<Filter>("requested");
	const [scope, setScope] = useState<string[] | null>(owner ? [] : null);
	const [notice, setNotice] = useState<string | null>(null);
	const [dialog, setDialog] = useState<{ action: "dispatch" | "cancel" | "receive"; row: Transfer } | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!owner) void getJson<{ warehouse_ids: string[] }>("/api/v1/me").then((r) => setScope(r.ok ? r.data.warehouse_ids : []));
	}, [owner]);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);
	const list = useKeysetList<Transfer>(
		`/api/v1/admin/inventory/transfers?limit=50${filter === "all" ? "" : `&status=${filter}`}`,
		(row) => row.id,
	);
	const inScope = (warehouseId: string) => owner || Boolean(scope?.includes(warehouseId));
	const name = (row: Transfer) => row.stock_item_name ?? "Barang";
	return (
		<AdminPage testId="transfers-page">
			<PageHeader
				title="Transfer Stok"
				back={{ href: "/admin/produk/inventori", label: "Stok Gudang" }}
				description="Pindah stok antar gudang. Stok dipesan saat transfer dibuat, keluar dari gudang asal saat dikirim, dan masuk ke gudang tujuan saat diterima."
			/>
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="border-success/30 bg-success-surface outline-none">
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			<section aria-labelledby="transfers-heading" className="flex flex-col gap-4">
				<div className="flex items-start justify-between gap-3">
					<h2 id="transfers-heading" className="text-base font-semibold">
						Daftar transfer
					</h2>
					<Button variant="outline" className="shrink-0" onClick={() => void list.reload()}>
						<RefreshCw aria-hidden="true" />
						Muat ulang
					</Button>
				</div>
				<SegmentedControl
					legend="Status transfer"
					value={filter}
					onChange={setFilter}
					testId={(key) => `transfers-filter-${key}`}
					options={[
						["requested", "Menunggu dikirim"],
						["dispatched", "Dalam perjalanan"],
						["exception", "Diterima sebagian"],
						["received", "Diterima"],
						["cancelled", "Dibatalkan"],
						["all", "Semua"],
					]}
				/>
				<DataTable
					rows={list.rows}
					rowKey={(row) => row.id}
					status={list.status}
					paging={{ ...list.paging, testId: "transfers-more" }}
					loadingLabel="Memuat transfer…"
					empty={
						filter === "all" ? (
							<>
								Belum ada transfer. Transfer dibuat dari{" "}
								<Link href="/admin/produk/inventori" className="text-primary underline-offset-4 hover:underline">
									Stok Gudang
								</Link>
								.
							</>
						) : (
							<>
								<p>Tidak ada transfer berstatus {STATUS[filter][0].toLowerCase()}.</p>
								<Button type="button" variant="outline" size="sm" onClick={() => setFilter("all")}>
									Tampilkan semua transfer
								</Button>
							</>
						)
					}
					testId="transfers"
					rowTestId={(row) => `transfer-row-${row.sku}`}
					caption="Transfer stok antar gudang"
					stack
					columns={[
						{
							id: "item",
							header: "Barang",
							stack: "title",
							cellClassName: "whitespace-normal md:max-w-64",
							cell: (row) => (
								<div className="flex flex-col">
									<span className="font-medium">{name(row)}</span>
									{row.sku && <span className="font-mono text-xs font-normal text-muted-foreground">{row.sku}</span>}
								</div>
							),
						},
						{ id: "quantity", header: "Jumlah", stack: "aside", className: "text-right tabular-nums", cell: (row) => row.quantity },
						{
							id: "route",
							header: "Rute",
							stack: "meta",
							cellClassName: "whitespace-normal",
							cell: (row) => `${row.from_warehouse_name ?? "Gudang asal"} → ${row.to_warehouse_name ?? "Gudang tujuan"}`,
						},
						{ id: "created", header: "Dibuat", stack: "meta", kind: "datetime", hideBelow: "5xl", cell: (row) => wibDateTime(row.created_at) },
						{
							id: "status",
							header: "Status",
							stack: "status",
							cell: (row) => (
								<div className="flex flex-wrap items-center gap-1">
									<StatusBadge tone={STATUS[row.status][1]}>{STATUS[row.status][0]}</StatusBadge>
									{(row.received_quantity > 0 || row.quarantined_quantity > 0) && (
										<span className="text-xs text-muted-foreground tabular-nums">
											diterima {row.received_quantity}
											{row.quarantined_quantity > 0 && `, karantina ${row.quarantined_quantity}`}
										</span>
									)}
								</div>
							),
						},
						{
							id: "actions",
							header: "Tindakan",
							className: "text-right",
							cell: (row) => (
								<div className="flex justify-end gap-2 max-md:w-full">
									{row.status === "requested" && inScope(row.from_warehouse_id) && (
										<>
											<Button size="sm" data-testid={`transfer-dispatch-${row.sku}`} onClick={() => setDialog({ action: "dispatch", row })}>
												Kirim
											</Button>
											<Button size="sm" variant="outline" onClick={() => setDialog({ action: "cancel", row })}>
												Batalkan
											</Button>
										</>
									)}
									{(row.status === "dispatched" || row.status === "exception") && inScope(row.to_warehouse_id) && (
										<Button size="sm" data-testid={`transfer-receive-${row.sku}`} onClick={() => setDialog({ action: "receive", row })}>
											Terima
										</Button>
									)}
								</div>
							),
						},
					]}
				/>
			</section>
			{dialog && (dialog.action === "receive" ? (
				<ReceiveDialog
					row={dialog.row}
					onClose={() => setDialog(null)}
					onDone={(message) => {
						setDialog(null);
						setNotice(message);
						void list.reload();
					}}
				/>
			) : (
				<ResolveDialog
					action={dialog.action}
					row={dialog.row}
					onClose={() => setDialog(null)}
					onDone={(message) => {
						setDialog(null);
						setNotice(message);
						void list.reload();
					}}
				/>
			))}
		</AdminPage>
	);
}

function ResolveDialog({
	action,
	row,
	onClose,
	onDone,
}: {
	action: "dispatch" | "cancel";
	row: Transfer;
	onClose: () => void;
	onDone: (message: string) => void;
}) {
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const key = useOperationKey();
	const item = row.stock_item_name ?? "barang";
	async function submit() {
		if (!reason.trim()) return setError("Alasan wajib diisi.");
		setPending(true);
		setError(null);
		const result = await send("POST", `/api/v1/admin/inventory/transfers/${row.id}/${action === "dispatch" ? "dispatches" : "cancellations"}`, {
			expected_version: row.version,
			reason: reason.trim(),
		}, key);
		setPending(false);
		if (!result.ok) return setError(result.text);
		onDone(action === "dispatch" ? `${row.quantity} × ${item} dikirim ke ${row.to_warehouse_name ?? "gudang tujuan"}.` : `Transfer ${item} dibatalkan; stok yang dipesan dilepas.`);
	}
	return (
		<FormDialog
			title={action === "dispatch" ? `Kirim ${row.quantity} × ${item}` : `Batalkan transfer ${item}`}
			description={
				action === "dispatch"
					? `Stok keluar dari ${row.from_warehouse_name ?? "gudang asal"} sekarang dan masuk ke ${row.to_warehouse_name ?? "gudang tujuan"} setelah diterima di sana.`
					: "Stok yang dipesan untuk transfer ini kembali tersedia di gudang asal. Transfer yang dibatalkan tidak bisa dilanjutkan; buat transfer baru dari Stok Gudang bila masih perlu."
			}
			pending={pending}
			error={error}
			submitLabel={action === "dispatch" ? "Kirim sekarang" : "Batalkan transfer"}
			destructive={action === "cancel"}
			dirty={Boolean(reason.trim())}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id="resolve-reason" label="Alasan" hint={action === "dispatch" ? "Contoh: kurir internal, surat jalan SJ-0412." : undefined}>
				<Input
					id="resolve-reason"
					maxLength={500}
					aria-describedby={action === "dispatch" ? "resolve-reason-hint" : undefined}
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>
		</FormDialog>
	);
}

const count = (value: string, max: number) => (/^\d{1,7}$/.test(value.trim()) && Number(value) <= max ? Number(value) : null);

function ReceiveDialog({ row, onClose, onDone }: { row: Transfer; onClose: () => void; onDone: (message: string) => void }) {
	const open = row.allocations.filter((a) => a.quantity > a.received_quantity);
	const [form, setForm] = useState(() =>
		Object.fromEntries(open.map((a) => [a.source_balance_id, { received: String(a.quantity - a.received_quantity), damaged: "0" }])),
	);
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const key = useOperationKey();
	async function submit() {
		const parts = [];
		for (const a of open) {
			const remaining = a.quantity - a.received_quantity;
			const received = count(form[a.source_balance_id].received, remaining);
			if (received === null) return setError(`Jumlah diterima per lot 0–${remaining}.`);
			const damaged = count(form[a.source_balance_id].damaged, received);
			if (damaged === null) return setError("Jumlah rusak tidak boleh melebihi jumlah diterima.");
			if (received > 0) parts.push({ source_balance_id: a.source_balance_id, received_quantity: received, quarantined_quantity: damaged });
		}
		if (!parts.length) return setError("Isi jumlah diterima minimal satu lot.");
		if (!reason.trim()) return setError("Alasan wajib diisi.");
		setPending(true);
		setError(null);
		const result = await send<Transfer>("POST", `/api/v1/admin/inventory/transfers/${row.id}/receipts`, {
			expected_version: row.version,
			reason: reason.trim(),
			allocations: parts,
		}, key);
		setPending(false);
		if (!result.ok) return setError(result.text);
		const total = parts.reduce((n, p) => n + p.received_quantity, 0);
		onDone(
			result.data.status === "received"
				? `Transfer ${row.stock_item_name ?? "barang"} diterima lengkap (${total} satuan).`
				: `${total} satuan diterima; sisa ${result.data.outstanding_quantity} masih ditunggu.`,
		);
	}
	return (
		<FormDialog
			title={`Terima ${row.stock_item_name ?? "barang"}`}
			description={`Dari ${row.from_warehouse_name ?? "gudang asal"}. Hitung barang yang datang per lot; yang rusak masuk karantina dan tidak dijual.`}
			pending={pending}
			error={error}
			submitLabel="Simpan penerimaan"
			dirty={Boolean(reason.trim()) || open.some((a) => form[a.source_balance_id].received !== String(a.quantity - a.received_quantity) || form[a.source_balance_id].damaged !== "0")}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			{open.map((a, i) => {
				const lot = a.lot_code ? `Lot ${a.lot_code}${a.expires_on ? ` (s.d. ${wibDate(`${a.expires_on}T00:00:00+07:00`)})` : ""}` : `Bagian ${i + 1} tanpa lot`;
				const value = form[a.source_balance_id];
				const set = (field: "received" | "damaged") => (e: React.ChangeEvent<HTMLInputElement>) =>
					setForm({ ...form, [a.source_balance_id]: { ...value, [field]: e.target.value } });
				return (
					<fieldset key={a.source_balance_id} className="flex flex-col gap-2 rounded-md border p-3">
						<legend className="px-1 text-sm font-medium">
							{lot} · dikirim {a.quantity}
							{a.received_quantity > 0 && `, sudah diterima ${a.received_quantity}`}
						</legend>
						<div className="grid grid-cols-2 gap-3">
							<FormField id={`receipt-${i}-received`} label="Diterima">
								<Input id={`receipt-${i}-received`} inputMode="numeric" value={value.received} onChange={set("received")} />
							</FormField>
							<FormField id={`receipt-${i}-damaged`} label="Rusak (karantina)">
								<Input id={`receipt-${i}-damaged`} inputMode="numeric" value={value.damaged} onChange={set("damaged")} />
							</FormField>
						</div>
					</fieldset>
				);
			})}
			<FormField id="receipt-reason" label="Alasan">
				<Input id="receipt-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}
