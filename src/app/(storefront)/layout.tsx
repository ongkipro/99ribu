// Storefront pages plus the @modal slot: /masuk opened by client navigation renders there as a modal over
// the current page (@modal/(.)masuk); every other route leaves the slot empty. No wrapper element, so each
// page's Shell stays a direct child of <body> (the CSS keys on `body > .store-header`).
export default function StorefrontLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
	return <>{children}{modal}</>;
}
