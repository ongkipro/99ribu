import { redirect } from "next/navigation";
import { AuthFrame } from "../../../components/storefront/auth-frame";
import { SignInPanel } from "../../../components/storefront/sign-in-panel";
import { isAdminPath, safeReturnPath } from "../../../modules/access/return-to";

export const dynamic = "force-dynamic";
export const metadata = { title: "Masuk", robots: { index: false, follow: false } };

// The dedicated page: deep links, password managers, staff TOTP and no-JS. Storefront links open the same
// content as a modal over the current page (@modal/(.)masuk) on client navigation.
// A console `next` (old links and bookmarks) belongs to the staff door: /portal, with the same query.
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
	const params = await searchParams;
	const next = safeReturnPath(params.next);
	if (next && isAdminPath(next)) {
		const query = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) if (typeof value === "string") query.set(key, value);
		redirect(`/portal?${query}`);
	}
	return (
		<AuthFrame>
			<SignInPanel params={params} />
		</AuthFrame>
	);
}
