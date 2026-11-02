import Link from "next/link";

export type AccountView = "orders" | "returns" | "profile" | "settings";

// Short pages instead of one long one (Shopify customer accounts): plain links, the current
// page marked with aria-current, no script needed. "Bantuan" leaves the account for the support page.
const tabs: { view: AccountView; label: string; href: string }[] = [
	{ view: "orders", label: "Pesanan", href: "/akun/pesanan" },
	{ view: "returns", label: "Pengembalian", href: "/akun/pengembalian" },
	{ view: "profile", label: "Profil", href: "/akun/profil" },
	{ view: "settings", label: "Pengaturan", href: "/akun/pengaturan" },
];

export function AccountNavigation({ current }: { current: AccountView }) {
	return (
		<nav className="account-navigation" aria-label="Halaman akun">
			{tabs.map((tab) => (
				<Link key={tab.view} className="account-nav-link" href={tab.href} aria-current={tab.view === current ? "page" : undefined}>
					{tab.label}
				</Link>
			))}
			<Link className="account-nav-link account-nav-help" href="/bantuan">
				Bantuan
			</Link>
		</nav>
	);
}
