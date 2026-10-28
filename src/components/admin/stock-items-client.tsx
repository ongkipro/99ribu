"use client";

import { CircleCheck, Plus, ReceiptText, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CostHistory } from "./cost-versions";
import { DataTable } from "./data-table";
import { FormDialog, FormField } from "./form";
import { send, useOperationKey } from "./ops-api";
import { AdminPage, PageHeader } from "./page-blocks";
import { useKeysetList } from "./use-keyset-list";

// S134 / spec 17 B9: the physical SKU dictionary (owner and ecommerce_admin read and create; the API refuses everyone else)
// and, for roles holding finance.costs.read, each SKU's HPP version history with the append form. The list never shows
// a cost: amounts load only inside the dialog, so a role without the cost grant never requests them (the API refuses too).

type StockItem = { id: string; sku: string; name: string };
const SKU_FORMAT = /^[A-Z0-9_-]{1,100}$/;

export function StockItemsClient({ costs, costsWrite }: { costs: boolean; costsWrite: boolean }) {
	const list = useKeysetList<StockItem>("/api/v1/admin/stock-items?limit=50", (row) => row.id);
	const [query, setQuery] = useState("");
	const [create, setCreate] = useState(false);
	const [open, setOpen] = useState<StockItem | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);
	const needle = query.trim().toLowerCase();
	const rows = needle ? list.rows.filter((row) => `${row.sku} ${row.name}`.toLowerCase().includes(needle)) : list.rows;
	return (
		<AdminPage testId="stock-items-page">
			<PageHeader
				title="SKU Fisik"
				back={{ href: "/admin/catalog", label: "Produk" }}
				description="Barang fisik yang menjadi isi paket. SKU dibuat sekali dan tidak diubah; stok dan HPP dicatat terpisah per SKU."
				actions={
					<Button type="button" data-testid="stock-item-new" onClick={() => setCreate(true)}>
						<Plus aria-hidden="true" />
						Tambah SKU
					</Button>
				}
			/>
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="border-success/30 bg-success-surface outline-none" data-testid="stock-item-notice">
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			{!costs && (
				<p className="text-sm text-muted-foreground" data-testid="stock-items-no-costs">
					HPP dan asumsi biaya hanya terlihat oleh Super Admin dan staf keuangan dengan izin baca biaya.
				</p>
			)}
			<search className="flex max-w-md flex-col gap-1.5" aria-label="Cari SKU">
				<FormField
					id="stock-search"
					label="Cari SKU atau nama"
					hint={needle && list.paging.hasMore ? "Hasil hanya dari baris yang sudah dimuat. Muat baris berikutnya untuk mencari lebih banyak." : "Mencari di baris yang sudah dimuat."}
				>
					<div className="relative">
						<Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							id="stock-search"
							type="search"
							className="pl-8"
							autoComplete="off"
							aria-describedby="stock-search-hint"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
					</div>
				</FormField>
			</search>
			<DataTable
				testId="stock-items"
				caption="Daftar SKU fisik"
				rows={rows}
				rowKey={(row) => row.id}
				rowTestId={(row) => `stock-item-row-${row.sku}`}
				status={list.status}
				loadingLabel="Memuat SKU…"
				empty={needle ? "Tidak ada SKU yang cocok di baris yang sudah dimuat." : "Belum ada SKU fisik. Tambah SKU pertama dengan tombol di atas."}
				emptyTestId="stock-items-empty"
				stack
				paging={{ ...list.paging, testId: "stock-items-more", summary: `${list.rows.length} SKU dimuat` }}
				columns={[
					{ id: "sku", header: "SKU", stack: "title", className: "font-mono", cell: (row) => row.sku },
					{ id: "name", header: "Nama", stack: "plain", cellClassName: "whitespace-normal", cell: (row) => row.name },
					{
						id: "actions",
						header: <span className="sr-only">Tindakan</span>,
						className: "text-right",
						cell: (row) =>
							costs ? (
								<Button type="button" variant="outline" size="sm" data-testid={`stock-item-hpp-${row.sku}`} onClick={() => setOpen(row)}>
									<ReceiptText aria-hidden="true" />
									{costsWrite ? "HPP" : "Lihat HPP"}
									<span className="sr-only"> {row.sku}</span>
								</Button>
							) : null,
					},
				]}
			/>
			<p className="text-xs text-muted-foreground">
				SKU dipakai di isi paket pada{" "}
				<Link href="/admin/catalog" className="text-primary underline-offset-4 hover:underline">
					detail produk
				</Link>
				; stok per gudang ada di{" "}
				<Link href="/admin/inventory" className="text-primary underline-offset-4 hover:underline">
					Stok Gudang
				</Link>
				.
			</p>
			{create && (
				<CreateDialog
					onClose={() => setCreate(false)}
					onDone={(row) => {
						setCreate(false);
						list.setRows((rows) => [row, ...(rows ?? []).filter((r) => r.id !== row.id)]);
						setNotice(`SKU ${row.sku} dibuat. Isi HPP-nya sebelum paket yang memakainya diterbitkan.`);
					}}
				/>
			)}
			{open && (
				<Dialog open onOpenChange={(next) => !next && setOpen(null)}>
					<DialogContent className="md:max-h-[90dvh] md:max-w-3xl md:overflow-y-auto max-md:pb-4" data-testid="stock-item-hpp-dialog">
						<DialogHeader>
							<DialogTitle>HPP {open.sku}</DialogTitle>
							<DialogDescription>
								{open.name}. Versi biaya hanya berlaku ke depan; versi lama tetap tersimpan. Setiap pembukaan riwayat tercatat di log audit.
							</DialogDescription>
						</DialogHeader>
						<CostHistory kind="component" scopeId={open.id} subject={`${open.sku} (${open.name})`} canWrite={costsWrite} testId="hpp" />
					</DialogContent>
				</Dialog>
			)}
		</AdminPage>
	);
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: (row: StockItem) => void }) {
	const id = useId();
	const key = useOperationKey();
	const [sku, setSku] = useState("");
	const [name, setName] = useState("");
	const [problem, setProblem] = useState<{ sku?: string; name?: string }>({});
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	async function submit() {
		const found: typeof problem = {};
		if (!SKU_FORMAT.test(sku)) found.sku = "SKU hanya berisi huruf besar A–Z, angka, garis bawah atau tanda hubung (maks. 100).";
		if (!name.trim()) found.name = "Nama wajib diisi.";
		setProblem(found);
		if (found.sku || found.name) return;
		setPending(true);
		setError(null);
		const result = await send<StockItem>("POST", "/api/v1/admin/stock-items", { sku, name: name.trim() }, key);
		setPending(false);
		if (!result.ok) return setError(result.code === "CATALOG_IDENTITY_CONFLICT" ? `SKU ${sku} sudah dipakai. Gunakan kode lain. (kode: ${result.code})` : result.text);
		onDone(result.data);
	}
	return (
		<FormDialog
			title="Tambah SKU fisik"
			description="SKU dan nama tidak bisa diubah setelah dibuat. Stok masuk dan HPP dicatat setelahnya."
			pending={pending}
			error={error}
			submitLabel="Tambah SKU"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id={`${id}-sku`} label="SKU" hint={problem.sku ?? "Huruf besar, angka, _ dan -. Contoh: KOPI-ARABIKA-250."}>
				<Input
					id={`${id}-sku`}
					data-testid="stock-item-sku"
					className="font-mono"
					value={sku}
					maxLength={100}
					autoComplete="off"
					autoCapitalize="characters"
					aria-invalid={problem.sku ? true : undefined}
					aria-describedby={`${id}-sku-hint`}
					onChange={(event) => setSku(event.target.value.toUpperCase())}
				/>
			</FormField>
			<FormField id={`${id}-name`} label="Nama barang" hint={problem.name}>
				<Input
					id={`${id}-name`}
					data-testid="stock-item-name"
					value={name}
					maxLength={200}
					autoComplete="off"
					aria-invalid={problem.name ? true : undefined}
					aria-describedby={problem.name ? `${id}-name-hint` : undefined}
					onChange={(event) => setName(event.target.value)}
				/>
			</FormField>
		</FormDialog>
	);
}
