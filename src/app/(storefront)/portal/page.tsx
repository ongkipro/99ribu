import { AuthFrame } from "../../../components/storefront/auth-frame";
import { SignInPanel } from "../../../components/storefront/sign-in-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portal staf", robots: { index: false, follow: false } };

// Owner and staff sign-in (owner 2026-10-30): sign-in only, no sign-up and no link into the shop. Staff
// accounts are created by the owner in the console; buyers sign in on /akun (and the /masuk modal).
export default async function PortalPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
	return (
		<AuthFrame back={false}>
			<SignInPanel params={await searchParams} portal />
		</AuthFrame>
	);
}
