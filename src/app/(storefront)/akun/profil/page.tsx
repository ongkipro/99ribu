import { redirect } from "next/navigation";
import { BuyerAccountClient } from "../../../../components/storefront/buyer-account-client";
import { Shell } from "../../../../components/storefront/shell";
import { loadAccount } from "../load";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Profil",
	robots: { index: false, follow: false },
};

export default async function AccountProfilePage() {
	const { workspace, completion } = await loadAccount("/akun/profil", { orders: false, completion: true });
	if (!workspace.authenticated) redirect(`/masuk?next=${encodeURIComponent("/akun/profil")}`);
	return (
		<Shell active="account">
			<main id="main" className="wrap account-page">
				<BuyerAccountClient
					view="profile"
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
