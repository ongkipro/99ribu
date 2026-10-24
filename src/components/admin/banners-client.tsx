"use client";

import { ArrowDown, ArrowUp, CircleCheck, History, ImageUp, Plus } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BANNER_IMAGE_BYTES, BANNER_IMAGE_MIN, BANNER_TINTS, type BannerPhase, type BannerTint, bannerHref } from "@/modules/storefront/banner-rules";
import { wibDateTime, wibInput, wibInputToIso } from "@/modules/storefront/format";
import { BannerCard, type Banner, PromoBanners } from "../storefront/sections/promo-banners";
import { CatalogImage } from "../storefront/ui/media";
import { describeFailure, failureText, getJson, readFailure } from "./admin-errors";
import { DataTable, type DataTableColumn, type DataTableStatus } from "./data-table";
import { FormDialog, FormField, nativeSelectClass, SegmentedControl } from "./form";
import { DetailSection, StickyActions } from "./page-blocks";
import { EmptyState, ErrorState, LoadingState } from "./states";
import { StatusBadge, type StatusTone } from "./status";

// S110 home banner manager: list (rail order), schedule in WIB, reorder, retire, history, and a preview that
// renders the storefront's own rail card. Every write asks for the password (home_banner.write proof).
type AdminBanner = {
	id: string;
	version: number;
	version_id: string;
	title: string;
	subtitle: string | null;
	action_label: string;
	href: string;
	tint: BannerTint | null;
	image: { sha256: string; width: number; height: number; alt: string; url: string };
	starts_at: string;
	ends_at: string;
	position: number;
	active: boolean;
	retired: boolean;
	recorded_by: string;
	recorded_by_name: string | null;
	reason: string;
	recorded_at: string;
	phase: BannerPhase;
};
type Image = { sha256: string; width: number; height: number; url: string };

const PHASE: Record<BannerPhase, { tone: StatusTone; label: string }> = {
	live: { tone: "success", label: "Tayang" },
	scheduled: { tone: "open", label: "Terjadwal" },
	paused: { tone: "closed", label: "Dijeda" },
	ended: { tone: "closed", label: "Berakhir" },
	retired: { tone: "closed", label: "Diarsipkan" },
};
const TINT_LABEL: Record<BannerTint, string> = { amber: "Kuning", slate: "Abu-abu", rose: "Merah muda", blue: "Biru", green: "Hijau", violet: "Ungu", teal: "Toska" };
const CODE_MESSAGES: Record<string, string> = {
	REAUTHENTICATION_REQUIRED: "Kata sandi salah atau konfirmasinya kedaluwarsa.",
	FRESH_MFA_REQUIRED: "Verifikasi dua langkah ulang diperlukan. Keluar lalu masuk kembali.",
	RATE_LIMITED: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
	INVALID_BANNER_LINK: "Tujuan harus halaman toko: /promo, /kategori, /kategori/<slug>, /cari?q=… atau /produk/<slug>.",
	BANNER_WINDOW_INVALID: "Waktu berakhir harus setelah waktu mulai.",
	BANNER_ALREADY_ENDED: "Waktu berakhir sudah lewat. Pilih waktu di masa depan.",
	BANNER_SCHEDULE_TOO_DISTANT: "Waktu mulai paling jauh 366 hari dari sekarang.",
	BANNER_IMAGE_NOT_FOUND: "Gambar tidak ditemukan di media katalog. Unggah ulang.",
	BANNER_IMAGE_TOO_SMALL: `Gambar terlalu kecil: sisi terpendek minimal ${BANNER_IMAGE_MIN} px.`,
	BANNER_IMAGE_TOO_LARGE: "Gambar terlalu besar: sisi terpanjang maksimal 4096 px.",
	BANNER_IMAGE_REJECTED: "Gambar ditolak pemeriksaan berkas.",
	UNSUPPORTED_IMAGE_TYPE: "Gunakan gambar WebP.",
	UPLOAD_TYPE_MISMATCH: "Isi berkas bukan gambar WebP.",
	BODY_TOO_LARGE: "Berkas melebihi 512 KB.",
	BANNER_LIMIT_REACHED: "Sudah ada 24 banner aktif atau terjadwal. Arsipkan salah satu dulu.",
	BANNER_RETIRED: "Banner ini sudah diarsipkan.",
	BANNER_ORDER_STALE: "Daftar banner sudah berubah. Muat ulang lalu atur urutan lagi.",
};
const message = (status: number, code: string | null) =>
	code && CODE_MESSAGES[code] ? `${CODE_MESSAGES[code]} (kode: ${code})` : failureText(describeFailure(status, code));

type Result<T> = { ok: true; data: T } | { ok: false; text: string };
async function send<T>(url: string, body: BodyInit, contentType: string): Promise<Result<T>> {
	try {
		const res = await fetch(url, {
			method: "POST",
			credentials: "include",
			headers: { "content-type": contentType, "idempotency-key": crypto.randomUUID() },
			body,
		});
		if (res.ok) return { ok: true, data: (await res.json()) as T };
		const failure = await readFailure(res);
		return { ok: false, text: message(res.status, failure.code) };
	} catch {
		return { ok: false, text: message(0, null) };
	}
}
const post = <T,>(url: string, body: unknown) => send<T>(url, JSON.stringify(body), "application/json");
/** A single-use proof for one banner write (fresh MFA + password). */
async function withProof<T>(password: string, url: string, body: Record<string, unknown>) {
	const proof = await post<{ proof: string }>("/api/v1/me/reauthentication-proofs", {
		password,
		action: "home_banner.write",
		subject_id: "home-banners",
	});
	if (!proof.ok) return proof;
	return post<T>(url, { ...body, reauthentication_proof: proof.data.proof });
}

const toCard = (b: {
	id: string;
	title: string;
	subtitle: string | null;
	action_label: string;
	href: string;
	tint: BannerTint | null;
	image: { url: string; width: number; height: number; alt: string } | null;
}): Banner => ({
	id: b.id,
	title: b.title,
	body: b.subtitle ?? "",
	href: b.href,
	action: b.action_label,
	tint: "#efeafd",
	cutout: b.tint ?? undefined,
	images: b.image ? [{ src: b.image.url, width: b.image.width, height: b.image.height, alt: b.image.alt }] : [],
});
const schedule = (b: Pick<AdminBanner, "starts_at" | "ends_at">) => `${wibDateTime(b.starts_at)} – ${wibDateTime(b.ends_at)}`;

export function BannersClient() {
	const [state, setState] = useState<"current" | "retired">("current");
	const [rows, setRows] = useState<AdminBanner[]>([]);
	const [status, setStatus] = useState<DataTableStatus>({ kind: "loading" });
	const [order, setOrder] = useState<string[] | null>(null);
	const [editing, setEditing] = useState<AdminBanner | "new" | null>(null);
	const [retiring, setRetiring] = useState<AdminBanner | null>(null);
	const [history, setHistory] = useState<AdminBanner | null>(null);
	const [savingOrder, setSavingOrder] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	const load = useCallback(async () => {
		setStatus({ kind: "loading" });
		const result = await getJson<{ data: AdminBanner[] }>(`/api/v1/admin/home-banners?state=${state}`);
		if (!result.ok) {
			setStatus(
				result.failure.status === 403 || result.failure.status === 401
					? { kind: "denied", message: result.failure.message }
					: { kind: "error", message: failureText(result.failure), onRetry: () => void load() },
			);
			return;
		}
		setRows(result.data.data);
		setOrder(null);
		setStatus({ kind: "ready" });
	}, [state]);
	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);
	const shown = order ? order.map((id) => rows.find((row) => row.id === id) as AdminBanner) : rows;
	const move = (id: string, delta: -1 | 1) => {
		const ids = order ?? rows.map((row) => row.id);
		const from = ids.indexOf(id);
		const to = from + delta;
		if (to < 0 || to >= ids.length) return;
		const next = [...ids];
		[next[from], next[to]] = [next[to], next[from]];
		setOrder(next.join() === rows.map((row) => row.id).join() ? null : next);
	};
	const done = (text: string) => {
		setEditing(null);
		setRetiring(null);
		setSavingOrder(false);
		setNotice(text);
		void load();
	};
	const current = state === "current";
	const columns: DataTableColumn<AdminBanner>[] = [
		{
			id: "banner",
			header: "Banner",
			stack: "title",
			cell: (b) => (
				<div className="flex min-w-0 items-center gap-3">
					<CatalogImage
						src={b.image.url}
						sizes="56px"
						max={128}
						alt=""
						width={b.image.width}
						height={b.image.height}
						className="size-14 shrink-0 rounded-md border object-cover"
					/>
					<div className="flex min-w-0 flex-col">
						<span className="font-medium break-words" data-testid={`banner-title-${b.id}`}>
							{b.title}
						</span>
						<span className="font-mono text-xs break-all text-muted-foreground">{b.href}</span>
					</div>
				</div>
			),
		},
		{
			id: "status",
			header: "Status",
			stack: "status",
			cell: (b) => (
				<StatusBadge tone={PHASE[b.phase].tone} testId={`banner-phase-${b.id}`} data-status={b.phase}>
					{PHASE[b.phase].label}
				</StatusBadge>
			),
		},
		{ id: "schedule", header: "Jadwal (WIB)", cell: (b) => <span className="tabular-nums">{schedule(b)}</span> },
		...(current
			? [{ id: "order", header: "Urutan", cellClassName: "tabular-nums", cell: (b: AdminBanner) => shown.indexOf(b) + 1 }]
			: []),
		{
			id: "recorded",
			header: "Perubahan terakhir",
			stack: "meta",
			cell: (b) => (
				<span className="text-xs text-muted-foreground">
					Versi {b.version} · {wibDateTime(b.recorded_at)}
					{b.recorded_by_name ? ` · ${b.recorded_by_name}` : ""}
				</span>
			),
		},
		{
			id: "actions",
			header: <span className="sr-only">Tindakan</span>,
			cell: (b) => {
				const index = shown.indexOf(b);
				return (
					<div className="flex flex-wrap items-center gap-2">
						{current && (
							<>
								<Button
									type="button"
									variant="outline"
									size="icon"
									aria-label={`Naikkan urutan ${b.title}`}
									data-testid={`banner-up-${b.id}`}
									disabled={index === 0}
									onClick={() => move(b.id, -1)}
								>
									<ArrowUp aria-hidden="true" />
								</Button>
								<Button
									type="button"
									variant="outline"
									size="icon"
									aria-label={`Turunkan urutan ${b.title}`}
									data-testid={`banner-down-${b.id}`}
									disabled={index === shown.length - 1}
									onClick={() => move(b.id, 1)}
								>
									<ArrowDown aria-hidden="true" />
								</Button>
								<Button type="button" variant="outline" data-testid={`banner-edit-${b.id}`} disabled={!!order} onClick={() => setEditing(b)}>
									Ubah
								</Button>
								<Button type="button" variant="outline" data-testid={`banner-retire-${b.id}`} disabled={!!order} onClick={() => setRetiring(b)}>
									Arsipkan
								</Button>
							</>
						)}
						<Button type="button" variant="outline" data-testid={`banner-history-${b.id}`} onClick={() => setHistory(b)}>
							<History data-icon="inline-start" aria-hidden="true" />
							Riwayat
						</Button>
					</div>
				);
			},
		},
	];
	const live = shown.filter((b) => b.phase === "live");
	return (
		<div className="flex flex-col gap-6">
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="outline-none" data-testid="banners-notice">
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			<section aria-labelledby="banners-list-heading" className="flex flex-col gap-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 id="banners-list-heading" className="text-lg font-semibold">
						Daftar banner
					</h2>
					<Button type="button" data-testid="banners-create" disabled={!!order} onClick={() => setEditing("new")} className="max-md:w-full">
						<Plus data-icon="inline-start" aria-hidden="true" />
						Tambah banner
					</Button>
				</div>
				<SegmentedControl
					legend="Tampilkan"
					value={state}
					options={[
						["current", "Aktif & terjadwal"],
						["retired", "Diarsipkan"],
					]}
					onChange={setState}
					testId={(key) => `banners-state-${key}`}
				/>
				<DataTable
					rows={shown}
					rowKey={(b) => b.id}
					columns={columns}
					status={status}
					stack
					loadingLabel="Memuat banner…"
					caption="Banner beranda"
					testId="banners-list"
					rowTestId={(b) => `banner-row-${b.id}`}
					emptyTestId="banners-empty"
					empty={
						current
							? "Belum ada banner di daftar ini, jadi beranda menampilkan kartu bawaan (Paket campuran, Otomotif, Fashion Pria). Setelah ada banner, hanya banner dari daftar ini yang tampil sesuai jadwalnya."
							: "Belum ada banner yang diarsipkan."
					}
				/>
				{order && (
					<StickyActions>
						<p className="text-sm max-md:basis-full max-md:text-center">Urutan berubah, belum disimpan.</p>
						<Button type="button" variant="outline" data-testid="banners-order-cancel" onClick={() => setOrder(null)}>
							Batalkan
						</Button>
						<Button type="button" data-testid="banners-order-save" onClick={() => setSavingOrder(true)}>
							Simpan urutan
						</Button>
					</StickyActions>
				)}
			</section>
			{current && status.kind === "ready" && (
				<DetailSection
					id="banners-preview-heading"
					title="Pratinjau beranda"
					description="Banner yang tayang sekarang, dengan urutan dan tampilan seperti di toko."
					testId="banners-preview"
				>
					{live.length ? (
						<div inert className="home-main overflow-hidden pt-0!">
							<PromoBanners banners={live.map(toCard)} />
						</div>
					) : (
						<EmptyState>
							{rows.length
								? "Tidak ada banner yang tayang sekarang, jadi bagian ini tidak tampil di beranda."
								: "Beranda menampilkan kartu bawaan sampai ada banner di daftar ini."}
						</EmptyState>
					)}
				</DetailSection>
			)}
			{editing && (
				<BannerEditor
					banner={editing === "new" ? null : editing}
					onClose={() => setEditing(null)}
					onDone={(b, created) => done(created ? `Banner "${b.title}" dibuat.` : `Banner "${b.title}" diperbarui ke versi ${b.version}.`)}
				/>
			)}
			{retiring && (
				<RetireDialog banner={retiring} onClose={() => setRetiring(null)} onDone={() => done(`Banner "${retiring.title}" diarsipkan.`)} />
			)}
			{savingOrder && order && (
				<OrderDialog
					banners={shown}
					onClose={() => setSavingOrder(false)}
					onDone={() => done("Urutan banner disimpan.")}
				/>
			)}
			{history && <HistoryDialog banner={history} onClose={() => setHistory(null)} />}
		</div>
	);
}

type Draft = {
	title: string;
	subtitle: string;
	action_label: string;
	href: string;
	image: Image | null;
	image_alt: string;
	tint: BannerTint | "";
	starts: string;
	ends: string;
	active: boolean;
	reason: string;
	password: string;
};
function draftOf(banner: AdminBanner | null): Draft {
	if (banner)
		return {
			title: banner.title,
			subtitle: banner.subtitle ?? "",
			action_label: banner.action_label,
			href: banner.href,
			image: banner.image,
			image_alt: banner.image.alt,
			tint: banner.tint ?? "",
			starts: wibInput(banner.starts_at),
			ends: wibInput(banner.ends_at),
			active: banner.active,
			reason: "",
			password: "",
		};
	const now = Date.now();
	return {
		title: "",
		subtitle: "",
		action_label: "Lihat pilihan",
		href: "/promo",
		image: null,
		image_alt: "",
		tint: "",
		starts: wibInput(now),
		ends: wibInput(now + 30 * 86_400_000),
		active: true,
		reason: "",
		password: "",
	};
}

function BannerEditor({
	banner,
	onClose,
	onDone,
}: {
	banner: AdminBanner | null;
	onClose: () => void;
	onDone: (banner: AdminBanner, created: boolean) => void;
}) {
	const [draft, setDraft] = useState<Draft>(() => draftOf(banner));
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const ids = useId();
	const field = (name: string) => `${ids}-${name}`;
	const set =
		(name: keyof Draft) =>
		(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
			setDraft((d) => ({ ...d, [name]: e.target.value }));
	async function upload(file: File | undefined) {
		setUploadError(null);
		if (!file) return;
		if (file.type !== "image/webp") return setUploadError(CODE_MESSAGES.UNSUPPORTED_IMAGE_TYPE);
		if (file.size > BANNER_IMAGE_BYTES) return setUploadError(CODE_MESSAGES.BODY_TOO_LARGE);
		setUploading(true);
		const result = await send<Image>("/api/v1/admin/home-banner-images", file, "image/webp");
		setUploading(false);
		if (!result.ok) return setUploadError(result.text);
		setDraft((d) => ({ ...d, image: result.data }));
	}
	const href = bannerHref(draft.href.trim());
	const startsAt = wibInputToIso(draft.starts);
	const endsAt = wibInputToIso(draft.ends);
	async function submit() {
		const title = draft.title.trim();
		const alt = draft.image_alt.trim();
		const action = draft.action_label.trim();
		if (!draft.image) return setError("Unggah gambar banner terlebih dahulu.");
		if (!title || !action || !alt || !draft.reason.trim() || !draft.password) return setError("Lengkapi judul, label tombol, teks alternatif, alasan dan kata sandi.");
		if (!href) return setError(CODE_MESSAGES.INVALID_BANNER_LINK);
		if (!startsAt || !endsAt) return setError("Waktu mulai atau berakhir tidak valid.");
		if (startsAt >= endsAt) return setError(CODE_MESSAGES.BANNER_WINDOW_INVALID);
		setPending(true);
		setError(null);
		const content = {
			title,
			subtitle: draft.subtitle.trim() || null,
			action_label: action,
			href,
			image_sha256: draft.image.sha256,
			image_alt: alt,
			tint: draft.tint || null,
			starts_at: startsAt,
			ends_at: endsAt,
			active: draft.active,
			reason: draft.reason.trim(),
		};
		const result = banner
			? await withProof<AdminBanner>(draft.password, `/api/v1/admin/home-banners/${banner.id}/versions`, { ...content, expected_version: banner.version })
			: await withProof<AdminBanner>(draft.password, "/api/v1/admin/home-banners", content);
		setPending(false);
		if (!result.ok) return setError(result.text);
		onDone(result.data, !banner);
	}
	const preview = toCard({
		id: "preview",
		title: draft.title.trim() || "Judul banner",
		subtitle: draft.subtitle.trim() || null,
		action_label: draft.action_label.trim() || "Lihat pilihan",
		href: href ?? "/",
		tint: draft.tint || null,
		image: draft.image ? { ...draft.image, alt: draft.image_alt } : null,
	});
	return (
		<FormDialog
			title={banner ? `Ubah banner ${banner.title}` : "Tambah banner"}
			description="Gambar, teks dan tujuan kartu di beranda. Jadwal dibaca sebagai WIB; banner hanya tampil saat aktif dan dalam jadwal."
			pending={pending || uploading}
			error={error}
			submitLabel={banner ? "Simpan versi baru" : "Simpan banner"}
			onClose={onClose}
			onSubmit={() => void submit()}
			className="sm:max-w-4xl md:max-h-[92dvh] md:overflow-y-auto"
		>
			<div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,410px)]" data-testid="banner-form">
				<div className="flex min-w-0 flex-col gap-4">
					<FormField
						id={field("image")}
						label="Gambar (WebP)"
						hint={
							uploadError ? (
								<span role="alert" className="text-destructive">
									{uploadError}
								</span>
							) : draft.image ? (
								`${draft.image.width} × ${draft.image.height} px, tersimpan di media katalog.`
							) : (
								`Maks. 512 KB, sisi terpendek min. ${BANNER_IMAGE_MIN} px. Hindari teks harga, diskon atau klaim di gambar.`
							)
						}
					>
						<div className="flex items-center gap-2">
							<ImageUp aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
							<Input
								id={field("image")}
								type="file"
								accept="image/webp"
								data-testid="banner-image-input"
								aria-describedby={`${field("image")}-hint`}
								disabled={uploading || pending}
								onChange={(e) => void upload(e.target.files?.[0])}
							/>
						</div>
					</FormField>
					<FormField id={field("alt")} label="Teks alternatif gambar" hint="Apa yang terlihat di foto, untuk pembaca layar. Maks. 160 karakter.">
						<Input id={field("alt")} data-testid="banner-alt" maxLength={160} value={draft.image_alt} onChange={set("image_alt")} aria-describedby={`${field("alt")}-hint`} />
					</FormField>
					<FormField id={field("tint")} label="Latar foto potongan" hint="Untuk foto produk berlatar putih: foto ditaruh di tengah di atas warna ini. Tanpa latar, foto memenuhi kartu.">
						<select id={field("tint")} data-testid="banner-tint" className={nativeSelectClass} value={draft.tint} onChange={set("tint")} aria-describedby={`${field("tint")}-hint`}>
							<option value="">Tanpa latar (foto penuh)</option>
							{BANNER_TINTS.map((tint) => (
								<option key={tint} value={tint}>
									{TINT_LABEL[tint]}
								</option>
							))}
						</select>
					</FormField>
					<FormField id={field("title")} label="Judul" hint="Maks. 60 karakter.">
						<Input id={field("title")} data-testid="banner-title" maxLength={60} value={draft.title} onChange={set("title")} aria-describedby={`${field("title")}-hint`} />
					</FormField>
					<FormField id={field("subtitle")} label="Keterangan (opsional)" hint="Maks. 140 karakter. Tanpa janji hemat atau harga selain Rp99.000.">
						<Textarea id={field("subtitle")} data-testid="banner-subtitle" maxLength={140} rows={2} value={draft.subtitle} onChange={set("subtitle")} aria-describedby={`${field("subtitle")}-hint`} />
					</FormField>
					<div className="grid gap-4 sm:grid-cols-2">
						<FormField id={field("action")} label="Label tombol" hint="Maks. 24 karakter.">
							<Input id={field("action")} data-testid="banner-action" maxLength={24} value={draft.action_label} onChange={set("action_label")} aria-describedby={`${field("action")}-hint`} />
						</FormField>
						<FormField
							id={field("href")}
							label="Tujuan tautan"
							hint={href || !draft.href.trim() ? "Halaman toko: /promo, /kategori/<slug>, /cari?q=…, /produk/<slug>." : <span className="text-destructive">Bukan halaman toko yang diizinkan.</span>}
						>
							<Input
								id={field("href")}
								data-testid="banner-href"
								inputMode="url"
								autoCapitalize="none"
								spellCheck={false}
								value={draft.href}
								onChange={set("href")}
								aria-invalid={!href && !!draft.href.trim()}
								aria-describedby={`${field("href")}-hint`}
							/>
						</FormField>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<FormField id={field("starts")} label="Mulai tayang (WIB)" hint={startsAt ? wibDateTime(startsAt) : "Tanggal dan jam WIB."}>
							<Input id={field("starts")} data-testid="banner-starts" type="datetime-local" value={draft.starts} onChange={set("starts")} aria-describedby={`${field("starts")}-hint`} />
						</FormField>
						<FormField id={field("ends")} label="Berakhir (WIB)" hint={endsAt ? `${wibDateTime(endsAt)}, tidak tampil lagi sejak waktu ini.` : "Tanggal dan jam WIB."}>
							<Input id={field("ends")} data-testid="banner-ends" type="datetime-local" value={draft.ends} onChange={set("ends")} aria-describedby={`${field("ends")}-hint`} />
						</FormField>
					</div>
					<label className="flex min-h-11 items-center gap-2 text-sm font-medium" htmlFor={field("active")}>
						<input
							id={field("active")}
							type="checkbox"
							data-testid="banner-active"
							className="size-4 accent-primary"
							checked={draft.active}
							onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
						/>
						Aktif (tampil selama jadwal berjalan; hapus centang untuk menjeda)
					</label>
					<FormField id={field("reason")} label="Alasan perubahan" hint="Tercatat di riwayat banner.">
						<Input id={field("reason")} data-testid="banner-reason" maxLength={500} value={draft.reason} onChange={set("reason")} aria-describedby={`${field("reason")}-hint`} />
					</FormField>
					<FormField id={field("password")} label="Kata sandi Anda" hint="Konfirmasi ulang untuk setiap perubahan banner.">
						<Input
							id={field("password")}
							data-testid="banner-password"
							type="password"
							autoComplete="current-password"
							value={draft.password}
							onChange={set("password")}
							aria-describedby={`${field("password")}-hint`}
						/>
					</FormField>
				</div>
				<div className="flex min-w-0 flex-col gap-2 md:sticky md:top-0 md:self-start" data-testid="banner-preview">
					<p className="text-sm font-medium">Pratinjau kartu</p>
					<div inert className="home-main pt-0!">
						<div className="home-banners">
							<ul className="banner-row">
								<li className="banner">
									<BannerCard banner={preview} />
								</li>
							</ul>
						</div>
					</div>
				</div>
			</div>
		</FormDialog>
	);
}

function ProofFields({ ids, reason, password, setReason, setPassword }: { ids: string; reason: string; password: string; setReason: (v: string) => void; setPassword: (v: string) => void }) {
	return (
		<>
			<FormField id={`${ids}-reason`} label="Alasan" hint="Tercatat di riwayat banner.">
				<Input id={`${ids}-reason`} data-testid="banner-dialog-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={`${ids}-reason-hint`} />
			</FormField>
			<FormField id={`${ids}-password`} label="Kata sandi Anda">
				<Input id={`${ids}-password`} data-testid="banner-dialog-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
			</FormField>
		</>
	);
}

function RetireDialog({ banner, onClose, onDone }: { banner: AdminBanner; onClose: () => void; onDone: () => void }) {
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const ids = useId();
	async function submit() {
		if (!reason.trim() || !password) return setError("Isi alasan dan kata sandi.");
		setPending(true);
		setError(null);
		const result = await withProof(password, `/api/v1/admin/home-banners/${banner.id}/retirements`, { expected_version: banner.version, reason: reason.trim() });
		setPending(false);
		if (!result.ok) return setError(result.text);
		onDone();
	}
	return (
		<FormDialog
			title={`Arsipkan banner ${banner.title}?`}
			description="Banner langsung hilang dari beranda dan tidak dapat diaktifkan lagi. Riwayatnya tetap tersimpan. Bila tidak ada banner tersisa di daftar, beranda kembali menampilkan kartu bawaan."
			pending={pending}
			error={error}
			submitLabel="Arsipkan banner"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<ProofFields ids={ids} reason={reason} password={password} setReason={setReason} setPassword={setPassword} />
		</FormDialog>
	);
}

function OrderDialog({ banners, onClose, onDone }: { banners: AdminBanner[]; onClose: () => void; onDone: () => void }) {
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const ids = useId();
	async function submit() {
		if (!reason.trim() || !password) return setError("Isi alasan dan kata sandi.");
		setPending(true);
		setError(null);
		const result = await withProof(password, "/api/v1/admin/home-banners/order", {
			banners: banners.map((b) => ({ id: b.id, expected_version: b.version })),
			reason: reason.trim(),
		});
		setPending(false);
		if (!result.ok) return setError(result.text);
		onDone();
	}
	return (
		<FormDialog
			title="Simpan urutan banner"
			description={`Urutan baru: ${banners.map((b, i) => `${i + 1}. ${b.title}`).join(", ")}.`}
			pending={pending}
			error={error}
			submitLabel="Simpan urutan"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<ProofFields ids={ids} reason={reason} password={password} setReason={setReason} setPassword={setPassword} />
		</FormDialog>
	);
}

function HistoryDialog({ banner, onClose }: { banner: AdminBanner; onClose: () => void }) {
	const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; rows: AdminBanner[] }>({ kind: "loading" });
	useEffect(() => {
		const controller = new AbortController();
		void getJson<{ data: AdminBanner[] }>(`/api/v1/admin/home-banners/${banner.id}/versions?limit=50`, controller.signal).then((result) => {
			if (!controller.signal.aborted) setState(result.ok ? { kind: "ready", rows: result.data.data } : { kind: "error", message: failureText(result.failure) });
		});
		return () => controller.abort();
	}, [banner.id]);
	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="md:max-h-[85dvh] md:overflow-y-auto" data-testid="banner-history">
				<DialogHeader>
					<DialogTitle>Riwayat {banner.title}</DialogTitle>
					<DialogDescription>Setiap versi tersimpan permanen, terbaru di atas.</DialogDescription>
				</DialogHeader>
				{state.kind === "loading" && <LoadingState label="Memuat riwayat…" lines={2} />}
				{state.kind === "error" && <ErrorState message={state.message} />}
				{state.kind === "ready" && (
					<ol className="flex flex-col divide-y rounded-md border pb-0 max-md:mb-4">
						{state.rows.map((v) => (
							<li key={v.version_id} className="flex flex-col gap-1 p-3 text-sm" data-testid={`banner-version-${v.version}`}>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<span className="font-medium">Versi {v.version}</span>
									<StatusBadge tone={v.retired ? "closed" : v.active ? "open" : "closed"}>{v.retired ? "Diarsipkan" : v.active ? "Aktif" : "Dijeda"}</StatusBadge>
								</div>
								<p className="text-xs text-muted-foreground tabular-nums">
									{wibDateTime(v.recorded_at)}
									{v.recorded_by_name ? ` · ${v.recorded_by_name}` : ""} · urutan {v.position + 1}
								</p>
								<p>{v.reason}</p>
								<p className="text-xs text-muted-foreground">
									{v.title} · {v.href} · {schedule(v)}
								</p>
							</li>
						))}
					</ol>
				)}
			</DialogContent>
		</Dialog>
	);
}
