"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";

type Step = "password" | "totp" | "backup";

// Posts only to the existing Better Auth handler (/api/auth/*): it owns Origin/CSRF checks,
// per-account rate limits and the signed two_factor challenge cookie. Messages never say
// whether an email exists.
async function post(path: string, body: Record<string, string>) {
	try {
		const response = await fetch(`/api/auth${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
		const retry = Number(response.headers.get("retry-after") ?? response.headers.get("x-retry-after"));
		return { status: response.status, payload, retry: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null };
	} catch {
		return { status: 0, payload: null, retry: null };
	}
}

type Result = Awaited<ReturnType<typeof post>>;
// Each response gets its own message: only a credential rejection says the email, password or
// code did not match. Origin, rate limit, disabled service and connection problems say so.
function failure({ status, payload, retry }: Result, step: Step) {
	if (status === 403 && payload?.code === "INVALID_ORIGIN")
		return "Halaman ini dibuka dari alamat yang tidak diizinkan. Buka toko dari alamat resminya lalu coba lagi.";
	if (status === 429)
		return retry ? `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(retry / 60)} menit.` : "Terlalu banyak percobaan. Coba lagi dalam beberapa menit.";
	if (status === 503) return "Layanan masuk sedang dinonaktifkan sementara. Coba lagi nanti.";
	if (status === 0 || status >= 500) return "Tidak bisa terhubung. Coba lagi.";
	if (step === "password") return "Email atau kata sandi tidak cocok. Periksa kembali lalu coba lagi.";
	return "Kode tidak cocok atau verifikasi sudah kedaluwarsa. Coba kode terbaru, atau mulai ulang dari email dan kata sandi.";
}
// Only a credential rejection marks a field invalid.
const credential = ({ status, payload }: Result) => status !== 429 && status !== 0 && status < 500 && !(status === 403 && payload?.code === "INVALID_ORIGIN");

export function SignInForm({ next }: { next: string | null }) {
	const [step, setStep] = useState<Step>("password");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [error, setError] = useState<{ message: string; field: "email" | "password" | "code" | null } | null>(null);
	const [pending, setPending] = useState(false);
	const codeRef = useRef<HTMLInputElement>(null);
	const alertRef = useRef<HTMLDivElement>(null);
	const resume = next ? `/masuk?next=${encodeURIComponent(next)}` : "/masuk";

	useEffect(() => {
		if (step !== "password") codeRef.current?.focus();
	}, [step]);

	// Every failed submit (a new error object) moves focus to its message, so keyboard and
	// screen-reader users land on the reason and the invalid field is the next Tab stop.
	useEffect(() => {
		if (error) alertRef.current?.focus();
	}, [error]);

	function finish() {
		// Full navigation: the server re-reads the new session and routes by role.
		window.location.assign(resume);
	}

	async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!email.trim() || !password) {
			setError({ message: "Isi email dan kata sandi.", field: !email.trim() ? "email" : "password" });
			return;
		}
		setPending(true);
		setError(null);
		const result = await post("/sign-in/email", { email: email.trim(), password });
		setPending(false);
		if (result.status === 200 && result.payload?.twoFactorRedirect === true) {
			setPassword("");
			setStep("totp");
		} else if (result.status === 200) finish();
		else setError({ message: failure(result, "password"), field: credential(result) ? "password" : null });
	}

	async function submitCode(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const value = code.replace(/\s+/g, "");
		const backup = step === "backup";
		const normalized = backup && /^[A-Za-z0-9]{10}$/.test(value) ? `${value.slice(0, 5)}-${value.slice(5)}` : value;
		if (backup ? !/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/.test(normalized) : !/^\d{6}$/.test(normalized)) {
			setError({ message: backup ? "Masukkan kode cadangan 10 karakter, contoh: abcde-12345." : "Masukkan 6 digit kode dari aplikasi autentikator.", field: "code" });
			return;
		}
		setPending(true);
		setError(null);
		const result = await post(backup ? "/two-factor/verify-backup-code" : "/two-factor/verify-totp", { code: normalized });
		setPending(false);
		if (result.status === 200) finish();
		else setError({ message: failure(result, step), field: credential(result) ? "code" : null });
	}

	function restart() {
		setStep("password");
		setCode("");
		setError(null);
	}

	const alert = error && (
		<div ref={alertRef} tabIndex={-1} className="signin-alert" role="alert" aria-live="assertive" id="signin-error" data-testid="signin-error">
			<Icon name="alert" />
			<p>{error.message}</p>
		</div>
	);
	const described = (field: "email" | "password" | "code") => (error?.field === field ? "signin-error" : undefined);

	if (step === "password") {
		return (
			<form className="signin-card" method="post" onSubmit={submitPassword} noValidate aria-labelledby="signin-heading">
				<h1 id="signin-heading">Masuk ke akun 99ribu</h1>
				<p className="signin-lead">Lihat pesanan, alamat tersimpan, dan status pengiriman Anda.</p>
				{alert}
				<div className="signin-field">
					<label htmlFor="signin-email">Email</label>
					<input id="signin-email" name="email" type="email" inputMode="email" autoComplete="username" required maxLength={254}
						value={email} onChange={(event) => setEmail(event.currentTarget.value)}
						aria-invalid={error?.field === "email" || error?.field === "password" || undefined} aria-describedby={described("email")} />
				</div>
				<div className="signin-field">
					<label htmlFor="signin-password">Kata sandi</label>
					<input id="signin-password" name="password" type="password" autoComplete="current-password" required maxLength={128}
						value={password} onChange={(event) => setPassword(event.currentTarget.value)}
						aria-invalid={error?.field === "password" || undefined} aria-describedby={described("password")} />
				</div>
				<div className="signin-actions">
					<button className="button" type="submit" disabled={pending}>{pending ? "Memeriksa…" : "Masuk"}</button>
					<Link className="button button-secondary" href={next ?? "/"}>Batal</Link>
				</div>
				<p className="signin-hint">Akun staf meminta kode verifikasi dua langkah setelah kata sandi.</p>
				<p className="signin-hint">Belanja tetap bisa tanpa akun. Pesanan tamu dapat dibuka dari halaman <Link href="/akun">Akun</Link>.</p>
			</form>
		);
	}

	const backup = step === "backup";
	return (
		<form className="signin-card" method="post" onSubmit={submitCode} noValidate aria-labelledby="signin-verify-heading">
			<h1 id="signin-verify-heading">Verifikasi dua langkah</h1>
			<p className="signin-lead">
				{backup
					? "Masukkan salah satu kode cadangan yang Anda simpan saat mengaktifkan verifikasi dua langkah. Setiap kode hanya berlaku sekali."
					: "Buka aplikasi autentikator lalu masukkan 6 digit kode untuk 99ribu. Kode berganti setiap 30 detik."}
			</p>
			{alert}
			<div className="signin-field">
				<label htmlFor="signin-code">{backup ? "Kode cadangan" : "Kode autentikator"}</label>
				<input ref={codeRef} id="signin-code" name="code" type="text" required
					inputMode={backup ? "text" : "numeric"} autoComplete={backup ? "off" : "one-time-code"} maxLength={backup ? 11 : 6}
					autoCapitalize="none" spellCheck={false} value={code} onChange={(event) => setCode(event.currentTarget.value)}
					aria-invalid={error?.field === "code" || undefined} aria-describedby={described("code") ?? "signin-code-hint"} />
				<p id="signin-code-hint" className="signin-hint">Verifikasi ini berlaku 5 menit sejak kata sandi diterima.</p>
			</div>
			<div className="signin-actions">
				<button className="button" type="submit" disabled={pending}>{pending ? "Memeriksa…" : "Verifikasi"}</button>
				<button className="button button-secondary" type="button" onClick={() => { setStep(backup ? "totp" : "backup"); setCode(""); setError(null); }}>
					{backup ? "Pakai kode autentikator" : "Pakai kode cadangan"}
				</button>
			</div>
			<button className="signin-restart" type="button" onClick={restart}>
				Mulai ulang dari email dan kata sandi
			</button>
		</form>
	);
}
