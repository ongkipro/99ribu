import { redirect } from "next/navigation";
import { BuyerAccountClient } from "../../../../components/storefront/buyer-account-client";
import { Shell } from "../../../../components/storefront/shell";
import { loadAccount } from "../load";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pesanan saya",
	robots: { index: false, follow: false },
};

export default async function AccountOrdersPage() {
	const { workspace, completion } = await loadAccount("/akun/pesanan", { orders: true, completion: false });
	if (!workspace.authenticated) redirect(`/masuk?next=${encodeURIComponent("/akun/pesanan")}`);
	return (
		<Shell active="account">
			<main id="main" className="wrap account-page">
				<BuyerAccountClient
					view="orders"
					initialAuthenticated
					initialProfile={workspace.profile}
					initialAddresses={workspace.addresses}
					initialPreferences={workspace.preferences}
					initialNotifications={workspace.notifications}
					initialOrders={workspace.orders}
					initialCompletion={completion}
				/>
			</main>
		</Shell>
	);
}
