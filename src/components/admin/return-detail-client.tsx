"use client";

import { CircleAlert, CircleCheck, FileVideo } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { type ApiFailure, describeFailure, failureText, getJson, readFailure } from "./admin-errors";
import { formatWib, rupiah } from "./format";
import { FormDialog, FormField, nativeSelectClass } from "./form";
import { AdminPage, DetailSection, PageHeader, StickyActions } from "./page-blocks";
import {
	CLAIM,
	ERROR_MESSAGES,
	EVENT,
	INSPECTION,
	REASON,
	REFUND_STATUS,
	REPLACEMENT_STATUS,
	RESOLUTION,
	RETURN_STATUS,
	type Refund,
	type Replacement,
	type ReturnAccess,
	type ReturnCase,
	type ReturnItem,
	STAFF_REASON_KINDS,
} from "./return-model";
import { Deadline, StatusBadge } from "./status";
import { adminPath } from "@/modules/access/admin-paths";

// S101: one return case end to end. The API owns the state machine; this screen offers only the
// next actions the current status and the viewer's roles allow, sends the case version it read,
// keeps one idempotency key per open dialog (rotated after any definitive answer) and reloads
// the authorized projection after every action.

type Result<T> = { ok: true; data: T } | { ok: false; text: string; retryable: boolean };
const message = (failure: ApiFailure) =>
	ERROR_MESSAGES[failure.code] ? `${ERROR_MESSAGES[failure.code]} (kode: ${failure.code})` : failureText(failure);

async function post<T>(url: string, body: unknown, key: string): Promise<Result<T>> {
	try {
		const res = await fetch(url, {
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json", "idempotency-key": key },
			body: JSON.stringify(body),
		});
		if (res.ok) return { ok: true, data: (await res.json()) as T };
		return { ok: false, text: message(await readFailure(res)), retryable: res.status >= 500 };
	} catch {
		return { ok: false, text: message(describeFailure(0)), retryable: true };
	}
}

/** One idempotency key per dialog session; a definitive answer (success or 4xx) starts a new one. */
function useDialogKey() {
	const key = useRef(crypto.randomUUID());
	return {
		current: () => key.current,
		settle: (retryable: boolean) => {
			if (!retryable) key.current = crypto.randomUUID();
		},
	};
}

type Dialog =
	| { kind: "decide"; decision: "approve" | "reject" | "request_evidence" }
	| { kind: "inspect" }
	| { kind: "refund" }
	| { kind: "replace" }
	| { kind: "replacement"; replacement: Replacement; action: ReplacementAction };
type ReplacementAction = "reserve" | "prepare" | "book" | "handover";
const ACTION_PATH: Record<ReplacementAction, string> = {
	reserve: "reservations",
	prepare: "preparations",
	book: "bookings",
	handover: "handover",
};
const ACTION_LABEL: Record<ReplacementAction, string> = {
	reserve: "Pesan stok penggantian",
	prepare: "Mulai siapkan",
	book: "Pesan kurir",
	handover: "Serahkan ke kurir",
};

/** The one next physical step of a replacement parcel, and who may take it. */
function replacementNext(status: string): { action: ReplacementAction; who: "review" | "warehouse" } | null {
	if (status === "awaiting_stock") return { action: "reserve", who: "review" };
	if (status === "ready") return { action: "prepare", who: "warehouse" };
	if (status === "picking" || status === "booking_failed") return { action: "book", who: "warehouse" };
	if (status === "packed") return { action: "handover", who: "warehouse" };
	return null;
}

export function ReturnDetailClient({ caseId, access, canOrders }: { caseId: string; access: ReturnAccess; canOrders: boolean }) {
	const [detail, setDetail] = useState<ReturnCase | null>(null);
	const [failure, setFailure] = useState<ApiFailure | null>(null);
	const [refunds, setRefunds] = useState<Refund[]>([]);
	const [replacements, setReplacements] = useState<Replacement[]>([]);
	const [dialog, setDialog] = useState<Dialog | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);

	const load = useCallback(async () => {
		setFailure(null);
		const result = await getJson<ReturnCase>(`/api/v1/admin/returns/${encodeURIComponent(caseId)}`);
		if (!result.ok) return setFailure(result.failure);
		setDetail(result.data);
		// Child resources are read separately; a refused child read only hides that card.
		const refundReads = await Promise.all(
			(result.data.refund_ids ?? []).map((id) => getJson<Refund>(`/api/v1/admin/refunds/${id}`)),
		);
		setRefunds(refundReads.flatMap((r) => (r.ok ? [r.data] : [])));
		const replacementReads = await Promise.all(
			(result.data.replacement_ids ?? []).map((id) => getJson<Replacement>(`/api/v1/admin/replacements/${id}`)),
		);
		setReplacements(replacementReads.flatMap((r) => (r.ok ? [r.data] : [])));
	}, [caseId]);
	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);

	const back = { href: "/admin/returns", label: "Kembali ke daftar retur" };
	if (failure)
		return (
			<AdminPage>
				<PageHeader back={back} title="Detail retur" />
				<Alert role="alert" data-testid="return-detail-error">
					<CircleAlert aria-hidden="true" />
					<AlertDescription className="flex flex-wrap items-center gap-3 text-foreground">
						{failure.status === 404 || failure.code === "INVALID_INPUT"
							? "Retur tidak ditemukan atau barangnya berada di luar gudang yang ditugaskan ke akun Anda."
							: message(failure)}
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
				<PageHeader back={back} title="Detail retur" />
				<div className="flex flex-col gap-3" aria-live="polite" aria-busy="true">
					<p className="text-sm text-muted-foreground">Memuat detail retur…</p>
					<Skeleton className="h-8 w-64 bg-border/70" />
					<Skeleton className="h-40 w-full bg-border/70" />
				</div>
			</AdminPage>
		);

	const d = detail;
	const [statusLabel, statusTone] = RETURN_STATUS[d.status];
	const decidable = d.can_decide && ["requested", "reviewing"].includes(d.status);
	const redecidable = d.can_decide && ["approved", "awaiting_goods", "inspecting"].includes(d.status);
	// The API sets can_inspect per unit; the role gate mirrors it so a stale or wider projection never offers it to CS/finance.
	const inspectable = access.warehouse && ["awaiting_goods", "inspecting"].includes(d.status) && d.items.some((i) => i.can_inspect);
	const refundable = access.refundWrite && d.status === "approved" && d.resolution === "refund" && !(d.refund_ids ?? []).length;
	const replaceable =
		access.review && d.items_complete && d.status === "replacing" &&
		d.items.some((i) => i.claim_state === "held" && ["accepted", "waived"].includes(i.inspection_status));
	const done = (text: string) => {
		setDialog(null);
		setNotice(text);
		void load();
	};

	// The primary action of this status; the others are outline.
	const actions: ReactNode[] = [];
	if (decidable) {
		actions.push(
			<Button key="approve" data-testid="return-approve" onClick={() => setDialog({ kind: "decide", decision: "approve" })}>
				Setujui<span className="max-md:sr-only"> {d.requested_resolution === "refund" ? "refund" : "ganti barang"}</span>
			</Button>,
			<Button key="evidence" variant="outline" data-testid="return-request-evidence" disabled={d.status === "reviewing"} onClick={() => setDialog({ kind: "decide", decision: "request_evidence" })}>
				Minta bukti
			</Button>,
			<Button key="reject" variant="destructive" data-testid="return-reject" onClick={() => setDialog({ kind: "decide", decision: "reject" })}>
				Tolak
			</Button>,
		);
	}
	if (inspectable)
		actions.push(
			<Button key="inspect" data-testid="return-inspect" onClick={() => setDialog({ kind: "inspect" })}>
				Catat inspeksi
			</Button>,
		);
	if (refundable)
		actions.push(
			<Button key="refund" data-testid="return-refund" onClick={() => setDialog({ kind: "refund" })}>
				Ajukan refund
			</Button>,
		);
	if (replaceable)
		actions.push(
			<Button key="replace" data-testid="return-replace" onClick={() => setDialog({ kind: "replace" })}>
				Buat penggantian
			</Button>,
		);
	if (redecidable)
		actions.push(
			<Button key="redecide" variant="outline" data-testid="return-reject-late" onClick={() => setDialog({ kind: "decide", decision: "reject" })}>
				Tolak klaim
			</Button>,
		);

	return (
		<AdminPage testId="return-detail">
			<PageHeader
				back={back}
				title={
					<>
						Retur pesanan <span className="font-mono">{d.order_number}</span>
					</>
				}
				titleTestId="return-title"
				badge={
					<StatusBadge tone={statusTone} testId="return-status" data-status={d.status}>
						{statusLabel}
					</StatusBadge>
				}
				meta={
					<>
						<span>Diajukan {formatWib(d.created_at)}</span>
						<span aria-hidden="true">·</span>
						<span>Permintaan: {RESOLUTION[d.requested_resolution]}</span>
						{d.requires_goods !== null && (
							<>
								<span aria-hidden="true">·</span>
								<span>{d.requires_goods ? "Barang dikembalikan" : "Tanpa pengembalian barang"}</span>
							</>
						)}
						{canOrders && (
							<>
								<span aria-hidden="true">·</span>
								<Link
									href={adminPath("order", d.order_admin_no)}
									className="text-primary underline-offset-4 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
								>
									Buka pesanan
								</Link>
							</>
						)}
					</>
				}
			/>
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="outline-none" data-testid="return-notice">
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			{!d.items_complete && (
				<p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="return-partial">
					Sebagian barang retur ini dikirim dari gudang lain dan tidak ditampilkan. Keputusan klaim
					dan bukti pembeli hanya untuk staf yang melihat semua barangnya.
				</p>
			)}
			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
				<div className="flex min-w-0 flex-col gap-4">
					<DetailSection id="return-items-heading" title="Barang yang diretur" testId="return-items">
						{/* A few units with a free-text note: one card each (a table would clip the note). */}
						<ul className="flex flex-col divide-y rounded-md border">
							{d.items.map((item) => {
								const [label, tone] = INSPECTION[item.inspection_status] ?? [item.inspection_status, "open"];
								return (
									<li key={item.id} className="flex flex-col gap-1.5 p-3" data-testid="return-item">
										<div className="flex items-start justify-between gap-3">
											<span className="flex min-w-0 flex-col">
												<span className="font-medium">{item.product_name}</span>
												{item.variant_label && <span className="text-xs text-muted-foreground">{item.variant_label}</span>}
											</span>
											<StatusBadge tone={tone}>{label}</StatusBadge>
										</div>
										<p className="text-xs text-muted-foreground">
											{REASON[item.reason] ?? item.reason} · {item.warehouse_name} · {CLAIM[item.claim_state] ?? item.claim_state}
										</p>
										{item.details && (
											<p className="text-sm whitespace-pre-line break-words">
												<span className="sr-only">Keterangan pembeli: </span>“{item.details}”
											</p>
										)}
									</li>
								);
							})}
						</ul>
					</DetailSection>
					<EvidenceSection detail={d} />
					{(refunds.length > 0 || replacements.length > 0) && (
						<DetailSection id="return-remedy-heading" title="Refund dan penggantian" testId="return-remedies">
							<ul className="flex flex-col divide-y rounded-md border">
								{refunds.map((refund) => {
									const [label, tone] = REFUND_STATUS[refund.status] ?? [refund.status, "open"];
									return (
										<li key={refund.id} className="flex flex-col gap-1 p-3" data-testid="return-refund-card">
											<div className="flex items-start justify-between gap-3">
												<span className="font-medium">Refund {rupiah(refund.amount)}</span>
												<StatusBadge tone={tone}>{label}</StatusBadge>
											</div>
											<p className="text-xs text-muted-foreground">
												Diajukan {formatWib(refund.created_at)}
												{refund.explanation ? ` · ${refund.explanation}` : ""}
											</p>
										</li>
									);
								})}
								{replacements.map((replacement, index) => {
									const [label, tone] = REPLACEMENT_STATUS[replacement.status] ?? [replacement.status, "open"];
									const next = replacementNext(replacement.status);
									const allowed = next && (next.who === "review" ? access.review : access.warehouse);
									return (
										<li key={replacement.id} className="flex flex-col gap-2 p-3" data-testid="return-replacement-card">
											<div className="flex items-start justify-between gap-3">
												<span className="font-medium">
													Penggantian {replacements.length > 1 ? `${index + 1}/${replacements.length}` : ""} · {replacement.items.length} barang
												</span>
												<StatusBadge tone={tone} data-status={replacement.status}>{label}</StatusBadge>
											</div>
											<div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
												{replacement.packing_due_at && !replacement.handover_at && (
													<Deadline iso={replacement.packing_due_at} prefix="Batas resi" />
												)}
												{replacement.tracking_number && <span>Resi {replacement.tracking_number}</span>}
												{replacement.handover_at && <span>Diserahkan {formatWib(replacement.handover_at)}</span>}
											</div>
											{next && allowed && (
												<Button
													size="sm"
													variant="outline"
													className="self-start max-md:self-stretch"
													data-testid={`replacement-${next.action}`}
													onClick={() => setDialog({ kind: "replacement", replacement, action: next.action })}
												>
													{ACTION_LABEL[next.action]}
												</Button>
											)}
										</li>
									);
								})}
							</ul>
						</DetailSection>
					)}
				</div>
				<div className="flex min-w-0 flex-col gap-4">
					<DetailSection id="return-next-heading" title="Tindakan berikutnya" testId="return-next">
						<p className="text-sm text-muted-foreground">{nextHint(d, actions.length > 0 || replacements.some((r) => { const next = replacementNext(r.status); return !!next && (next.who === "review" ? access.review : access.warehouse); }))}</p>
						{actions.length > 0 && <StickyActions className="md:flex-col md:items-stretch">{actions}</StickyActions>}
					</DetailSection>
					<HistorySection detail={d} />
				</div>
			</div>
			{dialog?.kind === "decide" && <DecideDialog detail={d} decision={dialog.decision} onClose={() => setDialog(null)} onDone={done} />}
			{dialog?.kind === "inspect" && <InspectDialog detail={d} onClose={() => setDialog(null)} onDone={done} />}
			{dialog?.kind === "refund" && <RefundDialog detail={d} onClose={() => setDialog(null)} onDone={done} />}
			{dialog?.kind === "replace" && <ReplaceDialog detail={d} onClose={() => setDialog(null)} onDone={done} />}
			{dialog?.kind === "replacement" && (
				<ReplacementActionDialog replacement={dialog.replacement} action={dialog.action} onClose={() => setDialog(null)} onDone={done} />
			)}
		</AdminPage>
	);
}

function nextHint(d: ReturnCase, hasActions: boolean) {
	const hints: Record<string, string> = {
		requested: "Periksa alasan dan bukti pembeli, lalu putuskan.",
		reviewing: "Menunggu bukti tambahan dari pembeli. Klaim tetap bisa diputuskan.",
		approved: d.resolution === "refund" ? "Klaim disetujui. Keuangan mengajukan refund; nominal dihitung server." : "Klaim disetujui.",
		awaiting_goods: "Menunggu barang retur tiba di gudang asal untuk diperiksa.",
		inspecting: "Gudang sedang memeriksa barang. Catat hasilnya setelah semua komponen dicek.",
		refunding: "Refund sudah diajukan. Status pengiriman dana ada di kartu refund.",
		replacing: "Penggantian berjalan dari gudang. Ikuti langkah di kartu penggantian.",
		rejected: "Klaim ditolak. Alasan penolakan terlihat oleh pembeli.",
		resolved: "Retur selesai.",
	};
	const hint = hints[d.status] ?? "";
	return hasActions ? hint : `${hint} Tidak ada tindakan untuk peran Anda saat ini.`.trim();
}

function EvidenceSection({ detail }: { detail: ReturnCase }) {
	const files = detail.evidence ?? [];
	return (
		<DetailSection id="return-evidence-heading" title="Bukti pembeli" testId="return-evidence">
			{!detail.items_complete ? (
				<p className="text-sm text-muted-foreground">Bukti hanya terlihat oleh staf yang melihat semua barang retur ini.</p>
			) : files.length === 0 ? (
				<p className="text-sm text-muted-foreground">Pembeli belum melampirkan foto atau video.</p>
			) : (
				<ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
					{files.map((file, index) => {
						const href = `/api/v1/admin/returns/${detail.id}/evidence/${file.id}`;
						const label = `Bukti ${index + 1} dari ${files.length}, diunggah ${formatWib(file.created_at)}`;
						return (
							<li key={file.id}>
								<a
									href={href}
									target="_blank"
									rel="noreferrer noopener"
									aria-label={label}
									className="flex aspect-square items-center justify-center overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
								>
									{file.content_type.startsWith("image/") ? (
										// biome-ignore lint/performance/noImgElement: private no-store bytes; next/image would cache them.
										<img src={href} alt="" loading="lazy" className="size-full object-cover" />
									) : (
										<span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
											<FileVideo aria-hidden="true" className="size-6" />
											Buka video
										</span>
									)}
								</a>
							</li>
						);
					})}
				</ul>
			)}
		</DetailSection>
	);
}

function HistorySection({ detail }: { detail: ReturnCase }) {
	const events = [...(detail.events ?? [])].reverse();
	return (
		<DetailSection id="return-history-heading" title="Riwayat" description="Terbaru di atas. Setiap langkah tercatat di log audit." testId="return-history">
			<ol className="flex flex-col gap-3">
				{events.map((event) => {
					const [label, tone] = RETURN_STATUS[event.status];
					const who = event.actor === "buyer" ? "Pembeli" : event.actor === "staff" ? event.actor_name || "Staf" : "Sistem";
					return (
						<li key={event.version} className="flex flex-col gap-1 border-l-2 pl-3" data-testid="return-history-event">
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-sm font-medium">{EVENT[event.kind] ?? event.kind}</span>
								<StatusBadge tone={tone}>{label}</StatusBadge>
							</div>
							<p className="text-xs text-muted-foreground tabular-nums">
								{who} · {formatWib(event.occurred_at)}
							</p>
							{STAFF_REASON_KINDS.has(event.kind) && <p className="text-sm whitespace-pre-line break-words">{event.reason}</p>}
						</li>
					);
				})}
			</ol>
		</DetailSection>
	);
}

type DialogProps = { detail: ReturnCase; onClose: () => void; onDone: (text: string) => void };

function useSubmit() {
	const key = useDialogKey();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function run<T>(url: string, body: unknown): Promise<T | null> {
		setPending(true);
		setError(null);
		const result = await post<T>(url, body, key.current());
		setPending(false);
		key.settle(!result.ok && result.retryable);
		if (!result.ok) {
			setError(result.text);
			return null;
		}
		return result.data;
	}
	return { pending, error, setError, run, setPending };
}

function DecideDialog({ detail, decision, onClose, onDone }: DialogProps & { decision: "approve" | "reject" | "request_evidence" }) {
	const [reason, setReason] = useState("");
	const [requiresGoods, setRequiresGoods] = useState(true);
	const submit = useSubmit();
	const approve = decision === "approve";
	const resolution = detail.requested_resolution;
	const title = approve ? `Setujui ${resolution === "refund" ? "refund" : "ganti barang"}` : decision === "reject" ? "Tolak klaim" : "Minta bukti tambahan";
	async function send() {
		if (!reason.trim()) return submit.setError("Alasan wajib diisi.");
		const body = {
			decision: approve ? (resolution === "refund" ? "approve_refund" : "approve_replacement") : decision,
			reason: reason.trim(),
			expected_version: detail.version,
			...(approve ? { requires_goods: requiresGoods } : {}),
		};
		const result = await submit.run<{ status: keyof typeof RETURN_STATUS }>(`/api/v1/admin/returns/${detail.id}/decisions`, body);
		if (result) onDone(`Keputusan tersimpan. Status: ${RETURN_STATUS[result.status][0]}.`);
	}
	return (
		<FormDialog
			title={title}
			description={
				approve
					? "Persetujuan mengikuti permintaan pembeli. Nominal refund dihitung server, bukan diisi di sini."
					: "Alasan ini ditampilkan ke pembeli di halaman pesanannya."
			}
			pending={submit.pending}
			error={submit.error}
			submitLabel={approve ? "Setujui" : decision === "reject" ? "Tolak klaim" : "Kirim permintaan"}
			onClose={onClose}
			onSubmit={() => void send()}
		>
			{approve && (
				<label className="flex items-start gap-2 text-sm">
					<input
						type="checkbox"
						className="mt-0.5 size-4 accent-primary"
						checked={requiresGoods}
						data-testid="decide-requires-goods"
						onChange={(e) => setRequiresGoods(e.target.checked)}
					/>
					<span>
						Barang harus dikembalikan dan diperiksa gudang
						<span className="block text-xs text-muted-foreground">
							Hapus centang hanya bila kesalahan jelas dari kami; alasannya wajib dan tidak menambah stok.
						</span>
					</span>
				</label>
			)}
			<FormField id="decide-reason" label="Alasan (wajib)">
				<Textarea id="decide-reason" value={reason} maxLength={2000} rows={3} onChange={(e) => setReason(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}

type Intake = Record<string, { include: boolean; goods: Record<string, { quantity: string; confirmed: boolean }> }>;
function InspectDialog({ detail, onClose, onDone }: DialogProps) {
	const items = detail.items.filter((item) => item.can_inspect);
	const [result, setResult] = useState<"accepted" | "rejected" | "needs_review" | "record_goods">("accepted");
	const [reason, setReason] = useState("");
	const [intake, setIntake] = useState<Intake>(() =>
		Object.fromEntries(
			items.map((item) => [
				item.id,
				{
					include: item.inspection_status === "pending" || item.inspection_status === "needs_review",
					goods: Object.fromEntries((item.components ?? []).map((c) => [c.balance_id, { quantity: String(c.quantity), confirmed: true }])),
				},
			]),
		),
	);
	const submit = useSubmit();
	const set = (item: ReturnItem, next: Partial<Intake[string]>) => setIntake((all) => ({ ...all, [item.id]: { ...all[item.id], ...next } }));
	async function send() {
		const chosen = items.filter((item) => intake[item.id]?.include);
		if (!chosen.length) return submit.setError("Pilih minimal satu barang.");
		if (!reason.trim()) return submit.setError("Catatan inspeksi wajib diisi.");
		const lines = [];
		for (const item of chosen) {
			const goods = [];
			for (const component of item.components ?? []) {
				const row = intake[item.id].goods[component.balance_id];
				if (!row || row.quantity.trim() === "" || row.quantity.trim() === "0") continue;
				const quantity = Number(row.quantity);
				if (!Number.isInteger(quantity) || quantity < 1 || quantity > component.quantity)
					return submit.setError(`Jumlah ${component.name} harus 0–${component.quantity}.`);
				goods.push({ expected_balance_id: component.balance_id, quantity, identity_confirmed: row.confirmed });
			}
			lines.push({ return_item_id: item.id, goods });
		}
		const body = { expected_version: detail.version, result, reason: reason.trim(), items: lines };
		const saved = await submit.run<{ status: keyof typeof RETURN_STATUS }>(`/api/v1/admin/returns/${detail.id}/inspections`, body);
		if (saved) onDone(`Inspeksi tersimpan. Status: ${RETURN_STATUS[saved.status][0]}.`);
	}
	const results = [
		["accepted", "Diterima", "Barang sesuai klaim; komponen yang cocok masuk karantina."],
		["rejected", "Ditolak", "Barang tidak sesuai klaim."],
		["needs_review", "Perlu tinjauan", "Butuh keputusan Super Admin atau Layanan Pelanggan."],
		["record_goods", "Catat barang saja", "Mencatat barang yang tiba tanpa mengubah hasil."],
	] as const;
	return (
		<FormDialog
			title="Catat inspeksi barang retur"
			description="Isi jumlah setiap komponen yang benar-benar diterima. Komponen yang identitasnya cocok masuk stok karantina."
			pending={submit.pending}
			error={submit.error}
			submitLabel="Simpan inspeksi"
			onClose={onClose}
			onSubmit={() => void send()}
		>
			<fieldset className="flex flex-col gap-2">
				<legend className="mb-1 text-sm font-medium">Hasil</legend>
				{results.map(([value, label, hint]) => (
					<label key={value} className="flex items-start gap-2 text-sm">
						<input type="radio" name="inspect-result" className="mt-0.5 size-4 accent-primary" value={value} checked={result === value} onChange={() => setResult(value)} />
						<span>
							{label}
							<span className="block text-xs text-muted-foreground">{hint}</span>
						</span>
					</label>
				))}
			</fieldset>
			{items.map((item) => (
				<fieldset key={item.id} className="flex flex-col gap-2 rounded-md border p-3" data-testid="inspect-item">
					<legend className="sr-only">{item.product_name}</legend>
					<label className="flex items-start gap-2 text-sm font-medium">
						<input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={intake[item.id].include} onChange={(e) => set(item, { include: e.target.checked })} />
						<span>
							{item.product_name}
							<span className="block text-xs font-normal text-muted-foreground">
								{[item.variant_label, INSPECTION[item.inspection_status]?.[0]].filter(Boolean).join(" · ")}
							</span>
						</span>
					</label>
					{intake[item.id].include &&
						(item.components ?? []).map((component) => {
							const row = intake[item.id].goods[component.balance_id];
							const fieldId = `inspect-${item.id}-${component.balance_id}`;
							return (
								<div key={component.balance_id} className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-x-2 gap-y-1 pl-6">
									<label htmlFor={fieldId} className="text-sm">
										{component.name}
										<span className="block text-xs text-muted-foreground">Dikirim {component.quantity}; isi jumlah diterima</span>
									</label>
									<Input
										id={fieldId}
										inputMode="numeric"
										value={row.quantity}
										onChange={(e) => set(item, { goods: { ...intake[item.id].goods, [component.balance_id]: { ...row, quantity: e.target.value } } })}
									/>
									<label className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground">
										<input
											type="checkbox"
											className="size-4 accent-primary"
											checked={row.confirmed}
											onChange={(e) => set(item, { goods: { ...intake[item.id].goods, [component.balance_id]: { ...row, confirmed: e.target.checked } } })}
										/>
										Identitas cocok dengan yang dikirim
									</label>
								</div>
							);
						})}
				</fieldset>
			))}
			<FormField id="inspect-reason" label="Catatan inspeksi (wajib)">
				<Textarea id="inspect-reason" value={reason} maxLength={2000} rows={3} onChange={(e) => setReason(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}

/** A fresh subject-bound proof for the money action (issued just before the action). */
async function issueProof(password: string, action: string, subject: string) {
	return post<{ proof: string }>("/api/v1/me/reauthentication-proofs", { password, action, subject_id: subject }, crypto.randomUUID());
}

function RefundDialog({ detail, onClose, onDone }: DialogProps) {
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const submit = useSubmit();
	async function send() {
		if (!reason.trim() || !password) return submit.setError("Isi alasan dan kata sandi.");
		submit.setPending(true);
		const issued = await issueProof(password, "finance.refund", detail.id);
		if (!issued.ok) {
			submit.setPending(false);
			return submit.setError(issued.text);
		}
		const refund = await submit.run<Refund>("/api/v1/admin/refunds", {
			return_case_id: detail.id,
			expected_version: detail.version,
			reason: reason.trim(),
			reauthentication_proof: issued.data.proof,
		});
		if (refund) onDone(`Refund ${rupiah(refund.amount)} diajukan. ${refund.explanation ?? ""}`.trim());
	}
	return (
		<FormDialog
			title="Ajukan refund"
			description="Server menghitung nominal dari barang yang disetujui, ongkir dan biaya pembayaran yang dibayar pembeli. Prabayar kembali ke metode asal; COD menunggu rekening tujuan dari pembeli."
			pending={submit.pending}
			pendingLabel="Mengajukan…"
			error={submit.error}
			submitLabel="Ajukan refund"
			onClose={onClose}
			onSubmit={() => void send()}
		>
			<FormField id="refund-reason" label="Alasan (wajib)">
				<Input id="refund-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
			</FormField>
			<FormField id="refund-password" label="Konfirmasi kata sandi" hint="Diperlukan untuk setiap refund; berlaku hanya untuk retur ini.">
				<Input
					id="refund-password"
					type="password"
					autoComplete="current-password"
					aria-describedby="refund-password-hint"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
			</FormField>
		</FormDialog>
	);
}

function ReplaceDialog({ detail, onClose, onDone }: DialogProps) {
	const eligible = detail.items.filter((i) => i.claim_state === "held" && ["accepted", "waived"].includes(i.inspection_status));
	const origins = [...new Map(detail.items.map((i) => [i.warehouse_id, i.warehouse_name])).entries()];
	const [chosen, setChosen] = useState<string[]>(eligible.map((i) => i.id));
	const [warehouse, setWarehouse] = useState(origins[0]?.[0] ?? "");
	const [reason, setReason] = useState("");
	const submit = useSubmit();
	async function send() {
		if (!chosen.length) return submit.setError("Pilih minimal satu barang.");
		if (!reason.trim()) return submit.setError("Alasan wajib diisi.");
		const saved = await submit.run<Replacement>(`/api/v1/admin/returns/${detail.id}/replacements`, {
			return_item_ids: chosen,
			warehouse_id: warehouse,
			expected_version: detail.version,
			reason: reason.trim(),
		});
		if (saved) onDone(`Penggantian dibuat. Status: ${REPLACEMENT_STATUS[saved.status]?.[0] ?? saved.status}.`);
	}
	return (
		<FormDialog
			title="Buat penggantian"
			description="Barang pengganti dikirim tanpa ongkir dan tanpa tagihan COD. Stok dipesan dari gudang yang dipilih."
			pending={submit.pending}
			error={submit.error}
			submitLabel="Buat penggantian"
			onClose={onClose}
			onSubmit={() => void send()}
		>
			<fieldset className="flex flex-col gap-2">
				<legend className="mb-1 text-sm font-medium">Barang yang diganti</legend>
				{eligible.map((item) => (
					<label key={item.id} className="flex items-start gap-2 text-sm">
						<input
							type="checkbox"
							className="mt-0.5 size-4 accent-primary"
							checked={chosen.includes(item.id)}
							onChange={(e) => setChosen((all) => (e.target.checked ? [...all, item.id] : all.filter((id) => id !== item.id)))}
						/>
						<span>
							{item.product_name}
							{item.variant_label && <span className="block text-xs text-muted-foreground">{item.variant_label}</span>}
						</span>
					</label>
				))}
			</fieldset>
			<FormField id="replace-warehouse" label="Gudang pengirim">
				<select id="replace-warehouse" className={`${nativeSelectClass} w-full`} value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
					{origins.map(([id, name]) => (
						<option key={id} value={id}>
							{name}
						</option>
					))}
				</select>
			</FormField>
			<FormField id="replace-reason" label="Alasan (wajib)">
				<Input id="replace-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}

function ReplacementActionDialog({
	replacement,
	action,
	onClose,
	onDone,
}: {
	replacement: Replacement;
	action: ReplacementAction;
	onClose: () => void;
	onDone: (text: string) => void;
}) {
	const [reason, setReason] = useState("");
	const [reference, setReference] = useState("");
	const submit = useSubmit();
	async function send() {
		if (!reason.trim()) return submit.setError("Alasan wajib diisi.");
		if (action === "handover" && !reference.trim()) return submit.setError("Isi bukti serah terima.");
		const saved = await submit.run<Replacement>(`/api/v1/admin/replacements/${replacement.id}/${ACTION_PATH[action]}`, {
			expected_version: replacement.version,
			reason: reason.trim(),
			...(action === "handover" ? { handover_reference: reference.trim() } : {}),
		});
		if (saved) onDone(`${ACTION_LABEL[action]}: tersimpan. Status: ${REPLACEMENT_STATUS[saved.status]?.[0] ?? saved.status}.`);
	}
	const descriptions: Record<ReplacementAction, string> = {
		reserve: "Coba pesan ulang stok lengkap untuk penggantian ini.",
		prepare: "Tandai barang pengganti mulai diambil dan dikemas.",
		book: "Pesan kurir untuk paket penggantian (tanpa ongkir pembeli, tanpa COD). Resi tercatat setelah kurir menjawab.",
		handover: "Catat serah terima nyata paket penggantian ke kurir. Stok dipotong saat ini.",
	};
	return (
		<FormDialog
			title={ACTION_LABEL[action]}
			description={descriptions[action]}
			pending={submit.pending}
			error={submit.error}
			submitLabel={ACTION_LABEL[action]}
			onClose={onClose}
			onSubmit={() => void send()}
		>
			{action === "handover" && (
				<FormField id="replacement-reference" label="Bukti serah terima" hint="Mis. nama kurir dan jam penjemputan.">
					<Input id="replacement-reference" aria-describedby="replacement-reference-hint" value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} />
				</FormField>
			)}
			<FormField id="replacement-reason" label="Alasan (wajib)">
				<Input id="replacement-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}
