"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { activationCallback } from "../../modules/access/return-to";
import {
	type AuthMode, authHref, cooldownLabel, NAME_MAX, PASSWORD_MAX, PASSWORD_MIN, passwordHint, RESEND_COOLDOWN,
	type SignInStep, type SignUpFailure, signInHref, signUpFailureField, signUpFailureKind, signUpFailureMessage,
} from "./sign-in-copy";
import { AuthSwitch, type ModeSwitch, post, SignInForm, type SignInError } from "./sign-in-form";
import { Wordmark } from "./ui/brand";
import { Icon } from "./ui/icon";

// S123 buyer sign-up, shared by /masuk and the intercepted modal (owner decision 2026-10-25: name and email
// only). With JS it posts JSON to Better Auth (/api/auth/sign-up/email, then /send-verification-email for
// a resend) through handleAuth: Origin check, per-email budgets, NOTIFICATION_DISABLED in production, no
// password accepted. The email carries a set-password link (/masuk/atur-sandi); creating the password
// activates the account. Without JS the same forms post to /masuk/kirim. A new and a registered email
// both end on "Cek email Anda untuk verifikasi".

// The receipt's "Simpan pesanan ini ke akun" card hands its order's contact email and recipient name to the
// sign-up form it opens by client navigation: kept in memory only (never in a URL or storage), used once.
let handoff: { next: string; email: string; name: string | null } | null = null;
export function handOffSignUp(next: string, email: string, name: string | null) {
	handoff = { next, email, name };
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
	const handed = handoff?.next === next ? handoff : null;
	const [sentTo, setSentTo] = useState<string | null>(initialSent ? carried : null);
	const [sent, setSent] = useState(initialSent);
	const [error, setError] = useState<Notice | null>(initialError ? notice(initialError.kind, initialError.retry) : null);
	const [pending, setPending] = useState(false);
	const [email, setEmail] = useState(() => carried ?? handed?.email ?? "");
	const [name, setName] = useState(() => handed?.name ?? "");
	const alertRef = useRef<HTMLDivElement>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const moved = useRef(false);
	const Heading = modal ? "h2" : "h1";

	useEffect(() => {
		handoff = null;
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
		const person = name.trim(), address = email.trim();
		const local: SignUpFailure | null = !person || !address ? "empty" : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? "email" : null;
		if (local) return setError({ ...notice(local), field: local === "empty" ? (!person ? "name" : "email") : "email" });
		setPending(true);
		setError(null);
		const result = await post("/sign-up/email", { name: person, email: address, callbackURL: activationCallback(next) });
		setPending(false);
		if (result.status === 200) {
			setSentTo(address);
			setSent(true);
		} else setError(notice(signUpFailureKind(result.status, result.payload?.code), result.retry));
	}

	if (sent) {
		return (
			<div className="signin-card" data-testid="signup-sent">
				<span className="brand signin-mark" aria-hidden="true"><Wordmark /></span>
				<span className="signin-sent-icon" aria-hidden="true"><Icon name="mail" size={28} /></span>
				<Heading ref={headingRef} tabIndex={-1} id="signup-sent-heading">Cek email Anda untuk verifikasi</Heading>
				<p className="signin-lead">
					{sentTo ? <>Kami mengirim email ke <strong className="signin-address">{sentTo}</strong>. </> : "Kami mengirim email ke alamat yang didaftarkan. "}
					Buka tautan di dalamnya untuk membuat kata sandi dan mengaktifkan akun; tautan berlaku 30 menit.
				</p>
				<ResendForm next={next} email={sentTo} resent={resent} cooldown={sentTo && !initialSent ? RESEND_COOLDOWN : 0} initialError={initialSent ? error : null} />
				<p className="signin-links">
					<a href={authHref(next, "daftar")} onClick={(event) => { event.preventDefault(); if (sentTo) setEmail(sentTo); setSent(false); }}>Ganti email</a>
					<a href={signInHref(next)} onClick={(event) => { event.preventDefault(); onMode("masuk", sentTo ?? undefined); }}>Sudah membuat kata sandi? Masuk</a>
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
					value={name} onChange={(event) => setName(event.currentTarget.value)} aria-invalid={invalid("name")} aria-describedby={described("name")} />
			</div>
			<div className="signin-field">
				<label htmlFor="signup-email">Email</label>
				<input id="signup-email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254}
					value={email} onChange={(event) => setEmail(event.currentTarget.value)} aria-invalid={invalid("email")} aria-describedby={described("email", "signup-email-hint")} />
				<p id="signup-email-hint" className="signin-field-hint">Kata sandi dibuat lewat tautan yang kami kirim ke email ini.</p>
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

// New-password pill with the 44px show/hide toggle (rendered only once hydrated, so no dead button
// without JS) and the live length hint. The set-password page.
function PasswordField({ id, label, value, onChange, invalid, errorId }: { id: string; label: string; value: string; onChange: (value: string) => void; invalid?: true; errorId?: string }) {
	const [visible, setVisible] = useState(false);
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => setHydrated(true), []);
	const ok = value.length >= PASSWORD_MIN;
	return (
		<div className="signin-field">
			<label htmlFor={id}>{label}</label>
			<div className="signin-password">
				<input id={id} name="password" type={visible ? "text" : "password"} autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX}
					autoCapitalize="none" spellCheck={false} value={value} onChange={(event) => onChange(event.currentTarget.value)}
					aria-invalid={invalid} aria-describedby={[errorId, `${id}-hint`].filter(Boolean).join(" ")} />
				{hydrated && (
					<button type="button" className="signin-reveal" aria-label="Tampilkan kata sandi" aria-pressed={visible} aria-controls={id} onClick={() => setVisible((shown) => !shown)}>
						<Icon name={visible ? "eye-off" : "eye"} size={20} />
					</button>
				)}
			</div>
			<p id={`${id}-hint`} className="signin-field-hint" data-ok={ok || undefined}>
				{ok && <Icon name="check" size={14} />}
				{passwordHint(value.length)}
			</p>
		</div>
	);
}

// The set-password form behind every emailed link for an unverified account (/masuk/atur-sandi, owner
// decision 2026-10-25: "Buat kata sandi" activates the account). The link proves the email; the password
// created here is the account's first usable one (public sign-up stores a random one nobody knows) and
// onPasswordReset verifies the email. The token arrives in the URL from Better Auth's redirect; with JS it is
// dropped from the address bar at once (the page also sends no Referer). With JS, success signs the buyer
// in with the new password and returns them to `next`.
export function SetPasswordForm({ token, activation, email, next, error: initialError }: {
	token: string; activation: boolean; email: string | null; next: string | null; error: { kind: SignUpFailure | "token"; retry: number | null } | null;
}) {
	const [password, setPassword] = useState("");
	const [error, setError] = useState<Notice | null>(initialError ? (initialError.kind === "token" ? { message: TOKEN_MESSAGE, field: null } : notice(initialError.kind, initialError.retry)) : null);
	const [pending, setPending] = useState(false);
	const [done, setDone] = useState(false);
	const alertRef = useRef<HTMLDivElement>(null);
	const doneRef = useRef<HTMLHeadingElement>(null);
	const shown = useRef(error);

	useEffect(() => {
		const url = new URL(window.location.href);
		if (url.searchParams.has("token")) {
			url.searchParams.delete("token");
			window.history.replaceState(window.history.state, "", url.pathname + url.search);
		}
	}, []);
	useEffect(() => {
		if (error && error !== shown.current) alertRef.current?.focus();
	}, [error]);
	useEffect(() => {
		if (done) doneRef.current?.focus();
	}, [done]);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (password.length < PASSWORD_MIN) return setError(notice("password"));
		setPending(true);
		setError(null);
		const result = await post("/reset-password", { token, newPassword: password });
		if (result.status === 200) {
			// The account is active now; sign in with what was just typed (a full load lets /masuk route the session).
			if (email && (await post("/sign-in/email", { email, password })).status === 200) return window.location.assign(signInHref(next));
			setPending(false);
			return setDone(true);
		}
		setPending(false);
		const kind = signUpFailureKind(result.status, result.payload?.code);
		setError(result.status === 400 && kind === "input" ? { message: TOKEN_MESSAGE, field: null } : notice(kind, result.retry));
	}

	if (done) return <PasswordDone activation={activation} next={next} headingRef={doneRef} />;
	return (
		<div className="signin-card" data-testid="set-password">
			<form className="signin-forms" method="post" action="/masuk/kirim" onSubmit={submit} noValidate aria-labelledby="set-password-heading">
				<input type="hidden" name="step" value="reset" />
				<input type="hidden" name="token" value={token} />
				{activation && <input type="hidden" name="aktivasi" value="1" />}
				{next && <input type="hidden" name="next" value={next} />}
				{/* Lets a password manager store the new password under the right account. */}
				{email && <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />}
				<span className="brand signin-mark" aria-hidden="true"><Wordmark /></span>
				<h1 id="set-password-heading">{activation ? "Buat kata sandi" : "Atur kata sandi baru"}</h1>
				<p className="signin-lead">
					{activation ? "Satu langkah lagi untuk mengaktifkan akun" : "Kata sandi baru untuk akun"}
					{email ? <> <strong className="signin-address">{email}</strong>.</> : "."}
					{activation ? "" : " Semua sesi yang masih masuk akan keluar."}
				</p>
				<PasswordField id="set-password" label="Kata sandi" value={password} onChange={setPassword} invalid={error?.field === "password" || undefined} errorId={error?.field === "password" ? "set-password-error" : undefined} />
				{error && (
					<div ref={alertRef} tabIndex={-1} className="signin-alert" role="alert" id="set-password-error" data-testid="set-password-error">
						<Icon name="alert" size={16} />
						<p>{error.message}</p>
					</div>
				)}
				<button className="button signin-submit" type="submit" disabled={pending}>{pending ? "Menyimpan…" : activation ? "Buat kata sandi" : "Simpan kata sandi"}</button>
			</form>
			{error?.message === TOKEN_MESSAGE && <ResendForm next={next} email={null} />}
		</div>
	);
}
const TOKEN_MESSAGE = "Tautan ini sudah dipakai atau kedaluwarsa. Minta tautan baru di bawah.";

// After the password is stored without an automatic sign-in (no JS, or the sign-in was refused).
export function PasswordDone({ activation, next, headingRef }: { activation: boolean; next: string | null; headingRef?: React.Ref<HTMLHeadingElement> }) {
	return (
		<div className="signin-card" data-testid="set-password-done">
			<span className="brand signin-mark" aria-hidden="true"><Wordmark /></span>
			<span className="signin-sent-icon" aria-hidden="true"><Icon name="check" size={28} /></span>
			<h1 ref={headingRef} tabIndex={-1}>{activation ? "Akun sudah aktif" : "Kata sandi tersimpan"}</h1>
			<p className="signin-lead">Masuk dengan email dan kata sandi baru Anda.</p>
			<a className="button signin-submit" href={signInHref(next)}>Masuk</a>
		</div>
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
		const result = await post("/send-verification-email", { email: address, callbackURL: activationCallback(next) });
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
				<p className="signin-status" role="status" data-testid="resend-status"><Icon name="check" size={16} />Jika alamat ini menunggu verifikasi, kami mengirim tautan untuk mengatur kata sandi dan mengaktifkan akun.</p>
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
