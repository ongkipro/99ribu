import { redirect } from "next/navigation";
import { BuyerAccountClient } from "../../../components/storefront/buyer-account-client";
import { Shell } from "../../../components/storefront/shell";
import { loadAccount } from "./load";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Akun",
	robots: { index: false, follow: false },
};

// Signed in: the account opens on its orders (Shopify customer accounts pattern). Signed out:
// sign-in actions beside the guest order lookup.
export default async function AccountPage() {
	const { workspace } = await loadAccount("/akun", { orders: false, completion: false });
	if (workspace.authenticated) redirect("/akun/pesanan");
	return (
		<Shell active="account">
			<main id="main" className="wrap account-page">
				<BuyerAccountClient view="signed-out" initialAuthenticated={false} initialProfile={null} initialAddresses={null} initialPreferences={null} initialNotifications={[]} initialOrders={[]} />
			</main>
		</Shell>
	);
}
