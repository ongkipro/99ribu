"use client";

import { CircleCheck, Pause, Pencil, Play, RefreshCw, RotateCcw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { failureText, getJson } from "./admin-errors";
import { formatWib, rupiah } from "./format";
import { FormDialog, FormField } from "./form";
import { useSettingsIntent } from "./settings-intent";
import { EmptyState, ErrorState } from "./states";
import { StatusBadge } from "./status";

// S130 / spec 17 B24: advertising destinations, redacted diagnostics, version history, pause/resume,
// and controlled event replay moved off the owner dashboard to /admin/pemasaran/iklan.

const CONVERSION_SOURCE_LABELS: Record<string, string> = {
	UPLOAD_CLICKS: "Unggah klik offline",
};

export interface AdDestinationHistoryItem {
	version: number;
	paused: boolean;
	public_identifier: string | null;
	reason: string | null;
	created_at: string;
}

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
	history?: AdDestinationHistoryItem[];
}

const PLATFORM_NAMES: Record<AdDestinationItem["platform"], string> = {
	meta: "Meta",
	google: "Google Ads",
	tiktok: "TikTok",
};

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DialogState =
	| { kind: "version"; dest: AdDestinationItem }
	| { kind: "pause"; dest: AdDestinationItem }
	| { kind: "replay"; dest: AdDestinationItem }
	| null;

export function SettingsAdvertisingClient({ canWrite }: { canWrite: boolean }) {
	const [destinations, setDestinations] = useState<AdDestinationItem[]>([]);
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [error, setError] = useState<string | null>(null);
	const [dialog, setDialog] = useState<DialogState>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	const requestRef = useRef(0);

	const load = useCallback(async () => {
		const runId = ++requestRef.current;
		setState("loading");
		setError(null);
		const res = await getJson<{ data: AdDestinationItem[] }>(
			"/api/v1/admin/advertising/destinations",
		);
		if (runId !== requestRef.current) return;
		if (!res.ok) {
			setDestinations([]);
			setError(failureText(res.failure));
			setState("error");
			return;
		}
		setDestinations(res.data.data ?? []);
		setState("ready");
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);

	return (
		<div
			className="flex flex-col gap-6"
			data-testid="settings-advertising-root"
		>
			{notice && (
				<Alert
					ref={noticeRef}
					tabIndex={-1}
					role="status"
					className="outline-none"
					data-testid="advertising-notice"
				>
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">
						{notice}
					</AlertDescription>
				</Alert>
			)}

			{!canWrite && (
				<p
					data-testid="advertising-readonly"
					className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
				>
					Hanya baca: Anda dapat meninjau diagnostik sinyal yang diredaksi dan
					riwayat versi tujuan iklan. Perubahan konfigurasi, jeda, atau
					pengiriman ulang memerlukan Super Admin dengan autentikasi ulang.
				</p>
			)}

			<section
				aria-labelledby="ad-diagnostics-heading"
				data-testid="panel-s60-advertising"
				className="flex flex-col gap-4"
			>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex flex-col gap-1">
						<h2 id="ad-diagnostics-heading" className="text-base font-semibold">
							Tujuan iklan & diagnostik sinyal
						</h2>
						<p className="text-sm text-muted-foreground">
							Kredensial selalu disimpan di penyimpanan rahasia dan tidak pernah
							ditampilkan. Jumlah kejadian sinyal dipisahkan dari pesanan unik
							dan penerimaan uang aktual.
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void load()}
					>
						<RefreshCw aria-hidden="true" />
						Muat ulang
					</Button>
				</div>

				{state === "loading" && destinations.length === 0 ? (
					<div
						className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4"
						aria-busy="true"
					>
						<span className="sr-only">Memuat diagnostik iklan…</span>
						<Skeleton className="h-72" />
						<Skeleton className="h-72" />
						<Skeleton className="h-72" />
					</div>
				) : state === "error" ? (
					<ErrorState
						message={`Diagnostik iklan gagal dimuat. ${error ?? ""}`}
						onRetry={() => void load()}
					/>
				) : destinations.length === 0 ? (
					<EmptyState>Belum ada tujuan iklan yang dikonfigurasi.</EmptyState>
				) : (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4">
						{destinations.map((dest) => (
							<article
								key={dest.platform}
								data-testid={`ad-destination-card-${dest.platform}`}
								className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4"
							>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<h3 className="text-sm font-semibold">
										{PLATFORM_NAMES[dest.platform]}{" "}
										<span className="text-xs font-normal text-muted-foreground tabular-nums">
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
										<code
											data-testid={`ad-public-id-${dest.platform}`}
											className="font-mono text-xs"
										>
											{dest.public_identifier}
										</code>
									</Pair>
									<Pair label="Versi tujuan">
										<code className="font-mono text-xs">
											{dest.destination_version}
										</code>
									</Pair>
									{dest.google_conversion_source && (
										<Pair label="Sumber konversi Google">
											{CONVERSION_SOURCE_LABELS[
												dest.google_conversion_source
											] ?? dest.google_conversion_source}
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
										{rupiah(dest.reconciliation.gross_merchandise_amount_idr)}
									</Pair>
									<Pair label="Pengembalian dana">
										{rupiah(
											dest.reconciliation.refunded_merchandise_amount_idr,
										)}
									</Pair>
									<Pair label="Penerimaan bersih">
										{rupiah(dest.reconciliation.net_merchandise_amount_idr)}
									</Pair>
									<Pair label="Nilai sinyal pembelian terkirim">
										{rupiah(
											dest.reconciliation.dispatched_purchase_signal_amount_idr,
										)}
									</Pair>
									<Pair label="Tanpa sesi / tanpa izin">
										{dest.missing_identity.orders_without_visitor_session} /{" "}
										{dest.missing_identity.orders_without_consent}
									</Pair>
								</dl>

								<details
									className="border-t pt-2 text-xs"
									data-testid={`ad-history-${dest.platform}`}
								>
									<summary className="min-h-9 cursor-pointer font-medium text-muted-foreground pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center">
										Riwayat versi ({dest.history?.length ?? 1})
									</summary>
									<ol className="mt-2 flex flex-col divide-y">
										{(
											dest.history ?? [
												{
													version: dest.version,
													paused: dest.paused,
													public_identifier: dest.public_identifier,
													reason: "Versi aktif",
													created_at: dest.updated_at,
												},
											]
										).map((ver) => (
											<li
												key={ver.version}
												data-testid={`ad-version-${dest.platform}-${ver.version}`}
												className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0"
											>
												<div className="flex flex-wrap items-center gap-1.5">
													<span className="font-semibold tabular-nums">
														v{ver.version}
													</span>
													<StatusBadge tone={ver.paused ? "problem" : "success"}>
														{ver.paused ? "Dijeda" : "Aktif"}
													</StatusBadge>
													<span className="text-muted-foreground">
														{formatWib(ver.created_at)}
													</span>
												</div>
												{ver.public_identifier && (
													<code className="font-mono text-xs text-muted-foreground">
														{ver.public_identifier}
													</code>
												)}
												{ver.reason && (
													<span className="break-words">{ver.reason}</span>
												)}
											</li>
										))}
									</ol>
								</details>

								{canWrite && (
									<div className="mt-auto flex flex-wrap gap-2 pt-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											data-testid={`ad-edit-version-${dest.platform}`}
											onClick={() => setDialog({ kind: "version", dest })}
										>
											<Pencil aria-hidden="true" />
											Versi baru
										</Button>
										<Button
											type="button"
											variant="outline"
											size="sm"
											data-testid={`ad-toggle-pause-${dest.platform}`}
											onClick={() => setDialog({ kind: "pause", dest })}
										>
											{dest.paused ? (
												<Play aria-hidden="true" />
											) : (
												<Pause aria-hidden="true" />
											)}
											{dest.paused
												? "Lanjutkan kirim sinyal"
												: "Jeda kirim sinyal"}
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											data-testid={`ad-replay-btn-${dest.platform}`}
											onClick={() => setDialog({ kind: "replay", dest })}
										>
											<RotateCcw aria-hidden="true" />
											Kirim ulang kejadian
										</Button>
									</div>
								)}
							</article>
						))}
					</div>
				)}
			</section>

			{dialog?.kind === "version" && (
				<AdVersionDialog
					dest={dialog.dest}
					onClose={() => setDialog(null)}
					onStale={() => void load()}
					onDone={(updated) => {
						setDialog(null);
						setDestinations((prev) =>
							prev.map((d) => (d.platform === updated.platform ? updated : d)),
						);
						setNotice(
							`Konfigurasi ${PLATFORM_NAMES[updated.platform]} diperbarui ke versi v${updated.version}.`,
						);
					}}
				/>
			)}

			{dialog?.kind === "pause" && (
				<AdPauseDialog
					dest={dialog.dest}
					onClose={() => setDialog(null)}
					onStale={() => void load()}
					onDone={(updated) => {
						setDialog(null);
						setDestinations((prev) =>
							prev.map((d) => (d.platform === updated.platform ? updated : d)),
						);
						setNotice(
							`Pengiriman sinyal ${PLATFORM_NAMES[updated.platform]} ${updated.paused ? "dijeda" : "dilanjutkan"} (revisi v${updated.version}).`,
						);
					}}
				/>
			)}

			{dialog?.kind === "replay" && (
				<AdReplayDialog
					dest={dialog.dest}
					onClose={() => setDialog(null)}
					onStale={() => void load()}
					onDone={(eventId) => {
						const name = PLATFORM_NAMES[dialog.dest.platform];
						setDialog(null);
						setNotice(`Kejadian ${eventId} dikirim ulang ke ${name}.`);
						void load();
					}}
				/>
			)}
		</div>
	);
}

function AdVersionDialog({
	dest,
	onClose,
	onStale,
	onDone,
}: {
	dest: AdDestinationItem;
	onClose: () => void;
	onStale: () => void;
	onDone: (updated: AdDestinationItem) => void;
}) {
	const id = useId();
	// Frozen on mount: a background reload after 409 VERSION_CONFLICT must not silently advance the version an open dialog submits.
	const [capturedVersion] = useState(dest.version);
	const [publicIdentifier, setPublicIdentifier] = useState(
		dest.public_identifier,
	);
	const [destinationVersion, setDestinationVersion] = useState(
		dest.destination_version,
	);
	const [paused, setPaused] = useState(dest.paused);
	const [reason, setReason] = useState("");
	const intent = useSettingsIntent();

	async function submit() {
		if (!publicIdentifier.trim()) {
			intent.setError("ID publik tujuan iklan wajib diisi.");
			return;
		}
		if (!destinationVersion.trim()) {
			intent.setError("Versi tujuan wajib diisi.");
			return;
		}
		if (!reason.trim()) {
			intent.setError("Alasan perubahan wajib diisi.");
			return;
		}
		const saved = await intent.run<AdDestinationItem>(
			`/api/v1/admin/advertising/destinations/${dest.id}/versions`,
			() => ({
				expected_version: capturedVersion,
				public_identifier: publicIdentifier.trim(),
				destination_version: destinationVersion.trim(),
				paused,
				reason: reason.trim(),
			}),
			{
				onStale,
				onUncertain: onStale,
			},
		);
		if (saved) {
			onDone(saved);
		}
	}

	return (
		<FormDialog
			title={`Versi baru ${PLATFORM_NAMES[dest.platform]}`}
			description={`Menambah revisi v${capturedVersion + 1} (didasarkan pada revisi v${capturedVersion}). Kredensial rahasia tidak diubah dari layar ini.`}
			pending={intent.pending}
			error={intent.error}
			submitLabel="Simpan versi tujuan"
			pendingLabel="Menyimpan…"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField
				id={`${id}-public-id`}
				label="ID publik / piksel tujuan"
				hint="ID publik terverifikasi, tanpa token atau kunci rahasia."
			>
				<Input
					id={`${id}-public-id`}
					data-testid="ad-version-public-id"
					maxLength={100}
					autoComplete="off"
					aria-describedby={`${id}-public-id-hint`}
					value={publicIdentifier}
					onChange={(e) => setPublicIdentifier(e.target.value)}
				/>
			</FormField>

			<FormField id={`${id}-dest-version`} label="Versi skema tujuan">
				<Input
					id={`${id}-dest-version`}
					data-testid="ad-version-schema"
					maxLength={100}
					autoComplete="off"
					value={destinationVersion}
					onChange={(e) => setDestinationVersion(e.target.value)}
				/>
			</FormField>

			<label className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
				<input
					type="checkbox"
					data-testid="ad-version-paused"
					className="size-4 accent-primary"
					checked={paused}
					onChange={(e) => setPaused(e.target.checked)}
				/>
				Jeda pengiriman sinyal untuk tujuan ini
			</label>

			<FormField id={`${id}-reason`} label="Alasan perubahan (wajib)">
				<Textarea
					id={`${id}-reason`}
					data-testid="ad-version-reason"
					rows={2}
					maxLength={1000}
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>

		</FormDialog>
	);
}

function AdPauseDialog({
	dest,
	onClose,
	onStale,
	onDone,
}: {
	dest: AdDestinationItem;
	onClose: () => void;
	onStale: () => void;
	onDone: (updated: AdDestinationItem) => void;
}) {
	const id = useId();
	// Frozen on mount: a background reload after 409 VERSION_CONFLICT must not silently advance the version an open dialog submits.
	const [capturedVersion] = useState(dest.version);
	const [reason, setReason] = useState("");
	const intent = useSettingsIntent();
	const pausing = !dest.paused;
	const name = PLATFORM_NAMES[dest.platform];

	async function submit() {
		if (!reason.trim()) {
			intent.setError("Alasan wajib diisi untuk jejak audit.");
			return;
		}
		const saved = await intent.run<AdDestinationItem>(
			`/api/v1/admin/advertising/destinations/${dest.id}/pause`,
			() => ({
				expected_version: capturedVersion,
				paused: pausing,
				reason: reason.trim(),
			}),
			{
				onStale,
				onUncertain: onStale,
			},
		);
		if (saved) {
			onDone(saved);
		}
	}

	return (
		<FormDialog
			title={
				pausing ? `Jeda kirim sinyal ${name}?` : `Lanjutkan kirim sinyal ${name}?`
			}
			description={
				pausing
					? `Menambah revisi v${capturedVersion + 1}. Sinyal baru ditahan di antrean sampai pengiriman dilanjutkan; pesanan dan pembayaran tidak terpengaruh.`
					: `Menambah revisi v${capturedVersion + 1}. Sinyal yang memenuhi izin akan dikirim sesuai antrean.`
			}
			pending={intent.pending}
			error={intent.error}
			submitLabel={pausing ? "Jeda kirim sinyal" : "Lanjutkan kirim sinyal"}
			pendingLabel="Memproses…"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField
				id={`${id}-reason`}
				label="Alasan (wajib, tercatat di audit)"
			>
				<Textarea
					id={`${id}-reason`}
					data-testid="ad-pause-reason"
					rows={2}
					maxLength={1000}
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>

		</FormDialog>
	);
}

function AdReplayDialog({
	dest,
	onClose,
	onStale,
	onDone,
}: {
	dest: AdDestinationItem;
	onClose: () => void;
	onStale: () => void;
	onDone: (eventId: string) => void;
}) {
	const id = useId();
	// Frozen on mount: a background reload after 409 VERSION_CONFLICT must not silently advance the version an open dialog submits.
	const [capturedVersion] = useState(dest.version);
	const [eventId, setEventId] = useState("");
	const [reason, setReason] = useState("");
	const intent = useSettingsIntent();
	const name = PLATFORM_NAMES[dest.platform];

	async function submit() {
		const trimmedEventId = eventId.trim();
		if (!UUID_RE.test(trimmedEventId)) {
			intent.setError(
				trimmedEventId
					? "ID kejadian harus berupa UUID yang valid."
					: "ID kejadian wajib diisi.",
			);
			return;
		}
		if (!reason.trim()) {
			intent.setError("Alasan wajib diisi untuk jejak audit.");
			return;
		}
		const saved = await intent.run<{ event_id: string }>(
			`/api/v1/admin/advertising/destinations/${dest.id}/replays`,
			() => ({
				expected_version: capturedVersion,
				event_id: trimmedEventId,
				reason: reason.trim(),
			}),
			{
				onStale,
				onUncertain: onStale,
			},
		);
		if (saved) {
			onDone(trimmedEventId);
		}
	}

	return (
		<FormDialog
			title={`Kirim ulang kejadian ke ${name}`}
			description={`Satu kejadian pembelian yang sudah tercatat dikirim ulang ke ${name} (revisi v${capturedVersion}). Tindakan ini tercatat di audit.`}
			pending={intent.pending}
			error={intent.error}
			submitLabel="Kirim ulang"
			pendingLabel="Memproses…"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id="replay-event-id-input" label="ID kejadian (event_id)">
				<Input
					id="replay-event-id-input"
					data-testid="replay-event-id-input"
					placeholder="00000000-0000-4000-8000-000000000000"
					autoComplete="off"
					className="font-mono"
					value={eventId}
					onChange={(e) => setEventId(e.target.value)}
				/>
			</FormField>

			<FormField
				id={`${id}-reason`}
				label="Alasan (wajib, tercatat di audit)"
			>
				<Textarea
					id={`${id}-reason`}
					data-testid="ad-replay-reason"
					rows={2}
					maxLength={1000}
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>

		</FormDialog>
	);
}

function Pair({
	label,
	testId,
	children,
}: {
	label: string;
	testId?: string;
	children: ReactNode;
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
