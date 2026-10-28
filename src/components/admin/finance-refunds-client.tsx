"use client";

import { CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
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
	ADMIN_REFUND_STATUS,
	ADMIN_REFUND_STATUSES,
	type AdminRefund,
	type AdminRefundStatus,
	type FinanceAccess,
} from "./finance-model";
import { formatWib, rupiah } from "./format";
import { FormDialog, FormField, nativeSelectClass } from "./form";
import { AdminPage, DetailSection, PageHeader, StickyActions } from "./page-blocks";
import { StatusBadge } from "./status";
import { useKeysetList } from "./use-keyset-list";
import { adminPath } from "@/modules/access/admin-paths";

const PAGE_SIZE = 20;
const ALL = "";
const API = "/api/v1/admin/refunds";

export function RefundsListClient({
	access,
	canOrders,
	initialStatus,
}: {
	access: FinanceAccess;
	canOrders: boolean;
	initialStatus: AdminRefundStatus | null;
}) {
	const router = useRouter();
	const [status, setStatus] = useState<AdminRefundStatus | typeof ALL>(
		initialStatus ?? ALL,
	);

	const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
	if (status) params.set("status", status);
	const list = useKeysetList<AdminRefund>(`${API}?${params}`, (row) => row.id);
	const filtered = status !== ALL;

	const remember = (nextStatus: string) => {
		const query = new URLSearchParams();
		if (nextStatus) query.set("status", nextStatus);
		router.replace(`/admin/finance/refunds${query.size ? `?${query}` : ""}`, {
			scroll: false,
		});
	};

	return (
		<div className="flex flex-col gap-4" data-testid="refunds-page">
			{!access.refundWrite && (
				<p
					data-testid="refunds-read-only"
					className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
				>
					Hanya lihat: merekonsiliasi atau mencoba ulang refund memerlukan izin tulis refund
					keuangan (finance.refunds.write).
				</p>
			)}
			<div className="flex flex-wrap items-end justify-between gap-3 max-md:flex-col max-md:items-stretch">
				<FormField
					id="refund-filter-status"
					label="Status"
					className="md:w-64"
				>
					<select
						id="refund-filter-status"
						className={`${nativeSelectClass} w-full`}
						value={status}
						onChange={(e) => {
							const next = e.target.value as AdminRefundStatus | typeof ALL;
							setStatus(next);
							remember(next);
						}}
					>
						<option value={ALL}>Semua status</option>
						{ADMIN_REFUND_STATUSES.map((key) => (
							<option key={key} value={key}>
								{ADMIN_REFUND_STATUS[key][0]}
							</option>
						))}
					</select>
				</FormField>
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
				testId="refunds-table"
				caption="Daftar kewajiban dan hasil pengiriman refund retur"
				rows={list.rows}
				rowKey={(row) => row.id}
				rowTestId={(row) => `refund-row-${row.id}`}
				status={list.status}
				loadingLabel="Memuat daftar refund…"
				empty={
					filtered
						? "Tidak ada refund dengan status ini. Ubah atau hapus filter untuk melihat refund lain."
						: "Belum ada refund retur yang diajukan."
				}
				emptyTestId="refunds-empty"
				stack
				paging={{
					...list.paging,
					testId: "refunds-more",
					summary: `${list.rows.length} refund ditampilkan`,
				}}
				columns={[
					{
						id: "refund",
						header: "Refund",
						stack: "title",
						cell: (row) => (
							<span className="flex flex-col">
								<Link
									href={adminPath("refund", row.admin_no)}
									className="font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
								>
									Refund <span className="font-mono">#{row.admin_no}</span>
								</Link>
								{row.explanation && (
									<span className="text-xs text-muted-foreground">
										{row.explanation}
									</span>
								)}
							</span>
						),
					},
					{
						id: "amount",
						header: "Nominal",
						stack: "aside",
						className: "text-right tabular-nums",
						cell: (row) => (
							<span className="font-medium tabular-nums">
								{rupiah(row.amount)}
							</span>
						),
					},
					{
						id: "status",
						header: "Status",
						stack: "status",
						cell: (row) => {
							const [label, tone] = ADMIN_REFUND_STATUS[row.status] ?? [
								row.status,
								"open",
							];
							return (
								<StatusBadge tone={tone} data-status={row.status}>
									{label}
								</StatusBadge>
							);
						},
					},
					{
						id: "links",
						header: "Kasus retur",
						className: "md:max-lg:hidden",
						cell: (row) => (
							<div className="flex flex-wrap items-center gap-2 text-xs">
								<Link
									href={adminPath("return", row.return_admin_no)}
									className="font-mono text-primary underline-offset-4 hover:underline"
								>
									Retur #{row.return_admin_no}
								</Link>
								{canOrders && (
									<>
										<span aria-hidden="true">·</span>
										<Link
											href={adminPath("order", row.order_admin_no)}
											className="font-mono text-primary underline-offset-4 hover:underline"
										>
											Pesanan #{row.order_admin_no}
										</Link>
									</>
								)}
							</div>
						),
					},
					{
						id: "created",
						header: "Diajukan",
						stack: "meta",
						className: "whitespace-nowrap tabular-nums",
						cell: (row) => formatWib(row.created_at),
					},
					{
						id: "actions",
						header: <span className="sr-only">Tindakan</span>,
						className: "text-right",
						cell: (row) => (
							<Button asChild size="sm" variant="outline">
								<Link href={adminPath("refund", row.admin_no)}>
									Buka refund
								</Link>
							</Button>
						),
					},
				]}
			/>
		</div>
	);
}

// ---- Detail & Reconcile / Retry -----------------------------------------------------------------

type RefundAction = "reconcile" | "retry";

export function RefundDetailClient({
	refundId,
	access,
	canOrders,
}: {
	refundId: string;
	access: FinanceAccess;
	canOrders: boolean;
}) {
	const [refund, setRefund] = useState<AdminRefund | null>(null);
	const [failure, setFailure] = useState<ApiFailure | null>(null);
	const [dialog, setDialog] = useState<RefundAction | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);

	const load = useCallback(async () => {
		const res = await getJson<AdminRefund>(
			`${API}/${encodeURIComponent(refundId)}`,
		);
		if (!res.ok) {
			setFailure(res.failure);
			return;
		}
		setFailure(null);
		setRefund(res.data);
	}, [refundId]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);

	const back = {
		href: "/admin/finance/refunds",
		label: "Kembali ke daftar refund",
	};

	if (failure && !refund) {
		return (
			<AdminPage>
				<PageHeader back={back} title="Detail refund" />
				<Alert role="alert" data-testid="refund-detail-error">
					<CircleAlert aria-hidden="true" />
					<AlertDescription className="flex flex-wrap items-center gap-3 text-foreground">
						{failure.status === 404 || failure.code === "INVALID_INPUT"
							? "Refund tidak ditemukan."
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

	if (!refund) {
		return (
			<AdminPage>
				<PageHeader back={back} title="Detail refund" />
				<div
					className="flex flex-col gap-3"
					aria-live="polite"
					aria-busy="true"
				>
					<p className="text-sm text-muted-foreground">
						Memuat detail refund…
					</p>
					<Skeleton className="h-8 w-64 bg-border/70" />
					<Skeleton className="h-40 w-full bg-border/70" />
				</div>
			</AdminPage>
		);
	}

	const [statusLabel, statusTone] = ADMIN_REFUND_STATUS[refund.status] ?? [
		refund.status,
		"open",
	];
	const reconcilable =
		refund.status === "queued" ||
		refund.status === "processing" ||
		refund.status === "unknown" ||
		refund.status === "failed";

	const actions: ReactNode[] = [];
	if (access.refundWrite && reconcilable) {
		actions.push(
			<Button
				key="reconcile"
				variant={refund.status === "unknown" ? "default" : "outline"}
				data-testid="refund-reconcile"
				onClick={() => setDialog("reconcile")}
			>
				Rekonsiliasi
			</Button>,
		);
	}
	// Money safety: retry is offered ONLY for a proven failure, never for unknown/queued/processing/succeeded.
	if (access.refundWrite && refund.status === "failed") {
		actions.push(
			<Button
				key="retry"
				data-testid="refund-retry"
				onClick={() => setDialog("retry")}
			>
				Coba ulang
			</Button>,
		);
	}

	return (
		<AdminPage testId="refund-detail">
			<PageHeader
				back={back}
				title={
					<>
						Refund <span className="font-mono">#{refund.admin_no}</span>
					</>
				}
				titleTestId="refund-title"
				badge={
					<StatusBadge
						tone={statusTone}
						testId="refund-status"
						data-status={refund.status}
					>
						{statusLabel}
					</StatusBadge>
				}
				description={`Nominal ${rupiah(refund.amount)} · versi ${refund.version}`}
				meta={
					<>
						<span>Diajukan {formatWib(refund.created_at)}</span>
						<span aria-hidden="true">·</span>
						<Link
							href={adminPath("return", refund.return_admin_no)}
							className="text-primary underline-offset-4 hover:underline"
						>
							Buka retur #{refund.return_admin_no}
						</Link>
						{canOrders && (
							<>
								<span aria-hidden="true">·</span>
								<Link
									href={adminPath("order", refund.order_admin_no)}
									className="text-primary underline-offset-4 hover:underline"
								>
									Buka pesanan #{refund.order_admin_no}
								</Link>
							</>
						)}
					</>
				}
			/>

			{notice && (
				<Alert
					ref={noticeRef}
					tabIndex={-1}
					role="status"
					className="outline-none"
					data-testid="refund-notice"
				>
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">
						{notice}
					</AlertDescription>
				</Alert>
			)}

			{refund.status === "unknown" && (
				<Alert role="alert" data-testid="refund-unknown">
					<CircleAlert aria-hidden="true" />
					<AlertDescription className="text-foreground">
						Hasil pengiriman dana belum pasti; dana mungkin sudah keluar dari bank. Jangan
						mengajukan refund lagi dan jangan coba ulang. Rekonsiliasi memeriksa hasil refund
						yang sama tanpa mengirim dana baru.
					</AlertDescription>
				</Alert>
			)}

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
				<div className="flex min-w-0 flex-col gap-4">
					<DetailSection
						id="refund-summary-heading"
						title="Rincian kewajiban refund"
						testId="refund-summary"
					>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
							<dt className="text-muted-foreground">ID refund</dt>
							<dd className="font-mono text-xs break-all">{refund.id}</dd>
							<dt className="text-muted-foreground">Nominal</dt>
							<dd
								className="font-semibold tabular-nums"
								data-testid="refund-amount"
							>
								{rupiah(refund.amount)}
							</dd>
							<dt className="text-muted-foreground">ID kasus retur</dt>
							<dd className="font-mono text-xs break-all">
								{refund.return_case_id}
							</dd>
							<dt className="text-muted-foreground">ID pesanan</dt>
							<dd className="font-mono text-xs break-all">{refund.order_id}</dd>
							<dt className="text-muted-foreground">Versi</dt>
							<dd className="tabular-nums">{refund.version}</dd>
							{refund.explanation && (
								<>
									<dt className="text-muted-foreground">Keterangan</dt>
									<dd>{refund.explanation}</dd>
								</>
							)}
						</dl>
					</DetailSection>
				</div>

				<div className="flex min-w-0 flex-col gap-4">
					<DetailSection
						id="refund-actions-heading"
						title="Tindakan keuangan"
						testId="refund-actions"
					>
						<p className="text-sm text-muted-foreground">
							{!access.refundWrite
								? "Peran Anda hanya memiliki akses baca pada refund."
								: refund.status === "awaiting_destination"
									? "Refund COD menunggu pembeli menerima rekening tujuan yang diverifikasi."
									: refund.status === "succeeded"
										? "Pengembalian dana telah selesai dikonfirmasi."
										: refund.status === "unknown"
											? "Hasil pengiriman dana belum pasti. Gunakan Rekonsiliasi untuk memulihkan hasil asli tanpa mengirim ulang."
											: refund.status === "failed"
												? "Kegagalan pengiriman dana terbukti tanpa dana keluar: gunakan Rekonsiliasi atau Coba ulang."
												: "Refund sedang dalam antrean atau diproses. Rekonsiliasi memeriksa ulang hasil yang tertahan."}
						</p>
						{actions.length > 0 && (
							<StickyActions className="md:flex-col md:items-stretch">
								{actions}
							</StickyActions>
						)}
					</DetailSection>
				</div>
			</div>

			{dialog && (
				<RefundActionDialog
					action={dialog}
					refund={refund}
					onClose={() => setDialog(null)}
					onUncertain={() => void load()}
					onConflict={() => void load()}
					onDone={(saved, act) => {
						setDialog(null);
						setRefund(saved);
						const [st] = ADMIN_REFUND_STATUS[saved.status] ?? [
							saved.status,
							"open",
						];
						setNotice(
							act === "retry"
								? `Percobaan baru untuk refund ${rupiah(saved.amount)} masuk antrean. Status: ${st}.`
								: `Rekonsiliasi refund dijalankan. Status: ${st}.`,
						);
					}}
				/>
			)}
		</AdminPage>
	);
}

function RefundActionDialog({
	action,
	refund,
	onClose,
	onUncertain,
	onConflict,
	onDone,
}: {
	action: RefundAction;
	refund: AdminRefund;
	onClose: () => void;
	onUncertain: () => void;
	onConflict: () => void;
	onDone: (saved: AdminRefund, action: RefundAction) => void;
}) {
	// Frozen on mount so background reload after 409 VERSION_CONFLICT cannot silently advance the dialog's target version.
	const [capturedVersion] = useState(refund.version);
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const intent = useFinanceIntent();
	const retry = action === "retry";

	async function submit() {
		if (!reason.trim() || !password) {
			return intent.setError("Isi alasan dan kata sandi.");
		}
		const saved = await intent.run<AdminRefund>(
			`${API}/${encodeURIComponent(refund.id)}/reconciliations`,
			() => ({
				action,
				expected_version: capturedVersion,
				reason: reason.trim(),
			}),
			{
				money: {
					password,
					action: "finance.refund",
					subject: refund.id,
				},
				onUncertain,
				onConflict,
			},
		);
		if (saved) onDone(saved, action);
	}

	return (
		<FormDialog
			title={retry ? "Coba ulang refund" : "Rekonsiliasi refund"}
			description={
				retry
					? "Hanya untuk kegagalan yang terbukti tanpa dana keluar. Server memeriksa ulang sebelum membuat percobaan pengiriman baru untuk kewajiban refund yang sama."
					: "Memeriksa ulang hasil bank asli untuk refund ini dan memulihkan callback yang tertahan tanpa mengirim dana baru."
			}
			pending={intent.pending}
			pendingLabel="Memproses…"
			error={intent.error}
			submitLabel={
				intent.uncertain
					? "Kirim ulang (kunci sama)"
					: retry
						? "Coba ulang"
						: "Rekonsiliasi"
			}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id="refund-reason" label="Alasan (wajib)">
				<Input
					id="refund-reason"
					data-testid="refund-reason"
					maxLength={500}
					disabled={intent.uncertain}
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>
			<FormField
				id="refund-password"
				label="Konfirmasi kata sandi"
				hint="Berlaku satu kali untuk tindakan refund ini (finance.refund)."
			>
				<Input
					id="refund-password"
					data-testid="refund-password"
					type="password"
					autoComplete="current-password"
					aria-describedby="refund-password-hint"
					disabled={intent.uncertain}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
			</FormField>
		</FormDialog>
	);
}
