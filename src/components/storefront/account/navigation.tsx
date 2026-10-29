import Link from "next/link";

export type AccountView = "orders" | "profile" | "settings";

// Three short pages instead of one long one (Shopify customer accounts): plain links, the current
// page marked with aria-current, no script needed.
const tabs: { view: AccountView; label: string; href: string }[] = [
	{ view: "orders", label: "Pesanan", href: "/akun/pesanan" },
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
		</nav>
	);
}
