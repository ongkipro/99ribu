"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { type AuthMode, authHref, codeInput, failureKind, failureMessage, type SignInFailure, type SignInStep, signInHref } from "./sign-in-copy";
import { Icon } from "./ui/icon";
import { Wordmark } from "./ui/brand";

type Field = "email" | "password" | "code";
export type SignInError = { message: string; field: Field | null; kind?: SignInFailure };
export type ModeSwitch = (mode: AuthMode, email?: string) => void;

// "Masuk / Daftar" (S123): real links to the two /masuk URLs, so the switch also works without JS; with
// JS the panel swaps the form in place (the modal stays open) and keeps the typed email.
export function AuthSwitch({ mode, next, onMode }: { mode: "masuk" | "daftar"; next: string | null; onMode?: ModeSwitch }) {
	const item = (target: "masuk" | "daftar", label: string) => (
		<a href={authHref(next, target)} aria-current={mode === target ? "page" : undefined}
			onClick={onMode ? (event) => { event.preventDefault(); if (mode !== target) onMode(target); } : undefined}>{label}</a>
	);
	return <nav className="signin-switch" aria-label="Masuk atau daftar">{item("masuk", "Masuk")}{item("daftar", "Daftar")}</nav>;
}

// With JS: posts JSON to the existing Better Auth handler (/api/auth/*), which owns Origin/CSRF checks,
// per-account rate limits and the signed two_factor challenge cookie. Without JS the same form posts
// to /masuk/kirim, which calls that handler and redirects back here.
export async function post(path: string, body: Record<string, string>) {
	try {
		const response = await fetch(`/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
		const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
		const retry = Number(response.headers.get("retry-after") ?? response.headers.get("x-retry-after"));
		return { status: response.status, payload, retry: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null };
	} catch {
		return { status: 0, payload: null, retry: null };
	}
}

// `modal`: rendered in the intercepted sheet over a storefront page (h2, success returns to that page).
// `onMode`/`email`: the sign-up switch and the email carried over from it (sign-up-form.tsx:AuthForms).
export function SignInForm({ next, step: initialStep = "password", error: initialError = null, modal = false, onMode, email = null }: { next: string | null; step?: SignInStep; error?: SignInError | null; modal?: boolean; onMode?: ModeSwitch; email?: string | null }) {
	const [step, setStep] = useState<SignInStep>(initialStep);
	const [code, setCode] = useState("");
	const [error, setError] = useState<SignInError | null>(initialError);
	const [pending, setPending] = useState(false);
	const codeRef = useRef<HTMLInputElement>(null);
	const alertRef = useRef<HTMLDivElement>(null);
	const moved = useRef(false);
	const Heading = modal ? "h2" : "h1";

	// A step change moves focus to the code field (not on first render, so a page load does not jump).
	useEffect(() => {
		if (moved.current && step !== "password") codeRef.current?.focus();
		moved.current = true;
	}, [step]);
	// Every failed submit (a new error object) moves focus to its message, so keyboard and screen-reader
	// users land on the reason and the invalid field is the next Tab stop.
	useEffect(() => {
		if (error && error !== initialError) alertRef.current?.focus();
	}, [error, initialError]);

	function finish() {
		// Full navigation so the server re-reads the new session. /masuk routes it by role to `next`; the
		// modal without a `next` reloads the page it covers, so the shopper stays where they were.
		if (modal && !next) {
			window.addEventListener("popstate", () => window.location.reload(), { once: true });
			window.history.back();
		} else window.location.assign(signInHref(next));
	}

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		let path: string;
		let body: Record<string, string>;
		if (step === "password") {
			const email = String(data.get("email") ?? "").trim(), password = String(data.get("password") ?? "");
			if (!email || !password) return setError({ message: "Isi email dan kata sandi.", field: email ? "password" : "email" });
			path = "/sign-in/email";
			body = { email, password };
		} else {
			const input = codeInput(step, code);
			if (input.code === null) return setError({ message: input.error, field: "code" });
			path = step === "backup" ? "/two-factor/verify-backup-code" : "/two-factor/verify-totp";
			body = { code: input.code };
		}
		setPending(true);
		setError(null);
		const result = await post(path, body);
		setPending(false);
		if (result.status === 200 && step === "password" && result.payload?.twoFactorRedirect === true) setStep("totp");
		else if (result.status === 200) finish();
		else {
			const kind = failureKind(result.status, result.payload?.code);
			setError({ message: failureMessage(kind, step, result.retry), field: kind === "credential" ? (step === "password" ? "password" : "code") : null, kind });
		}
	}

	// Step switches are links, so they also work without JS (the pending two_factor cookie stays).
	const switchTo = (target: SignInStep) => (event: React.MouseEvent) => {
		event.preventDefault();
		setStep(target);
		setCode("");
		setError(null);
	};

	const alert = error && (
		<div ref={alertRef} tabIndex={-1} className="signin-alert" role="alert" id="signin-error" data-testid="signin-error">
			<Icon name="alert" size={16} />
			<p>{error.message}</p>
		</div>
	);
	// An unverified account (password already matched) gets the resend step with the typed email.
	const resend = error?.kind === "unverified" && (
		<p className="signin-links">
			<a href={authHref(next, "cek-email")} data-testid="signin-resend-link"
				onClick={onMode ? (event) => { event.preventDefault(); onMode("cek-email", String(new FormData(event.currentTarget.closest("form") ?? undefined).get("email") ?? "").trim()); } : undefined}>Kirim tautan verifikasi baru</a>
		</p>
	);
	const invalid = (field: Field) => error?.field === field || (field === "email" && error?.field === "password") || undefined;
	const described = (field: Field) => (error?.field === field ? "signin-error" : undefined);
	const backup = step === "backup";
	const headingId = step === "password" ? "signin-heading" : "signin-verify-heading";

	return (
		<form className="signin-card" method="post" action="/masuk/kirim" onSubmit={submit} noValidate aria-labelledby={headingId}>
			<input type="hidden" name="step" value={step} />
			{next && <input type="hidden" name="next" value={next} />}
			<span className="brand signin-mark" aria-hidden="true"><Wordmark /></span>
			{step === "password" && <AuthSwitch mode="masuk" next={next} onMode={onMode} />}
			<Heading id={headingId}>{step === "password" ? "Masuk ke 99ribu" : "Verifikasi dua langkah"}</Heading>
			<p className="signin-lead">
				{step === "password"
					? "Lihat pesanan, alamat tersimpan, dan status pengiriman."
					: backup
						? "Masukkan salah satu kode cadangan yang Anda simpan. Setiap kode hanya berlaku sekali."
						: "Buka aplikasi autentikator, lalu masukkan 6 digit kode untuk 99ribu."}
			</p>
			{step === "password" ? (
				<>
					<div className="signin-field">
						<label htmlFor="signin-email">Email</label>
						<input id="signin-email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} defaultValue={email ?? undefined}
							aria-invalid={invalid("email")} aria-describedby={described("email")} />
					</div>
					<div className="signin-field">
						<label htmlFor="signin-password">Kata sandi</label>
						<input id="signin-password" name="password" type="password" autoComplete="current-password" required maxLength={128}
							aria-invalid={invalid("password")} aria-describedby={described("password")} />
					</div>
				</>
			) : (
				<div className="signin-field">
					<label htmlFor="signin-code">{backup ? "Kode cadangan" : "Kode autentikator"}</label>
					<input ref={codeRef} id="signin-code" name="code" type="text" required inputMode={backup ? "text" : "numeric"} autoComplete={backup ? "off" : "one-time-code"}
						maxLength={backup ? 11 : 6} autoCapitalize="none" spellCheck={false} value={code} onChange={(event) => setCode(event.currentTarget.value)}
						aria-invalid={invalid("code")} aria-describedby={described("code") ?? "signin-code-hint"} />
					<p id="signin-code-hint" className="signin-field-hint">Berlaku 5 menit sejak kata sandi diterima.</p>
				</div>
			)}
			{alert}
			{resend}
			<button className="button signin-submit" type="submit" disabled={pending}>{pending ? "Memeriksa…" : step === "password" ? "Masuk" : "Verifikasi"}</button>
			{step === "password" ? (
				<p className="signin-hint">
					Akun staf diminta kode verifikasi dua langkah. Belanja tetap bisa tanpa akun; pesanan tamu dibuka dari halaman <Link href="/akun">Akun</Link>.
				</p>
			) : (
				<p className="signin-links">
					<a href={signInHref(next, backup ? "totp" : "backup")} onClick={switchTo(backup ? "totp" : "backup")}>{backup ? "Pakai kode autentikator" : "Pakai kode cadangan"}</a>
					<a href={signInHref(next)} onClick={switchTo("password")}>Mulai ulang dari email dan kata sandi</a>
				</p>
			)}
		</form>
	);
}
