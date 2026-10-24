import Link from "next/link";
import { BuyerAccountClient } from "../../../components/storefront/buyer-account-client";
import { Shell } from "../../../components/storefront/shell";
import { SignOutButton } from "../../../components/storefront/sign-out-button";
import { getLocalAuth } from "../../../modules/access/auth";
import { readBuyerAccountWorkspace } from "../../../modules/accounts/service";
import { storefrontRequest } from "../../../modules/storefront/browser";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Akun",
	robots: { index: false, follow: false },
};

export default async function AccountPage() {
	const req = await storefrontRequest("GET", "/akun");
	const identity = getLocalAuth();
	const workspace = await readBuyerAccountWorkspace(req, identity);
	return (
		<Shell active="account">
			<main id="main" className="wrap" style={{ paddingTop: "24px" }}>
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
					{!workspace.authenticated && (
						<p data-testid="account-signup-value">
							Dengan akun: lacak pesanan dari halaman ini, simpan alamat untuk
							belanja berikutnya, dan lihat riwayat belanja.
						</p>
					)}
					{workspace.authenticated ? (
						<div className="notice-actions">
							<Link className="button" href="/">
								Belanja produk
							</Link>
							<Link className="button button-secondary" href="/bantuan">
								Bantuan pesanan
							</Link>
							<SignOutButton to="/" />
						</div>
					) : (
						// S123: signed out, the account actions lead; Daftar opens the sign-up modal.
						<div className="notice-actions">
							<Link
								className="button"
								href="/masuk?langkah=daftar&next=%2Fakun"
							>
								Daftar
							</Link>
							<Link
								className="button button-secondary"
								href="/masuk?next=%2Fakun"
							>
								Masuk
							</Link>
							<Link className="button button-secondary" href="/">
								Belanja produk
							</Link>
							<Link className="button button-secondary" href="/bantuan">
								Bantuan pesanan
							</Link>
						</div>
					)}
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
