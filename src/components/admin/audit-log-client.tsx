"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "./data-table";
import { formatWib } from "./format";
import { FormField, nativeSelectClass } from "./form";
import { StatusBadge } from "./status";
import { useKeysetList } from "./use-keyset-list";

// S135 / spec 17 B26: the audit trail as a filter form over a keyset-paged table. The API redacts details by an
// allowlist and re-checks the grant on every page; this screen only chooses what to ask for. Filters stay in
// component state, not in the address bar: an actor or object id would otherwise land in browser history.

export type AuditScope = "all" | "money";
type AuditEvent = {
	id: string;
	occurred_at: string;
	actor_id: string | null;
	actor_name: string | null;
	action: string;
	subject_id: string | null;
	outcome: "allowed" | "denied";
	reason: string;
	details: Record<string, unknown>;
	redacted: boolean;
};

// Family prefix -> label. The API matches a value ending in "." as a family.
const FAMILIES: readonly (readonly [string, string])[] = [
	["finance.", "Keuangan (rekonsiliasi, setoran, transfer, biaya)"],
	["payout.", "Pembayaran komisi"],
	["refund.", "Refund"],
	["commerce_exception.", "Pengecualian pesanan"],
	["return.", "Retur"],
	["staff_roles.", "Peran staf"],
	["catalog.", "Katalog dan penerbitan"],
	["inventory.", "Stok dan transfer"],
	["fulfillment.", "Pengiriman"],
	["support.", "Layanan pelanggan"],
	["advertising.", "Iklan"],
	["home_banner.", "Banner beranda"],
	["audit.", "Pembacaan log audit"],
	["local.", "Pemulihan otomatis"],
];
const MONEY_FAMILIES = [
	"finance.",
	"payout.",
	"refund.",
	"commerce_exception.",
	"local.",
];
const ID = /^[A-Za-z0-9:_.-]{1,120}$/;
const PAGE_SIZE = 25;
const DAY_MS = 86_400_000;

type Filters = {
	actor: string;
	action: string;
	object: string;
	from: string;
	to: string;
};
const NONE: Filters = { actor: "", action: "", object: "", from: "", to: "" };

/** Dates are WIB calendar days: from 00:00 of the first day to 00:00 after the last (the API's `to` is exclusive). */
function queryOf(filters: Filters) {
	const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
	if (filters.actor) params.set("actor", filters.actor);
	if (filters.action) params.set("action", filters.action);
	if (filters.object) params.set("object", filters.object);
	if (filters.from) params.set("from", `${filters.from}T00:00:00+07:00`);
	if (filters.to)
		params.set(
			"to",
			new Date(
				Date.parse(`${filters.to}T00:00:00+07:00`) + DAY_MS,
			).toISOString(),
		);
	return params;
}

function validate(filters: Filters) {
	const problems: Partial<Record<keyof Filters, string>> = {};
	if (filters.actor && !ID.test(filters.actor))
		problems.actor =
			"ID pelaku hanya berisi huruf, angka, titik, titik dua, garis bawah, atau tanda hubung (maks. 120).";
	if (filters.object && !ID.test(filters.object))
		problems.object =
			"ID objek hanya berisi huruf, angka, titik, titik dua, garis bawah, atau tanda hubung (maks. 120).";
	if (filters.from && filters.to && filters.to < filters.from)
		problems.to = "Tanggal akhir tidak boleh sebelum tanggal awal.";
	return problems;
}

function flatten(
	value: Record<string, unknown>,
	prefix = "",
): [string, string][] {
	return Object.entries(value).flatMap(([key, item]) =>
		item && typeof item === "object" && !Array.isArray(item)
			? flatten(item as Record<string, unknown>, `${prefix}${key}.`)
			: [
					[
						`${prefix}${key}`,
						Array.isArray(item)
							? item.join(", ") || "—"
							: item === null
								? "—"
								: String(item),
					] as [string, string],
				],
	);
}

function Details({ row }: { row: AuditEvent }) {
	const entries = flatten(row.details);
	return (
		<div className="flex min-w-0 flex-col gap-1 text-xs">
			{entries.length > 0 ? (
				<details>
					<summary className="cursor-pointer text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center">
						Rincian ({entries.length})
					</summary>
					<dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
						{entries.map(([key, value]) => (
							<div key={key} className="contents">
								<dt className="font-mono text-muted-foreground">{key}</dt>
								<dd className="font-mono break-all">{value}</dd>
							</div>
						))}
					</dl>
				</details>
			) : (
				<span className="text-muted-foreground">—</span>
			)}
			{row.redacted && (
				<span className="text-muted-foreground">
					Sebagian data disembunyikan karena bersifat pribadi atau rahasia.
				</span>
			)}
		</div>
	);
}

export function AuditLogClient({ scope }: { scope: AuditScope }) {
	const [draft, setDraft] = useState<Filters>(NONE);
	const [applied, setApplied] = useState<Filters>(NONE);
	const [problems, setProblems] = useState<Partial<Record<keyof Filters, string>>>({});
	const list = useKeysetList<AuditEvent>(
		`/api/v1/admin/audit-events?${queryOf(applied)}`,
		(row) => row.id,
	);
	const filtered = Object.values(applied).some(Boolean);
	const choices = FAMILIES.filter(
		([prefix]) => scope === "all" || MONEY_FAMILIES.includes(prefix),
	);
	const set = (key: keyof Filters) => (value: string) =>
		setDraft((current) => ({ ...current, [key]: value }));
	const submit = (next: Filters) => {
		const found = validate(next);
		setProblems(found);
		if (Object.keys(found).length > 0) return;
		setApplied(next);
	};
	return (
		<div className="flex flex-col gap-4">
			<search aria-label="Filter log audit">
				<form
					noValidate
					data-testid="audit-filter"
					className="grid gap-3 md:grid-cols-2 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto] xl:items-start"
					onSubmit={(event) => {
						event.preventDefault();
						submit(draft);
					}}
				>
					<FormField
						id="audit-actor"
						label="Pelaku (ID akun)"
						hint={problems.actor ?? "ID akun staf atau pembeli, sama persis."}
					>
						<Input
							id="audit-actor"
							value={draft.actor}
							maxLength={120}
							autoComplete="off"
							aria-invalid={problems.actor ? true : undefined}
							aria-describedby="audit-actor-hint"
							onChange={(event) => set("actor")(event.target.value.trim())}
						/>
					</FormField>
					<FormField id="audit-action" label="Jenis tindakan">
						<select
							id="audit-action"
							className={nativeSelectClass}
							value={draft.action}
							onChange={(event) => set("action")(event.target.value)}
						>
							<option value="">
								{scope === "all" ? "Semua tindakan" : "Semua tindakan keuangan"}
							</option>
							{choices.map(([prefix, label]) => (
								<option key={prefix} value={prefix}>
									{label}
								</option>
							))}
						</select>
					</FormField>
					<FormField
						id="audit-object"
						label="Objek (ID)"
						hint={problems.object ?? "Pesanan, produk, pembayaran, dan sejenisnya."}
					>
						<Input
							id="audit-object"
							value={draft.object}
							maxLength={120}
							autoComplete="off"
							aria-invalid={problems.object ? true : undefined}
							aria-describedby="audit-object-hint"
							onChange={(event) => set("object")(event.target.value.trim())}
						/>
					</FormField>
					<FormField id="audit-from" label="Dari tanggal (WIB)">
						<Input
							id="audit-from"
							type="date"
							value={draft.from}
							onChange={(event) => set("from")(event.target.value)}
						/>
					</FormField>
					<FormField
						id="audit-to"
						label="Sampai tanggal (WIB)"
						hint={problems.to}
					>
						<Input
							id="audit-to"
							type="date"
							value={draft.to}
							aria-invalid={problems.to ? true : undefined}
							aria-describedby={problems.to ? "audit-to-hint" : undefined}
							onChange={(event) => set("to")(event.target.value)}
						/>
					</FormField>
					<div className="flex gap-2 md:col-span-2 xl:col-span-1 xl:pt-6">
						<Button type="submit" className="max-md:flex-1">
							<Search aria-hidden="true" />
							Terapkan
						</Button>
						{filtered && (
							<Button
								type="button"
								variant="outline"
								className="max-md:flex-1"
								onClick={() => {
									setDraft(NONE);
									setProblems({});
									setApplied(NONE);
								}}
							>
								Hapus filter
							</Button>
						)}
					</div>
				</form>
			</search>
			<DataTable
				testId="audit-table"
				caption="Log audit, terbaru di atas"
				rows={list.rows}
				rowKey={(row) => row.id}
				rowTestId={() => "audit-row"}
				status={list.status}
				loadingLabel="Memuat log audit…"
				empty={
					filtered
						? "Tidak ada catatan yang cocok dengan filter ini. Ubah atau hapus filter."
						: scope === "all"
							? "Belum ada catatan audit."
							: "Belum ada catatan tindakan keuangan."
				}
				emptyTestId="audit-empty"
				stack
				paging={{
					...list.paging,
					testId: "audit-more",
					summary: `${list.rows.length} catatan ditampilkan`,
				}}
				columns={[
					{
						id: "time",
						header: "Waktu",
						stack: "meta",
						className: "whitespace-nowrap tabular-nums",
						cell: (row) => formatWib(row.occurred_at),
					},
					{
						id: "action",
						header: "Tindakan",
						stack: "title",
						cell: (row) => (
							<span className="flex min-w-0 flex-col">
								<span className="font-medium">
									{FAMILIES.find(([prefix]) => row.action.startsWith(prefix))?.[1] ??
										"Tindakan lain"}
								</span>
								<span className="font-mono text-xs font-normal break-all text-muted-foreground">
									{row.action}
								</span>
								{row.reason && (
									<span className="text-xs font-normal text-muted-foreground">
										{row.reason}
									</span>
								)}
							</span>
						),
					},
					{
						id: "actor",
						header: "Pelaku",
						cell: (row) =>
							row.actor_id === null ? (
								"Sistem"
							) : (
								<span className="flex min-w-0 flex-col md:items-start">
									{row.actor_name && <span>{row.actor_name}</span>}
									<span className="font-mono text-xs break-all text-muted-foreground">
										{row.actor_id}
									</span>
								</span>
							),
					},
					{
						id: "object",
						header: "Objek",
						className: "md:max-lg:hidden",
						cell: (row) =>
							row.subject_id ? (
								<span className="font-mono text-xs break-all">
									{row.subject_id}
								</span>
							) : (
								"—"
							),
					},
					{
						id: "outcome",
						header: "Hasil",
						stack: "aside",
						cell: (row) =>
							row.outcome === "allowed" ? (
								<StatusBadge tone="success">Diizinkan</StatusBadge>
							) : (
								<StatusBadge tone="danger">Ditolak</StatusBadge>
							),
					},
					{
						id: "details",
						header: "Rincian",
						stack: "plain",
						cell: (row) => <Details row={row} />,
					},
				]}
			/>
		</div>
	);
}
