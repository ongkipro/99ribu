import { Shell } from "../../../../components/storefront/shell";
import { SIGN_UP_FAILURES, type SignUpFailure, signInHref } from "../../../../components/storefront/sign-in-copy";
import { ResendForm, SetPasswordForm } from "../../../../components/storefront/sign-up-form";
import { Wordmark } from "../../../../components/storefront/ui/brand";
import { Icon } from "../../../../components/storefront/ui/icon";

export const dynamic = "force-dynamic";
// The emailed token sits in this page's URL (Better Auth's redirect): never send it on as a Referer.
export const metadata = { title: "Atur kata sandi", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

// S123 review M1: where a set-password link lands (GET /api/auth/reset-password/<token> redirects here with
// `token`, or `error=INVALID_TOKEN`). `aktivasi=1` marks the link sent for an unverified account on a
// repeated sign-up or a resend; setting the password verifies the email (auth.ts onPasswordReset). No-JS
// posts come back from /masuk/kirim with `galat`/`tunggu` (token kept) or `selesai=1`.
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
	const params = await searchParams;
	const token = typeof params.token === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(params.token) ? params.token : null;
	const activation = params.aktivasi === "1";
	const galat = params.galat, wait = Number(params.tunggu);
	let body: React.ReactNode;
	if (params.selesai === "1") {
		body = (
			<section className="signin-card" aria-labelledby="set-password-done-heading" data-testid="set-password-done">
				<span className="brand signin-mark" aria-hidden="true"><Wordmark /></span>
				<span className="signin-sent-icon" aria-hidden="true"><Icon name="check" size={28} /></span>
				<h1 id="set-password-done-heading">{activation ? "Akun sudah aktif" : "Kata sandi tersimpan"}</h1>
				<p className="signin-lead">Masuk dengan email dan kata sandi baru Anda.</p>
				<a className="button signin-submit" href={signInHref(null)}>Masuk</a>
			</section>
		);
	} else if (!token || params.error !== undefined) {
		body = (
			<section className="signin-card" aria-labelledby="set-password-invalid-heading" data-testid="set-password-invalid">
				<span className="brand signin-mark" aria-hidden="true"><Wordmark /></span>
				<span className="signin-sent-icon" data-state="invalid" aria-hidden="true"><Icon name="alert" size={28} /></span>
				<h1 id="set-password-invalid-heading">Tautan tidak berlaku</h1>
				<p className="signin-lead">Tautan ini sudah dipakai, kedaluwarsa (30 menit), atau terpotong saat disalin. Masukkan email pendaftaran untuk menerima tautan baru.</p>
				<ResendForm next={null} email={null} />
				<p className="signin-links"><a href={signInHref(null)}>Masuk</a></p>
			</section>
		);
	} else {
		const error = galat === "token" ? { kind: "token" as const, retry: null }
			: SIGN_UP_FAILURES.includes(galat as SignUpFailure) ? { kind: galat as SignUpFailure, retry: wait > 0 ? wait : null } : null;
		body = <SetPasswordForm token={token} activation={activation} error={error} />;
	}
	return (
		<Shell active="account">
			<main id="main" className="wrap signin-main">{body}</main>
		</Shell>
	);
}
