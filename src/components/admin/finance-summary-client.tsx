"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { failureText, getJson } from "./admin-errors";
import { DataTable, type DataTableStatus } from "./data-table";
import {
	CLOSING_BALANCE_SECTIONS,
	type FinanceSummaryResponse,
	type FinancialStatementSection,
	formatDashboardMoney,
	formatStatementAmount,
	missingInputLabel,
	PERIOD_FLOW_SECTIONS,
	type SummarySectionKey,
} from "./finance-model";
import { formatWib } from "./format";
import { FormField, SegmentedControl } from "./form";
import { KpiGrid } from "./kpi-card";
import { DetailSection } from "./page-blocks";
import { ErrorState, LoadingState } from "./states";
import { StatusBadge } from "./status";

const DAY_MS = 86_400_000;
const MAX_WINDOW_MS = 366 * DAY_MS;

type PresetWindow = "7d" | "30d" | "90d" | "365d" | "custom";

const PRESET_OPTIONS: readonly (readonly [PresetWindow, string])[] = [
	["7d", "7 hari terakhir"],
	["30d", "30 hari terakhir"],
	["90d", "90 hari terakhir"],
	["365d", "365 hari terakhir"],
	["custom", "Rentang tanggal"],
];

const DASHBOARD_METRIC_LABELS: Record<string, string> = {
	cod_receivable: "COD belum disetor",
	cod_remitted: "COD sudah disetor",
	refund_liability: "Kewajiban pengembalian dana",
	affiliate_liability: "Kewajiban komisi afiliasi",
	estimated_contribution: "Estimasi kontribusi margin",
	realized_contribution: "Kontribusi margin terealisasi",
	net_merchandise_revenue: "Pendapatan bersih barang",
};

const BASIS_LABELS: Record<string, string> = {
	actual: "Aktual",
	estimated: "Estimasi",
	mixed: "Aktual + estimasi",
	unknown: "Belum diketahui",
};

type DashboardMoneyMetric = {
	key: string;
	kind: "count" | "money";
	complete: boolean;
	amount: number | null;
	financial_basis: string;
	definition: string;
};

type DashboardSnapshot = {
	as_of: string;
	metrics: DashboardMoneyMetric[];
};

function defaultRange(preset: Exclude<PresetWindow, "custom">) {
	const days =
		preset === "7d"
			? 7
			: preset === "30d"
				? 30
				: preset === "90d"
					? 90
					: 365;
	const now = Date.now();
	return {
		from: new Date(now - days * DAY_MS).toISOString(),
		to: new Date(now + 60_000).toISOString(),
	};
}

type StatementRow = {
	key: SummarySectionKey;
	label: string;
	description: string;
	section: FinancialStatementSection;
};

export function FinanceSummaryClient() {
	const [preset, setPreset] = useState<PresetWindow>("30d");
	const [fromDate, setFromDate] = useState("");
	const [toDate, setToDate] = useState("");
	const [rangeError, setRangeError] = useState<string | null>(null);
	const [appliedRange, setAppliedRange] = useState(() => defaultRange("30d"));

	const [summary, setSummary] = useState<FinanceSummaryResponse | null>(null);
	const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
	const [status, setStatus] = useState<DataTableStatus>({ kind: "loading" });

	const load = useCallback(async (range: { from: string; to: string }) => {
		setStatus({ kind: "loading" });
		const query = `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
		const [sumRes, dashRes] = await Promise.all([
			getJson<FinanceSummaryResponse>(`/api/v1/admin/finance/summary?${query}`),
			getJson<DashboardSnapshot>(
				`/api/v1/admin/dashboard?workspace=finance&${query}`,
			),
		]);
		if (!sumRes.ok) {
			setStatus({
				kind: "error",
				message: failureText(sumRes.failure),
				onRetry: () => void load(range),
			});
			return;
		}
		setSummary(sumRes.data);
		// A failed dashboard request must not leave the previous period's KPIs next to the new period's statement.
		setDashboard(dashRes.ok ? dashRes.data : null);
		setStatus({ kind: "ready" });
	}, []);

	useEffect(() => {
		void load(appliedRange);
	}, [appliedRange, load]);

	function selectPreset(next: PresetWindow) {
		setPreset(next);
		setRangeError(null);
		if (next !== "custom") {
			setAppliedRange(defaultRange(next));
		}
	}

	function applyCustomRange() {
		if (!fromDate || !toDate) {
			setRangeError("Isi tanggal awal dan tanggal akhir (WIB).");
			return;
		}
		const fromMs = Date.parse(`${fromDate}T00:00:00+07:00`);
		const toMs = Date.parse(`${toDate}T00:00:00+07:00`) + DAY_MS;
		if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
			setRangeError("Tanggal akhir harus setelah atau sama dengan tanggal awal.");
			return;
		}
		if (toMs - fromMs > MAX_WINDOW_MS) {
			setRangeError("Rentang waktu laporan tidak boleh melebihi 366 hari.");
			return;
		}
		setRangeError(null);
		setAppliedRange({
			from: new Date(fromMs).toISOString(),
			to: new Date(toMs).toISOString(),
		});
	}

	const closingRows: StatementRow[] = summary
		? CLOSING_BALANCE_SECTIONS.map((item) => ({
				...item,
				section: summary[item.key],
		  }))
		: [];

	const flowRows: StatementRow[] = summary
		? PERIOD_FLOW_SECTIONS.map((item) => ({
				...item,
				section: summary[item.key],
		  }))
		: [];

	const moneyMetrics = (dashboard?.metrics ?? []).filter(
		(m) => m.kind === "money",
	);

	const hasIncomplete =
		flowRows.some((r) => !r.section.complete) ||
		closingRows.some((r) => !r.section.complete) ||
		moneyMetrics.some((m) => !m.complete);

	return (
		<div className="flex flex-col gap-6" data-testid="finance-summary-page">
			<div className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<SegmentedControl
						legend="Pilih periode laporan keuangan"
						value={preset}
						onChange={selectPreset}
						options={PRESET_OPTIONS}
						testId={(key) => `summary-preset-${key}`}
					/>
					<Button
						type="button"
						variant="outline"
						data-testid="summary-refresh"
						onClick={() => void load(appliedRange)}
					>
						<RefreshCw data-icon="inline-start" aria-hidden="true" />
						Muat ulang
					</Button>
				</div>

				{preset === "custom" && (
					<div
						className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
						data-testid="summary-custom-range"
					>
						<FormField
							id="summary-from"
							label="Dari tanggal (WIB)"
							className="w-44"
						>
							<Input
								id="summary-from"
								data-testid="summary-from"
								type="date"
								value={fromDate}
								onChange={(e) => setFromDate(e.target.value)}
							/>
						</FormField>
						<FormField
							id="summary-to"
							label="Sampai tanggal (WIB)"
							className="w-44"
						>
							<Input
								id="summary-to"
								data-testid="summary-to"
								type="date"
								value={toDate}
								onChange={(e) => setToDate(e.target.value)}
							/>
						</FormField>
						<Button
							type="button"
							data-testid="summary-apply-range"
							onClick={applyCustomRange}
						>
							Terapkan periode
						</Button>
						{rangeError && (
							<p
								role="alert"
								data-testid="summary-range-error"
								className="w-full text-sm text-destructive"
							>
								{rangeError}
							</p>
						)}
					</div>
				)}

				{summary && (
					<p
						className="text-xs text-muted-foreground"
						data-testid="summary-window-meta"
					>
						Periode {formatWib(summary.from)} s/d {formatWib(summary.to)} WIB
						{summary.generated_at
							? ` · Dihitung ${formatWib(summary.generated_at)}`
							: ""}{" "}
						· Nilai dengan sumber biaya yang belum lengkap ditampilkan sebagai{" "}
						<strong>Belum lengkap</strong>, tidak pernah dianggap Rp0.
					</p>
				)}
			</div>

			{status.kind === "loading" && !summary ? (
				<LoadingState label="Memuat laporan keuangan…" lines={6} columns={4} />
			) : status.kind === "error" ? (
				<ErrorState message={status.message} onRetry={status.onRetry} />
			) : (
				<>
					{hasIncomplete && (
						<Alert role="status" data-testid="summary-incomplete-alert">
							<CircleAlert aria-hidden="true" />
							<AlertDescription className="text-foreground">
								Sebagian pos kontribusi atau margin pada periode ini{" "}
								<strong>Belum lengkap</strong> karena HPP komponen, asumsi biaya
								penawaran, atau rekonsiliasi pencairan belum tercatat. Lengkapi sumber
								biaya atau rekonsiliasi terlebih dahulu; angka yang belum lengkap tidak
								ditampilkan sebagai Rp0.
							</AlertDescription>
						</Alert>
					)}

					{moneyMetrics.length > 0 && (
						<DetailSection
							id="summary-dashboard-heading"
							title="Metrik keuangan ruang kerja"
							description="Ringkasan posisi COD, kewajiban, dan kontribusi dari dasbor keuangan."
							testId="summary-dashboard-metrics"
						>
							<KpiGrid money>
								{moneyMetrics.map((m) => (
									<li
										key={m.key}
										data-testid={`summary-kpi-${m.key}`}
										data-complete={m.complete ? "true" : "false"}
										className="flex min-w-0 flex-col justify-between gap-2 rounded-lg border bg-card p-3.5"
									>
										<div className="flex items-start justify-between gap-2">
											<span className="text-xs font-medium text-muted-foreground">
												{DASHBOARD_METRIC_LABELS[m.key] ?? m.key}
											</span>
											{m.complete && BASIS_LABELS[m.financial_basis] ? (
												<Badge variant="outline">
													{BASIS_LABELS[m.financial_basis]}
												</Badge>
											) : (
												<StatusBadge tone="problem">Belum lengkap</StatusBadge>
											)}
										</div>
										<p
											data-testid={`summary-kpi-value-${m.key}`}
											className={
												m.complete && m.amount !== null
													? "text-lg font-semibold tabular-nums"
													: "text-base font-semibold text-warning"
											}
										>
											{formatDashboardMoney(m)}
										</p>
										<p className="text-xs text-muted-foreground">
											{m.complete
												? m.definition
												: "Sebagian sumber biaya belum tercatat, jadi nilai tidak dihitung sebagai Rp0."}
										</p>
									</li>
								))}
							</KpiGrid>
						</DetailSection>
					)}

					<DetailSection
						id="summary-closing-heading"
						title="Saldo akhir periode"
						description="Posisi saldo buku besar dan kewajiban per akhir batas periode."
						testId="summary-closing-balances"
					>
						<StatementTable
							testId="summary-closing-table"
							caption="Saldo akhir periode"
							rows={closingRows}
						/>
					</DetailSection>

					<DetailSection
						id="summary-flows-heading"
						title="Arus periode & kelengkapan kontribusi"
						description="Pendapatan barang dagangan, HPP diakui, estimasi vs realisasi kontribusi margin, dan hasil operasional."
						testId="summary-period-flows"
					>
						<StatementTable
							testId="summary-statement-table"
							caption="Arus periode dan kelengkapan kontribusi"
							rows={flowRows}
						/>
					</DetailSection>
				</>
			)}
		</div>
	);
}

function StatementTable({
	testId,
	caption,
	rows,
}: {
	testId: string;
	caption: string;
	rows: readonly StatementRow[];
}) {
	return (
		<DataTable
			testId={testId}
			caption={caption}
			rows={rows}
			rowKey={(row) => row.key}
			rowTestId={(row) => `summary-row-${row.key}`}
			status={{ kind: "ready" }}
			loadingLabel="Memuat pos laporan…"
			empty="Tidak ada pos laporan."
			stack
			columns={[
				{
					id: "section",
					header: "Pos keuangan",
					stack: "title",
					className: "whitespace-normal [overflow-wrap:anywhere]",
					cell: (row) => (
						<span className="flex flex-col">
							<span className="font-medium">{row.label}</span>
							<span className="text-xs text-muted-foreground">
								{row.description}
							</span>
						</span>
					),
				},
				{
					id: "completeness",
					header: "Kelengkapan",
					stack: "status",
					className: "md:w-px",
					cell: (row) => (
						<StatusBadge
							tone={row.section.complete ? "success" : "problem"}
							testId={`summary-status-${row.key}`}
							data-status={row.section.complete ? "complete" : "incomplete"}
						>
							{row.section.complete ? "Lengkap" : "Belum lengkap"}
						</StatusBadge>
					),
				},
				{
					id: "amount",
					header: "Nilai",
					stack: "aside",
					className: "text-right whitespace-nowrap tabular-nums md:w-px",
					cell: (row) => (
						<span
							data-testid={`summary-value-${row.key}`}
							className={
								row.section.complete && row.section.amount !== null
									? "font-semibold tabular-nums"
									: "font-semibold text-warning"
							}
						>
							{formatStatementAmount(row.section)}
						</span>
					),
				},
				{
					id: "missing",
					header: "Sumber yang belum lengkap",
					className: "whitespace-normal [overflow-wrap:anywhere]",
					cellClassName: "max-md:flex-col max-md:items-start max-md:text-left",
					cell: (row) =>
						row.section.missing_inputs.length === 0 ? (
							<span className="text-xs text-muted-foreground">—</span>
						) : (
							<ul
								className="flex flex-col gap-0.5 text-xs"
								data-testid={`summary-missing-${row.key}`}
							>
								{row.section.missing_inputs.map((input) => (
									<li key={input}>
										<span>{missingInputLabel(input)}</span>{" "}
										<span className="font-mono text-muted-foreground">
											({input})
										</span>
									</li>
								))}
							</ul>
						),
				},
			]}
		/>
	);
}
