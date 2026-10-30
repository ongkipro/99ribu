import { redirect } from "next/navigation";
import { BuyerAccountClient } from "../../../components/storefront/buyer-account-client";
import { AuthFrame } from "../../../components/storefront/auth-frame";
import { SignInPanel } from "../../../components/storefront/sign-in-panel";
import { loadAccount } from "./load";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Akun",
	robots: { index: false, follow: false },
};

// Signed in: the account opens on its orders (Shopify customer accounts pattern). Signed out (owner
// 2026-10-29; focused frame without store chrome 2026-10-30): one centred column with the same sign-in/sign-up forms as /masuk (`?langkah=daftar` opens
// sign-up), returning to /akun, then the guest order lookup.
export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
	const { workspace } = await loadAccount("/akun", { orders: false, completion: false });
	if (workspace.authenticated) redirect("/akun/pesanan");
	const params = await searchParams;
	return (
		<AuthFrame>
			<div className="account-page">
				<BuyerAccountClient view="signed-out" initialAuthenticated={false} initialProfile={null} initialAddresses={null} initialPreferences={null} initialNotifications={[]} initialOrders={[]} entry={<SignInPanel params={{ langkah: params.langkah, next: "/akun" }} />} />
			</div>
		</AuthFrame>
	);
}
