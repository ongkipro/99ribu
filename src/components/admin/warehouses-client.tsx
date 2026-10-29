"use client";

import { ChevronRight, CircleCheck, Pencil } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { failureText, getJson } from "./admin-errors";
import { DataTable } from "./data-table";
import { formatWib } from "./format";
import { FormDialog, FormField } from "./form";
import { send, useOperationKey } from "./ops-api";
import { AdminPage, DetailSection, PageHeader } from "./page-blocks";
import { ErrorState, LoadingState } from "./states";
import { StatusBadge, type StatusTone } from "./status";
import { useKeysetList } from "./use-keyset-list";
import { adminPath } from "@/modules/access/admin-paths";

// S134 / spec 17 B11: warehouses the caller may see (owner: all active; others: their memberships), and one warehouse
// with its pickup profile (private personal data; owner/ecommerce_admin) and its shipping calendar (owner only).
// The warehouse APIs enforce the same scope and roles; the page only decides what to ask for. Calendar writes stay on
// Pengiriman Manual: the calendar validator still accepts TEST-ONLY calendars only (DEC-018 Q2), so this screen is a view.

type Warehouse = { id: string; admin_no: number; name: string; city: string; timezone: string; active: boolean };

export function WarehousesClient({ all }: { all: boolean }) {
	const list = useKeysetList<Warehouse>("/api/v1/admin/warehouses?limit=50", (row) => row.id);
	return (
		<AdminPage testId="warehouses-page">
			<PageHeader
				title="Gudang"
				description={
					all
						? "Semua gudang aktif. Buka satu gudang untuk profil penjemputan dan kalender pengiriman."
						: "Gudang yang ditugaskan kepada Anda. Gudang lain tidak terlihat di sini."
				}
			/>
			<DataTable
				testId="warehouses"
				caption="Daftar gudang"
				rows={list.rows}
				rowKey={(row) => row.id}
				rowTestId={(row) => `warehouse-row-${row.name}`}
				status={list.status}
				loadingLabel="Memuat gudang…"
				empty={
					all
						? "Belum ada gudang aktif. Gudang muncul di sini setelah ditambahkan lewat impor katalog."
						: "Belum ada gudang yang ditugaskan kepada Anda. Minta Super Admin menambahkannya di Staf & Peran."
				}
				emptyTestId="warehouses-empty"
				stack
				paging={{ ...list.paging, testId: "warehouses-more", summary: `${list.rows.length} gudang dimuat` }}
				columns={[
					{
						id: "name",
						header: "Gudang",
						stack: "title",
						cellClassName: "whitespace-normal",
						cell: (row) => (
							<Link href={adminPath("warehouse", row.admin_no)} className="font-medium text-primary underline-offset-4 hover:underline">
								{row.name}
							</Link>
						),
					},
					{ id: "city", header: "Kota", stack: "meta", cell: (row) => row.city },
					{ id: "tz", header: "Zona waktu", hideBelow: "5xl", cell: (row) => row.timezone },
					{
						id: "actions",
						header: <span className="sr-only">Tindakan</span>,
						className: "text-right",
						cell: (row) => (
							<Button asChild variant="outline" size="sm">
								<Link href={adminPath("warehouse", row.admin_no)}>
									Buka<span className="sr-only"> {row.name}</span>
									<ChevronRight aria-hidden="true" data-icon="inline-end" />
								</Link>
							</Button>
						),
					},
				]}
			/>
		</AdminPage>
	);
}

export function WarehouseDetailClient({ warehouseId, profileAccess, owner }: { warehouseId: string; profileAccess: boolean; owner: boolean }) {
	const [state, setState] = useState<{ kind: "loading" } | { kind: "missing" } | { kind: "error"; text: string } | { kind: "ready"; warehouse: Warehouse }>({ kind: "loading" });
	const load = useCallback(async () => {
		setState({ kind: "loading" });
		const result = await getJson<Warehouse>(`/api/v1/admin/warehouses/${warehouseId}`);
		setState(
			result.ok
				? { kind: "ready", warehouse: result.data }
				: result.failure.status === 404 || result.failure.status === 400
					? { kind: "missing" }
					: { kind: "error", text: failureText(result.failure) },
		);
	}, [warehouseId]);
	useEffect(() => {
		void load();
	}, [load]);
	const back = { href: "/admin/warehouses", label: "Gudang" };
	if (state.kind === "loading")
		return (
			<AdminPage>
				<PageHeader title="Gudang" back={back} />
				<LoadingState label="Memuat gudang…" lines={3} className="h-28 w-full rounded-lg" />
			</AdminPage>
		);
	if (state.kind === "missing")
		return (
			<AdminPage testId="warehouse-missing">
				<PageHeader title="Gudang tidak ditemukan" back={back} />
				<p className="text-sm">Gudang ini tidak ada, sudah nonaktif, atau di luar gudang yang ditugaskan kepada Anda. Kembali ke daftar Gudang untuk memilih gudang lain.</p>
			</AdminPage>
		);
	if (state.kind === "error")
		return (
			<AdminPage>
				<PageHeader title="Gudang" back={back} />
				<ErrorState message={state.text} onRetry={() => void load()} />
			</AdminPage>
		);
	const { warehouse } = state;
	return (
		<AdminPage testId="warehouse-page">
			<PageHeader title={warehouse.name} titleTestId="warehouse-title" back={back} description={`${warehouse.city} · zona waktu ${warehouse.timezone}`} />
			<DetailSection id="warehouse-links" title="Stok dan transfer" description="Stok per gudang dicatat dan dilihat di halaman Stok Gudang.">
				<div className="flex flex-wrap gap-2 max-md:*:flex-1">
					<Button asChild variant="outline">
						<Link href="/admin/inventory">Stok Gudang</Link>
					</Button>
					<Button asChild variant="outline">
						<Link href="/admin/inventory/transfers">Transfer Stok</Link>
					</Button>
				</div>
			</DetailSection>
			{profileAccess ? (
				<PickupProfile warehouse={warehouse} />
			) : (
				<DetailSection id="pickup-heading" title="Profil penjemputan" testId="pickup-restricted">
					<p className="text-sm text-muted-foreground">Alamat dan kontak PIC penjemputan adalah data pribadi. Hanya Super Admin dan Admin E-Commerce yang melihatnya.</p>
				</DetailSection>
			)}
			{owner ? (
				<CalendarView warehouse={warehouse} />
			) : (
				<DetailSection id="calendar-heading" title="Kalender pengiriman" testId="calendar-restricted">
					<p className="text-sm text-muted-foreground">Kalender hari kerja dan batas jam hanya terlihat dan diatur oleh Super Admin.</p>
				</DetailSection>
			)}
		</AdminPage>
	);
}

// ---- Pickup profile --------------------------------------------------------------------------------------------

type Profile = {
	warehouse_id: string;
	warehouse_name: string;
	version: number;
	readiness: "complete" | "incomplete";
	mode: "mengantar_api" | "manual_dashboard";
	street_address: string | null;
	pic_name: string | null;
	pic_phone: string | null;
	pinpoint: { latitude: number; longitude: number } | null;
	updated_at: string | null;
};
const PROFILE_MESSAGES: Record<string, string> = {
	INVALID_STREET_ADDRESS: "Alamat jalan minimal 10 karakter.",
	INVALID_PIC_NAME: "Nama PIC minimal 2 karakter.",
	INVALID_PIC_PHONE: "Telepon PIC harus nomor Indonesia, misalnya 081234567890.",
	INVALID_PINPOINT: "Titik koordinat di luar wilayah Indonesia.",
	VERSION_CONFLICT: "Profil sudah diubah orang lain. Data dimuat ulang; tutup dialog, periksa, lalu ubah lagi.",
};
const localPhone = (phone: string | null) => (phone ? `0${phone.slice(2)}` : "");

function PickupProfile({ warehouse }: { warehouse: Warehouse }) {
	const [profile, setProfile] = useState<Profile | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [dialog, setDialog] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	const load = useCallback(async () => {
		setFailure(null);
		const result = await getJson<Profile>(`/api/v1/admin/warehouses/${warehouse.id}/pickup-profile`);
		if (result.ok) setProfile(result.data);
		else setFailure(failureText(result.failure));
	}, [warehouse.id]);
	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);
	return (
		<DetailSection
			id="pickup-heading"
			title="Profil penjemputan"
			description="Data pribadi (alamat jalan, nama dan telepon PIC) untuk pemesanan otomatis Mengantar di masa depan. Selama integrasi otomatis belum aktif, gudang tetap mode manual."
			testId="pickup-profile"
		>
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="border-success/30 bg-success-surface outline-none" data-testid="pickup-notice">
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			{failure ? (
				<ErrorState message={failure} onRetry={() => void load()} />
			) : !profile ? (
				<Skeleton className="h-24 w-full" />
			) : (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<StatusBadge tone={profile.readiness === "complete" ? "success" : "problem"} data-status={profile.readiness}>
							{profile.readiness === "complete" ? "Lengkap" : "Belum lengkap"}
						</StatusBadge>
						<StatusBadge tone="neutral">{profile.mode === "mengantar_api" ? "Mode otomatis" : "Mode manual"}</StatusBadge>
						<span className="text-xs text-muted-foreground">
							Versi {profile.version}
							{profile.updated_at ? ` · ${formatWib(profile.updated_at)}` : ""}
						</span>
					</div>
					<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm" data-testid="pickup-values">
						<dt className="text-muted-foreground">Alamat jalan</dt>
						<dd className="break-words">{profile.street_address ?? "Belum diisi"}</dd>
						<dt className="text-muted-foreground">Nama PIC</dt>
						<dd>{profile.pic_name ?? "Belum diisi"}</dd>
						<dt className="text-muted-foreground">Telepon PIC</dt>
						<dd className="tabular-nums">{localPhone(profile.pic_phone) || "Belum diisi"}</dd>
						<dt className="text-muted-foreground">Koordinat</dt>
						<dd className="tabular-nums">{profile.pinpoint ? `${profile.pinpoint.latitude}, ${profile.pinpoint.longitude}` : "Belum diisi"}</dd>
					</dl>
					<Button type="button" variant="outline" className="self-start max-md:self-stretch" data-testid="pickup-edit" onClick={() => setDialog(true)}>
						<Pencil aria-hidden="true" />
						Revisi profil
					</Button>
				</>
			)}
			{dialog && profile && (
				<ProfileDialog
					profile={profile}
					onClose={() => setDialog(false)}
					onStale={() => void load()}
					onDone={(saved) => {
						setDialog(false);
						setProfile(saved);
						setNotice(`Profil penjemputan versi ${saved.version} tersimpan (${saved.readiness === "complete" ? "lengkap" : "belum lengkap"}).`);
					}}
				/>
			)}
		</DetailSection>
	);
}

function ProfileDialog({ profile, onClose, onStale, onDone }: { profile: Profile; onClose: () => void; onStale: () => void; onDone: (saved: Profile) => void }) {
	const id = useId();
	const key = useOperationKey();
	// Frozen on mount so a VERSION_CONFLICT reload behind the dialog cannot overwrite concurrent edits on resubmit.
	const [capturedVersion] = useState(profile.version);
	const [form, setForm] = useState({
		street: profile.street_address ?? "",
		pic: profile.pic_name ?? "",
		phone: localPhone(profile.pic_phone),
		lat: profile.pinpoint ? String(profile.pinpoint.latitude) : "",
		lng: profile.pinpoint ? String(profile.pinpoint.longitude) : "",
		reason: "",
	});
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const set = (field: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [field]: value }));
	const dirty =
		form.street !== (profile.street_address ?? "") ||
		form.pic !== (profile.pic_name ?? "") ||
		form.phone !== localPhone(profile.pic_phone) ||
		form.lat !== (profile.pinpoint ? String(profile.pinpoint.latitude) : "") ||
		form.lng !== (profile.pinpoint ? String(profile.pinpoint.longitude) : "") ||
		form.reason.trim() !== "";
	async function submit() {
		if (!form.reason.trim()) return setError("Alasan perubahan wajib diisi.");
		if ((form.lat.trim() === "") !== (form.lng.trim() === "")) return setError("Isi lintang dan bujur sekaligus, atau kosongkan keduanya.");
		const pinpoint = form.lat.trim() ? { latitude: Number(form.lat), longitude: Number(form.lng) } : null;
		if (pinpoint && !(Number.isFinite(pinpoint.latitude) && Number.isFinite(pinpoint.longitude))) return setError("Koordinat harus berupa angka desimal.");
		setPending(true);
		setError(null);
		const result = await send<Profile>(
			"POST",
			`/api/v1/admin/warehouses/${profile.warehouse_id}/pickup-profile`,
			{
				expected_version: capturedVersion,
				street_address: form.street.trim() || null,
				pic_name: form.pic.trim() || null,
				pic_phone: form.phone.trim() || null,
				pinpoint,
				reason: form.reason.trim(),
			},
			key,
		);
		setPending(false);
		if (!result.ok) {
			if (result.code === "VERSION_CONFLICT") onStale();
			return setError(result.code && PROFILE_MESSAGES[result.code] ? `${PROFILE_MESSAGES[result.code]} (kode: ${result.code})` : result.text);
		}
		onDone(result.data);
	}
	return (
		<FormDialog
			title={`Revisi profil penjemputan ${profile.warehouse_name}`}
			description={`Menambah versi ${profile.version + 1}. Kosongkan kolom yang belum ada; profil lengkap bila alamat, nama dan telepon PIC terisi.`}
			pending={pending}
			error={error}
			submitLabel="Simpan profil"
			dirty={dirty}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id={`${id}-street`} label="Alamat jalan penjemputan">
				<Textarea id={`${id}-street`} data-testid="pickup-street" rows={3} maxLength={300} autoComplete="off" value={form.street} onChange={(event) => set("street")(event.target.value)} />
			</FormField>
			<FormField id={`${id}-pic`} label="Nama PIC">
				<Input id={`${id}-pic`} data-testid="pickup-pic" maxLength={120} autoComplete="off" value={form.pic} onChange={(event) => set("pic")(event.target.value)} />
			</FormField>
			<FormField id={`${id}-phone`} label="Telepon PIC">
				<Input id={`${id}-phone`} data-testid="pickup-phone" type="tel" inputMode="tel" maxLength={24} autoComplete="off" value={form.phone} onChange={(event) => set("phone")(event.target.value)} />
			</FormField>
			<div className="grid gap-4 sm:grid-cols-2">
				<FormField id={`${id}-lat`} label="Lintang (opsional)">
					<Input id={`${id}-lat`} inputMode="decimal" autoComplete="off" value={form.lat} onChange={(event) => set("lat")(event.target.value)} />
				</FormField>
				<FormField id={`${id}-lng`} label="Bujur (opsional)">
					<Input id={`${id}-lng`} inputMode="decimal" autoComplete="off" value={form.lng} onChange={(event) => set("lng")(event.target.value)} />
				</FormField>
			</div>
			<FormField id={`${id}-reason`} label="Alasan perubahan (wajib)">
				<Input id={`${id}-reason`} data-testid="pickup-reason" maxLength={200} autoComplete="off" value={form.reason} onChange={(event) => set("reason")(event.target.value)} />
			</FormField>
		</FormDialog>
	);
}

// ---- Calendar view (owner) -------------------------------------------------------------------------------------

type CalendarValues = { timezone: string; year: number; working_weekdays: number[]; cutoff_local: string; closed_dates: string[]; source: string; approval: string };
type CalendarVersion = { id: string; version: number; effective_at: string; values: CalendarValues; reason: string; created_at: string };
type CalendarHistory = { data: CalendarVersion[]; latest_version: number; current: CalendarVersion | null };
const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const CALENDAR_STATE: Record<"current" | "outdated" | "missing", [string, StatusTone]> = {
	current: ["Berlaku", "success"],
	outdated: ["Tahun lama", "problem"],
	missing: ["Belum diatur", "danger"],
};
// Holiday keys are local calendar dates (YYYY-MM-DD); read in UTC so the day never shifts.
const holidayFormat = new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const holiday = (date: string) => {
	const [y, m, d] = date.split("-").map(Number);
	return y && m && d ? holidayFormat.format(new Date(Date.UTC(y, m - 1, d))) : date;
};

function CalendarView({ warehouse }: { warehouse: Warehouse }) {
	const [history, setHistory] = useState<CalendarHistory | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const load = useCallback(async () => {
		setFailure(null);
		const result = await getJson<CalendarHistory>(`/api/v1/admin/policy-versions?kind=warehouse_calendar&warehouse_id=${warehouse.id}&limit=5`);
		if (result.ok) setHistory(result.data);
		else setFailure(failureText(result.failure));
	}, [warehouse.id]);
	useEffect(() => {
		void load();
	}, [load]);
	const year = Number(new Intl.DateTimeFormat("en-US", { timeZone: warehouse.timezone, year: "numeric" }).format(new Date()));
	const current = history?.current ?? null;
	const state = !current ? "missing" : current.values.year === year ? "current" : "outdated";
	const [label, tone] = CALENDAR_STATE[state];
	return (
		<DetailSection
			id="calendar-heading"
			title="Kalender pengiriman"
			description="Hari kerja dan batas jam yang menghitung tenggat resi gudang ini. Hanya Super Admin yang menyetujui dan menulis kalender."
			testId="warehouse-calendar"
		>
			{failure ? (
				<ErrorState message={failure} onRetry={() => void load()} />
			) : !history ? (
				<Skeleton className="h-24 w-full" />
			) : (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<StatusBadge tone={tone} data-status={state}>
							{state === "current" ? `${label} ${year}` : label}
						</StatusBadge>
						{current && <span className="text-xs text-muted-foreground">Versi {current.version} · berlaku {formatWib(current.effective_at)}</span>}
					</div>
					{current ? (
						<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm" data-testid="calendar-values">
							<dt className="text-muted-foreground">Tahun kalender</dt>
							<dd className="tabular-nums">{current.values.year}</dd>
							<dt className="text-muted-foreground">Hari kerja</dt>
							<dd>{current.values.working_weekdays.map((day) => DAYS[day]).join(", ")}</dd>
							<dt className="text-muted-foreground">Batas jam harian</dt>
							<dd className="tabular-nums">{current.values.cutoff_local}</dd>
							<dt className="text-muted-foreground">Hari libur</dt>
							<dd className="break-words tabular-nums">{current.values.closed_dates.length ? current.values.closed_dates.map(holiday).join(", ") : "Tidak ada"}</dd>
						</dl>
					) : (
						<p className="text-sm">Gudang ini belum punya kalender. Tenggat resi pesanan dari gudang ini belum bisa dihitung.</p>
					)}
					{history.data.length > 1 && (
						<details className="text-sm">
							<summary className="min-h-9 cursor-pointer text-muted-foreground pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center">Riwayat versi ({history.latest_version})</summary>
							<ol className="mt-2 flex flex-col divide-y" aria-label="Riwayat kalender" data-testid="warehouse-calendar-history">
								{history.data.map((version) => (
									<li key={version.id} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
										<span className="font-medium">
											Versi {version.version} · tahun {version.values.year}
										</span>
										<span className="text-xs text-muted-foreground">
											Berlaku {formatWib(version.effective_at)} · {version.values.working_weekdays.length} hari kerja, batas {version.values.cutoff_local}
										</span>
										<span className="text-xs break-words">{version.reason}</span>
									</li>
								))}
							</ol>
						</details>
					)}
					<p className="text-xs text-muted-foreground">
						Kalender masih berstatus TEST-ONLY sampai kalender produksi disetujui. Ubah atau terapkan kalender default di{" "}
						<Link href="/admin/fulfillment" className="text-primary underline-offset-4 hover:underline">
							Pengiriman Manual
						</Link>
						.
					</p>
				</>
			)}
		</DetailSection>
	);
}
