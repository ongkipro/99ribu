import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocalAuth } from "../../modules/access/auth";
import { AccessError, getPrincipal, isStaff } from "../../modules/access/policy";
import { isAdminPath, safeReturnPath, signInDestination } from "../../modules/access/return-to";
import { storefrontRequest } from "../../modules/storefront/browser";
import { codeInput, failureMessage, type SignInFailure, signInHref, stepFromParam } from "./sign-in-copy";
import { SignInForm, type SignInError } from "./sign-in-form";
import { SignOutButton } from "./sign-out-button";
import { Wordmark } from "./ui/brand";

type Params = { [key: string]: string | string[] | undefined };
const FAILURES: SignInFailure[] = ["origin", "limit", "disabled", "network", "credential"];

// The sign-in content of /masuk, shared by the page and the intercepted modal (@modal/(.)masuk). A signed-in
// visitor is routed by role; a buyer asked for the console and a staff account without MFA see why not.
// `galat`/`tunggu`/`langkah` come back from the no-JS form post (masuk/kirim/route.ts).
export async function SignInPanel({ params, modal = false }: { params: Params; modal?: boolean }) {
	const next = safeReturnPath(params.next);
	let state: "signed-out" | "mfa-required" | { staff: boolean };
	try {
		state = { staff: isStaff(await getPrincipal(await storefrontRequest("GET", "/masuk"), getLocalAuth())) };
	} catch (error) {
		if (!(error instanceof AccessError)) throw error;
		state = error.code === "MFA_REQUIRED" ? "mfa-required" : "signed-out";
	}
	const switchAccount = typeof state === "object" && !state.staff && next !== null && isAdminPath(next);
	if (typeof state === "object" && !switchAccount) redirect(signInDestination(next, state.staff));

	if (state === "signed-out") {
		const step = stepFromParam(params.langkah), galat = params.galat, wait = Number(params.tunggu);
		const error: SignInError | null =
			galat === "kosong" ? { message: "Isi email dan kata sandi.", field: "email" }
			: galat === "format" ? { message: codeInput(step, "").error ?? "", field: "code" }
			: FAILURES.includes(galat as SignInFailure) ? { message: failureMessage(galat as SignInFailure, step, wait > 0 ? wait : null), field: galat === "credential" ? (step === "password" ? "password" : "code") : null }
			: null;
		return <SignInForm next={next} step={step} error={error} modal={modal} />;
	}
	const Heading = modal ? "h2" : "h1";
	return (
		<section className="signin-card" aria-labelledby="signin-switch-heading" data-testid="signin-switch">
			<span className="brand signin-mark" aria-hidden="true"><Wordmark /></span>
			<Heading id="signin-switch-heading">{state === "mfa-required" ? "Verifikasi dua langkah belum aktif" : "Masuk dengan akun staf"}</Heading>
			<p className="signin-lead">
				{state === "mfa-required"
					? "Akun staf wajib memakai verifikasi dua langkah sebelum membuka halaman operasional. Minta pemilik toko mengaktifkannya, lalu masuk kembali."
					: "Anda sedang masuk dengan akun pembeli. Keluar terlebih dahulu untuk masuk dengan akun staf."}
			</p>
			<SignOutButton className="button signin-submit" to={signInHref(next)} />
			<p className="signin-hint"><Link href="/">Kembali ke toko</Link></p>
		</section>
	);
}
