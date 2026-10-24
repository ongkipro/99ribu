import { Shell } from "../../../../components/storefront/shell";
import { signInHref } from "../../../../components/storefront/sign-in-copy";
import { ResendForm } from "../../../../components/storefront/sign-up-form";
import { Wordmark } from "../../../../components/storefront/ui/brand";
import { Icon } from "../../../../components/storefront/ui/icon";
import { safeReturnPath } from "../../../../modules/access/return-to";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verifikasi email", robots: { index: false, follow: false } };

// S123: where the email verification link lands. Better Auth (GET /api/auth/verify-email) marks the
// email verified and redirects here; a bad link comes back with `error=TOKEN_EXPIRED|INVALID_TOKEN|
// USER_NOT_FOUND`. autoSignInAfterVerification stays off, so the buyer signs in next and `next` carries
// them back to the page they registered from. "Masuk" is a full navigation to the /masuk page (not the
// modal), so the role redirect after sign-in decides the destination.
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
	const params = await searchParams;
	const next = safeReturnPath(params.next);
	const state = params.error === undefined ? "verified" : params.error === "TOKEN_EXPIRED" ? "expired" : "invalid";
	const copy = {
		verified: { title: "Email terverifikasi", lead: "Akun sudah aktif. Masuk dengan email dan kata sandi yang didaftarkan untuk melanjutkan." },
		expired: { title: "Tautan verifikasi kedaluwarsa", lead: "Tautan hanya berlaku 30 menit. Masukkan email pendaftaran untuk menerima tautan baru." },
		invalid: { title: "Tautan verifikasi tidak valid", lead: "Tautan mungkin terpotong saat disalin atau sudah diganti. Buka lagi dari email, atau minta tautan baru." },
	}[state];
	return (
		<Shell active="account">
			<main id="main" className="wrap signin-main">
				<section className="signin-card" aria-labelledby="verify-heading" data-testid="verify-landing" data-state={state}>
					<span className="brand signin-mark" aria-hidden="true"><Wordmark /></span>
					<span className="signin-sent-icon" data-state={state} aria-hidden="true"><Icon name={state === "verified" ? "check" : "alert"} size={28} /></span>
					<h1 id="verify-heading">{copy.title}</h1>
					<p className="signin-lead">{copy.lead}</p>
					{state === "verified" ? (
						<a className="button signin-submit" href={signInHref(next)}>Masuk</a>
					) : (
						<>
							<ResendForm next={next} email={null} />
							<p className="signin-links"><a href={signInHref(next)}>Sudah verifikasi? Masuk</a></p>
						</>
					)}
				</section>
			</main>
		</Shell>
	);
}
