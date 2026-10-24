import { Shell } from "../../../../components/storefront/shell";
import { SIGN_UP_FAILURES, type SignUpFailure, signInHref } from "../../../../components/storefront/sign-in-copy";
import { PasswordDone, ResendForm, SetPasswordForm } from "../../../../components/storefront/sign-up-form";
import { Wordmark } from "../../../../components/storefront/ui/brand";
import { Icon } from "../../../../components/storefront/ui/icon";
import { getLocalAuth } from "../../../../modules/access/auth";
import { safeReturnPath } from "../../../../modules/access/return-to";

export const dynamic = "force-dynamic";
// The emailed token sits in this page's URL (Better Auth's redirect): never send it on as a Referer.
export const metadata = { title: "Buat kata sandi", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

// The account a live set-password token belongs to (read-only; the token holder controls that inbox).
async function tokenEmail(token: string) {
	const context = await getLocalAuth().auth.$context;
	const row = await context.internalAdapter.findVerificationValue(`reset-password:${token}`);
	if (!row || row.expiresAt < new Date()) return null;
	return (await context.internalAdapter.findUserById(row.value))?.email ?? null;
}

// S123: where every set-password link lands (GET /api/auth/reset-password/<token> redirects here with
// `token`, or `error=INVALID_TOKEN`). `aktivasi=1` marks the link sent by sign-up and resend: creating the
// password activates the account (auth.ts onPasswordReset) and, with JS, signs in and returns to `next`.
// No-JS posts come back from /masuk/kirim with `galat`/`tunggu` (token kept) or `selesai=1`.
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
	const params = await searchParams;
	const next = safeReturnPath(params.next);
	const activation = params.aktivasi === "1";
	const token = typeof params.token === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(params.token) ? params.token : null;
	const email = token && params.error === undefined ? await tokenEmail(token) : null;
	const galat = params.galat, wait = Number(params.tunggu);
	let body: React.ReactNode;
	if (params.selesai === "1") body = <PasswordDone activation={activation} next={next} />;
	else if (!token || !email) {
		body = (
			<section className="signin-card" aria-labelledby="set-password-invalid-heading" data-testid="set-password-invalid">
				<span className="brand signin-mark" aria-hidden="true"><Wordmark /></span>
				<span className="signin-sent-icon" data-state="invalid" aria-hidden="true"><Icon name="alert" size={28} /></span>
				<h1 id="set-password-invalid-heading">Tautan tidak berlaku</h1>
				<p className="signin-lead">Tautan ini sudah dipakai, kedaluwarsa (30 menit), atau terpotong saat disalin. Masukkan email pendaftaran untuk menerima tautan baru.</p>
				<ResendForm next={next} email={null} />
				<p className="signin-links"><a href={signInHref(next)}>Sudah membuat kata sandi? Masuk</a></p>
			</section>
		);
	} else {
		const error = galat === "token" ? { kind: "token" as const, retry: null }
			: SIGN_UP_FAILURES.includes(galat as SignUpFailure) ? { kind: galat as SignUpFailure, retry: wait > 0 ? wait : null } : null;
		body = <SetPasswordForm token={token} activation={activation} email={email} next={next} error={error} />;
	}
	return (
		<Shell active="account">
			<main id="main" className="wrap signin-main">{body}</main>
		</Shell>
	);
}
