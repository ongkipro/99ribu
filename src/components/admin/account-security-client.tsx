"use client";

import { CircleCheck, KeyRound, LogOut, Monitor, ShieldCheck, Smartphone } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { wibDateTime } from "@/modules/storefront/format";
import { type AccountSecurity, type OwnSession, SECURITY_MESSAGES, describeDevice } from "./account-model";
import { describeFailure, failureText, getJson, readFailure } from "./admin-errors";
import { FormDialog, FormField } from "./form";
import { DetailSection } from "./page-blocks";
import { ErrorState, LoadingState } from "./states";
import { StatusBadge } from "./status";

// S129 (spec 17 B2): own password, two-step verification and sessions. Every change asks for the current password.
// Staff cannot switch two-step verification off here: the API has no such route. Backup codes exist only in this
// component's state while the dialog that shows them is open; they are never stored, logged or fetched again.

type Result<T> = { ok: true; data: T } | { ok: false; text: string };
const message = (status: number, code: string | null) =>
	code && SECURITY_MESSAGES[code] ? `${SECURITY_MESSAGES[code]} (kode: ${code})` : failureText(describeFailure(status, code));

async function post<T>(url: string, body: unknown): Promise<Result<T>> {
	try {
		const res = await fetch(url, {
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
			body: JSON.stringify(body),
		});
		if (res.ok) return { ok: true, data: (await res.json()) as T };
		const failure = await readFailure(res);
		return { ok: false, text: message(res.status, failure.code) };
	} catch {
		return { ok: false, text: message(0, null) };
	}
}

type OpenDialog = "password" | "backup" | "sessions";

export function AccountSecurityClient() {
	const [data, setData] = useState<AccountSecurity | null>(null);
	const [status, setStatus] = useState<{ kind: "loading" } | { kind: "ready" } | { kind: "error" | "denied"; message: string }>({ kind: "loading" });
	const [dialog, setDialog] = useState<OpenDialog | null>(null);
	const [codes, setCodes] = useState<string[] | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	const load = useCallback(async () => {
		const result = await getJson<AccountSecurity>("/api/auth/account-security");
		if (!result.ok) {
			setStatus(
				result.failure.status === 401 || result.failure.status === 403
					? { kind: "denied", message: failureText(result.failure) }
					: { kind: "error", message: failureText(result.failure) },
			);
			return;
		}
		setData(result.data);
		setStatus({ kind: "ready" });
	}, []);
	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);
	const done = (text: string) => {
		setDialog(null);
		setNotice(text);
		void load();
	};

	if (status.kind === "loading") return <LoadingState label="Memuat keamanan akun…" lines={3} />;
	if (status.kind !== "ready" || !data)
		return (
			<ErrorState
				message={status.kind === "ready" ? "Data keamanan tidak tersedia." : status.message}
				onRetry={
					status.kind === "error"
						? () => {
								setStatus({ kind: "loading" });
								void load();
							}
						: undefined
				}
			/>
		);
	const others = data.sessions.filter((session) => !session.current).length;
	const { two_factor: twoFactor } = data;
	return (
		<div className="flex flex-col gap-4" data-testid="account-security">
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="outline-none" data-testid="account-security-notice">
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			<DetailSection
				id="security-password"
				title="Kata sandi"
				description="Minimal 12 karakter. Setelah diganti, sesi di semua perangkat lain berakhir."
				testId="security-password"
			>
				<div>
					<Button type="button" variant="outline" data-testid="change-password-open" onClick={() => setDialog("password")}>
						<KeyRound data-icon="inline-start" aria-hidden="true" />
						Ganti kata sandi
					</Button>
				</div>
			</DetailSection>
			<DetailSection
				id="security-two-factor"
				title="Verifikasi dua langkah"
				description="Wajib untuk akun staf. Staf tidak dapat mematikannya sendiri; hubungi Super Admin bila perangkat autentikator hilang."
				testId="security-two-factor"
			>
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<StatusBadge tone={twoFactor.enabled ? "success" : "problem"} testId="two-factor-status">
						{twoFactor.enabled ? "Aktif" : "Belum aktif"}
					</StatusBadge>
					{twoFactor.verified_at && (
						<span className="text-muted-foreground" data-testid="two-factor-verified-at">
							Terverifikasi di sesi ini pada {wibDateTime(twoFactor.verified_at)}
						</span>
					)}
				</div>
				{twoFactor.backup_codes_remaining !== null && (
					<p className="text-sm" data-testid="backup-codes-remaining">
						Kode cadangan tersisa: <strong>{twoFactor.backup_codes_remaining}</strong>
					</p>
				)}
				{twoFactor.enabled && (
					<div>
						<Button type="button" variant="outline" data-testid="backup-codes-open" onClick={() => setDialog("backup")}>
							<ShieldCheck data-icon="inline-start" aria-hidden="true" />
							Buat ulang kode cadangan
						</Button>
					</div>
				)}
			</DetailSection>
			<DetailSection
				id="security-sessions"
				title="Sesi aktif"
				description="Perangkat yang sedang masuk ke akun ini. Sesi yang tidak Anda kenali sebaiknya diakhiri, lalu ganti kata sandi."
				testId="security-sessions"
			>
				<ul className="flex flex-col divide-y rounded-md border" aria-label="Sesi aktif" data-testid="session-list">
					{data.sessions.map((session) => (
						<SessionRow key={`${session.signed_in_at}|${session.expires_at}|${session.ip_hint}|${session.user_agent}`} session={session} />
					))}
				</ul>
				<div>
					<Button
						type="button"
						variant="outline"
						disabled={others === 0}
						data-testid="terminate-others-open"
						onClick={() => setDialog("sessions")}
					>
						<LogOut data-icon="inline-start" aria-hidden="true" />
						Akhiri sesi lain{others > 0 ? ` (${others})` : ""}
					</Button>
					{others === 0 && <p className="mt-2 text-xs text-muted-foreground">Tidak ada sesi lain yang aktif.</p>}
				</div>
			</DetailSection>
			{dialog === "password" && <PasswordDialog onClose={() => setDialog(null)} onDone={() => done("Kata sandi diganti. Sesi di perangkat lain sudah berakhir.")} />}
			{dialog === "backup" && (
				<BackupDialog
					onClose={() => setDialog(null)}
					onDone={(next) => {
						setDialog(null);
						setCodes(next);
						void load();
					}}
				/>
			)}
			{dialog === "sessions" && <SessionsDialog count={others} onClose={() => setDialog(null)} onDone={() => done("Sesi di perangkat lain sudah berakhir.")} />}
			{codes && <CodesDialog codes={codes} onClose={() => setCodes(null)} />}
		</div>
	);
}

function SessionRow({ session }: { session: OwnSession }) {
	const Icon = /Android|iPhone|iPad|iOS/.test(describeDevice(session.user_agent)) ? Smartphone : Monitor;
	return (
		<li className="flex flex-col gap-1 p-3 md:flex-row md:items-center md:justify-between md:gap-4" data-testid="session-item" data-current={session.current}>
			<div className="flex min-w-0 items-start gap-3">
				<Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<div className="flex min-w-0 flex-col">
					<span className="font-medium break-words">{describeDevice(session.user_agent)}</span>
					<span className="text-xs text-muted-foreground">
						Masuk {wibDateTime(session.signed_in_at)}
						{session.ip_hint ? ` · alamat ${session.ip_hint}` : ""}
					</span>
				</div>
			</div>
			{session.current && <StatusBadge tone="success">Perangkat ini</StatusBadge>}
		</li>
	);
}

function PasswordDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [repeat, setRepeat] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const ids = useId();
	async function submit() {
		if (!current) return setError("Isi kata sandi saat ini.");
		if (next.length < 12) return setError(message(0, "PASSWORD_TOO_SHORT"));
		if (next !== repeat) return setError("Kata sandi baru dan konfirmasinya tidak sama.");
		if (next === current) return setError(message(0, "PASSWORD_UNCHANGED"));
		setPending(true);
		setError(null);
		const result = await post("/api/auth/change-password", { currentPassword: current, newPassword: next });
		setPending(false);
		setCurrent("");
		setNext("");
		setRepeat("");
		if (!result.ok) return setError(result.text);
		onDone();
	}
	return (
		<FormDialog
			title="Ganti kata sandi"
			description="Sesi di semua perangkat lain berakhir. Perangkat ini tetap masuk."
			pending={pending}
			error={error}
			submitLabel="Ganti kata sandi"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id={`${ids}-current`} label="Kata sandi saat ini">
				<Input id={`${ids}-current`} data-testid="password-current" type="password" autoComplete="current-password" maxLength={128} value={current} onChange={(e) => setCurrent(e.target.value)} />
			</FormField>
			<FormField id={`${ids}-new`} label="Kata sandi baru" hint="Minimal 12 karakter.">
				<Input id={`${ids}-new`} data-testid="password-new" type="password" autoComplete="new-password" maxLength={128} aria-describedby={`${ids}-new-hint`} value={next} onChange={(e) => setNext(e.target.value)} />
			</FormField>
			<FormField id={`${ids}-repeat`} label="Ulangi kata sandi baru">
				<Input id={`${ids}-repeat`} data-testid="password-repeat" type="password" autoComplete="new-password" maxLength={128} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}

function BackupDialog({ onClose, onDone }: { onClose: () => void; onDone: (codes: string[]) => void }) {
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const ids = useId();
	async function submit() {
		if (!password) return setError("Isi kata sandi Anda.");
		setPending(true);
		setError(null);
		const result = await post<{ backupCodes: string[] }>("/api/auth/two-factor/generate-backup-codes", { password });
		setPending(false);
		setPassword("");
		if (!result.ok) return setError(result.text);
		onDone(result.data.backupCodes);
	}
	return (
		<FormDialog
			title="Buat ulang kode cadangan"
			description="Kode cadangan yang lama langsung tidak berlaku. Kode baru hanya ditampilkan satu kali."
			pending={pending}
			error={error}
			submitLabel="Buat kode baru"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id={`${ids}-password`} label="Kata sandi Anda">
				<Input id={`${ids}-password`} data-testid="backup-password" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}

function CodesDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
	return (
		<Dialog open onOpenChange={(next) => !next && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Simpan kode cadangan baru</DialogTitle>
					<DialogDescription>Setiap kode dapat dipakai satu kali bila autentikator tidak tersedia. Kode ini tidak akan ditampilkan lagi setelah dialog ditutup.</DialogDescription>
				</DialogHeader>
				<ul className="grid grid-cols-2 gap-2 font-mono text-sm" data-testid="backup-codes">
					{codes.map((code) => (
						<li key={code} className="rounded-md border bg-muted/40 px-3 py-2 break-all">
							{code}
						</li>
					))}
				</ul>
				<DialogFooter>
					<Button type="button" data-testid="backup-codes-done" onClick={onClose}>
						Sudah saya simpan
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function SessionsDialog({ count, onClose, onDone }: { count: number; onClose: () => void; onDone: () => void }) {
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const ids = useId();
	async function submit() {
		if (!password) return setError("Isi kata sandi Anda.");
		setPending(true);
		setError(null);
		// getCurrentUser names the caller; the proof is bound to that id and to this session, and is used once.
		const me = await getJson<{ id: string }>("/api/v1/me");
		if (!me.ok) {
			setPending(false);
			return setError(failureText(me.failure));
		}
		const proof = await post<{ proof: string }>("/api/v1/me/reauthentication-proofs", {
			password,
			action: "session.terminate_others",
			subject_id: me.data.id,
		});
		setPassword("");
		if (!proof.ok) {
			setPending(false);
			return setError(proof.text);
		}
		const result = await post("/api/v1/me/session-terminations", { scope: "all_other", reauthentication_proof: proof.data.proof });
		setPending(false);
		if (!result.ok) return setError(result.text);
		onDone();
	}
	return (
		<FormDialog
			title="Akhiri sesi di perangkat lain?"
			description={`${count} sesi lain akan keluar dan harus masuk lagi dengan kode autentikator. Perangkat ini tetap masuk.`}
			pending={pending}
			error={error}
			submitLabel="Akhiri sesi lain"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id={`${ids}-password`} label="Kata sandi Anda">
				<Input id={`${ids}-password`} data-testid="sessions-password" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
			</FormField>
		</FormDialog>
	);
}
