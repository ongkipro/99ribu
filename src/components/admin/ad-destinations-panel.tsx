import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { failureText, readFailure } from "./admin-errors";

export interface AdDestinationItem {
	id: string;
	version: number;
	revision: number;
	platform: "meta" | "google" | "tiktok";
	destination_version: string;
	public_identifier: string;
	external_destination_id: string;
	conversion_action_id: string;
	google_conversion_source?: string;
	paused: boolean;
	enabled: boolean;
	server_purchase_enabled: boolean;
	browser_purchase_enabled: boolean;
	credentials_configured: boolean;
	secret_redacted: boolean;
	updated_at: string;
	eligible: number;
	suppressed: number;
	queued: number;
	accepted: number;
	processed: number;
	attributed: number | null;
	purchase_collection_instances: number;
	unique_orders: number;
	reconciliation: {
		gross_merchandise_amount_idr: number;
		refunded_merchandise_amount_idr: number;
		net_merchandise_amount_idr: number;
		dispatched_purchase_signal_amount_idr: number;
		eligible_purchase_signal_amount_idr: number;
		suppressed_purchase_signal_amount_idr: number;
		net_signal_merchandise_amount_idr: number;
	};
	missing_identity: {
		orders_without_visitor_session: number;
		orders_without_consent: number;
		expired_outbox_events: number;
		total_suppressed_or_missing: number;
	};
}

const PLATFORM_NAMES: Record<AdDestinationItem["platform"], string> = {
	meta: "Meta",
	google: "Google Ads",
	tiktok: "TikTok",
};

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const idr = new Intl.NumberFormat("id-ID", {
	style: "currency",
	currency: "IDR",
	maximumFractionDigits: 0,
});

type Action = { kind: "pause" | "replay"; dest: AdDestinationItem };

export function AdDestinationsPanel({
	state,
	error,
	onRetry,
	destinations,
	setDestinations,
	authenticated,
	onNotice,
}: {
	state: "loading" | "ready" | "error" | "preview";
	error: string | null;
	onRetry: () => void;
	destinations: AdDestinationItem[];
	setDestinations: React.Dispatch<React.SetStateAction<AdDestinationItem[]>>;
	authenticated: boolean;
	onNotice: (notice: { kind: "info" | "error"; message: string }) => void;
}) {
	const [action, setAction] = useState<Action | null>(null);
	const [reason, setReason] = useState("");
	const [eventId, setEventId] = useState("");
	const [pending, setPending] = useState(false);
	const [dialogError, setDialogError] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<{
		eventId?: string;
		reason?: string;
	}>({});
	const eventIdRef = useRef<HTMLInputElement>(null);
	const reasonRef = useRef<HTMLTextAreaElement>(null);
	// Controlled dialog has no DialogTrigger, so return focus to the opener ourselves.
	const openerRef = useRef<HTMLElement | null>(null);

	const open = (next: Action) => {
		openerRef.current = document.activeElement as HTMLElement | null;
		setAction(next);
		setReason("");
		setEventId("");
		setDialogError(null);
		setFieldErrors({});
	};

	const submit = async () => {
		if (!action) return;
		const { kind, dest } = action;
		const name = PLATFORM_NAMES[dest.platform];
		const errors: { eventId?: string; reason?: string } = {};
		if (kind === "replay" && !UUID_RE.test(eventId.trim()))
			errors.eventId = eventId.trim()
				? "ID kejadian harus berupa UUID yang valid."
				: "ID kejadian wajib diisi.";
		if (!reason.trim()) errors.reason = "Alasan wajib diisi untuk jejak audit.";
		setFieldErrors(errors);
		if (errors.eventId || errors.reason) {
			(errors.eventId ? eventIdRef : reasonRef).current?.focus();
			return;
		}
		if (!authenticated) {
			setDialogError(
				"Tindakan ini memerlukan sesi Super Admin dengan MFA aktif.",
			);
			return;
		}
		setPending(true);
		setDialogError(null);
		try {
			const res = await fetch(
				`/api/v1/admin/advertising/destinations/${dest.id}/${kind === "pause" ? "pause" : "replays"}`,
				{
					method: "POST",
					credentials: "include",
					headers: {
						"Content-Type": "application/json",
						"Idempotency-Key": crypto.randomUUID(),
					},
					body: JSON.stringify(
						kind === "pause"
							? {
									expected_version: dest.version,
									paused: !dest.paused,
									reason: reason.trim(),
								}
							: {
									expected_version: dest.version,
									event_id: eventId.trim(),
									reason: reason.trim(),
								},
					),
				},
			);
			if (!res.ok) {
				setDialogError(failureText(await readFailure(res)));
				return;
			}
			if (kind === "pause") {
				const updated = (await res.json()) as AdDestinationItem;
				setDestinations((prev) =>
					prev.map((d) => (d.platform === updated.platform ? updated : d)),
				);
				onNotice({
					kind: "info",
					message: `Pengiriman sinyal ${name} ${updated.paused ? "dijeda" : "dilanjutkan"} (revisi v${updated.version}).`,
				});
			} else {
				onNotice({
					kind: "info",
					message: `Kejadian ${eventId.trim()} dikirim ulang ke ${name}.`,
				});
			}
			setAction(null);
		} catch {
			setDialogError(
				"Tidak dapat terhubung ke server lokal. Periksa koneksi lalu coba lagi.",
			);
		} finally {
			setPending(false);
		}
	};

	const actionName = action ? PLATFORM_NAMES[action.dest.platform] : "";
	const pausing = action?.kind === "pause" && !action.dest.paused;

	return (
		<section
			aria-labelledby="ad-diagnostics-heading"
			data-testid="panel-s60-advertising"
			className="flex flex-col gap-4 rounded-lg border bg-card p-4 md:p-5"
		>
			<div className="flex flex-col gap-1">
				<h2 id="ad-diagnostics-heading" className="text-base font-semibold">
					Diagnostik Sinyal Iklan
				</h2>
				<p className="text-sm text-muted-foreground">
					Hanya Super Admin. Kredensial selalu disembunyikan. Jumlah sinyal
					dipisahkan dari pesanan unik dan uang yang benar-benar diterima.
				</p>
			</div>

			{state === "loading" ? (
				<div
					className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3"
					aria-busy="true"
				>
					<span className="sr-only">Memuat diagnostik iklan…</span>
					<Skeleton className="h-72" />
					<Skeleton className="h-72" />
					<Skeleton className="h-72" />
				</div>
			) : state === "error" ? (
				<Alert
					variant="destructive"
					className="flex flex-wrap items-center justify-between gap-3 border-destructive/40 bg-destructive-surface"
				>
					<AlertDescription className="text-foreground">
						Diagnostik iklan gagal dimuat. {error}
					</AlertDescription>
					<Button type="button" variant="outline" size="sm" onClick={onRetry}>
						<RefreshCw data-icon="inline-start" aria-hidden="true" />
						Coba lagi
					</Button>
				</Alert>
			) : destinations.length === 0 ? (
				<p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
					Belum ada tujuan iklan yang dikonfigurasi.
				</p>
			) : (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3">
					{destinations.map((dest) => (
						<article
							key={dest.platform}
							data-testid={`ad-destination-card-${dest.platform}`}
							className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
						>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<h3 className="text-sm font-semibold">
									{PLATFORM_NAMES[dest.platform]}{" "}
									<span className="text-xs font-normal text-muted-foreground">
										Revisi v{dest.version}
									</span>
								</h3>
								<Badge
									data-testid={`ad-status-badge-${dest.platform}`}
									variant={dest.paused ? "warning" : "success"}
								>
									{dest.paused ? "Dijeda" : "Aktif"}
								</Badge>
							</div>

							<dl className="grid gap-1 text-sm break-words">
								<Pair label="ID publik">
									<code className="font-mono text-xs">
										{dest.public_identifier}
									</code>
								</Pair>
								{dest.google_conversion_source && (
									<Pair label="Sumber konversi Google">
										{dest.google_conversion_source}
									</Pair>
								)}
								<Pair
									label="Kredensial"
									testId={`ad-secret-redacted-${dest.platform}`}
								>
									{dest.credentials_configured
										? "Terpasang (disembunyikan)"
										: "Belum diatur"}
								</Pair>
							</dl>

							<dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-muted/60 p-3 text-xs">
								<Pair label="Memenuhi syarat">{dest.eligible}</Pair>
								<Pair label="Ditahan, tanpa izin">{dest.suppressed}</Pair>
								<Pair label="Dalam antrean">{dest.queued}</Pair>
								<Pair label="Diterima platform">{dest.accepted}</Pair>
								<Pair label="Diproses lokal">{dest.processed}</Pair>
								<Pair label="Atribusi platform">
									{dest.attributed === null
										? "Tidak diketahui"
										: dest.attributed}
								</Pair>
							</dl>

							<dl className="grid gap-1 border-t pt-3 text-xs">
								<Pair label="Kejadian pembelian vs pesanan unik">
									{dest.purchase_collection_instances} vs {dest.unique_orders}
								</Pair>
								<Pair label="Penerimaan kotor">
									{idr.format(dest.reconciliation.gross_merchandise_amount_idr)}
								</Pair>
								<Pair label="Pengembalian dana">
									{idr.format(
										dest.reconciliation.refunded_merchandise_amount_idr,
									)}
								</Pair>
								<Pair label="Penerimaan bersih">
									{idr.format(dest.reconciliation.net_merchandise_amount_idr)}
								</Pair>
								<Pair label="Nilai sinyal pembelian terkirim">
									{idr.format(
										dest.reconciliation.dispatched_purchase_signal_amount_idr,
									)}
								</Pair>
								<Pair label="Tanpa sesi / tanpa izin">
									{dest.missing_identity.orders_without_visitor_session} /{" "}
									{dest.missing_identity.orders_without_consent}
								</Pair>
							</dl>

							<div className="mt-auto flex flex-wrap gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									data-testid={`ad-toggle-pause-${dest.platform}`}
									onClick={() => open({ kind: "pause", dest })}
								>
									{dest.paused ? "Lanjutkan pengiriman" : "Jeda pengiriman"}
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									data-testid={`ad-replay-btn-${dest.platform}`}
									onClick={() => open({ kind: "replay", dest })}
								>
									Kirim ulang kejadian
								</Button>
							</div>
						</article>
					))}
				</div>
			)}

			<Dialog
				open={action !== null}
				onOpenChange={(next) => {
					if (!next && !pending) setAction(null);
				}}
			>
				<DialogContent
					onCloseAutoFocus={(e) => {
						e.preventDefault();
						openerRef.current?.focus();
					}}
				>
					<form
						noValidate
						className="flex flex-col gap-4"
						onSubmit={(e) => {
							e.preventDefault();
							void submit();
						}}
					>
						<DialogHeader>
							<DialogTitle>
								{action?.kind === "replay"
									? `Kirim ulang kejadian ke ${actionName}`
									: pausing
										? `Jeda pengiriman sinyal ${actionName}?`
										: `Lanjutkan pengiriman sinyal ${actionName}?`}
							</DialogTitle>
							<DialogDescription>
								{action?.kind === "replay"
									? "Satu kejadian pembelian yang sudah tercatat dikirim ulang ke platform. Tindakan ini tercatat di audit."
									: pausing
										? "Sinyal baru ditahan di antrean sampai pengiriman dilanjutkan. Pesanan dan pembayaran tidak terpengaruh."
										: "Sinyal yang ditahan akan dikirim lagi sesuai urutan antrean."}
							</DialogDescription>
						</DialogHeader>

						{action?.kind === "replay" && (
							<div className="flex flex-col gap-1.5">
								<label
									htmlFor="replay-event-id-input"
									className="text-sm font-medium"
								>
									ID kejadian (event_id)
								</label>
								<Input
									id="replay-event-id-input"
									data-testid="replay-event-id-input"
									value={eventId}
									onChange={(e) => setEventId(e.target.value)}
									placeholder="00000000-0000-4000-8000-000000000000"
									ref={eventIdRef}
									autoComplete="off"
									required
									aria-invalid={fieldErrors.eventId ? true : undefined}
									aria-describedby={
										fieldErrors.eventId ? "replay-event-id-error" : undefined
									}
									className="font-mono"
								/>
								{fieldErrors.eventId && (
									<p
										id="replay-event-id-error"
										className="text-sm text-destructive"
									>
										{fieldErrors.eventId}
									</p>
								)}
							</div>
						)}

						<div className="flex flex-col gap-1.5">
							<label htmlFor="ad-action-reason" className="text-sm font-medium">
								Alasan (wajib, tercatat di audit)
							</label>
							<Textarea
								id="ad-action-reason"
								value={reason}
								onChange={(e) => setReason(e.target.value)}
								ref={reasonRef}
								maxLength={500}
								required
								aria-invalid={fieldErrors.reason ? true : undefined}
								aria-describedby={
									fieldErrors.reason ? "ad-action-reason-error" : undefined
								}
							/>
							{fieldErrors.reason && (
								<p
									id="ad-action-reason-error"
									className="text-sm text-destructive"
								>
									{fieldErrors.reason}
								</p>
							)}
						</div>

						{dialogError && (
							<p role="alert" className="text-sm text-destructive">
								{dialogError}
							</p>
						)}

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								disabled={pending}
								onClick={() => setAction(null)}
							>
								Batal
							</Button>
							<Button type="submit" disabled={pending}>
								{pending
									? "Memproses…"
									: action?.kind === "replay"
										? "Kirim ulang"
										: pausing
											? "Jeda pengiriman"
											: "Lanjutkan pengiriman"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</section>
	);
}

function Pair({
	label,
	testId,
	children,
}: {
	label: string;
	testId?: string;
	children: React.ReactNode;
}) {
	return (
		<div
			data-testid={testId}
			className="flex flex-wrap items-baseline justify-between gap-x-3"
		>
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="font-semibold tabular-nums">{children}</dd>
		</div>
	);
}
