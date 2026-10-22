import { redirect } from "next/navigation";
import { SignInForm } from "../../../components/storefront/sign-in-form";
import { SignOutButton } from "../../../components/storefront/sign-out-button";
import { Shell } from "../../../components/storefront/shell";
import { getLocalAuth } from "../../../modules/access/auth";
import { AccessError, getPrincipal, isStaff } from "../../../modules/access/policy";
import { isAdminPath, safeReturnPath, signInDestination } from "../../../modules/access/return-to";
import { storefrontRequest } from "../../../modules/storefront/browser";

export const dynamic = "force-dynamic";
export const metadata = { title: "Masuk", robots: { index: false, follow: false } };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
	const next = safeReturnPath((await searchParams).next);
	let state: "signed-out" | "mfa-required" | { staff: boolean };
	try {
		state = { staff: isStaff(await getPrincipal(await storefrontRequest("GET", "/masuk"), getLocalAuth())) };
	} catch (error) {
		if (!(error instanceof AccessError)) throw error;
		state = error.code === "MFA_REQUIRED" ? "mfa-required" : "signed-out";
	}
	const switchAccount = typeof state === "object" && !state.staff && next !== null && isAdminPath(next);
	if (typeof state === "object" && !switchAccount) redirect(signInDestination(next, state.staff));
	const here = next ? `/masuk?next=${encodeURIComponent(next)}` : "/masuk";

	return (
		<Shell active="account">
			<main id="main" className="wrap signin-main">
				{state === "signed-out" ? (
					<SignInForm next={next} />
				) : (
					<section className="signin-card" aria-labelledby="signin-switch-heading" data-testid="signin-switch">
						<h1 id="signin-switch-heading">
							{state === "mfa-required" ? "Verifikasi dua langkah belum aktif" : "Masuk dengan akun staf"}
						</h1>
						<p className="signin-lead">
							{state === "mfa-required"
								? "Akun staf wajib memakai verifikasi dua langkah sebelum membuka halaman operasional. Minta pemilik toko mengaktifkannya, lalu masuk kembali."
								: "Anda sedang masuk dengan akun pembeli. Keluar terlebih dahulu untuk masuk dengan akun staf."}
						</p>
						<div className="signin-actions">
							<SignOutButton className="button" to={here} />
							<a className="button button-secondary" href="/">Kembali ke toko</a>
						</div>
					</section>
				)}
			</main>
		</Shell>
	);
}
