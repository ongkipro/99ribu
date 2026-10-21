import Link from "next/link";
import { BuyerAccountClient } from "../../../components/storefront/buyer-account-client";
import { Shell } from "../../../components/storefront/shell";
import { getLocalAuth } from "../../../modules/access/auth";
import { readBuyerAccountWorkspace } from "../../../modules/accounts/service";
import { storefrontRequest } from "../../../modules/storefront/browser";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Akun",
	robots: { index: false, follow: false },
};

export default async function AccountPage() {
	const req = await storefrontRequest("GET", "/account");
	const identity = getLocalAuth();
	const workspace = await readBuyerAccountWorkspace(req, identity);
	return (
		<Shell active="account">
			<main id="main" className="wrap">
				<section className="notice-panel">
					<h1>
						{workspace.authenticated
							? `Akun ${workspace.profile.display_name}`
							: "Akun opsional"}
					</h1>
					<p>
						Belanja Rp99.000 per pilihan tetap bisa dilakukan tanpa membuat
						akun. Status pengiriman dan pembayaran selalu mengikuti tautan tanda
						terima pesanan Anda.
					</p>
					<div className="notice-actions">
						<Link className="button" href="/">
							Belanja produk
						</Link>
						<Link className="button button-secondary" href="/help">
							Bantuan pesanan
						</Link>
					</div>
				</section>
				<BuyerAccountClient
					initialAuthenticated={workspace.authenticated}
					initialProfile={workspace.profile}
					initialAddresses={workspace.addresses}
					initialPreferences={workspace.preferences}
					initialNotifications={workspace.notifications}
					initialOrders={workspace.orders}
				/>
			</main>
		</Shell>
	);
}
