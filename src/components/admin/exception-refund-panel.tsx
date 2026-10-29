"use client";

import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useIntent } from "./exception-intent";
import {
	type CommerceException,
	type ExceptionAccess,
	REFUND_STATUS,
	type RecoveryRefund,
	type RecoveryRefundList,
} from "./exception-model";
import { formatWib, rupiah } from "./format";
import { FormDialog, FormField } from "./form";
import { DetailSection } from "./page-blocks";
import { StatusBadge } from "./status";

// S133 finance side of a case: the recovery refunds of its original sources and the three
// finance writes (queue, reconcile, retry). Money rules the screen keeps:
//  - the amount is never typed: the server derives it from the original collection;
//  - a result that is unknown stays "belum pasti" with only a reconcile action: retry is offered
//    only for a known zero-money failure, and the API refuses it otherwise;
//  - each write needs a fresh subject-bound proof (password), issued once per intent;
//  - an unknown answer to a write keeps the dialog's idempotency key and request, so sending
//    again replays the saved result instead of creating a second obligation.

const COMMERCE = "/api/v1/admin/commerce-exceptions";

export type RefundsState =
	| { kind: "loading" }
	| { kind: "error"; text: string }
	| { kind: "ready"; refunds: RecoveryRefund[] };

type DialogProps = {
	onClose: () => void;
	/** `warn`: the saved result still needs attention (refund outcome unknown or failed). */
	onDone: (text: string, warn?: boolean) => void;
	onUncertain: () => void;
};

function PasswordFields({
	reason,
	setReason,
	password,
	setPassword,
	frozen,
}: {
	reason: string;
	setReason: (value: string) => void;
	password: string;
	setPassword: (value: string) => void;
	frozen: boolean;
}) {
	return (
		<>
			<FormField id="refund-reason" label="Alasan (wajib)">
				<Input id="refund-reason" value={reason} maxLength={500} disabled={frozen} onChange={(e) => setReason(e.target.value)} />
			</FormField>
			<FormField id="refund-password" label="Konfirmasi kata sandi" hint="Berlaku satu kali, hanya untuk tindakan ini.">
				<Input
					id="refund-password"
					type="password"
					autoComplete="current-password"
					aria-describedby="refund-password-hint"
					value={password}
					disabled={frozen}
					onChange={(e) => setPassword(e.target.value)}
				/>
			</FormField>
		</>
	);
}

export function QueueRefundDialog({ detail, onClose, onDone, onUncertain }: DialogProps & { detail: CommerceException }) {
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const intent = useIntent();
	async function send() {
		if (!reason.trim() || !password) return intent.setError("Isi alasan dan kata sandi.");
		const saved = await intent.run<RecoveryRefundList>(
			`${COMMERCE}/${detail.id}/refunds`,
			() => ({ expected_version: detail.version, reason: reason.trim() }),
			{ money: { password, action: "finance.recovery_refund", subject: detail.id }, onUncertain },
		);
		if (saved) {
			const total = saved.refunds.reduce((sum, refund) => sum + refund.amount, 0);
			onDone(`Refund ${rupiah(total)} diajukan dari ${saved.refunds.length} sumber pembayaran asal. Hasil pengiriman dana ditampilkan di kartu refund.`);
		}
	}
	return (
		<FormDialog
			title="Ajukan refund pemulihan"
			description="Server menghitung nominal dari pembayaran asal dan sisa dana yang belum dikembalikan; nominal tidak diisi di sini. Prabayar kembali ke metode asal; COD menunggu rekening tujuan yang diverifikasi pembeli."
			pending={intent.pending}
			pendingLabel="Mengajukan…"
			error={intent.error}
			submitLabel={intent.uncertain ? "Kirim ulang (kunci sama)" : "Ajukan refund"}
			onClose={onClose}
			onSubmit={() => void send()}
		>
			<PasswordFields reason={reason} setReason={setReason} password={password} setPassword={setPassword} frozen={intent.uncertain} />
		</FormDialog>
	);
}

export function RefundActionDialog({
	action,
	exceptionId,
	refund,
	onClose,
	onDone,
	onUncertain,
}: DialogProps & { action: "reconcile" | "retry"; exceptionId: string; refund: RecoveryRefund }) {
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const intent = useIntent();
	const retry = action === "retry";
	async function send() {
		if (!reason.trim() || !password) return intent.setError("Isi alasan dan kata sandi.");
		const saved = await intent.run<RecoveryRefund>(
			`${COMMERCE}/${exceptionId}/refunds/${refund.id}/${retry ? "retries" : "reconciliations"}`,
			() => ({ expected_version: refund.version, reason: reason.trim() }),
			{ money: { password, action: "finance.recovery_refund", subject: refund.id }, onUncertain },
		);
		if (saved)
			onDone(
				retry
					? `Percobaan baru untuk refund ${rupiah(saved.amount)} masuk antrean. Status: ${REFUND_STATUS[saved.status][0]}.`
					: `Rekonsiliasi dijalankan. Status refund: ${REFUND_STATUS[saved.status][0]}.`,
				saved.status === "unknown" || saved.status === "failed",
			);
	}
	return (
		<FormDialog
			title={retry ? "Coba ulang refund" : "Rekonsiliasi refund"}
			description={
				retry
					? "Hanya untuk kegagalan yang pasti tanpa dana keluar. Server memeriksa ulang sebelum membuat percobaan baru untuk refund yang sama; tidak ada kewajiban atau jurnal baru."
					: "Memeriksa ulang hasil bank untuk refund yang sama dan menghidupkan kembali pemrosesan yang tertahan. Tidak mengirim dana dan tidak membuat refund baru."
			}
			pending={intent.pending}
			pendingLabel="Memproses…"
			error={intent.error}
			submitLabel={intent.uncertain ? "Kirim ulang (kunci sama)" : retry ? "Coba ulang" : "Rekonsiliasi"}
			onClose={onClose}
			onSubmit={() => void send()}
		>
			<PasswordFields reason={reason} setReason={setReason} password={password} setPassword={setPassword} frozen={intent.uncertain} />
		</FormDialog>
	);
}

export type RefundDialog = { kind: "queue" } | { kind: "refund"; action: "reconcile" | "retry"; refund: RecoveryRefund };

function RefundCard({
	refund,
	canWrite,
	onAction,
}: {
	refund: RecoveryRefund;
	canWrite: boolean;
	onAction: (action: "reconcile" | "retry", refund: RecoveryRefund) => void;
}) {
	const [label, tone] = REFUND_STATUS[refund.status];
	const open = refund.status === "queued" || refund.status === "processing" || refund.status === "unknown";
	return (
		<li className="flex flex-col gap-2 p-3" data-testid="refund-card" data-refund-id={refund.id}>
			<div className="flex items-start justify-between gap-3">
				<span className="font-medium tabular-nums">Refund {rupiah(refund.amount)}</span>
				<StatusBadge tone={tone} testId="refund-status" data-status={refund.status}>
					{label}
				</StatusBadge>
			</div>
			<p className="text-sm">{refund.explanation}</p>
			{refund.status === "unknown" && (
				<Alert role="alert" data-testid="refund-unknown" className="border-warning/40 bg-warning-surface">
					<CircleAlert aria-hidden="true" className="text-warning" />
					<AlertDescription className="text-foreground">
						Hasil pengiriman dana belum pasti; dana mungkin sudah keluar dari bank. Jangan mengajukan refund lagi dan jangan
						coba ulang. Rekonsiliasi memeriksa hasil refund yang sama.
					</AlertDescription>
				</Alert>
			)}
			<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
				<dt>Diajukan</dt>
				<dd className="tabular-nums">{formatWib(refund.created_at)}</dd>
				<dt>Sisa dana asal</dt>
				<dd className="tabular-nums">{rupiah(refund.remaining_capacity)}</dd>
				<dt>Jurnal kewajiban</dt>
				<dd className="font-mono break-all">{refund.obligation_transaction_id.slice(0, 8)}</dd>
				{refund.cash_transaction_id && (
					<>
						<dt>Jurnal kas</dt>
						<dd className="font-mono break-all">{refund.cash_transaction_id.slice(0, 8)}</dd>
					</>
				)}
			</dl>
			{canWrite && (open || refund.status === "failed") && (
				<div className="flex flex-wrap gap-2 max-md:*:flex-1">
					{open && (
						<Button
							size="sm"
							variant={refund.status === "unknown" ? "default" : "outline"}
							data-testid="refund-reconcile"
							onClick={() => onAction("reconcile", refund)}
						>
							Rekonsiliasi
						</Button>
					)}
					{refund.status === "failed" && (
						<Button size="sm" data-testid="refund-retry" onClick={() => onAction("retry", refund)}>
							Coba ulang
						</Button>
					)}
				</div>
			)}
		</li>
	);
}

export function RefundPanel({
	access,
	state,
	onAction,
	onRetryLoad,
}: {
	access: ExceptionAccess;
	state: RefundsState;
	onAction: (action: "reconcile" | "retry", refund: RecoveryRefund) => void;
	onRetryLoad: () => void;
}) {
	return (
		<DetailSection
			id="exception-refunds-heading"
			title="Refund pemulihan"
			description="Dana kembali ke sumber pembayaran asal. Nominal dihitung server."
			testId="exception-refunds"
		>
			{state.kind === "loading" && (
				<div aria-busy="true" aria-live="polite" className="flex flex-col gap-2">
					<p className="text-sm text-muted-foreground">Memuat refund…</p>
					<Skeleton className="h-16 w-full bg-border/70" />
				</div>
			)}
			{state.kind === "error" && (
				<Alert variant="destructive" role="alert" data-testid="refunds-error">
					<AlertDescription className="flex flex-wrap items-center justify-between gap-3 text-foreground">
						{state.text}
						<Button type="button" size="sm" variant="outline" onClick={onRetryLoad}>
							Coba lagi
						</Button>
					</AlertDescription>
				</Alert>
			)}
			{state.kind === "ready" && state.refunds.length === 0 && (
				<p className="text-sm text-muted-foreground" data-testid="refunds-empty">
					Belum ada refund untuk kasus ini.
				</p>
			)}
			{state.kind === "ready" && state.refunds.length > 0 && (
				<ul className="flex flex-col divide-y rounded-md border">
					{state.refunds.map((refund) => (
						<RefundCard key={refund.id} refund={refund} canWrite={access.refundWrite} onAction={onAction} />
					))}
				</ul>
			)}
			{!access.refundWrite && (
				<p className="text-xs text-muted-foreground">Akun Anda hanya bisa membaca refund; mengajukan dan merekonsiliasi memerlukan izin tulis refund.</p>
			)}
		</DetailSection>
	);
}
