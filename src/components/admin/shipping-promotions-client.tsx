"use client";

import { CircleCheck, EllipsisVertical, Info, Plus, RefreshCw, X } from "lucide-react";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { rupiah, wibDateTime, wibInput, wibInputToIso } from "@/modules/storefront/format";
import { DataTable, type DataTableColumn } from "./data-table";
import { bpsToPercent, percentToBps } from "./format";
import { FormDialog, FormField, nativeSelectClass } from "./form";
import { send, useOperationKey } from "./ops-api";
import { districtRegionId, MAX_REGION_IDS, regionLabel } from "./promotion-regions";
import { AdminPage, PageHeader } from "./page-blocks";
import { StatusBadge, type StatusTone, useNow } from "./status";
import { useKeysetList } from "./use-keyset-list";

// S102 / spec 17 B12: versioned shipping subsidies. Every change (including ending a promo) appends a
// new configuration version with a reason; budget already reserved or used stays encumbered.
// S177: one screen, two modes over the same API: "automatic" (Promo Ongkir, code null) and "voucher" (a code the
// buyer types). Marketing (no `canDecide`) writes inactive proposals only; owner/ecommerce_admin approve or reject
// them. A running voucher keeps its terms: only the end (later), the budget (higher), the name, or ending it.

export type Option = { id: string; label: string };
export type PromotionMode = "automatic" | "voucher";
type Promotion = {
	id: string;
	version: number;
	name: string;
	active: boolean;
	starts_at: string;
	ends_at: string;
	kind: "fixed" | "percentage";
	value: number;
	maximum_per_order: number;
	minimum_merchandise: number;
	budget: number;
	per_buyer_limit: number;
	payment_methods: ("prepaid" | "cod")[];
	region_ids: string[];
	service_ids: string[];
	stacking: "exclusive" | "allowed";
	priority: number;
	reason: string;
	recorded_at: string;
	budget_state: { reserved: number; committed: number };
	code: string | null;
	proposed: boolean;
	used_count: number;
	/** A version of it has been active and started: a voucher's terms stay locked for good (S177 decision 8). */
	has_run: boolean;
	/** S177 2B: what the benefit reduces; `merchandise` = store voucher (product subtotal). */
	target?: "shipping" | "merchandise";
	/** Store vouchers, single reads only: worst case per live offer at the minimum purchase (S177 decision 10). */
	margin_preview?: { offers: number; unknown_contribution: number; below_floor: number; worst: { name: string; label: string; contribution_after: number; floor: number } | null };
};

// decideProposal records a rejection as an inactive, no longer proposed version with this reason prefix.
const REJECTED = "Ditolak: ";
function phase(p: Promotion, now: number | null): [string, StatusTone] {
	if (p.proposed) return ["Usulan menunggu persetujuan", "progress"];
	if (!p.active) return p.reason.startsWith(REJECTED) ? ["Ditolak", "danger"] : ["Dihentikan", "closed"];
	if (now !== null && Date.parse(p.ends_at) <= now) return ["Berakhir", "closed"];
	if (now !== null && Date.parse(p.starts_at) > now) return ["Terjadwal", "open"];
	return ["Berjalan", "success"];
}
/** Active and not yet over: can still be ended. */
const live = (p: Promotion, now: number | null) => p.active && (now === null || Date.parse(p.ends_at) > now);
const subject = (p: Pick<Promotion, "target">) => (p.target === "merchandise" ? "harga produk" : "ongkir");
const benefit = (p: Pick<Promotion, "kind" | "value" | "maximum_per_order" | "target">) =>
	p.kind === "fixed"
		? `Potongan ${subject(p)} ${rupiah(p.value)} per pesanan`
		: `Potongan ${subject(p)} ${bpsToPercent(p.value)}%, maks. ${rupiah(p.maximum_per_order)} per pesanan`;
const discount = (p: Promotion) =>
	p.kind === "fixed" ? rupiah(p.value) : `${bpsToPercent(p.value)}% maks ${rupiah(p.maximum_per_order)}`;
const METHODS: Record<string, string> = { prepaid: "Prabayar", cod: "COD" };
const APPROVERS = "Super Admin atau Admin E-Commerce";

type DialogState =
	| { kind: "create" }
	| { kind: "edit"; row: Promotion; focus?: "ends" | "budget" }
	| { kind: "end" | "history" | "approve" | "reject"; row: Promotion };

export function ShippingPromotionsClient({
	mode,
	canDecide,
	services,
	regions,
	districts = false,
}: {
	mode: PromotionMode;
	/** Owner or ecommerce_admin: approve/reject proposals and change running promotions. */
	canDecide: boolean;
	services: Option[];
	regions: Option[];
	/** Real Mengantar catalogue: the form also targets kecamatan (`dist-…` region ids). */
	districts?: boolean;
}) {
	// lazy: the list API has no code filter, so each page of 100 is split here by `code`; a server-side filter
	// replaces this when promotions outgrow a few pages.
	const list = useKeysetList<Promotion>("/api/v1/admin/shipping-promotions?limit=100", (p) => p.id);
	const rows = list.rows.filter((p) => (mode === "voucher" ? p.code != null : p.code == null));
	const now = useNow();
	const [notice, setNotice] = useState<string | null>(null);
	const [dialog, setDialog] = useState<DialogState | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);
	const done = (message: string) => {
		setDialog(null);
		setNotice(message);
		void list.reload();
	};
	const voucher = mode === "voucher";
	const noun = voucher ? "voucher" : "promo";
	const title = (p: Promotion) => (voucher ? (p.code ?? p.name) : p.name);
	const label = (options: Option[], ids: string[], all: string) =>
		ids.length ? ids.map((id) => regionLabel(id, options)).join(", ") : all;
	const waiting = rows.filter((p) => p.proposed).length;
	const status: DataTableColumn<Promotion> = {
		id: "status",
		header: "Status",
		stack: "status",
		cell: (p) => {
			const [text, tone] = phase(p, now);
			return <StatusBadge tone={tone}>{text}</StatusBadge>;
		},
	};
	const period: DataTableColumn<Promotion> = {
		id: "period",
		header: voucher ? "Periode (WIB)" : "Periode",
		stack: "meta",
		kind: "datetime",
		cell: (p) => (
			<span className="flex flex-col max-md:flex-row max-md:flex-wrap max-md:gap-x-1">
				<span>{wibDateTime(p.starts_at)}</span>
				<span className="text-muted-foreground">s.d. {wibDateTime(p.ends_at)}</span>
			</span>
		),
	};
	const budget: DataTableColumn<Promotion> = {
		id: "budget",
		// The voucher header wraps so the column stays as wide as its amounts.
		header: voucher ? <span className="inline-block whitespace-normal">Kuota anggaran terpakai</span> : "Anggaran terpakai",
		stack: "aside",
		className: "text-right tabular-nums",
		cell: (p) => (
			<span className="flex flex-col items-end">
				{rupiah(p.budget_state.committed + p.budget_state.reserved)}
				<span className="text-xs font-normal text-muted-foreground">dari {rupiah(p.budget)}</span>
			</span>
		),
	};
	const actions: DataTableColumn<Promotion> = {
		id: "actions",
		header: "Tindakan",
		className: "text-right",
		cell: (p) => {
			const locked = voucher && p.has_run;
			// Marketing never touches an active promotion or a voucher that has run (the API refuses both). Approvers edit
			// everything except a proposal (approve or reject: an edit would record no decision); a voucher that has run gets
			// Perpanjang / Tambah anggaran (the same locked form) instead of a general "Ubah".
			const editable = canDecide ? !p.proposed && !locked : !p.active && !locked;
			const all: { id: string; label: string; primary?: boolean; open: () => void }[] = [
				...(canDecide && p.proposed
					? [
							{ id: "approve", label: "Setujui & jalankan", primary: true, open: () => setDialog({ kind: "approve", row: p }) },
							{ id: "reject", label: "Tolak", open: () => setDialog({ kind: "reject", row: p }) },
						]
					: []),
				...(editable ? [{ id: "edit", label: "Ubah", open: () => setDialog({ kind: "edit", row: p }) }] : []),
				...(canDecide && locked
					? [
							{ id: "extend", label: "Perpanjang", open: () => setDialog({ kind: "edit", row: p, focus: "ends" }) },
							{ id: "budget", label: "Tambah anggaran", open: () => setDialog({ kind: "edit", row: p, focus: "budget" }) },
						]
					: []),
				...(canDecide && live(p, now)
					? [{ id: "end", label: voucher ? "Akhiri voucher" : "Akhiri", open: () => setDialog({ kind: "end", row: p }) }]
					: []),
				{ id: "history", label: "Riwayat", open: () => setDialog({ kind: "history", row: p }) },
			];
			// Up to three buttons stay on one line; a fourth sends the rest to a menu.
			const shown = all.length > 3 ? all.slice(0, 2) : all;
			const more = all.slice(shown.length);
			return (
				<div className="flex justify-end gap-2 max-md:w-full">
					{shown.map((a) => (
						<Button key={a.id} size="sm" className="md:whitespace-nowrap" variant={a.primary ? "default" : "outline"} data-testid={`promotion-${a.id}-${p.id}`} onClick={a.open}>
							{a.label}
						</Button>
					))}
					{more.length > 0 && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									size="icon-sm"
									variant="outline"
									className="max-md:flex-none!"
									aria-label={`Tindakan lain untuk ${title(p)}`}
									data-testid={`promotion-more-${p.id}`}
								>
									<EllipsisVertical aria-hidden="true" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{more.map((a) => (
									<DropdownMenuItem key={a.id} data-testid={`promotion-${a.id}-${p.id}`} onSelect={a.open}>
										{a.label}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			);
		},
	};
	const columns: DataTableColumn<Promotion>[] = voucher
		? [
				{
					id: "code",
					header: "Kode",
					stack: "title",
					cellClassName: "whitespace-normal md:max-w-56",
					cell: (p) => (
						<div className="flex flex-col">
							<span className="font-mono font-semibold tracking-wide">{p.code}</span>
							<span className="text-xs font-normal text-muted-foreground">{p.name}</span>
						</div>
					),
				},
				{
					id: "discount",
					header: "Potongan",
					cellClassName: "tabular-nums",
					cell: (p) => (
						<span className="flex flex-col max-md:items-end">
							{discount(p)}
							<span className="text-xs text-muted-foreground">
								{voucher ? `${p.target === "merchandise" ? "harga produk" : "ongkir"} · ` : ""}
								{p.minimum_merchandise ? `min. belanja ${rupiah(p.minimum_merchandise)}` : "tanpa min. belanja"}
							</span>
						</span>
					),
				},
				period,
				budget,
				// Lowest priority on a mid-width frame (still on the phone card and from an 80rem frame).
				{ id: "used", header: "Dipakai", hideBelow: "7xl", className: "text-right tabular-nums", cell: (p) => `${p.used_count} pesanan` },
				status,
				actions,
			]
		: [
				{
					id: "name",
					header: "Promo",
					stack: "title",
					cellClassName: "whitespace-normal md:max-w-72",
					cell: (p) => (
						<div className="flex flex-col">
							<span className="font-medium">{p.name}</span>
							<span className="text-xs font-normal text-muted-foreground">{benefit(p)}</span>
						</div>
					),
				},
				budget,
				period,
				status,
				{
					id: "rules",
					header: "Berlaku untuk",
					hideBelow: "7xl",
					cellClassName: "whitespace-normal text-xs md:max-w-60",
					cell: (p) =>
						`${p.payment_methods.map((m) => METHODS[m] ?? m).join(" dan ")} · ${label(regions, p.region_ids, "semua wilayah")} · ${label(services, p.service_ids, "semua layanan")}${p.minimum_merchandise ? ` · min. belanja ${rupiah(p.minimum_merchandise)}` : ""}`,
				},
				actions,
			];
	return (
		<AdminPage testId={voucher ? "vouchers-page" : "shipping-promotions-page"}>
			<PageHeader
				title={voucher ? "Voucher" : "Promo Ongkir"}
				description={
					voucher
						? "Kode potongan ongkir yang diketik pembeli saat checkout. Satu voucher per pesanan; bila ada promo ongkir otomatis, pembeli mendapat potongan yang lebih besar. Setiap perubahan disimpan sebagai versi baru dengan alasan."
						: "Subsidi ongkir yang dipotong saat pembeli membayar pesanan. Setiap perubahan disimpan sebagai versi baru dengan alasan; pesanan yang sudah dibuat tetap memakai promo saat itu."
				}
				actions={
					<Button data-testid="promotion-create" onClick={() => setDialog({ kind: "create" })}>
						<Plus data-icon="inline-start" aria-hidden="true" />
						{canDecide ? `Buat ${noun}` : "Buat usulan"}
					</Button>
				}
			/>
			{!canDecide && (
				<Alert data-testid="proposal-info">
					<Info aria-hidden="true" />
					<AlertDescription className="text-foreground">
						Anda membuat usulan. Usulan berjalan setelah disetujui {APPROVERS}. {voucher ? "Voucher" : "Promo"} yang aktif hanya bisa
						diubah oleh mereka.
					</AlertDescription>
				</Alert>
			)}
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="border-success/30 bg-success-surface outline-none">
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			<section aria-labelledby="promotions-heading" className="flex flex-col gap-4">
				<div className="flex items-start justify-between gap-3">
					<div className="flex flex-col gap-0.5">
						<h2 id="promotions-heading" className="text-base font-semibold">
							{voucher ? "Daftar voucher" : "Daftar promo"}
						</h2>
						{canDecide && waiting > 0 && (
							<p className="text-sm text-muted-foreground" data-testid="proposals-waiting">
								{waiting} usulan menunggu persetujuan Anda.
							</p>
						)}
					</div>
					<Button variant="outline" className="shrink-0" onClick={() => void list.reload()}>
						<RefreshCw aria-hidden="true" />
						Muat ulang
					</Button>
				</div>
				<DataTable
					rows={rows}
					rowKey={(p) => p.id}
					status={list.status}
					paging={{ ...list.paging, testId: "promotions-more" }}
					loadingLabel={voucher ? "Memuat voucher…" : "Memuat promo…"}
					empty={
						voucher
							? list.paging.hasMore
								? "Belum ada voucher di halaman ini. Pilih Muat lebih banyak untuk melihat sisanya."
								: `Belum ada voucher. Pilih ${canDecide ? "Buat voucher" : "Buat usulan"} untuk membuat kode potongan ongkir.`
							: list.paging.hasMore
								? "Belum ada promo ongkir di halaman ini. Pilih Muat lebih banyak untuk melihat sisanya."
								: `Belum ada promo ongkir. Pilih ${canDecide ? "Buat promo" : "Buat usulan"} untuk memberi potongan ongkir pada pesanan baru.`
					}
					testId={voucher ? "vouchers" : "shipping-promotions"}
					rowTestId={(p) => `promotion-row-${p.id}`}
					caption={voucher ? "Voucher" : "Promo ongkir"}
					stack
					columns={columns}
				/>
			</section>
			{(dialog?.kind === "create" || dialog?.kind === "edit") && (
				<PromotionDialog
					key={dialog.kind === "edit" ? `${dialog.row.id}:${dialog.focus ?? ""}` : "create"}
					mode={mode}
					canDecide={canDecide}
					row={dialog.kind === "edit" ? dialog.row : undefined}
					locked={dialog.kind === "edit" && voucher && dialog.row.has_run}
					focus={dialog.kind === "edit" ? dialog.focus : undefined}
					services={services}
					regions={regions}
					districts={districts}
					onClose={() => setDialog(null)}
					onDone={done}
				/>
			)}
			{dialog?.kind === "end" && <EndDialog noun={noun} label={title(dialog.row)} row={dialog.row} onClose={() => setDialog(null)} onDone={done} />}
			{(dialog?.kind === "approve" || dialog?.kind === "reject") && (
				<DecisionDialog
					decision={dialog.kind}
					noun={noun}
					label={title(dialog.row)}
					row={dialog.row}
					onClose={() => setDialog(null)}
					onDone={done}
				/>
			)}
			{dialog?.kind === "history" && <HistoryDialog noun={noun} label={title(dialog.row)} row={dialog.row} onClose={() => setDialog(null)} />}
		</AdminPage>
	);
}

/** The full configuration body the versioned API takes, from a saved version. */
const body = (p: Promotion) => ({
	name: p.name,
	active: p.active,
	starts_at: p.starts_at,
	ends_at: p.ends_at,
	kind: p.kind,
	value: p.value,
	maximum_per_order: p.maximum_per_order,
	minimum_merchandise: p.minimum_merchandise,
	budget: p.budget,
	per_buyer_limit: p.per_buyer_limit,
	payment_methods: p.payment_methods,
	region_ids: p.region_ids,
	service_ids: p.service_ids,
	stacking: p.stacking,
	priority: p.priority,
	...(p.code ? { code: p.code } : {}),
	...(p.target ? { target: p.target } : {}),
});
const idr = (value: string) => (/^\d{1,15}$/.test(value.trim()) ? Number(value) : null);
const CODE = /^[A-Z0-9][A-Z0-9-]{2,31}$/;

function PromotionDialog({
	mode,
	canDecide,
	row,
	locked,
	focus,
	services,
	regions,
	districts,
	onClose,
	onDone,
}: {
	mode: PromotionMode;
	canDecide: boolean;
	row?: Promotion;
	/** A running voucher: only name, end (later) and budget (higher) move. */
	locked: boolean;
	focus?: "ends" | "budget";
	services: Option[];
	regions: Option[];
	districts: boolean;
	onClose: () => void;
	onDone: (message: string) => void;
}) {
	const voucher = mode === "voucher";
	const noun = voucher ? "voucher" : "promo";
	const [initial] = useState(() => ({
		code: row?.code ?? "",
		name: row?.name ?? "",
		// Marketing writes proposals, which are always inactive (the API refuses active:true).
		active: canDecide ? (row?.active ?? true) : false,
		starts: row ? wibInput(row.starts_at) : "",
		ends: row ? wibInput(row.ends_at) : "",
		target: row?.target ?? ("shipping" as "shipping" | "merchandise"),
		kind: row?.kind ?? ("fixed" as "fixed" | "percentage"),
		value: row ? (row.kind === "percentage" ? bpsToPercent(row.value) : String(row.value)) : "",
		maximum: row ? String(row.maximum_per_order) : "",
		minimum: row ? String(row.minimum_merchandise) : "0",
		budget: row ? String(row.budget) : "",
		perBuyer: row ? String(row.per_buyer_limit) : "1",
		methods: row?.payment_methods ?? (["prepaid", "cod"] as string[]),
		regions: row?.region_ids ?? ([] as string[]),
		services: row?.service_ids ?? ([] as string[]),
		stacking: row?.stacking ?? ("exclusive" as "exclusive" | "allowed"),
		priority: row ? String(row.priority) : "0",
		reason: "",
	}));
	const [form, setForm] = useState(initial);
	const dirty = JSON.stringify(form) !== JSON.stringify(initial);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const key = useOperationKey();
	const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
		setForm({ ...form, [field]: e.target.value });
	const toggle = (field: "methods" | "regions" | "services", id: string) =>
		setForm({ ...form, [field]: form[field].includes(id) ? form[field].filter((x) => x !== id) : [...form[field], id] });
	async function submit() {
		const code = form.code.normalize("NFKC").trim().toUpperCase();
		const starts = wibInputToIso(form.starts);
		const ends = wibInputToIso(form.ends);
		const value = form.kind === "percentage" ? percentToBps(form.value) : idr(form.value);
		const maximum = form.kind === "fixed" ? value : idr(form.maximum);
		const [minimum, budget, perBuyer, priority] = [idr(form.minimum), idr(form.budget), idr(form.perBuyer), idr(form.priority)];
		if (voucher && !row && !CODE.test(code)) return setError("Kode 3–32 huruf, angka atau tanda hubung, diawali huruf atau angka.");
		if (!form.name.trim()) return setError(`Nama ${noun} wajib diisi.`);
		if (!starts || !ends || starts >= ends) return setError("Isi waktu mulai dan selesai (WIB); selesai harus setelah mulai.");
		if (value === null || maximum === null) return setError(form.kind === "percentage" ? "Persen 0–100 (maks. dua desimal) dan potongan maksimum dalam rupiah." : "Potongan diisi rupiah, angka saja.");
		if (minimum === null || budget === null) return setError("Minimum belanja dan anggaran diisi rupiah, angka saja.");
		if (perBuyer === null || perBuyer < 1 || perBuyer > 1_000_000) return setError("Batas per pembeli 1–1.000.000 kali.");
		if (priority === null || priority > 10_000) return setError("Prioritas 0–10.000.");
		if (!form.methods.length) return setError("Pilih minimal satu metode pembayaran.");
		if (form.regions.length > MAX_REGION_IDS) return setError(`Maksimal ${MAX_REGION_IDS} provinsi dan kecamatan.`);
		if (row && locked && Date.parse(ends) < Date.parse(row.ends_at)) return setError("Voucher yang berjalan hanya bisa diperpanjang; selesai tidak boleh lebih awal.");
		if (row && locked && budget < row.budget) return setError("Anggaran voucher yang berjalan hanya bisa ditambah.");
		if (form.active && (!value || !maximum || !budget)) return setError(`${voucher ? "Voucher" : "Promo"} aktif perlu potongan, potongan maksimum dan anggaran lebih dari nol.`);
		// S177 decision 1: a percentage store voucher needs a cap that covers that percentage of the minimum purchase.
		if (voucher && form.target === "merchandise" && form.kind === "percentage" && value && (!maximum || maximum * 10_000 < value * minimum))
			return setError("Potongan maksimum harus minimal persen × minimum belanja.");
		if (!form.reason.trim()) return setError("Alasan wajib diisi.");
		setPending(true);
		setError(null);
		const config = {
			name: form.name.trim(),
			active: form.active,
			starts_at: starts,
			ends_at: ends,
			kind: form.kind,
			value,
			maximum_per_order: maximum,
			minimum_merchandise: minimum,
			budget,
			per_buyer_limit: perBuyer,
			payment_methods: [...form.methods].sort(),
			region_ids: [...form.regions].sort(),
			service_ids: [...form.services].sort(),
			stacking: form.stacking,
			priority,
			reason: form.reason.trim(),
			...(voucher ? { target: form.target } : {}),
			expected_version: row?.version ?? 0,
			// The code is set at creation; later versions repeat it.
			...(voucher ? { code: row?.code ?? code } : {}),
		};
		const result = await send<Promotion>(
			"POST",
			row ? `/api/v1/admin/shipping-promotions/${row.id}/versions` : "/api/v1/admin/shipping-promotions",
			config,
			key,
		);
		setPending(false);
		if (!result.ok) return setError(result.text);
		const what = voucher ? `Voucher ${result.data.code ?? code}` : `Promo ${result.data.name}`;
		if (!canDecide) return onDone(`Usulan ${what.charAt(0).toLowerCase()}${what.slice(1)} dikirim. Menunggu persetujuan ${APPROVERS}.`);
		onDone(row ? `${what} disimpan sebagai versi ${result.data.version}.` : `${what} dibuat.`);
	}
	const check = (field: "methods" | "regions" | "services", options: Option[], legend: string, hint?: string) => (
		<fieldset className="flex flex-col gap-1.5" disabled={locked}>
			<legend className="text-sm font-medium">{legend}</legend>
			{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
			<div className="flex flex-wrap gap-x-4">
				{options.map((o) => (
					<label key={o.id} className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
						<input type="checkbox" className="size-4 accent-primary" checked={form[field].includes(o.id)} onChange={() => toggle(field, o.id)} />
						{o.label}
					</label>
				))}
			</div>
		</fieldset>
	);
	const used = row ? row.budget_state.committed + row.budget_state.reserved : 0;
	const subject = voucher ? `voucher ${row?.code ?? ""}`.trim() : `promo ${row?.name ?? ""}`.trim();
	const dialogTitle = !row
		? canDecide
			? voucher
				? "Buat voucher"
				: "Buat promo ongkir"
			: voucher
				? "Usulkan voucher"
				: "Usulkan promo ongkir"
		: focus === "ends"
			? `Perpanjang ${subject}`
			: focus === "budget"
				? `Tambah anggaran ${subject}`
				: `Ubah ${subject}`;
	const description = row
		? `Versi ${row.version}. Perubahan berlaku untuk pesanan berikutnya. Anggaran minimal ${rupiah(locked ? row.budget : used)}${locked ? "" : " (sudah dipesan atau terpakai)"}.`
		: "Potongan dibayar toko dari anggaran dan dibatasi per pesanan dan per pembeli.";
	return (
		<FormDialog
			title={dialogTitle}
			description={`${description}${canDecide ? "" : ` Usulan berjalan setelah disetujui ${APPROVERS}.`}`}
			pending={pending}
			error={error}
			submitLabel={!canDecide ? "Kirim usulan" : row ? "Simpan versi baru" : voucher ? "Buat voucher" : "Buat promo"}
			dirty={dirty}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			{locked && (
				<p className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="voucher-locked">
					Voucher yang sedang berjalan hanya bisa diperpanjang, ditambah anggarannya, atau diakhiri. Potongan, syarat dan
					wilayah terkunci.
				</p>
			)}
			{voucher &&
				(row ? (
					<p className="text-sm">
						Kode <span className="font-mono font-semibold">{row.code}</span> tidak bisa diubah.
					</p>
				) : (
					<FormField id="promo-code" label="Kode voucher" hint="3–32 huruf, angka atau tanda hubung. Pembeli mengetik kode ini saat checkout; tidak bisa diubah setelah dibuat.">
						<Input
							id="promo-code"
							maxLength={32}
							autoCapitalize="characters"
							autoComplete="off"
							spellCheck={false}
							aria-describedby="promo-code-hint"
							className="font-mono uppercase"
							value={form.code}
							onChange={set("code")}
						/>
					</FormField>
				))}
			<FormField id="promo-name" label={voucher ? "Nama voucher" : "Nama promo"} hint={voucher ? "Untuk tim; pembeli melihat kodenya." : undefined}>
				<Input id="promo-name" maxLength={200} aria-describedby={voucher ? "promo-name-hint" : undefined} value={form.name} onChange={set("name")} />
			</FormField>
			{canDecide && !locked && (
				<label className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
					<input type="checkbox" className="size-4 accent-primary" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
					Aktif (berlaku untuk pesanan baru selama periode)
				</label>
			)}
			<div className="grid gap-3 sm:grid-cols-2">
				<FormField id="promo-starts" label="Mulai (WIB)">
					<Input id="promo-starts" type="datetime-local" lang="id" disabled={locked} value={form.starts} onChange={set("starts")} />
				</FormField>
				<FormField id="promo-ends" label="Selesai (WIB)">
					<Input id="promo-ends" type="datetime-local" lang="id" autoFocus={focus === "ends"} value={form.ends} onChange={set("ends")} />
				</FormField>
			</div>
			{voucher && (
				<FormField
					id="promo-target"
					label="Voucher untuk"
					hint={form.target === "merchandise" ? "Memotong harga produk; bisa digabung dengan gratis ongkir otomatis." : "Memotong ongkir; pembeli dapat yang lebih besar antara voucher ini dan promo ongkir otomatis."}
				>
					<select id="promo-target" className={`${nativeSelectClass} w-full`} disabled={locked || Boolean(row?.has_run)} aria-describedby="promo-target-hint" value={form.target} onChange={set("target")}>
						<option value="shipping">Ongkir</option>
						<option value="merchandise">Harga produk</option>
					</select>
				</FormField>
			)}
			<div className="grid gap-3 sm:grid-cols-2">
				<FormField id="promo-kind" label="Jenis potongan">
					<select id="promo-kind" className={`${nativeSelectClass} w-full`} disabled={locked} value={form.kind} onChange={set("kind")}>
						<option value="fixed">Nominal (Rp)</option>
						<option value="percentage">{form.target === "merchandise" ? "Persen harga produk" : "Persen ongkir"}</option>
					</select>
				</FormField>
				<FormField
					id="promo-value"
					label={form.kind === "fixed" ? "Potongan per pesanan (Rp)" : "Potongan (%)"}
					hint={voucher ? (form.target === "merchandise" ? "Dipotong dari total harga produk; setiap barang tetap minimal Rp1." : "Dipotong dari ongkir, tidak lebih dari ongkirnya.") : undefined}
				>
					<Input
						id="promo-value"
						inputMode={form.kind === "fixed" ? "numeric" : "decimal"}
						aria-describedby={voucher ? "promo-value-hint" : undefined}
						disabled={locked}
						value={form.value}
						onChange={set("value")}
					/>
				</FormField>
			</div>
			{form.kind === "percentage" && (
				<FormField id="promo-maximum" label="Potongan maksimum per pesanan (Rp)">
					<Input id="promo-maximum" inputMode="numeric" disabled={locked} value={form.maximum} onChange={set("maximum")} />
				</FormField>
			)}
			<div className="grid gap-3 sm:grid-cols-2">
				<FormField id="promo-minimum" label="Minimum belanja (Rp)" hint={voucher ? "Total harga barang sebelum ongkir. 0 = tanpa minimum." : undefined}>
					<Input
						id="promo-minimum"
						inputMode="numeric"
						aria-describedby={voucher ? "promo-minimum-hint" : undefined}
						disabled={locked}
						value={form.minimum}
						onChange={set("minimum")}
					/>
				</FormField>
				<FormField id="promo-budget" label="Anggaran total (Rp)" hint={locked ? `Minimal ${rupiah(row?.budget ?? 0)}; hanya bisa ditambah.` : undefined}>
					<Input
						id="promo-budget"
						inputMode="numeric"
						autoFocus={focus === "budget"}
						aria-describedby={locked ? "promo-budget-hint" : undefined}
						value={form.budget}
						onChange={set("budget")}
					/>
				</FormField>
				<FormField id="promo-per-buyer" label="Batas per pembeli (kali)" hint={voucher ? "Dihitung per nomor WhatsApp pembeli." : undefined}>
					<Input
						id="promo-per-buyer"
						inputMode="numeric"
						aria-describedby={voucher ? "promo-per-buyer-hint" : undefined}
						disabled={locked}
						value={form.perBuyer}
						onChange={set("perBuyer")}
					/>
				</FormField>
				{/* One voucher per order and no stacking with automatic promotions (decision 4): priority and stacking
				    only matter between automatic promotions. */}
				{!voucher && (
					<FormField id="promo-priority" label="Prioritas" hint="Angka lebih besar dipakai lebih dulu.">
						<Input id="promo-priority" inputMode="numeric" aria-describedby="promo-priority-hint" value={form.priority} onChange={set("priority")} />
					</FormField>
				)}
			</div>
			{check("methods", [{ id: "prepaid", label: "Prabayar" }, { id: "cod", label: "COD" }], "Metode pembayaran")}
			{regions.length > 0 && check("regions", regions, voucher ? "Provinsi tujuan" : "Wilayah tujuan", "Kosongkan untuk semua wilayah.")}
			{districts && (
				<DistrictPicker
					noun={voucher ? "Voucher" : "Promo"}
					disabled={locked}
					regions={regions}
					selected={form.regions}
					onChange={(next) => setForm({ ...form, regions: next })}
				/>
			)}
			{services.length > 0 && check("services", services, "Layanan kirim", "Kosongkan untuk semua layanan.")}
			{!voucher && (
				<FormField id="promo-stacking" label="Gabung dengan promo lain">
					<select id="promo-stacking" className={`${nativeSelectClass} w-full`} value={form.stacking} onChange={set("stacking")}>
						<option value="exclusive">Tidak (promo ini sendiri)</option>
						<option value="allowed">Boleh digabung</option>
					</select>
				</FormField>
			)}
			<FormField id="promo-reason" label="Alasan">
				<Input id="promo-reason" maxLength={500} value={form.reason} onChange={set("reason")} />
			</FormField>
		</FormDialog>
	);
}

function EndDialog({ noun, label, row, onClose, onDone }: { noun: string; label: string; row: Promotion; onClose: () => void; onDone: (message: string) => void }) {
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const key = useOperationKey();
	async function submit() {
		if (!reason.trim()) return setError("Alasan wajib diisi.");
		setPending(true);
		setError(null);
		const result = await send<Promotion>(
			"POST",
			`/api/v1/admin/shipping-promotions/${row.id}/versions`,
			{ ...body(row), active: false, reason: reason.trim(), expected_version: row.version },
			key,
		);
		setPending(false);
		if (!result.ok) return setError(result.text);
		onDone(`${noun === "voucher" ? "Voucher" : "Promo"} ${label} diakhiri (versi ${result.data.version}).`);
	}
	return (
		<FormDialog
			title={`Akhiri ${noun} ${label}`}
			description={`${noun === "voucher" ? "Voucher" : "Promo"} tidak lagi dipakai untuk pesanan berikutnya. Potongan yang sudah dipesan pembeli tetap berlaku; riwayat versi tetap tersimpan.${noun === "voucher" ? "" : " Untuk memakainya lagi, aktifkan lewat Ubah."}`}
			pending={pending}
			error={error}
			submitLabel={`Akhiri ${noun}`}
			destructive
			dirty={Boolean(reason.trim())}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id="end-reason" label="Alasan">
				<Input id="end-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}

function DecisionDialog({
	decision,
	noun,
	label,
	row,
	onClose,
	onDone,
}: {
	decision: "approve" | "reject";
	noun: string;
	label: string;
	row: Promotion;
	onClose: () => void;
	onDone: (message: string) => void;
}) {
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const key = useOperationKey();
	const approve = decision === "approve";
	// S177 decision 10: approving a store voucher accepts its margin; show the worst case first (single read computes it).
	const [preview, setPreview] = useState<Promotion["margin_preview"] | "loading" | "error" | "hidden">(approve && row.target === "merchandise" ? "loading" : undefined);
	useEffect(() => {
		if (!(approve && row.target === "merchandise")) return;
		const controller = new AbortController();
		fetch(`/api/v1/admin/shipping-promotions/${row.id}`, { signal: controller.signal, headers: { accept: "application/json" } })
			.then(async (response) => {
				if (!response.ok) throw new Error(String(response.status));
				// Cost and contribution data are for finance.costs.read holders (Super Admin) only (IAM spec 07).
				setPreview(((await response.json()) as Promotion).margin_preview ?? "hidden");
			})
			.catch(() => {
				if (!controller.signal.aborted) setPreview("error");
			});
		return () => controller.abort();
	}, [approve, row.id, row.target]);
	async function submit() {
		if (!reason.trim()) return setError("Alasan wajib diisi.");
		setPending(true);
		setError(null);
		const result = await send<Promotion>(
			"POST",
			`/api/v1/admin/shipping-promotions/${row.id}/decisions`,
			{ expected_version: row.version, decision, reason: reason.trim() },
			key,
		);
		setPending(false);
		if (!result.ok) return setError(result.text);
		onDone(approve ? `Usulan ${noun} ${label} disetujui dan dijalankan (versi ${result.data.version}).` : `Usulan ${noun} ${label} ditolak.`);
	}
	return (
		<FormDialog
			title={approve ? `Setujui & jalankan ${noun} ${label}` : `Tolak usulan ${noun} ${label}`}
			description={
				approve
					? `${noun === "voucher" ? "Voucher" : "Promo"} berlaku untuk pesanan baru mulai ${wibDateTime(row.starts_at)} sampai ${wibDateTime(row.ends_at)}.`
					: "Usulan tidak dijalankan. Pengusul melihat alasan Anda di riwayat dan bisa mengirim usulan baru."
			}
			pending={pending}
			error={error}
			submitLabel={approve ? "Setujui & jalankan" : "Tolak usulan"}
			destructive={!approve}
			dirty={Boolean(reason.trim())}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border bg-muted/40 p-3 text-sm" data-testid="proposal-terms">
				{row.code && (
					<>
						<dt className="text-muted-foreground">Kode</dt>
						<dd className="font-mono font-semibold">{row.code}</dd>
					</>
				)}
				<dt className="text-muted-foreground">Nama</dt>
				<dd>{row.name}</dd>
				<dt className="text-muted-foreground">Potongan</dt>
				<dd>{benefit(row)}</dd>
				<dt className="text-muted-foreground">Min. belanja</dt>
				<dd>{row.minimum_merchandise ? rupiah(row.minimum_merchandise) : "Tanpa minimum"}</dd>
				<dt className="text-muted-foreground">Anggaran</dt>
				<dd>{rupiah(row.budget)}</dd>
				<dt className="text-muted-foreground">Per pembeli</dt>
				<dd>{row.per_buyer_limit} kali</dd>
				<dt className="text-muted-foreground">Pembayaran</dt>
				<dd>{row.payment_methods.map((m) => METHODS[m] ?? m).join(" dan ")}</dd>
				<dt className="text-muted-foreground">Alasan usulan</dt>
				<dd className="break-words">{row.reason}</dd>
			</dl>
			{preview !== undefined && (
				<Alert data-testid="margin-preview" variant={typeof preview === "object" && preview.below_floor > 0 ? "destructive" : "default"}>
					<Info className="size-4" aria-hidden />
					<AlertDescription>
						{preview === "loading"
							? "Menghitung dampak ke margin…"
							: preview === "hidden"
								? "Dampak ke margin hanya terlihat oleh Super Admin (data biaya). Menyetujui voucher ini berarti menerima marginnya."
								: preview === "error" || !preview
								? "Dampak ke margin belum dapat dihitung. Muat ulang lalu buka lagi."
								: preview.below_floor > 0
									? `Pada potongan maksimum, ${preview.below_floor} dari ${preview.offers} produk aktif turun di bawah batas margin. Terendah: ${preview.worst?.name}${preview.worst?.label ? ` (${preview.worst.label})` : ""}, ${rupiah(preview.worst?.contribution_after ?? 0)} per barang (batas ${rupiah(preview.worst?.floor ?? 0)}). Menyetujui berarti menerima margin ini.`
									: `Semua ${preview.offers - preview.unknown_contribution} produk dengan biaya lengkap tetap di atas batas margin pada potongan maksimum.`}
						{typeof preview === "object" && preview && preview.unknown_contribution > 0 && ` ${preview.unknown_contribution} produk belum punya data biaya.`}
					</AlertDescription>
				</Alert>
			)}
			<FormField id="decision-reason" label={approve ? "Alasan persetujuan" : "Alasan penolakan"}>
				<Input id="decision-reason" maxLength={480} value={reason} onChange={(e) => setReason(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}

function HistoryDialog({ noun, label, row, onClose }: { noun: string; label: string; row: Promotion; onClose: () => void }) {
	const list = useKeysetList<Promotion>(`/api/v1/admin/shipping-promotions/${row.id}/versions?limit=20`, (p) => String(p.version));
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="md:max-h-[90dvh] md:max-w-2xl md:overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						Riwayat {noun} {label}
					</DialogTitle>
					<DialogDescription>Versi terbaru di atas. Versi lama tidak bisa diubah.</DialogDescription>
				</DialogHeader>
				<DataTable
					rows={list.rows}
					rowKey={(p) => String(p.version)}
					status={list.status}
					paging={{ ...list.paging, testId: "promotion-history-more" }}
					loadingLabel="Memuat riwayat…"
					empty={`Riwayat versi ${noun} ini belum tersedia. Muat ulang daftar lalu buka lagi.`}
					testId="promotion-history"
					caption={`Riwayat versi ${noun}`}
					stack
					columns={[
						{
							id: "version",
							header: "Versi",
							stack: "title",
							cellClassName: "whitespace-normal",
							cell: (p) => (
								<div className="flex flex-col">
									<span>
										Versi {p.version} · {p.proposed ? "usulan" : p.active ? "aktif" : "nonaktif"}
									</span>
									<span className="text-xs font-normal text-muted-foreground">{p.reason}</span>
								</div>
							),
						},
						{ id: "budget", header: "Anggaran", stack: "aside", className: "text-right tabular-nums", cell: (p) => rupiah(p.budget) },
						{ id: "when", header: "Dicatat", stack: "meta", kind: "datetime", cell: (p) => wibDateTime(p.recorded_at) },
						{ id: "benefit", header: "Potongan", cellClassName: "whitespace-normal text-xs", cell: benefit },
					]}
				/>
			</DialogContent>
		</Dialog>
	);
}

type DistrictHit = { id: string; label: string; province: string; city: string; district: string };

// S177 leftovers: kecamatan targeting. Searches the checkout's kecamatan lookup and stores `dist-…` region ids next to
// the chosen provinces in `region_ids`; a stored id the catalogue no longer names shows as its raw id.
function DistrictPicker({
	noun,
	disabled,
	regions,
	selected,
	onChange,
}: {
	noun: string;
	disabled: boolean;
	regions: Option[];
	selected: string[];
	onChange: (next: string[]) => void;
}) {
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<DistrictHit[]>([]);
	const [status, setStatus] = useState("");
	const [names, setNames] = useState<Record<string, string>>({});
	const provinces = new Set(regions.map((o) => o.id));
	const chips = selected.filter((id) => !provinces.has(id));
	const full = selected.length >= MAX_REGION_IDS;
	useEffect(() => {
		const q = query.trim();
		if (q.replace(/[^\p{L}\p{N}]/gu, "").length < 2) {
			setHits([]);
			setStatus("");
			return;
		}
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			setStatus("Mencari kecamatan…");
			try {
				const response = await fetch(`/api/v1/destinations?q=${encodeURIComponent(q)}&group=district&limit=8`, {
					signal: controller.signal,
					headers: { accept: "application/json" },
				});
				if (!response.ok) throw new Error(String(response.status));
				const items = ((await response.json()) as { items: DistrictHit[] }).items;
				if (controller.signal.aborted) return;
				setHits(items);
				setStatus(items.length ? `${items.length} kecamatan ditemukan.` : "Kecamatan tidak ditemukan. Periksa ejaan.");
			} catch {
				if (!controller.signal.aborted) {
					setHits([]);
					setStatus("Daftar kecamatan belum dapat dimuat. Coba ketik lagi.");
				}
			}
		}, 250);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query]);
	const add = (hit: DistrictHit) => {
		const id = districtRegionId(hit.province, hit.city, hit.district);
		setNames({ ...names, [id]: hit.label });
		if (!selected.includes(id)) onChange([...selected, id]);
		setQuery("");
	};
	return (
		<fieldset className="flex flex-col gap-1.5" disabled={disabled} data-testid="promo-districts">
			<legend className="text-sm font-medium">Kecamatan tujuan (opsional)</legend>
			<p id="promo-district-hint" className="text-xs text-muted-foreground">
				Kosongkan untuk semua kecamatan. {noun} hanya berlaku bila alamat pembeli ada di provinsi atau kecamatan yang dipilih.
			</p>
			{chips.length > 0 && (
				<ul className="flex flex-wrap gap-1.5" aria-label="Kecamatan dipilih">
					{chips.map((id) => {
						const name = names[id] ?? regionLabel(id, regions);
						return (
							<li key={id} className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs">
								{name}
								<button
									type="button"
									className="inline-flex size-6 items-center justify-center rounded hover:bg-background pointer-coarse:size-9"
									aria-label={`Hapus ${name}`}
									onClick={() => onChange(selected.filter((x) => x !== id))}
								>
									<X className="size-3.5" aria-hidden />
								</button>
							</li>
						);
					})}
				</ul>
			)}
			<Input
				id="promo-district-search"
				type="search"
				aria-label="Cari kecamatan"
				aria-describedby="promo-district-hint promo-district-status"
				placeholder="Cari kecamatan, mis. Coblong"
				autoComplete="off"
				disabled={full}
				value={query}
				onChange={(e) => setQuery(e.target.value)}
			/>
			<p id="promo-district-status" className="text-xs text-muted-foreground" aria-live="polite">
				{full ? `Maksimal ${MAX_REGION_IDS} provinsi dan kecamatan.` : status}
			</p>
			{hits.length > 0 && !full && (
				<ul className="flex flex-col rounded-md border" aria-label="Hasil pencarian kecamatan">
					{hits.map((hit) => {
						const chosen = selected.includes(districtRegionId(hit.province, hit.city, hit.district));
						return (
							<li key={hit.id}>
								<button
									type="button"
									className="flex min-h-9 w-full items-center justify-between gap-2 px-3 text-left text-sm hover:bg-muted disabled:opacity-60 pointer-coarse:min-h-11"
									disabled={chosen}
									onClick={() => add(hit)}
								>
									<span>{hit.label}</span>
									{chosen ? <span className="text-xs text-muted-foreground">Dipilih</span> : <Plus className="size-4" aria-hidden />}
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</fieldset>
	);
}
