"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type ApiFailure, failureText, getJson } from "./admin-errors";
import { ApplyDialog, DecideDialog } from "./exception-decision-dialogs";
import {
	type CommerceException,
	canApply,
	canDecide,
	canIntake,
	canReinspect,
	type ExceptionAccess,
	KIND,
	KIND_HINT,
	PHYSICAL,
	PROPOSAL,
	REFUND_NEXT,
	type RecoveryRefund,
	type RecoveryRefundList,
	SOURCE_KIND,
	STATUS,
} from "./exception-model";
import { IntakeDialog, StockReportDialog } from "./exception-physical-dialogs";
import {
	QueueRefundDialog,
	RefundActionDialog,
	type RefundDialog,
	RefundPanel,
	type RefundsState,
} from "./exception-refund-panel";
import { formatWib } from "./format";
import { AdminPage, DetailSection, PageHeader, StickyActions } from "./page-blocks";
import { StatusBadge } from "./status";
import { adminPath } from "@/modules/access/admin-paths";

// S133: one commerce exception end to end. The API owns the state machine and the scope; this
// screen offers only the next steps the case status and the viewer's roles allow, sends the case
// version it read, and reloads the authorized projection after every action. Nothing here
// computes money or stock: amounts, capacity and physical facts come from the server.

type Dialog =
	| { kind: "decide" }
	| { kind: "apply" }
	| { kind: "reinspect" }
	| { kind: "intake" }
	| RefundDialog;

const API = "/api/v1/admin/commerce-exceptions";

export function ExceptionDetailClient({
	exceptionId,
	access,
	canOrders,
}: {
	exceptionId: string;
	access: ExceptionAccess;
	canOrders: boolean;
}) {
	const [detail, setDetail] = useState<CommerceException | null>(null);
	const [failure, setFailure] = useState<ApiFailure | null>(null);
	const [refunds, setRefunds] = useState<RefundsState>({ kind: "loading" });
	const [dialog, setDialog] = useState<Dialog | null>(null);
	const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);

	const loadRefunds = useCallback(async () => {
		if (!access.refundRead) return;
		const read = await getJson<RecoveryRefundList>(`${API}/${encodeURIComponent(exceptionId)}/refunds`);
		setRefunds(
			read.ok
				? { kind: "ready", refunds: read.data.refunds }
				: { kind: "error", text: `Refund tidak dapat dimuat. ${failureText(read.failure)}` },
		);
	}, [access.refundRead, exceptionId]);
	const load = useCallback(async () => {
		const read = await getJson<CommerceException>(`${API}/${encodeURIComponent(exceptionId)}`);
		if (!read.ok) return setFailure(read.failure);
		setFailure(null);
		setDetail(read.data);
		await loadRefunds();
	}, [exceptionId, loadRefunds]);
	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);

	const back = { href: "/admin/pesanan/kendala", label: "Kembali ke daftar kasus" };
	if (failure && !detail)
		return (
			<AdminPage>
				<PageHeader back={back} title="Detail kasus" />
				<Alert role="alert" data-testid="exception-detail-error">
					<CircleAlert aria-hidden="true" />
					<AlertDescription className="flex flex-wrap items-center gap-3 text-foreground">
						{failure.status === 404 || failure.code === "INVALID_INPUT"
							? "Kasus tidak ditemukan atau berada di luar gudang yang ditugaskan ke akun Anda."
							: failure.status === 403
								? "Akun Anda tidak punya akses ke kasus pengiriman. Verifikasi dua langkah harus aktif."
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
	if (!detail)
		return (
			<AdminPage>
				<PageHeader back={back} title="Detail kasus" />
				<div className="flex flex-col gap-3" aria-live="polite" aria-busy="true">
					<p className="text-sm text-muted-foreground">Memuat detail kasus…</p>
					<Skeleton className="h-8 w-64 bg-border/70" />
					<Skeleton className="h-40 w-full bg-border/70" />
				</div>
			</AdminPage>
		);

	const d = detail;
	const [statusLabel, statusTone] = STATUS[d.status];
	const done = (text: string, warn = false) => {
		setDialog(null);
		setNotice({ text, warn });
		void load();
	};
	// The answer of a write was lost: refresh behind the open dialog, keep its intent.
	const uncertain = () => void load();

	// Same rule as the refund card's buttons, so this column never says "no action" beside one.
	const refundActionable =
		access.refundWrite &&
		refunds.kind === "ready" &&
		refunds.refunds.some((r) => ["queued", "processing", "unknown", "failed"].includes(r.status));
	const apply = access.review && canApply(d);
	const actions: ReactNode[] = [];
	if (apply)
		actions.push(
			<Button key="apply" data-testid="exception-apply" onClick={() => setDialog({ kind: "apply" })}>
				Terapkan persetujuan pembeli
			</Button>,
		);
	if (access.review && canDecide(d.status))
		actions.push(
			<Button key="decide" variant={apply ? "outline" : "default"} data-testid="exception-decide" onClick={() => setDialog({ kind: "decide" })}>
				Putuskan penanganan
			</Button>,
		);
	if (access.warehouse && canIntake(d))
		actions.push(
			<Button key="intake" variant="outline" data-testid="exception-intake" onClick={() => setDialog({ kind: "intake" })}>
				Catat barang kembali
			</Button>,
		);
	if (access.warehouse && canReinspect(d))
		actions.push(
			<Button key="reinspect" variant="outline" data-testid="exception-reinspect" onClick={() => setDialog({ kind: "reinspect" })}>
				Hitung ulang stok
			</Button>,
		);
	if (access.refundWrite && d.status === "ready_for_refund")
		actions.push(
			<Button key="queue" data-testid="exception-queue-refund" onClick={() => setDialog({ kind: "queue" })}>
				Ajukan refund
			</Button>,
		);

	return (
		<AdminPage testId="exception-detail">
			<PageHeader
				back={back}
				title={KIND[d.kind]}
				titleTestId="exception-title"
				badge={
					<StatusBadge tone={statusTone} testId="exception-status" data-status={d.status}>
						{statusLabel}
					</StatusBadge>
				}
				description={KIND_HINT[d.kind]}
				meta={
					<>
						{d.order_number && (
							<span>
								Pesanan{" "}
								{canOrders && d.order_admin_no != null ? (
									<Link
										href={adminPath("order", d.order_admin_no)}
										className="font-mono text-primary underline-offset-4 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
									>
										{d.order_number}
									</Link>
								) : (
									<span className="font-mono">{d.order_number}</span>
								)}
							</span>
						)}
						<span aria-hidden="true">·</span>
						<span>
							{SOURCE_KIND[d.source_kind] ?? d.source_kind} {formatWib(d.occurred_at)}
						</span>
						<span aria-hidden="true">·</span>
						<span>Dibuka {formatWib(d.created_at)}</span>
					</>
				}
			/>
			{notice && (
				<Alert
					ref={noticeRef}
					tabIndex={-1}
					role="status"
					className={cn("outline-none", notice.warn && "border-warning/40 bg-warning-surface")}
					data-testid="exception-notice"
					data-tone={notice.warn ? "warning" : "success"}
				>
					{notice.warn ? <CircleAlert aria-hidden="true" className="text-warning" /> : <CircleCheck aria-hidden="true" />}
					<AlertDescription className="text-foreground">{notice.text}</AlertDescription>
				</Alert>
			)}
			{failure && (
				<Alert role="alert" data-testid="exception-reload-error">
					<CircleAlert aria-hidden="true" />
					<AlertDescription className="flex flex-wrap items-center gap-3 text-foreground">
						Status terbaru belum bisa dimuat. {failureText(failure)}
						<Button size="sm" variant="outline" onClick={() => void load()}>
							Muat ulang
						</Button>
					</AlertDescription>
				</Alert>
			)}
			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
				<div className="flex min-w-0 flex-col gap-4">
					<DetailSection id="exception-units-heading" title="Unit terdampak" description="Setiap unit adalah satu paket penawaran lengkap, bukan komponen lepas." testId="exception-units">
						<ul className="flex flex-col divide-y rounded-md border">
							{d.units.map((unit, index) => {
								const [label, tone] = PHYSICAL[unit.physical_state];
								return (
									<li key={unit.id} className="flex flex-col gap-1 p-3" data-testid="exception-unit">
										<div className="flex items-start justify-between gap-3">
											<span className="flex min-w-0 flex-col">
												<span className="font-medium">{unit.product_name ?? `Unit ${index + 1}`}</span>
												{unit.variant_label && <span className="text-xs text-muted-foreground">{unit.variant_label}</span>}
											</span>
											<StatusBadge tone={tone} data-status={unit.physical_state}>
												{label}
											</StatusBadge>
										</div>
										<p className="text-xs text-muted-foreground">
											Unit {unit.unit_ordinal}
											{unit.warehouse_name ? ` · ${unit.warehouse_name}` : ""}
											{unit.replacement_link_id ? " · paket pengganti" : ""}
										</p>
									</li>
								);
							})}
							{d.units.length === 0 && (
								<li className="p-3 text-sm text-muted-foreground">Kasus ini tidak terkait unit barang tertentu (dana tanpa pesanan aktif).</li>
							)}
						</ul>
					</DetailSection>
					{d.proposal && (
						<DetailSection id="exception-proposal-heading" title="Usulan penanganan" testId="exception-proposal">
							<div className="flex flex-col gap-1">
								<p className="font-medium">{PROPOSAL[d.proposal.action]}</p>
								<p className="text-sm whitespace-pre-line break-words">{d.proposal.explanation}</p>
								<p className="text-xs text-muted-foreground tabular-nums">
									{d.proposal.unit_ids.length} unit · diusulkan {formatWib(d.proposal.created_at)}
								</p>
							</div>
						</DetailSection>
					)}
					{access.refundRead && (
						<RefundPanel
							access={access}
							state={refunds}
							onAction={(action, refund: RecoveryRefund) => setDialog({ kind: "refund", action, refund })}
							onRetryLoad={() => void loadRefunds()}
						/>
					)}
				</div>
				<div className="flex min-w-0 flex-col gap-4">
					<DetailSection id="exception-next-heading" title="Tindakan berikutnya" testId="exception-next">
						<p className="text-sm text-muted-foreground" data-testid="exception-explanation">
							{d.explanation}
						</p>
						<p className="text-sm">{REFUND_NEXT[d.status]}</p>
						{actions.length === 0 && (
							<p className="text-xs text-muted-foreground">
								{refundActionable
									? "Tindakan Anda ada di kartu refund pada bagian Refund pemulihan."
									: "Tidak ada tindakan untuk peran Anda pada tahap ini."}
							</p>
						)}
						{actions.length > 0 && <StickyActions className="md:flex-col md:items-stretch">{actions}</StickyActions>}
					</DetailSection>
				</div>
			</div>
			{dialog?.kind === "decide" && <DecideDialog detail={d} onClose={() => setDialog(null)} onDone={done} onUncertain={uncertain} />}
			{dialog?.kind === "apply" && <ApplyDialog detail={d} onClose={() => setDialog(null)} onDone={done} onUncertain={uncertain} />}
			{dialog?.kind === "intake" && (
				<IntakeDialog detail={d} onClose={() => setDialog(null)} onDone={(text) => done(text)} onUncertain={uncertain} />
			)}
			{dialog?.kind === "reinspect" && (
				<StockReportDialog reinspect={d} onClose={() => setDialog(null)} onDone={(text) => done(text)} onUncertain={uncertain} />
			)}
			{dialog?.kind === "queue" && <QueueRefundDialog detail={d} onClose={() => setDialog(null)} onDone={done} onUncertain={uncertain} />}
			{dialog?.kind === "refund" && (
				<RefundActionDialog
					action={dialog.action}
					exceptionId={d.id}
					refund={dialog.refund}
					onClose={() => setDialog(null)}
					onDone={done}
					onUncertain={uncertain}
				/>
			)}
		</AdminPage>
	);
}
