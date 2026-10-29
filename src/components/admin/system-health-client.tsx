"use client";

import { cn } from "cn";
import { CircleAlert, CircleX, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { wibDateTime } from "@/modules/storefront/format";
import { failureText, getJson } from "./admin-errors";
import { DataTable, type DataTableColumn, type DataTableStatus } from "./data-table";
import { KpiGrid } from "./kpi-card";
import { DetailSection } from "./page-blocks";
import { EmptyState } from "./states";

// S136 Kesehatan Sistem: counts of outbox jobs per kind and state (GET /api/v1/admin/system-health, owner
// only) and the retention registry. Read only: no action changes a job here. Counts only, never job content.
const STATES = ["due", "scheduled", "leased", "lease_expired", "unknown", "failed", "dead", "completed"] as const;
type State = (typeof STATES)[number];
type Counts = Record<State, number>;
type Kind = { kind: string; registered: boolean; counts: Counts; oldest_due_at: string | null };
type Health = {
	as_of: string;
	totals: Counts;
	kinds: Kind[];
	retention: { last_run_recorded: boolean; jobs: { name: string; table: string }[] };
};

const LABEL: Record<State, string> = {
	due: "Jatuh tempo",
	scheduled: "Terjadwal",
	leased: "Diproses",
	lease_expired: "Kunci habis",
	unknown: "Hasil belum pasti",
	failed: "Gagal",
	dead: "Percobaan habis",
	completed: "Selesai",
};
const MEANING: Record<State, string> = {
	due: "Menunggu, waktu jalannya sudah lewat; worker mengambilnya berikutnya.",
	scheduled: "Menunggu waktu jalan berikutnya (jeda ulang atau tenggat).",
	leased: "Sedang dikerjakan worker dengan kunci yang masih berlaku.",
	lease_expired: "Kunci worker habis dan belum dipulihkan; pekerjaan tertahan.",
	unknown: "Sudah dikirim ke adaptor tetapi hasilnya belum terkonfirmasi; menunggu rekonsiliasi.",
	failed: "Ditolak permanen sebelum percobaan habis.",
	dead: "Gagal setelah seluruh percobaan terpakai.",
	completed: "Berhasil dijalankan; tidak perlu tindakan.",
};
// States someone has to look at when non-zero: failed outcomes in red, unresolved ones in amber.
const ATTENTION: readonly State[] = ["lease_expired", "unknown", "failed", "dead"];
const FAILED: readonly State[] = ["failed", "dead"];

const total = (counts: Counts) => STATES.reduce((sum, state) => sum + counts[state], 0);
const needsLook = (counts: Counts) => ATTENTION.some((state) => counts[state] > 0);

function StatCard({ state, value }: { state: State; value: number }) {
	const attention = ATTENTION.includes(state) && value > 0;
	const failed = attention && FAILED.includes(state);
	const Icon = failed ? CircleX : CircleAlert;
	return (
		<li
			data-testid={`health-total-${state}`}
			data-tone={attention ? "attention" : value === 0 ? "idle" : "neutral"}
			data-severity={attention ? (failed ? "failed" : "uncertain") : undefined}
			className={cn(
				"flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-3",
				// Like the KPI cards: the border, icon and label carry attention, no tinted fill.
				attention && (failed ? "border-destructive/50" : "border-warning/50"),
				!attention && value === 0 && "bg-muted/40",
			)}
		>
			<h3
				className={cn(
					"flex items-center gap-1 text-xs font-medium",
					attention ? (failed ? "text-destructive" : "text-warning") : "text-muted-foreground",
				)}
			>
				{attention && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
				{LABEL[state]}
			</h3>
			<p data-testid={`health-total-value-${state}`} className={cn("text-xl font-semibold tabular-nums", !attention && value === 0 && "text-muted-foreground")}>
				{value}
			</p>
		</li>
	);
}

function Count({ state, value }: { state: State; value: number }) {
	const attention = ATTENTION.includes(state) && value > 0;
	return (
		<span
			className={cn(
				"tabular-nums",
				value === 0 && "text-muted-foreground",
				attention && (FAILED.includes(state) ? "font-semibold text-destructive" : "font-semibold text-warning"),
			)}
		>
			{value}
		</span>
	);
}

// Healthy states (finished, waiting, running) hide first when the table frame is narrow.
const HIDE_BELOW: Partial<Record<State, DataTableColumn<Kind>["hideBelow"]>> = {
	completed: "7xl",
	scheduled: "6xl",
	leased: "6xl",
};

const columns: DataTableColumn<Kind>[] = [
	{
		id: "kind",
		header: "Jenis pekerjaan",
		stack: "title",
		cellClassName: "whitespace-normal md:min-w-40",
		cell: (row) => (
			<span className="flex flex-col">
				<span className="font-mono text-xs break-all">{row.kind}</span>
				{!row.registered && <span className="text-xs text-muted-foreground">Adaptor berkunci atau jenis tak dikenal</span>}
			</span>
		),
	},
	...STATES.map(
		(state): DataTableColumn<Kind> => ({
			id: state,
			header: LABEL[state],
			className: "text-right",
			cellClassName: "text-right",
			// States that need no action give way first; the totals above keep every state.
			hideBelow: HIDE_BELOW[state],
			cell: (row) => <Count state={state} value={row.counts[state]} />,
		}),
	),
	{
		id: "oldest",
		header: "Jatuh tempo tertua",
		kind: "datetime",
		className: "text-right",
		cellClassName: "text-right",
		cell: (row) => (row.oldest_due_at ? wibDateTime(row.oldest_due_at) : <span className="text-muted-foreground">—</span>),
	},
];

export function SystemHealthClient() {
	const [health, setHealth] = useState<Health | null>(null);
	const [status, setStatus] = useState<DataTableStatus>({ kind: "loading" });
	const [showIdle, setShowIdle] = useState(false);
	const load = useCallback(async () => {
		setStatus({ kind: "loading" });
		const result = await getJson<Health>("/api/v1/admin/system-health");
		if (result.ok) {
			setHealth(result.data);
			setStatus({ kind: "ready" });
		} else if (result.failure.status === 403 || result.failure.status === 401) {
			setStatus({ kind: "denied", message: "Kesehatan sistem hanya untuk Super Admin dengan verifikasi dua langkah (MFA) aktif." });
		} else {
			setStatus({ kind: "error", message: failureText(result.failure), onRetry: () => void load() });
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);

	const kinds = (health?.kinds ?? [])
		.filter((entry) => showIdle || total(entry.counts) > 0)
		.sort((a, b) => Number(needsLook(b.counts)) - Number(needsLook(a.counts)) || a.kind.localeCompare(b.kind));
	const idleHidden = (health?.kinds ?? []).filter((entry) => total(entry.counts) === 0).length;

	return (
		<div className="flex flex-col gap-4 md:gap-6" data-testid="system-health">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs text-muted-foreground" data-testid="health-as-of">
					{health ? `Data per ${wibDateTime(health.as_of)}` : "Menunggu data"}
				</p>
				<Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={status.kind === "loading"} data-testid="health-refresh">
					<RefreshCw data-icon="inline-start" aria-hidden="true" />
					Muat ulang
				</Button>
			</div>
			{health && status.kind === "ready" && (
				<DetailSection id="health-totals-heading" title="Antrean pekerjaan" description="Jumlah seluruh jenis pekerjaan menurut keadaan.">
					<KpiGrid testId="health-totals" className="max-sm:grid-cols-2">
						{STATES.map((state) => (
							<StatCard key={state} state={state} value={health.totals[state]} />
						))}
					</KpiGrid>
				</DetailSection>
			)}
			<DetailSection
				id="health-kinds-heading"
				title="Per jenis pekerjaan"
				description="Jenis yang perlu ditinjau (kunci habis, hasil belum pasti, gagal, percobaan habis) tampil di atas."
				testId="health-kinds"
			>
				<DataTable
					rows={kinds}
					rowKey={(row) => row.kind}
					rowTestId={(row) => `health-kind-${row.kind}`}
					columns={columns}
					status={status}
					loadingLabel="Memuat kesehatan sistem..."
					empty="Belum ada pekerjaan di antrean. Jenis yang terdaftar tanpa baris disembunyikan."
					emptyTestId="health-empty"
					caption="Jumlah pekerjaan per jenis dan keadaan"
					testId="health-kinds-table"
					stack
				/>
				{health && status.kind === "ready" && idleHidden > 0 && (
					<Button type="button" variant="outline" size="sm" className="self-start" aria-pressed={showIdle} onClick={() => setShowIdle((value) => !value)} data-testid="health-toggle-idle">
						{showIdle ? "Sembunyikan jenis tanpa pekerjaan" : `Tampilkan ${idleHidden} jenis tanpa pekerjaan`}
					</Button>
				)}
			</DetailSection>
			{health && status.kind === "ready" && (
				<>
					<DetailSection id="health-states-heading" title="Arti setiap keadaan" testId="health-states">
						<dl className="grid gap-2 text-sm md:grid-cols-2">
							{STATES.map((state) => (
								<div key={state} className="flex flex-col">
									<dt className="font-medium">{LABEL[state]}</dt>
									<dd className="text-muted-foreground">{MEANING[state]}</dd>
								</div>
							))}
						</dl>
					</DetailSection>
					<DetailSection
						id="health-retention-heading"
						title="Retensi data"
						description="Worker membersihkan tabel berikut paling sering sekali per menit."
						testId="health-retention"
					>
						{!health.retention.last_run_recorded && (
							<p className="text-sm" data-testid="health-retention-note">
								Waktu pembersihan terakhir belum dicatat sistem, jadi tidak bisa ditampilkan. Kegagalan hanya masuk ke log worker.
							</p>
						)}
						{health.retention.jobs.length === 0 ? (
							<EmptyState>Tidak ada tugas retensi terdaftar.</EmptyState>
						) : (
							<ul className="grid gap-1 text-sm md:grid-cols-2" data-testid="health-retention-jobs">
								{health.retention.jobs.map((job) => (
									<li key={job.name} className="flex flex-wrap items-baseline justify-between gap-2 border-b py-1.5">
										<span className="font-mono text-xs">{job.name}</span>
										<span className="text-xs text-muted-foreground">tabel {job.table}</span>
									</li>
								))}
							</ul>
						)}
					</DetailSection>
				</>
			)}
		</div>
	);
}
