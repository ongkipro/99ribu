"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { verificationCallback } from "../../modules/access/return-to";
import {
	type AuthMode, authHref, cooldownLabel, NAME_MAX, PASSWORD_MAX, PASSWORD_MIN, passwordHint, RESEND_COOLDOWN,
	type SignInStep, type SignUpFailure, signInHref, signUpFailureField, signUpFailureKind, signUpFailureMessage,
} from "./sign-in-copy";
import { AuthSwitch, type ModeSwitch, post, SignInForm, type SignInError } from "./sign-in-form";
import { Wordmark } from "./ui/brand";
import { Icon } from "./ui/icon";

// S123 buyer sign-up, shared by /masuk and the intercepted modal. With JS it posts JSON to Better Auth
// (/api/auth/sign-up/email, then /send-verification-email for a resend) through handleAuth: Origin
// check, per-email budget 3/min, NOTIFICATION_DISABLED in production. Without JS the same forms post to
// /masuk/kirim. A new and a registered email both end on "Cek email kamu untuk verifikasi".

// The receipt's "Simpan pesanan ini ke akun" card hands its order's contact email to the sign-up form it
// opens by client navigation: kept in memory only (never in a URL or storage) and used once.
let handoff: { next: string; email: string } | null = null;
export function handOffSignUpEmail(next: string, email: string) {
	handoff = { next, email };
}

type Notice = { message: string; field: "name" | "email" | "password" | null };
const notice = (kind: SignUpFailure, retry: number | null = null): Notice => ({ message: signUpFailureMessage(kind, retry), field: signUpFailureField(kind) });

// Holds the mode so the switch swaps forms without a navigation (the modal stays open). URL errors
// (no-JS round trip) belong to the first form shown only.
export function AuthForms({ next, initialMode, step, signInError, signUpError, resent, modal }: {
	next: string | null; initialMode: AuthMode; step: SignInStep; signInError: SignInError | null; signUpError: { kind: SignUpFailure; retry: number | null } | null; resent: boolean; modal: boolean;
}) {
	const [mode, setMode] = useState(initialMode);
	const [email, setEmail] = useState<string | null>(null);
	const [fresh, setFresh] = useState(true);
	const box = useRef<HTMLDivElement>(null);
	const swapped = useRef(false);
	const go: ModeSwitch = (target, carried) => {
		setFresh(false);
		if (carried !== undefined) setEmail(carried || null);
		swapped.current = true;
		setMode(target);
	};
	// The swapped form replaces the focused control: focus moves to its current switch tab, or to the
	// "check your email" heading.
	useEffect(() => {
		if (!swapped.current) return;
		swapped.current = false;
		box.current?.querySelector<HTMLElement>('.signin-switch [aria-current="page"], [tabindex="-1"]:is(h1, h2)')?.focus();
	});
	return (
		<div ref={box} className="signin-forms">
			{mode === "masuk"
				? <SignInForm next={next} step={step} error={fresh ? signInError : null} modal={modal} onMode={go} email={email} />
				: <SignUpForm key={mode} next={next} sent={mode === "cek-email"} error={fresh ? signUpError : null} resent={fresh && resent} modal={modal} onMode={go} email={email} />}
		</div>
	);
}

function SignUpForm({ next, sent: initialSent, error: initialError, resent, modal, onMode, email: carried }: {
	next: string | null; sent: boolean; error: { kind: SignUpFailure; retry: number | null } | null; resent: boolean; modal: boolean; onMode: ModeSwitch; email: string | null;
}) {
	const [sentTo, setSentTo] = useState<string | null>(initialSent ? carried : null);
	const [sent, setSent] = useState(initialSent);
	const [error, setError] = useState<Notice | null>(initialError ? notice(initialError.kind, initialError.retry) : null);
	const [pending, setPending] = useState(false);
	const [email, setEmail] = useState(() => carried ?? (handoff?.next === next ? handoff.email : ""));
	const [password, setPassword] = useState("");
	const [visible, setVisible] = useState(false);
	const [hydrated, setHydrated] = useState(false);
	const alertRef = useRef<HTMLDivElement>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const moved = useRef(false);
	const Heading = modal ? "h2" : "h1";

	useEffect(() => {
		handoff = null;
		setHydrated(true);
	}, []);
	useEffect(() => {
		if (error && moved.current) alertRef.current?.focus();
	}, [error]);
	// The "check your email" state replaces the form: focus its heading so it is announced.
	useEffect(() => {
		if (sent && moved.current) headingRef.current?.focus();
		moved.current = true;
	}, [sent]);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const name = String(data.get("name") ?? "").trim(), address = email.trim();
		const local: SignUpFailure | null = !name || !address || !password ? "empty"
			: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? "email"
			: password.length < PASSWORD_MIN ? "password" : null;
		if (local) return setError({ ...notice(local), field: local === "empty" ? (!name ? "name" : !address ? "email" : "password") : signUpFailureField(local) });
		setPending(true);
		setError(null);
		const result = await post("/sign-up/email", { name, email: address, password, callbackURL: verificationCallback(next) });
		setPending(false);
		if (result.status === 200) {
			setPassword("");
			setSentTo(address);
			setSent(true);
		} else setError(notice(signUpFailureKind(result.status, result.payload?.code), result.retry));
	}

	if (sent) {
		return (
			<div className="signin-card" data-testid="signup-sent">
				<span className="brand signin-mark" aria-hidden="true"><Wordmark /></span>
				<span className="signin-sent-icon" aria-hidden="true"><Icon name="mail" size={28} /></span>
				<Heading ref={headingRef} tabIndex={-1} id="signup-sent-heading">Cek email kamu untuk verifikasi</Heading>
				<p className="signin-lead">
					{sentTo ? <>Kami mengirim email ke <strong className="signin-address">{sentTo}</strong>. </> : "Kami mengirim email ke alamat yang didaftarkan. "}
					Buka tautan di dalamnya untuk melanjutkan; tautan berlaku 30 menit.
				</p>
				<ResendForm next={next} email={sentTo} resent={resent} cooldown={sentTo && !initialSent ? RESEND_COOLDOWN : 0} initialError={initialSent ? error : null} />
				<p className="signin-links">
					<a href={authHref(next, "daftar")} onClick={(event) => { event.preventDefault(); if (sentTo) setEmail(sentTo); setSent(false); }}>Ganti email</a>
					<a href={signInHref(next)} onClick={(event) => { event.preventDefault(); onMode("masuk", sentTo ?? undefined); }}>Sudah verifikasi? Masuk</a>
				</p>
			</div>
		);
	}

	const invalid = (field: Notice["field"]) => (error?.field === field ? true : undefined);
	const described = (field: Notice["field"], hint?: string) => [error?.field === field ? "signup-error" : null, hint].filter(Boolean).join(" ") || undefined;
	return (
		<form className="signin-card" method="post" action="/masuk/kirim" onSubmit={submit} noValidate aria-labelledby="signup-heading">
			<input type="hidden" name="step" value="signup" />
			{next && <input type="hidden" name="next" value={next} />}
			<span className="brand signin-mark" aria-hidden="true"><Wordmark /></span>
			<AuthSwitch mode="daftar" next={next} onMode={onMode} />
			<Heading id="signup-heading">Buat akun 99ribu</Heading>
			<p className="signin-lead">Lacak pesanan, simpan alamat, dan lihat riwayat belanja.</p>
			<div className="signin-field">
				<label htmlFor="signup-name">Nama</label>
				<input id="signup-name" name="name" type="text" autoComplete="name" required maxLength={NAME_MAX}
					aria-invalid={invalid("name")} aria-describedby={described("name")} />
			</div>
			<div className="signin-field">
				<label htmlFor="signup-email">Email</label>
				<input id="signup-email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254}
					value={email} onChange={(event) => setEmail(event.currentTarget.value)} aria-invalid={invalid("email")} aria-describedby={described("email")} />
			</div>
			<div className="signin-field">
				<label htmlFor="signup-password">Kata sandi</label>
				<div className="signin-password">
					<input id="signup-password" name="password" type={visible ? "text" : "password"} autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX}
						autoCapitalize="none" spellCheck={false} value={password} onChange={(event) => setPassword(event.currentTarget.value)}
						aria-invalid={invalid("password")} aria-describedby={described("password", "signup-password-hint")} />
					{hydrated && (
						<button type="button" className="signin-reveal" aria-label="Tampilkan kata sandi" aria-pressed={visible} aria-controls="signup-password"
							onClick={() => setVisible((value) => !value)}>
							<Icon name={visible ? "eye-off" : "eye"} size={20} />
						</button>
					)}
				</div>
				<p id="signup-password-hint" className="signin-field-hint" data-ok={password.length >= PASSWORD_MIN || undefined}>
					{password.length >= PASSWORD_MIN && <Icon name="check" size={14} />}
					{passwordHint(password.length)}
				</p>
			</div>
			{error && (
				<div ref={alertRef} tabIndex={-1} className="signin-alert" role="alert" id="signup-error" data-testid="signup-error">
					<Icon name="alert" size={16} />
					<p>{error.message}</p>
				</div>
			)}
			<button className="button signin-submit" type="submit" disabled={pending}>{pending ? "Mendaftarkan…" : "Daftar"}</button>
			<p className="signin-hint">
				Dengan mendaftar, Anda menyetujui <Link href="/syarat">Syarat dan ketentuan</Link> serta <Link href="/privasi">Kebijakan privasi</Link> 99ribu. Belanja tetap bisa tanpa akun.
			</p>
		</form>
	);
}

// "Kirim ulang email" with a cooldown (the per-email budget is 3/min; a 429 sets the wait from
// Retry-After). The answer is the same whether or not the address waits for verification. Also used by
// the expired/invalid link states of /masuk/verifikasi, where the email field is shown.
export function ResendForm({ next, email, resent = false, cooldown = 0, initialError = null }: { next: string | null; email: string | null; resent?: boolean; cooldown?: number; initialError?: Notice | null }) {
	const [remaining, setRemaining] = useState(cooldown);
	const [status, setStatus] = useState(resent);
	const [error, setError] = useState<{ message: string; field: boolean } | null>(initialError && { message: initialError.message, field: initialError.field === "email" });
	const [pending, setPending] = useState(false);
	const alertRef = useRef<HTMLDivElement>(null);
	const shown = useRef(error);

	useEffect(() => {
		if (remaining <= 0) return;
		const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
		return () => clearTimeout(timer);
	}, [remaining]);
	useEffect(() => {
		if (error && error !== shown.current) alertRef.current?.focus();
	}, [error]);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const address = (email ?? String(new FormData(event.currentTarget).get("email") ?? "")).trim();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setError({ message: signUpFailureMessage("email", null), field: true });
		setPending(true);
		setError(null);
		setStatus(false);
		const result = await post("/send-verification-email", { email: address, callbackURL: verificationCallback(next) });
		setPending(false);
		if (result.status === 200) {
			setStatus(true);
			setRemaining(RESEND_COOLDOWN);
			return;
		}
		const kind = signUpFailureKind(result.status, result.payload?.code);
		if (kind === "limit") setRemaining(result.retry ?? RESEND_COOLDOWN);
		setError({ message: signUpFailureMessage(kind === "password" ? "input" : kind, result.retry), field: signUpFailureField(kind) === "email" });
	}

	return (
		<form className="signin-resend" method="post" action="/masuk/kirim" onSubmit={submit} noValidate>
			<input type="hidden" name="step" value="resend" />
			{next && <input type="hidden" name="next" value={next} />}
			{email ? <input type="hidden" name="email" value={email} /> : (
				<div className="signin-field">
					<label htmlFor="resend-email">Email</label>
					<input id="resend-email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254}
						aria-invalid={error?.field || undefined} aria-describedby={error?.field ? "resend-error" : undefined} />
				</div>
			)}
			{status && (
				<p className="signin-status" role="status" data-testid="resend-status"><Icon name="check" size={16} />Jika alamat ini menunggu verifikasi, tautan baru sudah dikirim.</p>
			)}
			{error && (
				<div ref={alertRef} tabIndex={-1} className="signin-alert" role="alert" id="resend-error" data-testid="resend-error">
					<Icon name="alert" size={16} />
					<p>{error.message}</p>
				</div>
			)}
			<button className="button button-secondary signin-submit" type="submit" disabled={pending || remaining > 0} data-testid="resend-button">
				{pending ? "Mengirim…" : remaining > 0 ? cooldownLabel(remaining) : "Kirim ulang email"}
			</button>
			<p className="signin-hint">Tidak ada di kotak masuk? Periksa folder spam atau promosi.</p>
		</form>
	);
}
