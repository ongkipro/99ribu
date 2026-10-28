// S129: vocabulary and wire types of the staff profile (/admin/account) and account security
// (/admin/account/security). Display only; the APIs re-authorize every request. No "use client":
// the server pages and the client screen both read it.

export const ROLE_LABEL: Record<string, string> = {
	owner: "Super Admin",
	ecommerce_admin: "Admin E-Commerce",
	warehouse: "Gudang",
	customer_service: "Layanan Pelanggan",
	finance: "Keuangan",
};

const PERMISSION_LABEL: Record<string, string> = {
	"orders.history.read": "Riwayat pesanan",
	"finance.summary.read": "Ringkasan keuangan",
	"finance.costs.read": "Biaya dan HPP (lihat)",
	"finance.costs.write": "Biaya dan HPP (ubah)",
	"finance.reconciliation.read": "Rekonsiliasi (lihat)",
	"finance.reconciliation.write": "Rekonsiliasi (ubah)",
	"finance.refunds.read": "Refund (lihat)",
	"finance.refunds.write": "Refund (proses)",
	"exports.read": "Ekspor data (lihat)",
	"exports.download": "Ekspor data (unduh)",
	"shipping.labels.read": "Label pengiriman (lihat)",
	"shipping.labels.generate": "Label pengiriman (buat)",
	"shipping.labels.print": "Label pengiriman (cetak)",
};

export const roleLabel = (role: string) => ROLE_LABEL[role] ?? role;
export const permissionLabel = (permission: string) => PERMISSION_LABEL[permission] ?? permission;

/** Wire types of GET /api/auth/account-security: no session token, no session id, no secrets. */
export type { AccountSecurity, OwnSession } from "@/modules/access/account-security";
/** "Chrome di Windows" from a User-Agent header; the raw header is never shown. */
export function describeDevice(userAgent: string | null): string {
	if (!userAgent) return "Perangkat tidak dikenal";
	const browser = /Edg(?:e|A|iOS)?\//.test(userAgent)
		? "Edge"
		: /OPR\/|Opera/.test(userAgent)
			? "Opera"
			: /Firefox\/|FxiOS\//.test(userAgent)
				? "Firefox"
				: /Chrome\/|CriOS\//.test(userAgent)
					? "Chrome"
					: /Safari\//.test(userAgent)
						? "Safari"
						: null;
	const system = /Android/.test(userAgent)
		? "Android"
		: /iPhone|iPad|iPod/.test(userAgent)
			? "iOS"
			: /Windows/.test(userAgent)
				? "Windows"
				: /Mac OS X|Macintosh/.test(userAgent)
					? "macOS"
					: /Linux|X11/.test(userAgent)
						? "Linux"
						: null;
	if (browser && system) return `${browser} di ${system}`;
	return browser ?? system ?? "Perangkat tidak dikenal";
}

/** Messages for the codes the account-security calls can return. Unlisted codes use the shared text. */
export const SECURITY_MESSAGES: Record<string, string> = {
	INVALID_PASSWORD: "Kata sandi saat ini salah.",
	REAUTHENTICATION_REQUIRED: "Kata sandi salah atau konfirmasinya kedaluwarsa. Coba lagi.",
	PASSWORD_TOO_SHORT: "Kata sandi baru minimal 12 karakter.",
	PASSWORD_TOO_LONG: "Kata sandi baru maksimal 128 karakter.",
	PASSWORD_UNCHANGED: "Kata sandi baru harus berbeda dari yang sekarang.",
	RATE_LIMITED: "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.",
	MFA_REQUIRED: "Verifikasi dua langkah belum selesai di sesi ini. Keluar lalu masuk kembali.",
	TWO_FACTOR_NOT_ENABLED: "Verifikasi dua langkah belum aktif di akun ini.",
	SESSION_REPLACEMENT_FAILED: "Kata sandi sudah diganti, tetapi sesi baru belum siap. Masuk kembali dengan kata sandi baru.",
};
