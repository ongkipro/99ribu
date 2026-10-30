import { AuthFrame } from "../../../components/storefront/auth-frame";
import { SignInPanel } from "../../../components/storefront/sign-in-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Masuk", robots: { index: false, follow: false } };

// The dedicated page: deep links, password managers, staff TOTP and no-JS. Storefront links open the same
// content as a modal over the current page (@modal/(.)masuk) on client navigation.
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
	return (
		<AuthFrame>
			<SignInPanel params={await searchParams} />
		</AuthFrame>
	);
}
