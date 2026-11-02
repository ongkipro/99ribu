import { redirect } from "next/navigation";
import { BuyerAccountClient } from "../../../../components/storefront/buyer-account-client";
import { Shell } from "../../../../components/storefront/shell";
import { loadAccount } from "../load";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pengembalian",
	robots: { index: false, follow: false },
};

const CURSOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AccountReturnsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
	const raw = (await searchParams).kursor;
	const value = Array.isArray(raw) ? raw[0] : raw;
	const returnsCursor = value && CURSOR.test(value) ? value.toLowerCase() : null;
	const { workspace } = await loadAccount("/akun/pengembalian", { orders: false, completion: false, returns: true, returnsCursor });
	if (!workspace.authenticated) redirect(`/masuk?next=${encodeURIComponent("/akun/pengembalian")}`);
	return (
		<Shell active="account">
			<main id="main" className="wrap account-page">
				<BuyerAccountClient
					view="returns"
					initialAuthenticated
					initialProfile={workspace.profile}
					initialAddresses={workspace.addresses}
					initialPreferences={workspace.preferences}
					initialNotifications={workspace.notifications}
					initialOrders={workspace.orders}
					initialReturns={workspace.returns}
					returnsCursor={returnsCursor}
				/>
			</main>
		</Shell>
	);
}
