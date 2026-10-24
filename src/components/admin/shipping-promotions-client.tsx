"use client";

import { CircleCheck, Plus, RefreshCw } from "lucide-react";
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
import { rupiah, wibDateTime, wibInput, wibInputToIso } from "@/modules/storefront/format";
import { DataTable } from "./data-table";
import { bpsToPercent, percentToBps } from "./format";
import { FormDialog, FormField, nativeSelectClass } from "./form";
import { send, useOperationKey } from "./ops-api";
import { AdminPage, PageHeader } from "./page-blocks";
import { StatusBadge, type StatusTone, useNow } from "./status";
import { useKeysetList } from "./use-keyset-list";

// S102 / spec 17 B12: versioned shipping subsidies. Every change (including ending a promo) appends a
// new configuration version with a reason; budget already reserved or used stays encumbered.

export type Option = { id: string; label: string };
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
};

function phase(p: Promotion, now: number | null): [string, StatusTone] {
	if (!p.active) return ["Nonaktif", "closed"];
	if (now !== null && Date.parse(p.ends_at) <= now) return ["Berakhir", "closed"];
	if (now !== null && Date.parse(p.starts_at) > now) return ["Terjadwal", "open"];
	return ["Berjalan", "success"];
}
const benefit = (p: Pick<Promotion, "kind" | "value" | "maximum_per_order">) =>
	p.kind === "fixed"
		? `Potongan ongkir ${rupiah(p.value)} per pesanan`
		: `Potongan ongkir ${bpsToPercent(p.value)}%, maks. ${rupiah(p.maximum_per_order)} per pesanan`;
const METHODS: Record<string, string> = { prepaid: "Prabayar", cod: "COD" };

export function ShippingPromotionsClient({ services, regions }: { services: Option[]; regions: Option[] }) {
	const list = useKeysetList<Promotion>("/api/v1/admin/shipping-promotions?limit=50", (p) => p.id);
	const now = useNow();
	const [notice, setNotice] = useState<string | null>(null);
	const [dialog, setDialog] = useState<{ kind: "edit" | "end" | "history"; row: Promotion } | { kind: "create" } | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);
	const done = (message: string) => {
		setDialog(null);
		setNotice(message);
		void list.reload();
	};
	const label = (options: Option[], ids: string[], all: string) =>
		ids.length ? ids.map((id) => options.find((o) => o.id === id)?.label ?? id).join(", ") : all;
	return (
		<AdminPage testId="shipping-promotions-page">
			<PageHeader
				title="Promo Ongkir"
				description="Subsidi ongkir yang dipotong saat checkout. Setiap perubahan disimpan sebagai versi baru dengan alasan; pesanan yang sudah dibuat tetap memakai promo saat itu."
				actions={
					<Button data-testid="promotion-create" onClick={() => setDialog({ kind: "create" })}>
						<Plus data-icon="inline-start" aria-hidden="true" />
						Buat promo
					</Button>
				}
			/>
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="border-success/30 bg-success-surface outline-none">
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			<section aria-labelledby="promotions-heading" className="flex flex-col gap-4">
				<div className="flex items-start justify-between gap-3">
					<h2 id="promotions-heading" className="text-lg font-semibold">
						Daftar promo
					</h2>
					<Button variant="outline" className="shrink-0" onClick={() => void list.reload()}>
						<RefreshCw aria-hidden="true" />
						Muat ulang
					</Button>
				</div>
				<DataTable
					rows={list.rows}
					rowKey={(p) => p.id}
					status={list.status}
					paging={{ ...list.paging, testId: "promotions-more" }}
					loadingLabel="Memuat promo…"
					empty="Belum ada promo ongkir. Buat promo untuk memberi potongan ongkir saat checkout."
					testId="shipping-promotions"
					rowTestId={(p) => `promotion-row-${p.id}`}
					caption="Promo ongkir"
					stack
					columns={[
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
						{
							id: "budget",
							header: "Anggaran terpakai",
							stack: "aside",
							className: "text-right tabular-nums",
							cell: (p) => (
								<span className="flex flex-col items-end">
									{rupiah(p.budget_state.committed + p.budget_state.reserved)}
									<span className="text-xs font-normal text-muted-foreground">dari {rupiah(p.budget)}</span>
								</span>
							),
						},
						{
							id: "period",
							header: "Periode",
							stack: "meta",
							cellClassName: "whitespace-normal",
							cell: (p) => `${wibDateTime(p.starts_at)} – ${wibDateTime(p.ends_at)}`,
						},
						{
							id: "status",
							header: "Status",
							stack: "status",
							cell: (p) => {
								const [text, tone] = phase(p, now);
								return <StatusBadge tone={tone}>{text}</StatusBadge>;
							},
						},
						{
							id: "rules",
							header: "Berlaku untuk",
							className: "md:max-xl:hidden",
							cellClassName: "whitespace-normal text-xs md:max-w-60",
							cell: (p) =>
								`${p.payment_methods.map((m) => METHODS[m] ?? m).join(" dan ")} · ${label(regions, p.region_ids, "semua wilayah")} · ${label(services, p.service_ids, "semua layanan")}${p.minimum_merchandise ? ` · min. belanja ${rupiah(p.minimum_merchandise)}` : ""}`,
						},
						{
							id: "actions",
							header: "Tindakan",
							className: "text-right",
							cell: (p) => (
								<div className="flex justify-end gap-2 max-md:w-full">
									<Button size="sm" variant="outline" data-testid={`promotion-edit-${p.id}`} onClick={() => setDialog({ kind: "edit", row: p })}>
										Ubah
									</Button>
									{p.active && (now === null || Date.parse(p.ends_at) > now) && (
										<Button size="sm" variant="outline" onClick={() => setDialog({ kind: "end", row: p })}>
											Akhiri
										</Button>
									)}
									<Button size="sm" variant="outline" onClick={() => setDialog({ kind: "history", row: p })}>
										Riwayat
									</Button>
								</div>
							),
						},
					]}
				/>
			</section>
			{dialog?.kind === "create" && <PromotionDialog services={services} regions={regions} onClose={() => setDialog(null)} onDone={done} />}
			{dialog?.kind === "edit" && (
				<PromotionDialog row={dialog.row} services={services} regions={regions} onClose={() => setDialog(null)} onDone={done} />
			)}
			{dialog?.kind === "end" && <EndDialog row={dialog.row} onClose={() => setDialog(null)} onDone={done} />}
			{dialog?.kind === "history" && <HistoryDialog row={dialog.row} onClose={() => setDialog(null)} />}
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
});
const idr = (value: string) => (/^\d{1,15}$/.test(value.trim()) ? Number(value) : null);

function PromotionDialog({
	row,
	services,
	regions,
	onClose,
	onDone,
}: {
	row?: Promotion;
	services: Option[];
	regions: Option[];
	onClose: () => void;
	onDone: (message: string) => void;
}) {
	const [form, setForm] = useState(() => ({
		name: row?.name ?? "",
		active: row?.active ?? true,
		starts: row ? wibInput(row.starts_at) : "",
		ends: row ? wibInput(row.ends_at) : "",
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
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const key = useOperationKey();
	const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
		setForm({ ...form, [field]: e.target.value });
	const toggle = (field: "methods" | "regions" | "services", id: string) =>
		setForm({ ...form, [field]: form[field].includes(id) ? form[field].filter((x) => x !== id) : [...form[field], id] });
	async function submit() {
		const starts = wibInputToIso(form.starts);
		const ends = wibInputToIso(form.ends);
		const value = form.kind === "percentage" ? percentToBps(form.value) : idr(form.value);
		const maximum = form.kind === "fixed" ? value : idr(form.maximum);
		const [minimum, budget, perBuyer, priority] = [idr(form.minimum), idr(form.budget), idr(form.perBuyer), idr(form.priority)];
		if (!form.name.trim()) return setError("Nama promo wajib diisi.");
		if (!starts || !ends || starts >= ends) return setError("Isi waktu mulai dan selesai (WIB); selesai harus setelah mulai.");
		if (value === null || maximum === null) return setError(form.kind === "percentage" ? "Persen 0–100 (maks. dua desimal) dan potongan maksimum dalam rupiah." : "Potongan diisi rupiah, angka saja.");
		if (minimum === null || budget === null) return setError("Minimum belanja dan anggaran diisi rupiah, angka saja.");
		if (perBuyer === null || perBuyer < 1 || perBuyer > 1_000_000) return setError("Batas per pembeli 1–1.000.000 kali.");
		if (priority === null || priority > 10_000) return setError("Prioritas 0–10.000.");
		if (!form.methods.length) return setError("Pilih minimal satu metode pembayaran.");
		if (form.active && (!value || !maximum || !budget)) return setError("Promo aktif perlu potongan, potongan maksimum dan anggaran lebih dari nol.");
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
			expected_version: row?.version ?? 0,
		};
		const result = await send<Promotion>(
			"POST",
			row ? `/api/v1/admin/shipping-promotions/${row.id}/versions` : "/api/v1/admin/shipping-promotions",
			config,
			key,
		);
		setPending(false);
		if (!result.ok) return setError(result.text);
		onDone(row ? `Promo ${result.data.name} disimpan sebagai versi ${result.data.version}.` : `Promo ${result.data.name} dibuat.`);
	}
	const check = (field: "methods" | "regions" | "services", options: Option[], legend: string, hint?: string) => (
		<fieldset className="flex flex-col gap-1.5">
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
	return (
		<FormDialog
			title={row ? `Ubah promo ${row.name}` : "Buat promo ongkir"}
			description={row ? `Versi ${row.version}. Perubahan berlaku untuk checkout berikutnya. Anggaran minimal ${rupiah(used)} (sudah dipesan atau terpakai).` : "Potongan dibayar toko dari anggaran promo dan dibatasi per pesanan dan per pembeli."}
			pending={pending}
			error={error}
			submitLabel={row ? "Simpan versi baru" : "Buat promo"}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id="promo-name" label="Nama promo">
				<Input id="promo-name" maxLength={200} value={form.name} onChange={set("name")} />
			</FormField>
			<label className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
				<input type="checkbox" className="size-4 accent-primary" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
				Aktif (berlaku di checkout selama periode)
			</label>
			<div className="grid gap-3 sm:grid-cols-2">
				<FormField id="promo-starts" label="Mulai (WIB)">
					<Input id="promo-starts" type="datetime-local" value={form.starts} onChange={set("starts")} />
				</FormField>
				<FormField id="promo-ends" label="Selesai (WIB)">
					<Input id="promo-ends" type="datetime-local" value={form.ends} onChange={set("ends")} />
				</FormField>
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<FormField id="promo-kind" label="Jenis potongan">
					<select id="promo-kind" className={`${nativeSelectClass} w-full`} value={form.kind} onChange={set("kind")}>
						<option value="fixed">Nominal (Rp)</option>
						<option value="percentage">Persen ongkir</option>
					</select>
				</FormField>
				<FormField id="promo-value" label={form.kind === "fixed" ? "Potongan per pesanan (Rp)" : "Potongan (%)"}>
					<Input id="promo-value" inputMode={form.kind === "fixed" ? "numeric" : "decimal"} value={form.value} onChange={set("value")} />
				</FormField>
			</div>
			{form.kind === "percentage" && (
				<FormField id="promo-maximum" label="Potongan maksimum per pesanan (Rp)">
					<Input id="promo-maximum" inputMode="numeric" value={form.maximum} onChange={set("maximum")} />
				</FormField>
			)}
			<div className="grid gap-3 sm:grid-cols-2">
				<FormField id="promo-minimum" label="Minimum belanja (Rp)">
					<Input id="promo-minimum" inputMode="numeric" value={form.minimum} onChange={set("minimum")} />
				</FormField>
				<FormField id="promo-budget" label="Anggaran total (Rp)">
					<Input id="promo-budget" inputMode="numeric" value={form.budget} onChange={set("budget")} />
				</FormField>
				<FormField id="promo-per-buyer" label="Batas per pembeli (kali)">
					<Input id="promo-per-buyer" inputMode="numeric" value={form.perBuyer} onChange={set("perBuyer")} />
				</FormField>
				<FormField id="promo-priority" label="Prioritas" hint="Angka lebih besar dipakai lebih dulu.">
					<Input id="promo-priority" inputMode="numeric" aria-describedby="promo-priority-hint" value={form.priority} onChange={set("priority")} />
				</FormField>
			</div>
			{check("methods", [{ id: "prepaid", label: "Prabayar" }, { id: "cod", label: "COD" }], "Metode pembayaran")}
			{regions.length > 0 && check("regions", regions, "Wilayah tujuan", "Kosongkan untuk semua wilayah.")}
			{services.length > 0 && check("services", services, "Layanan kirim", "Kosongkan untuk semua layanan.")}
			<FormField id="promo-stacking" label="Gabung dengan promo lain">
				<select id="promo-stacking" className={`${nativeSelectClass} w-full`} value={form.stacking} onChange={set("stacking")}>
					<option value="exclusive">Tidak (promo ini sendiri)</option>
					<option value="allowed">Boleh digabung</option>
				</select>
			</FormField>
			<FormField id="promo-reason" label="Alasan">
				<Input id="promo-reason" maxLength={500} value={form.reason} onChange={set("reason")} />
			</FormField>
		</FormDialog>
	);
}

function EndDialog({ row, onClose, onDone }: { row: Promotion; onClose: () => void; onDone: (message: string) => void }) {
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
		onDone(`Promo ${row.name} diakhiri (versi ${result.data.version}).`);
	}
	return (
		<FormDialog
			title={`Akhiri promo ${row.name}`}
			description="Promo tidak lagi dipakai di checkout berikutnya. Potongan yang sudah dipesan pembeli tetap berlaku; riwayat versi tetap tersimpan."
			pending={pending}
			error={error}
			submitLabel="Akhiri promo"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id="end-reason" label="Alasan">
				<Input id="end-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}

function HistoryDialog({ row, onClose }: { row: Promotion; onClose: () => void }) {
	const list = useKeysetList<Promotion>(`/api/v1/admin/shipping-promotions/${row.id}/versions?limit=20`, (p) => String(p.version));
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="md:max-h-[90dvh] md:max-w-2xl md:overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Riwayat promo {row.name}</DialogTitle>
					<DialogDescription>Versi terbaru di atas. Versi lama tidak bisa diubah.</DialogDescription>
				</DialogHeader>
				<DataTable
					rows={list.rows}
					rowKey={(p) => String(p.version)}
					status={list.status}
					paging={{ ...list.paging, testId: "promotion-history-more" }}
					loadingLabel="Memuat riwayat…"
					empty="Belum ada versi."
					testId="promotion-history"
					caption="Riwayat versi promo"
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
										Versi {p.version} · {p.active ? "aktif" : "nonaktif"}
									</span>
									<span className="text-xs font-normal text-muted-foreground">{p.reason}</span>
								</div>
							),
						},
						{ id: "budget", header: "Anggaran", stack: "aside", className: "text-right tabular-nums", cell: (p) => rupiah(p.budget) },
						{ id: "when", header: "Dicatat", stack: "meta", cell: (p) => wibDateTime(p.recorded_at) },
						{ id: "benefit", header: "Potongan", cellClassName: "whitespace-normal text-xs", cell: benefit },
					]}
				/>
			</DialogContent>
		</Dialog>
	);
}
