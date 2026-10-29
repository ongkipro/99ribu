"use client";

import { CircleAlert, CircleCheck, Plus, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { type ApiFailure, failureText, getJson } from "./admin-errors";
import { DataTable } from "./data-table";
import { useFinanceIntent } from "./finance-intent";
import {
	type FinanceAccess,
	RECONCILIATION_DIRECTION_LABEL,
	RECONCILIATION_EVENT_KIND,
	RECONCILIATION_PROBLEM_LABEL,
	RECONCILIATION_PROVIDER_LABEL,
	RECONCILIATION_PROVIDERS,
	RECONCILIATION_STATUS,
	RECONCILIATION_STATUSES,
	type ReconciliationDetail,
	type ReconciliationItem,
	type ReconciliationProvider,
	type ReconciliationStatus,
	type SettlementMatch,
	type SettlementSourceDetail,
	type SettlementStatement,
} from "./finance-model";
import { formatWib, rupiah } from "./format";
import { FilterSheet, FormDialog, FormField, nativeSelectClass } from "./form";
import { AdminPage, DetailSection, PageHeader, StickyActions } from "./page-blocks";
import { StatusBadge } from "./status";
import { useKeysetList } from "./use-keyset-list";
import { adminPath } from "@/modules/access/admin-paths";

const PAGE_SIZE = 20;
const ALL = "";
const API = "/api/v1/admin/reconciliation";

export function ReconciliationListClient({
	access,
	initialStatus,
	initialProvider,
	initialReference,
}: {
	access: FinanceAccess;
	initialStatus: ReconciliationStatus | null;
	initialProvider: ReconciliationProvider | null;
	initialReference: string | null;
}) {
	const router = useRouter();
	const [status, setStatus] = useState<ReconciliationStatus | typeof ALL>(
		initialStatus ?? ALL,
	);
	const [provider, setProvider] = useState<ReconciliationProvider | typeof ALL>(
		initialProvider ?? ALL,
	);
	const [referenceDraft, setReferenceDraft] = useState(initialReference ?? "");
	const [reference, setReference] = useState(initialReference ?? "");

	const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
	if (status) params.set("status", status);
	if (provider) params.set("provider", provider);
	if (reference) params.set("reference", reference);

	const list = useKeysetList<ReconciliationItem>(
		`${API}?${params}`,
		(row) => row.id,
	);
	const filtered = status !== ALL || provider !== ALL || reference !== "";

	const remember = (
		nextStatus: string,
		nextProvider: string,
		nextReference: string,
	) => {
		const query = new URLSearchParams();
		if (nextStatus) query.set("status", nextStatus);
		if (nextProvider) query.set("provider", nextProvider);
		if (nextReference) query.set("reference", nextReference);
		router.replace(
			`/admin/keuangan/rekonsiliasi${query.size ? `?${query}` : ""}`,
			{ scroll: false },
		);
	};

	return (
		<div className="flex flex-col gap-4" data-testid="reconciliation-page">
			{!access.reconcileWrite && (
				<p
					data-testid="reconciliation-read-only"
					className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
				>
					Hanya lihat: mencocokkan, melepas, atau mengeskalasi mutasi memerlukan izin tulis
					rekonsiliasi keuangan (finance.reconciliation.write).
				</p>
			)}
			<div className="flex flex-wrap items-end justify-between gap-3 max-md:flex-col max-md:items-stretch">
				<div className="grid gap-3 md:grid-cols-[repeat(3,minmax(11rem,15rem))] md:items-end">
					<FilterSheet
						active={
							Number(status !== ALL) +
							Number(provider !== ALL) +
							Number(reference !== "")
						}
					>
						<FormField id="reconciliation-filter-status" label="Status">
							<select
								id="reconciliation-filter-status"
								className={`${nativeSelectClass} w-full`}
								value={status}
								onChange={(e) => {
									const next = e.target.value as
										| ReconciliationStatus
										| typeof ALL;
									setStatus(next);
									remember(next, provider, reference);
								}}
							>
								<option value={ALL}>Semua status</option>
								{RECONCILIATION_STATUSES.map((key) => (
									<option key={key} value={key}>
										{RECONCILIATION_STATUS[key][0]}
									</option>
								))}
							</select>
						</FormField>
						<FormField id="reconciliation-filter-provider" label="Sumber">
							<select
								id="reconciliation-filter-provider"
								className={`${nativeSelectClass} w-full`}
								value={provider}
								onChange={(e) => {
									const next = e.target.value as
										| ReconciliationProvider
										| typeof ALL;
									setProvider(next);
									remember(status, next, reference);
								}}
							>
								<option value={ALL}>Semua sumber</option>
								{RECONCILIATION_PROVIDERS.map((key) => (
									<option key={key} value={key}>
										{RECONCILIATION_PROVIDER_LABEL[key]}
									</option>
								))}
							</select>
						</FormField>
						<FormField id="reconciliation-filter-reference" label="Referensi mutasi">
							<div className="flex gap-2">
								<Input
									id="reconciliation-filter-reference"
									value={referenceDraft}
									maxLength={200}
									onChange={(e) => setReferenceDraft(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											const clean = referenceDraft.trim();
											setReference(clean);
											remember(status, provider, clean);
										}
									}}
								/>
								<Button
									type="button"
									variant="outline"
									data-testid="reconciliation-apply-reference"
									onClick={() => {
										const clean = referenceDraft.trim();
										setReference(clean);
										remember(status, provider, clean);
									}}
								>
									Cari
								</Button>
							</div>
						</FormField>
					</FilterSheet>
				</div>
				<Button
					type="button"
					variant="outline"
					onClick={() => void list.reload()}
				>
					<RefreshCw data-icon="inline-start" aria-hidden="true" />
					Muat ulang
				</Button>
			</div>
			<DataTable
				testId="reconciliation-table"
				caption="Daftar mutasi rekonsiliasi keuangan"
				rows={list.rows}
				rowKey={(row) => row.id}
				rowTestId={(row) => `reconciliation-row-${row.id}`}
				status={list.status}
				loadingLabel="Memuat mutasi rekonsiliasi…"
				empty={
					filtered
						? "Tidak ada mutasi dengan filter ini. Ubah atau hapus filter untuk melihat mutasi lain."
						: "Belum ada mutasi pencairan pembayaran atau setoran COD."
				}
				emptyTestId="reconciliation-empty"
				stack
				paging={{
					...list.paging,
					testId: "reconciliation-more",
					summary: `${list.rows.length} mutasi ditampilkan`,
				}}
				columns={[
					{
						id: "reference",
						header: "Referensi",
						stack: "title",
						cell: (row) => (
							<span className="flex flex-col">
								<Link
									href={adminPath("reconciliation", row.admin_no)}
									className="font-mono font-medium break-all text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
								>
									{row.reference}
								</Link>
								<span className="text-xs text-muted-foreground">
									{RECONCILIATION_PROVIDER_LABEL[row.provider] ?? row.provider} ·{" "}
									{RECONCILIATION_DIRECTION_LABEL[row.direction] ?? row.direction}
								</span>
							</span>
						),
					},
					{
						id: "amount",
						header: "Dana bersih",
						stack: "aside",
						className: "text-right tabular-nums",
						cell: (row) => (
							<span className="font-medium tabular-nums">
								{row.direction === "debit" ? `-${rupiah(row.amount)}` : rupiah(row.amount)}
							</span>
						),
					},
					{
						id: "status",
						header: "Status",
						stack: "status",
						// The problem note wraps under the badge.
						cellClassName: "whitespace-normal md:min-w-48",
						cell: (row) => {
							const [label, tone] = RECONCILIATION_STATUS[row.status] ?? [
								row.status,
								"open",
							];
							return (
								<div className="flex flex-col items-start gap-1">
									<StatusBadge tone={tone} data-status={row.status}>
										{label}
									</StatusBadge>
									{row.problem_code && (
										<span className="text-xs text-muted-foreground">
											{RECONCILIATION_PROBLEM_LABEL[row.problem_code] ??
												row.problem_code}
										</span>
									)}
								</div>
							);
						},
					},
					{
						id: "gross",
						header: "Nominal kotor",
						className: "text-right tabular-nums",
						// The detail page shows the statement totals.
						hideBelow: "5xl",
						cell: (row) =>
							row.statement_totals.gross_amount !== null
								? rupiah(row.statement_totals.gross_amount)
								: "Belum lengkap",
					},
					{
						id: "occurred",
						header: "Waktu mutasi",
						stack: "meta",
						kind: "datetime",
						cell: (row) => formatWib(row.occurred_at),
					},
					{
						id: "actions",
						header: <span className="sr-only">Tindakan</span>,
						className: "text-right",
						cell: (row) => (
							<Button asChild size="sm" variant="outline">
								<Link href={adminPath("reconciliation", row.admin_no)}>
									Buka mutasi
								</Link>
							</Button>
						),
					},
				]}
			/>
		</div>
	);
}

// ---- Detail & Decisions -------------------------------------------------------------------------

type DecisionAction = "match" | "unmatch" | "escalate";

export function ReconciliationDetailClient({
	itemId,
	access,
	canOrders,
}: {
	itemId: string;
	access: FinanceAccess;
	canOrders: boolean;
}) {
	const [detail, setDetail] = useState<ReconciliationDetail | null>(null);
	const [source, setSource] = useState<SettlementSourceDetail | null>(null);
	const [inspectedMatch, setInspectedMatch] = useState<SettlementMatch | null>(
		null,
	);
	const [failure, setFailure] = useState<ApiFailure | null>(null);
	const [dialog, setDialog] = useState<DecisionAction | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);

	const loadMatch = useCallback(
		async (matchId: string) => {
			const res = await getJson<SettlementMatch>(
				`${API}/${encodeURIComponent(itemId)}/matches/${encodeURIComponent(matchId)}`,
			);
			if (res.ok) setInspectedMatch(res.data);
		},
		[itemId],
	);

	const load = useCallback(async () => {
		const res = await getJson<ReconciliationDetail>(
			`${API}/${encodeURIComponent(itemId)}`,
		);
		if (!res.ok) {
			setFailure(res.failure);
			return;
		}
		setFailure(null);
		setDetail(res.data);
		const srcPromise = getJson<SettlementSourceDetail>(
			`/api/v1/admin/settlements/${encodeURIComponent(res.data.item.source_id)}`,
		);
		const targetMatchId =
			res.data.item.current_match_id ?? res.data.item.last_match_id;
		const matchPromise = targetMatchId
			? getJson<SettlementMatch>(
					`${API}/${encodeURIComponent(itemId)}/matches/${encodeURIComponent(targetMatchId)}`,
			  )
			: Promise.resolve(null);
		const [srcRes, matchRes] = await Promise.all([srcPromise, matchPromise]);
		if (srcRes.ok) setSource(srcRes.data);
		if (matchRes?.ok) setInspectedMatch(matchRes.data);
		else setInspectedMatch(res.data.match);
	}, [itemId]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);

	const back = {
		href: "/admin/keuangan/rekonsiliasi",
		label: "Kembali ke daftar rekonsiliasi",
	};

	if (failure && !detail) {
		return (
			<AdminPage>
				<PageHeader back={back} title="Detail rekonsiliasi" />
				<Alert role="alert" data-testid="reconciliation-detail-error">
					<CircleAlert aria-hidden="true" />
					<AlertDescription className="flex flex-wrap items-center gap-3 text-foreground">
						{failure.status === 404 || failure.code === "INVALID_INPUT"
							? "Mutasi rekonsiliasi tidak ditemukan."
							: failureText(failure)}
						{failure.status !== 404 && failure.status !== 403 && (
							<Button size="sm" variant="outline" onClick={() => void load()}>
								Coba lagi
							</Button>
						)}
					</AlertDescription>
				</Alert>
			</AdminPage>
		);
	}

	if (!detail) {
		return (
			<AdminPage>
				<PageHeader back={back} title="Detail rekonsiliasi" />
				<div
					className="flex flex-col gap-3"
					aria-live="polite"
					aria-busy="true"
				>
					<p className="text-sm text-muted-foreground">
						Memuat detail rekonsiliasi…
					</p>
					<Skeleton className="h-8 w-64 bg-border/70" />
					<Skeleton className="h-40 w-full bg-border/70" />
				</div>
			</AdminPage>
		);
	}

	const { item, statement, history } = detail;
	const [statusLabel, statusTone] = RECONCILIATION_STATUS[item.status] ?? [
		item.status,
		"open",
	];
	const activeMatch = inspectedMatch ?? detail.match;

	const actions: ReactNode[] = [];
	if (access.reconcileWrite) {
		actions.push(
			<Button
				key="match"
				data-testid="reconciliation-match-open"
				onClick={() => setDialog("match")}
			>
				Cocokkan mutasi
			</Button>,
		);
		if (item.current_match_id) {
			actions.push(
				<Button
					key="unmatch"
					variant="outline"
					data-testid="reconciliation-unmatch-open"
					onClick={() => setDialog("unmatch")}
				>
					Lepas kecocokan
				</Button>,
			);
		}
		actions.push(
			<Button
				key="escalate"
				variant="outline"
				data-testid="reconciliation-escalate-open"
				onClick={() => setDialog("escalate")}
			>
				Eskalasi tinjauan
			</Button>,
		);
	}

	return (
		<AdminPage testId="reconciliation-detail">
			<PageHeader
				back={back}
				title={item.reference}
				titleTestId="reconciliation-title"
				mono
				badge={
					<StatusBadge
						tone={statusTone}
						testId="reconciliation-status"
						data-status={item.status}
					>
						{statusLabel}
					</StatusBadge>
				}
				description={`${RECONCILIATION_PROVIDER_LABEL[item.provider] ?? item.provider} · ${RECONCILIATION_DIRECTION_LABEL[item.direction] ?? item.direction} · versi ${item.version}`}
				meta={
					<>
						<span>Waktu mutasi {formatWib(item.occurred_at)}</span>
						<span aria-hidden="true">·</span>
						<span>Dicatat {formatWib(item.recorded_at)}</span>
					</>
				}
			/>

			{notice && (
				<Alert
					ref={noticeRef}
					tabIndex={-1}
					role="status"
					className="outline-none"
					data-testid="reconciliation-notice"
				>
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">
						{notice}
					</AlertDescription>
				</Alert>
			)}

			{item.source_processing_pending && (
				<Alert
					role="alert"
					data-testid="reconciliation-source-pending"
					className="border-warning/40 bg-warning-surface"
				>
					<CircleAlert aria-hidden="true" className="text-warning" />
					<AlertDescription className="text-foreground">
						Pernyataan sumber versi {item.latest_source_version} belum selesai diproses sistem
						(saat ini pada versi {item.source_version}). Keputusan akan ditolak sampai pernyataan
						terbaru diproses.
					</AlertDescription>
				</Alert>
			)}

			{item.problem_code && (
				<Alert
					role="status"
					data-testid="reconciliation-problem"
					className="border-warning/40 bg-warning-surface"
				>
					<CircleAlert aria-hidden="true" className="text-warning" />
					<AlertDescription className="text-foreground">
						<strong>Kendala rekonsiliasi:</strong>{" "}
						{RECONCILIATION_PROBLEM_LABEL[item.problem_code] ?? item.explanation}
					</AlertDescription>
				</Alert>
			)}

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
				<div className="flex min-w-0 flex-col gap-4">
					<DetailSection
						id="reconciliation-summary-heading"
						title="Ringkasan mutasi dan pernyataan sumber"
						testId="reconciliation-summary"
					>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
							<dt className="text-muted-foreground">Dana bersih mutasi</dt>
							<dd className="font-semibold tabular-nums">
								{item.direction === "debit"
									? `-${rupiah(item.amount)}`
									: rupiah(item.amount)}
							</dd>
							<dt className="text-muted-foreground">Nominal kotor pernyataan</dt>
							<dd className="tabular-nums">
								{statement.totals.gross_amount !== null
									? rupiah(statement.totals.gross_amount)
									: "Belum lengkap"}
							</dd>
							<dt className="text-muted-foreground">Biaya kurir pernyataan</dt>
							<dd className="tabular-nums">
								{statement.totals.carrier_fee !== null
									? rupiah(statement.totals.carrier_fee)
									: "Belum lengkap"}
							</dd>
							<dt className="text-muted-foreground">Biaya penyedia pernyataan</dt>
							<dd className="tabular-nums">
								{statement.totals.provider_fee !== null
									? rupiah(statement.totals.provider_fee)
									: "Belum lengkap"}
							</dd>
							{item.recorded_fees && (
								<>
									<dt className="text-muted-foreground">Biaya yang diposting</dt>
									<dd className="tabular-nums">
										Kurir {rupiah(item.recorded_fees.carrier_fee)} · Penyedia{" "}
										{rupiah(item.recorded_fees.provider_fee)}
									</dd>
								</>
							)}
							<dt className="text-muted-foreground">Keterangan terakhir</dt>
							<dd>{item.explanation}</dd>
							{item.cash_transaction_id && (
								<>
									<dt className="text-muted-foreground">Jurnal kas</dt>
									<dd className="font-mono text-xs break-all">
										{item.cash_transaction_id}
									</dd>
								</>
							)}
							{item.fee_transaction_id && (
								<>
									<dt className="text-muted-foreground">Jurnal biaya</dt>
									<dd className="font-mono text-xs break-all">
										{item.fee_transaction_id}
									</dd>
								</>
							)}
						</dl>
					</DetailSection>

					<DetailSection
						id="reconciliation-match-heading"
						title="Alokasi kecocokan piutang"
						description="Rincian kecocokan aktif atau historis beserta alokasi piutang pesanan."
						testId="reconciliation-match"
					>
						{!activeMatch ? (
							<p className="text-sm text-muted-foreground">
								Mutasi ini belum memiliki kecocokan piutang.
							</p>
						) : (
							<div className="flex flex-col gap-3">
								<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
									<span className="font-medium">
										Kecocokan <span className="font-mono text-xs">{activeMatch.id.slice(0, 8)}</span>
									</span>
									<StatusBadge
										tone={activeMatch.active ? "success" : "closed"}
										data-testid="match-active-badge"
									>
										{activeMatch.active ? "Aktif" : "Sudah dibatalkan"}
									</StatusBadge>
								</div>
								<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
									<dt>Alasan</dt>
									<dd className="text-foreground">{activeMatch.reason}</dd>
									<dt>Total dialokasikan</dt>
									<dd className="tabular-nums text-foreground">
										Kotor {rupiah(activeMatch.totals.gross_amount)} · Bersih{" "}
										{rupiah(activeMatch.totals.net_amount)}
									</dd>
									<dt>Sisa belum dialokasikan</dt>
									<dd className="tabular-nums text-foreground">
										Kotor {rupiah(activeMatch.remaining.gross_amount)} · Bersih{" "}
										{rupiah(activeMatch.remaining.net_amount)}
									</dd>
									<dt>Jurnal kecocokan</dt>
									<dd className="font-mono break-all">
										{activeMatch.transaction_id}
									</dd>
								</dl>
								<ul className="flex flex-col divide-y rounded-md border">
									{activeMatch.allocations.map((alloc) => (
										<li
											key={alloc.id}
											className="flex flex-col gap-1 p-3 text-sm"
											data-testid="reconciliation-allocation-row"
										>
											<div className="flex flex-wrap items-center justify-between gap-2">
												<span className="font-mono text-xs break-all">
													Piutang {alloc.receivable_transaction_id}
												</span>
												<span className="font-medium tabular-nums">
													{rupiah(alloc.gross_amount)}
												</span>
											</div>
											<div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
												<span>Bersih {rupiah(alloc.net_amount)}</span>
												<span>Kurir {rupiah(alloc.carrier_fee)}</span>
												<span>Penyedia {rupiah(alloc.provider_fee)}</span>
												{canOrders ? (
													<Link
														href={adminPath("order", alloc.order_admin_no)}
														className="text-primary underline-offset-4 hover:underline"
													>
														Pesanan #{alloc.order_admin_no}
													</Link>
												) : (
													<span>Pesanan #{alloc.order_admin_no}</span>
												)}
											</div>
										</li>
									))}
								</ul>
							</div>
						)}
					</DetailSection>

					{source && (
						<DetailSection
							id="reconciliation-source-heading"
							title="Sumber mutasi & riwayat pernyataan"
							description={`Pengiriman belum terdaftar: ${source.unregistered_deliveries}`}
							testId="reconciliation-source"
						>
							<ul className="flex flex-col divide-y rounded-md border">
								{source.statements.map((stmt) => (
									<li
										key={stmt.id}
										className="flex flex-col gap-1 p-3 text-sm"
										data-testid="reconciliation-statement-row"
									>
										<div className="flex items-center justify-between gap-2">
											<span className="font-medium">
												Pernyataan versi {stmt.version}{" "}
												<span className="font-mono text-xs text-muted-foreground">
													({stmt.id.slice(0, 8)})
												</span>
											</span>
											<span className="text-xs text-muted-foreground tabular-nums">
												{formatWib(stmt.reported_at)}
											</span>
										</div>
										<p className="text-xs text-muted-foreground tabular-nums">
											{stmt.totals.gross_amount === null &&
											stmt.totals.carrier_fee === null &&
											stmt.totals.provider_fee === null
												? "Total belum dilaporkan sumber"
												: (
														[
															["Kotor", stmt.totals.gross_amount],
															["Kurir", stmt.totals.carrier_fee],
															["Penyedia", stmt.totals.provider_fee],
														] as const
													)
														.map(
															([label, value]) =>
																`${label}: ${value !== null ? rupiah(value) : "belum dilaporkan"}`,
														)
														.join(" · ")}
											{stmt.allocation_claims
												? ` · ${stmt.allocation_claims.length} klaim alokasi`
												: " · tanpa klaim alokasi"}
										</p>
									</li>
								))}
							</ul>
						</DetailSection>
					)}
				</div>

				<div className="flex min-w-0 flex-col gap-4">
					<DetailSection
						id="reconciliation-actions-heading"
						title="Tindakan rekonsiliasi"
						testId="reconciliation-actions"
					>
						<p className="text-sm text-muted-foreground">
							{access.reconcileWrite
								? "Setiap keputusan membutuhkan alasan audit dan konfirmasi kata sandi sekali pakai."
								: "Peran Anda hanya memiliki akses baca pada rekonsiliasi keuangan."}
						</p>
						{actions.length > 0 && (
							<StickyActions className="md:flex-col md:items-stretch">
								{actions}
							</StickyActions>
						)}
					</DetailSection>

					<DetailSection
						id="reconciliation-history-heading"
						title="Riwayat peristiwa"
						testId="reconciliation-history"
					>
						<ol className="flex flex-col divide-y rounded-md border">
							{history.map((event) => {
								const [label, tone] = RECONCILIATION_STATUS[event.status] ?? [
									event.status,
									"open",
								];
								return (
									<li
										key={event.id}
										className="flex flex-col gap-1.5 p-3 text-sm"
										data-testid="reconciliation-history-row"
									>
										<div className="flex items-start justify-between gap-2">
											<span className="font-medium">
												v{event.version} ·{" "}
												{RECONCILIATION_EVENT_KIND[event.kind] ?? event.kind}
											</span>
											<StatusBadge tone={tone}>{label}</StatusBadge>
										</div>
										<p className="text-xs text-muted-foreground">
											{event.reason}
										</p>
										<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
											<span className="tabular-nums">
												{formatWib(event.occurred_at)}
											</span>
											{event.match_id && (
												<Button
													type="button"
													size="sm"
													variant="ghost"
													data-testid={`inspect-match-${event.match_id}`}
													onClick={() => void loadMatch(event.match_id as string)}
												>
													Lihat kecocokan #{event.match_id.slice(0, 8)}
												</Button>
											)}
										</div>
									</li>
								);
							})}
						</ol>
					</DetailSection>
				</div>
			</div>

			{dialog && (
				<ReconcileDecisionDialog
					action={dialog}
					item={item}
					statement={statement}
					currentMatch={activeMatch}
					onClose={() => setDialog(null)}
					onUncertain={() => void load()}
					onConflict={() => void load()}
					onDone={(text) => {
						setDialog(null);
						setNotice(text);
						void load();
					}}
				/>
			)}
		</AdminPage>
	);
}

type DraftClaim = {
	key: string;
	receivable_transaction_id: string;
	gross_amount: string;
	reopens_allocation_id: string;
};

function initialClaims(
	item: ReconciliationItem,
	statement: SettlementStatement,
	currentMatch: SettlementMatch | null,
): DraftClaim[] {
	if (statement.allocation_claims && statement.allocation_claims.length > 0) {
		return statement.allocation_claims.map((c, idx) => ({
			key: `claim-${idx}-${c.receivable_transaction_id}`,
			receivable_transaction_id: c.receivable_transaction_id,
			gross_amount: String(c.gross_amount),
			reopens_allocation_id: c.reopens_allocation_id ?? "",
		}));
	}
	if (currentMatch && currentMatch.allocations.length > 0) {
		return currentMatch.allocations.map((a) => ({
			key: `alloc-${a.id}`,
			receivable_transaction_id: a.receivable_transaction_id,
			gross_amount: String(a.gross_amount),
			reopens_allocation_id: a.reopens_allocation_id ?? "",
		}));
	}
	return [
		{
			key: "initial-0",
			receivable_transaction_id: "",
			gross_amount: String(statement.totals.gross_amount ?? item.amount),
			reopens_allocation_id: "",
		},
	];
}

function ReconcileDecisionDialog({
	action,
	item,
	statement,
	currentMatch,
	onClose,
	onUncertain,
	onConflict,
	onDone,
}: {
	action: DecisionAction;
	item: ReconciliationItem;
	statement: SettlementStatement;
	currentMatch: SettlementMatch | null;
	onClose: () => void;
	onUncertain: () => void;
	onConflict: () => void;
	onDone: (text: string) => void;
}) {
	// Frozen on mount so a background reload after 409 VERSION_CONFLICT cannot silently advance the dialog's target version.
	const [capturedVersion] = useState(item.version);
	const [capturedMatchId] = useState(item.current_match_id);
	const [capturedSourceRef] = useState(item.source_reference);
	const [claims, setClaims] = useState<DraftClaim[]>(() =>
		initialClaims(item, statement, currentMatch),
	);
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const intent = useFinanceIntent();

	const title =
		action === "match"
			? "Cocokkan mutasi dengan piutang"
			: action === "unmatch"
				? "Lepas kecocokan mutasi"
				: "Eskalasi mutasi ke tinjauan";
	const description =
		action === "match"
			? "Mencocokkan pernyataan sumber dengan transaksi piutang terverifikasi. Bila sudah ada kecocokan aktif, kecocokan lama akan dibalik secara tertaut."
			: action === "unmatch"
				? "Membalik kecocokan piutang aktif dan mengembalikan mutasi ke status menunggu pencocokan. Jurnal kas dan biaya tetap terjaga."
				: "Menandai mutasi sebagai perlu tinjauan keuangan tanpa mengubah jurnal kas.";

	async function submit() {
		if (!reason.trim() || !password) {
			return intent.setError("Alasan dan kata sandi wajib diisi.");
		}
		const parsedAllocations: {
			receivable_transaction_id: string;
			gross_amount: number;
			reopens_allocation_id: string | null;
		}[] = [];
		if (action === "match") {
			if (claims.length === 0) {
				return intent.setError("Tambahkan minimal satu alokasi piutang.");
			}
			for (const [idx, row] of claims.entries()) {
				const txId = row.receivable_transaction_id.trim();
				const gross = Number(row.gross_amount.replace(/[.\s]/g, ""));
				if (!txId || !Number.isSafeInteger(gross) || gross < 1) {
					return intent.setError(
						`Baris alokasi ${idx + 1}: isi ID transaksi piutang (UUID) dan nominal kotor positif.`,
					);
				}
				const reopens = row.reopens_allocation_id.trim();
				parsedAllocations.push({
					receivable_transaction_id: txId,
					gross_amount: gross,
					reopens_allocation_id: reopens ? reopens : null,
				});
			}
		}

		const saved = await intent.run<ReconciliationItem>(
			`${API}/${encodeURIComponent(item.id)}/decisions`,
			() => ({
				action,
				expected_version: capturedVersion,
				expected_match_id: capturedMatchId,
				source_reference: capturedSourceRef,
				reason: reason.trim(),
				allocations: parsedAllocations,
			}),
			{
				money: {
					password,
					action: "finance.reconcile",
					subject: item.id,
				},
				onUncertain,
				onConflict,
			},
		);
		if (saved) {
			const [statusText] = RECONCILIATION_STATUS[saved.status] ?? [
				saved.status,
				"open",
			];
			onDone(
				`Keputusan rekonsiliasi tersimpan (versi ${saved.version}). Status mutasi: ${statusText}.`,
			);
		}
	}

	return (
		<FormDialog
			title={title}
			description={description}
			pending={intent.pending}
			pendingLabel="Memproses…"
			error={intent.error}
			submitLabel={
				intent.uncertain
					? "Kirim ulang (kunci sama)"
					: action === "match"
						? "Simpan pencocokan"
						: action === "unmatch"
							? "Lepas kecocokan"
							: "Eskalasi mutasi"
			}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			{action === "match" && (
				<div className="flex flex-col gap-3">
					<div className="flex items-center justify-between gap-2">
						<span className="text-sm font-medium">Alokasi piutang</span>
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={intent.uncertain || claims.length >= 20}
							data-testid="reconciliation-add-allocation"
							onClick={() =>
								setClaims((current) => [
									...current,
									{
										key: crypto.randomUUID(),
										receivable_transaction_id: "",
										gross_amount: "",
										reopens_allocation_id: "",
									},
								])
							}
						>
							<Plus data-icon="inline-start" aria-hidden="true" />
							Tambah baris
						</Button>
					</div>
					{claims.map((claim, idx) => (
						<div
							key={claim.key}
							className="flex flex-col gap-2 rounded-md border p-3"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs font-medium text-muted-foreground">
									Alokasi #{idx + 1}
								</span>
								{claims.length > 1 && (
									<Button
										type="button"
										size="sm"
										variant="ghost"
										disabled={intent.uncertain}
										onClick={() =>
											setClaims((current) =>
												current.filter((_, i) => i !== idx),
											)
										}
									>
										<Trash2 aria-hidden="true" />
										<span className="sr-only">Hapus baris {idx + 1}</span>
									</Button>
								)}
							</div>
							<FormField
								id={`reconcile-tx-${idx}`}
								label="ID transaksi piutang (UUID)"
							>
								<Input
									id={`reconcile-tx-${idx}`}
									data-testid={`reconciliation-alloc-tx-${idx}`}
									className="font-mono text-xs"
									disabled={intent.uncertain}
									value={claim.receivable_transaction_id}
									onChange={(e) =>
										setClaims((current) =>
											current.map((row, i) =>
												i === idx
													? { ...row, receivable_transaction_id: e.target.value }
													: row,
											),
										)
									}
								/>
							</FormField>
							<FormField
								id={`reconcile-gross-${idx}`}
								label="Nominal kotor (Rp)"
							>
								<Input
									id={`reconcile-gross-${idx}`}
									data-testid={`reconciliation-alloc-gross-${idx}`}
									inputMode="numeric"
									disabled={intent.uncertain}
									value={claim.gross_amount}
									onChange={(e) =>
										setClaims((current) =>
											current.map((row, i) =>
												i === idx
													? { ...row, gross_amount: e.target.value }
													: row,
											),
										)
									}
								/>
							</FormField>
							{item.direction === "debit" && (
								<FormField
									id={`reconcile-reopens-${idx}`}
									label="ID alokasi kredit yang dibuka kembali (wajib untuk debit)"
								>
									<Input
										id={`reconcile-reopens-${idx}`}
										data-testid={`reconciliation-alloc-reopens-${idx}`}
										className="font-mono text-xs"
										disabled={intent.uncertain}
										value={claim.reopens_allocation_id}
										onChange={(e) =>
											setClaims((current) =>
												current.map((row, i) =>
													i === idx
														? { ...row, reopens_allocation_id: e.target.value }
														: row,
												),
											)
										}
									/>
								</FormField>
							)}
						</div>
					))}
				</div>
			)}

			<FormField id="reconcile-reason" label="Alasan keputusan (wajib)">
				<Input
					id="reconcile-reason"
					data-testid="reconciliation-reason"
					maxLength={500}
					disabled={intent.uncertain}
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>
			<FormField
				id="reconcile-password"
				label="Konfirmasi kata sandi"
				hint="Berlaku satu kali untuk mutasi ini (finance.reconcile)."
			>
				<Input
					id="reconcile-password"
					data-testid="reconciliation-password"
					type="password"
					autoComplete="current-password"
					aria-describedby="reconcile-password-hint"
					disabled={intent.uncertain}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
			</FormField>
		</FormDialog>
	);
}
