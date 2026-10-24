"use client";

import { CircleCheck, FlaskConical } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { describeFailure, failureText, getJson, readFailure } from "./admin-errors";
import { formatWib } from "./format";
import { FormDialog, FormField, nativeSelectClass } from "./form";
import { Disclosure } from "./page-blocks";
import { ErrorState, LoadingState } from "./states";
import { StatusBadge, type StatusTone } from "./status";

// S101: owner-only warehouse calendars (policy kind `warehouse_calendar`) next to the pickup
// profiles. Packing/resi deadlines compute only for a warehouse with a current-year calendar.
// The validator accepts TEST-ONLY calendars only (owner question Q2, spec 17), so this panel is
// labelled as local testing and always sends source TEST-ONLY / approval test_only.

type Values = { timezone: string; year: number; working_weekdays: number[]; cutoff_local: string; closed_dates: string[] };
type Coverage = {
	warehouse_id: string;
	warehouse_name: string;
	city: string;
	timezone: string;
	local_year: number;
	live_products: number;
	origin: boolean;
	state: "current" | "outdated" | "missing";
	scheduled: boolean;
	latest_version: number;
	current: { version_id: string; version: number; effective_at: string; values: Values } | null;
};
type Version = { id: string; version: number; effective_at: string; values: Values; reason: string; created_at: string };

const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const DEFAULT = { working_weekdays: [1, 2, 3, 4, 5, 6], cutoff_local: "15:00", closed_dates: [] as string[] };
const STATE: Record<Coverage["state"], [string, StatusTone]> = {
	current: ["Berlaku", "success"],
	outdated: ["Tahun lama", "problem"],
	missing: ["Belum diatur", "danger"],
};
const MESSAGES: Record<string, string> = {
	SCHEDULE_CONFLICT: "Sudah ada versi terjadwal yang mulai lebih lambat; versi baru tidak boleh mendahuluinya.",
	CALENDAR_ALREADY_CURRENT: "Salah satu gudang sudah punya kalender tahun ini. Muat ulang daftar.",
	INVALID_WAREHOUSE_SCOPE: "Gudang tidak aktif atau tidak punya produk aktif.",
	RETROACTIVE_POLICY_FORBIDDEN: "Waktu berlaku tidak boleh di masa lalu.",
	REAUTHENTICATION_REQUIRED: "Konfirmasi kata sandi gagal atau kedaluwarsa.",
	FRESH_MFA_REQUIRED: "Verifikasi dua langkah harus diulang: keluar, masuk lagi dengan kode autentikator, lalu coba lagi.",
	RATE_LIMITED: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
	INVALID_INPUT: "Isian kalender belum valid. Tanggal libur harus berformat TTTT-BB-HH di tahun kalender.",
};
const text = (status: number, code: string | null) =>
	code && MESSAGES[code] ? `${MESSAGES[code]} (kode: ${code})` : failureText(describeFailure(status, code));

async function post<T>(url: string, body: unknown, key = crypto.randomUUID()) {
	try {
		const res = await fetch(url, {
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json", "idempotency-key": key },
			body: JSON.stringify(body),
		});
		if (res.ok) return { ok: true as const, data: (await res.json()) as T };
		const failure = await readFailure(res);
		return { ok: false as const, text: text(res.status, failure.code), retryable: res.status >= 500 };
	} catch {
		return { ok: false as const, text: text(0, null), retryable: true };
	}
}
const proof = (password: string, action: string, subject: string) =>
	post<{ proof: string }>("/api/v1/me/reauthentication-proofs", { password, action, subject_id: subject });

const schedule = (v: Pick<Values, "working_weekdays" | "cutoff_local" | "closed_dates">) =>
	`${v.working_weekdays.map((d) => DAYS[d]).join(", ")} · batas ${v.cutoff_local}${v.closed_dates.length ? ` · ${v.closed_dates.length} hari libur` : ""}`;

/** UTC instant of local midnight on 1 January of `year` in `timeZone`. */
function newYearInstant(year: number, timeZone: string) {
	const guess = Date.UTC(year, 0, 1);
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
			.formatToParts(new Date(guess))
			.map((p) => [p.type, p.value]),
	);
	const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
	return new Date(guess - (local - guess)).toISOString();
}

/** Shared editable fields: working days, cutoff and closed dates (one per line). */
type Draft = { days: number[]; cutoff: string; closed: string };
const draftOf = (v: Pick<Values, "working_weekdays" | "cutoff_local" | "closed_dates">): Draft => ({
	days: v.working_weekdays,
	cutoff: v.cutoff_local,
	closed: v.closed_dates.join("\n"),
});
function parseDraft(draft: Draft) {
	const closed = [...new Set(draft.closed.split(/[\s,]+/).filter(Boolean))].sort();
	if (!draft.days.length) return { error: "Pilih minimal satu hari kerja." };
	if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.cutoff)) return { error: "Batas jam harus JJ:MM." };
	if (closed.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) return { error: "Tanggal libur harus berformat TTTT-BB-HH." };
	return { values: { working_weekdays: [...draft.days].sort(), cutoff_local: draft.cutoff, closed_dates: closed } };
}
function DraftFields({ id, draft, onChange }: { id: string; draft: Draft; onChange: (draft: Draft) => void }) {
	return (
		<>
			<fieldset className="flex flex-col gap-1.5">
				<legend className="mb-1 text-sm font-medium">Hari kerja gudang</legend>
				<div className="flex flex-wrap gap-2">
					{DAYS.map((label, day) => (
						<label key={label} className="flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm pointer-coarse:min-h-11">
							<input
								type="checkbox"
								className="size-4 accent-primary"
								checked={draft.days.includes(day)}
								onChange={(e) => onChange({ ...draft, days: e.target.checked ? [...draft.days, day] : draft.days.filter((d) => d !== day) })}
							/>
							{label}
						</label>
					))}
				</div>
			</fieldset>
			<FormField id={`${id}-cutoff`} label="Batas jam proses harian" hint="Pesanan setelah jam ini dihitung hari kerja berikutnya.">
				<Input id={`${id}-cutoff`} type="time" aria-describedby={`${id}-cutoff-hint`} value={draft.cutoff} onChange={(e) => onChange({ ...draft, cutoff: e.target.value })} />
			</FormField>
			<FormField id={`${id}-closed`} label="Hari libur (opsional)" hint="Satu tanggal per baris, format TTTT-BB-HH, di tahun kalender.">
				<Textarea id={`${id}-closed`} aria-describedby={`${id}-closed-hint`} rows={3} value={draft.closed} onChange={(e) => onChange({ ...draft, closed: e.target.value })} />
			</FormField>
		</>
	);
}

export function WarehouseCalendarPanel() {
	const [rows, setRows] = useState<Coverage[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState("");
	const [dialog, setDialog] = useState<"bulk" | "edit" | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	const load = useCallback(async () => {
		setError(null);
		const result = await getJson<{ data: Coverage[] }>("/api/v1/admin/warehouse-calendars");
		if (result.ok) setRows(result.data.data);
		else setError(failureText(result.failure));
	}, []);
	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);
	const origins = rows?.filter((r) => r.origin) ?? [];
	const missing = origins.filter((r) => r.state !== "current" && !r.scheduled);
	const chosen = rows?.find((r) => r.warehouse_id === selected) ?? null;
	const done = (message: string) => {
		setDialog(null);
		setNotice(message);
		void load();
	};
	return (
		<Disclosure
			id="calendar-heading"
			title="Kalender gudang"
			description="Hari kerja dan batas jam yang menghitung tenggat resi setiap gudang."
			testId="warehouse-calendars"
		>
			<p className="flex items-start gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground" data-testid="calendar-test-only">
				<FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
				Uji lokal: kalender tersimpan sebagai TEST-ONLY. Kalender produksi menunggu keputusan siapa yang menyetujuinya.
			</p>
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="outline-none" data-testid="calendar-notice">
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			{error ? (
				<ErrorState message={error} onRetry={() => void load()} />
			) : !rows ? (
				<LoadingState label="Memuat kalender gudang…" lines={2} />
			) : (
				<>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="text-sm" data-testid="calendar-summary">
							{missing.length
								? `${missing.length} dari ${origins.length} gudang asal produk aktif belum punya kalender tahun ini; tenggat resinya tidak bisa dihitung.`
								: `Semua ${origins.length} gudang asal produk aktif punya kalender tahun ini.`}
						</p>
						{missing.length > 0 && (
							<Button data-testid="calendar-bulk-open" className="max-md:w-full" onClick={() => setDialog("bulk")}>
								Terapkan kalender default ({missing.length})
							</Button>
						)}
					</div>
					<ul className="flex flex-col divide-y rounded-md border" data-testid="calendar-list">
						{origins.map((row) => {
							const [label, tone] = STATE[row.state];
							return (
								<li key={row.warehouse_id} className="flex flex-col gap-1 p-3" data-testid="calendar-row">
									<div className="flex items-start justify-between gap-3">
										<span className="font-medium">
											{row.warehouse_name}
											<span className="block text-xs font-normal text-muted-foreground">
												{row.city} · {row.live_products} produk aktif
											</span>
										</span>
										<StatusBadge tone={tone} data-status={row.state}>
											{row.state === "current" ? `${label} ${row.local_year}` : label}
										</StatusBadge>
									</div>
									<p className="text-xs text-muted-foreground">
										{row.current ? `${row.current.values.year}: ${schedule(row.current.values)}` : "Tenggat resi belum bisa dihitung."}
										{row.scheduled ? " · ada versi terjadwal" : ""}
									</p>
								</li>
							);
						})}
					</ul>
					<div className="flex max-w-sm flex-col gap-1.5">
						<label htmlFor="calendar-warehouse" className="text-sm font-medium">
							Atur kalender satu gudang
						</label>
						<div className="flex gap-2">
							<select id="calendar-warehouse" className={`${nativeSelectClass} min-w-0 flex-1`} value={selected} onChange={(e) => setSelected(e.target.value)}>
								<option value="">Pilih gudang</option>
								{rows.map((r) => (
									<option key={r.warehouse_id} value={r.warehouse_id}>
										{r.warehouse_name}
										{r.origin ? "" : " (tanpa produk aktif)"}
									</option>
								))}
							</select>
							<Button variant="outline" disabled={!chosen} data-testid="calendar-edit-open" onClick={() => setDialog("edit")}>
								Atur
							</Button>
						</div>
					</div>
					{chosen && <History warehouseId={chosen.warehouse_id} key={`${chosen.warehouse_id}:${chosen.latest_version}`} />}
				</>
			)}
			{dialog === "bulk" && <BulkDialog warehouses={missing} onClose={() => setDialog(null)} onDone={done} />}
			{dialog === "edit" && chosen && <EditDialog warehouse={chosen} onClose={() => setDialog(null)} onDone={done} />}
		</Disclosure>
	);
}

function History({ warehouseId }: { warehouseId: string }) {
	const [versions, setVersions] = useState<Version[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		void getJson<{ data: Version[] }>(`/api/v1/admin/policy-versions?kind=warehouse_calendar&warehouse_id=${warehouseId}&limit=5`).then((r) =>
			r.ok ? setVersions(r.data.data) : setError(failureText(r.failure)),
		);
	}, [warehouseId]);
	if (error) return <p className="text-sm text-destructive">{error}</p>;
	if (!versions) return <LoadingState label="Memuat riwayat kalender…" lines={1} />;
	if (!versions.length) return <p className="text-sm text-muted-foreground">Gudang ini belum punya versi kalender.</p>;
	return (
		<ol className="flex flex-col gap-2" aria-label="Riwayat kalender" data-testid="calendar-history">
			{versions.map((v) => (
				<li key={v.id} className="border-l-2 pl-3 text-sm">
					<span className="font-medium">
						Versi {v.version} · tahun {v.values.year}
					</span>
					<span className="block text-xs text-muted-foreground">
						Berlaku {formatWib(v.effective_at)} · {schedule(v.values)}
					</span>
					<span className="block text-xs break-words">{v.reason}</span>
				</li>
			))}
		</ol>
	);
}

function BulkDialog({ warehouses, onClose, onDone }: { warehouses: Coverage[]; onClose: () => void; onDone: (m: string) => void }) {
	const [draft, setDraft] = useState<Draft>(draftOf(DEFAULT));
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const key = useRef(crypto.randomUUID());
	async function submit() {
		const parsed = parseDraft(draft);
		if (parsed.error) return setError(parsed.error);
		if (!reason.trim() || !password) return setError("Isi alasan dan kata sandi.");
		setPending(true);
		setError(null);
		const issued = await proof(password, "warehouse_calendar.default_apply", "origin-warehouses");
		if (!issued.ok) {
			setPending(false);
			return setError(issued.text);
		}
		const result = await post<{ applied: unknown[] }>(
			"/api/v1/admin/warehouse-calendars/default-applications",
			{ warehouse_ids: warehouses.map((w) => w.warehouse_id), values: parsed.values, reason: reason.trim(), reauthentication_proof: issued.data.proof },
			key.current,
		);
		setPending(false);
		if (!result.ok) {
			if (!result.retryable) key.current = crypto.randomUUID();
			return setError(result.text);
		}
		onDone(`Kalender default diterapkan ke ${result.data.applied.length} gudang. Setiap versi tercatat di log audit.`);
	}
	return (
		<FormDialog
			title={`Terapkan kalender default ke ${warehouses.length} gudang`}
			description="Setiap gudang di bawah mendapat satu versi kalender baru untuk tahun berjalan, berlaku sekarang. Gudang yang sudah punya kalender tidak diubah."
			pending={pending}
			pendingLabel="Menerapkan…"
			error={error}
			submitLabel="Terapkan"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<ul className="max-h-32 overflow-y-auto rounded-md border px-3 py-2 text-sm" data-testid="calendar-bulk-list">
				{warehouses.map((w) => (
					<li key={w.warehouse_id}>
						{w.warehouse_name} <span className="text-muted-foreground">· {w.city}</span>
					</li>
				))}
			</ul>
			<DraftFields id="calendar-bulk" draft={draft} onChange={setDraft} />
			<FormField id="calendar-bulk-reason" label="Alasan (wajib)">
				<Input id="calendar-bulk-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
			</FormField>
			<FormField id="calendar-bulk-password" label="Konfirmasi kata sandi">
				<Input id="calendar-bulk-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}

function EditDialog({ warehouse, onClose, onDone }: { warehouse: Coverage; onClose: () => void; onDone: (m: string) => void }) {
	const [draft, setDraft] = useState<Draft>(draftOf(warehouse.current?.values ?? DEFAULT));
	const [when, setWhen] = useState<"now" | "next">("now");
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const key = useRef(crypto.randomUUID());
	const year = when === "now" ? warehouse.local_year : warehouse.local_year + 1;
	async function submit() {
		const parsed = parseDraft(draft);
		if (parsed.error) return setError(parsed.error);
		if (!reason.trim() || !password) return setError("Isi alasan dan kata sandi.");
		setPending(true);
		setError(null);
		const issued = await proof(password, "warehouse_calendar.version", warehouse.warehouse_id);
		if (!issued.ok) {
			setPending(false);
			return setError(issued.text);
		}
		const result = await post<{ version: number }>(
			"/api/v1/admin/policy-versions",
			{
				kind: "warehouse_calendar",
				warehouse_id: warehouse.warehouse_id,
				effective_at: when === "now" ? null : newYearInstant(year, warehouse.timezone),
				values: { timezone: warehouse.timezone, year, ...parsed.values, source: "TEST-ONLY", approval: "test_only" },
				expected_version: warehouse.latest_version,
				reason: reason.trim(),
				reauthentication_proof: issued.data.proof,
			},
			key.current,
		);
		setPending(false);
		if (!result.ok) {
			if (!result.retryable) key.current = crypto.randomUUID();
			return setError(result.text);
		}
		onDone(`Kalender ${warehouse.warehouse_name} versi ${result.data.version} tersimpan (tahun ${year}).`);
	}
	return (
		<FormDialog
			title={`Kalender ${warehouse.warehouse_name}`}
			description={`Versi baru tidak mengubah tenggat pesanan yang sudah dihitung. Zona waktu ${warehouse.timezone}.`}
			pending={pending}
			error={error}
			submitLabel="Simpan kalender"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<fieldset className="flex flex-col gap-2">
				<legend className="mb-1 text-sm font-medium">Berlaku</legend>
				<label className="flex items-center gap-2 text-sm">
					<input type="radio" name="calendar-when" className="size-4 accent-primary" checked={when === "now"} onChange={() => setWhen("now")} />
					Sekarang, untuk tahun {warehouse.local_year}
				</label>
				<label className="flex items-center gap-2 text-sm">
					<input type="radio" name="calendar-when" className="size-4 accent-primary" checked={when === "next"} onChange={() => setWhen("next")} />
					Mulai 1 Januari {warehouse.local_year + 1}
				</label>
			</fieldset>
			<DraftFields id="calendar-edit" draft={draft} onChange={setDraft} />
			<FormField id="calendar-edit-reason" label="Alasan (wajib)">
				<Input id="calendar-edit-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
			</FormField>
			<FormField id="calendar-edit-password" label="Konfirmasi kata sandi">
				<Input id="calendar-edit-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}
