// S137: vocabulary and rules of the staff & roles screen (/admin/settings/staff). Display only; the grant API
// re-checks every rule. No "use client": the server page and the client screen both read it. Role and permission
// names come from the central lists in policy.ts, so a new permission shows up here as "Lainnya" until it is grouped.
import { type Permission, permissions, staffRoles } from "@/modules/access/policy";

export type { StaffMember, StaffPage } from "@/modules/access/staff";

export const GRANTABLE_ROLES: readonly string[] = staffRoles;

export const ROLE_HINT: Record<string, string> = {
	ecommerce_admin: "Katalog, stok, promosi, dan pesanan di gudang yang dipilih.",
	warehouse: "Pengiriman dan stok di gudang yang dipilih. Gudang wajib dipilih.",
	customer_service: "Pesanan, retur, dan obrolan pembeli.",
	finance: "Pembayaran dan keuangan. Izin keuangan dipilih di bawah.",
};

type PermissionGroup = {
	id: string;
	title: string;
	/** When the group's grants only take effect with a role. */
	hint: string;
	/** The server refuses these without the finance role (role_grant_finance_check). */
	needsFinance?: true;
	items: readonly Permission[];
};

const GROUPS: readonly PermissionGroup[] = [
	{
		id: "orders",
		title: "Pesanan",
		hint: "Berlaku untuk Admin E-Commerce, Layanan Pelanggan, dan Keuangan.",
		items: ["orders.history.read"],
	},
	{
		id: "finance",
		title: "Keuangan",
		hint: "Hanya bersama peran Keuangan.",
		needsFinance: true,
		items: [
			"finance.summary.read",
			"finance.costs.read",
			"finance.costs.write",
			"finance.reconciliation.read",
			"finance.reconciliation.write",
			"finance.refunds.read",
			"finance.refunds.write",
		],
	},
	{
		id: "exports",
		title: "Ekspor data",
		hint: "Berlaku untuk semua peran staf.",
		items: ["exports.read", "exports.download"],
	},
	{
		id: "labels",
		title: "Label pengiriman",
		hint: "Berlaku untuk Gudang dan Admin E-Commerce.",
		items: ["shipping.labels.read", "shipping.labels.generate", "shipping.labels.print"],
	},
];

/** Every permission of the central list appears in exactly one group; an ungrouped one lands in "Lainnya". */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = (() => {
	const grouped = new Set(GROUPS.flatMap((group) => group.items));
	const rest = permissions.filter((permission) => !grouped.has(permission));
	return rest.length
		? [...GROUPS, { id: "other", title: "Lainnya", hint: "Berlaku sesuai kebijakan akses.", items: rest }]
		: GROUPS;
})();

export const isFinancePermission = (permission: string) => permission.startsWith("finance.");

/** The grant API's own refusals, caught before a password is asked for. */
export function grantProblem(roles: readonly string[], granted: readonly string[], warehouseIds: readonly string[]) {
	if (roles.includes("warehouse") && warehouseIds.length === 0)
		return "Peran Gudang membutuhkan minimal satu gudang. Pilih gudangnya.";
	if (!roles.includes("finance") && granted.some(isFinancePermission))
		return "Izin keuangan hanya bisa diberikan bersama peran Keuangan.";
	return null;
}

export const STAFF_MESSAGES: Record<string, string> = {
	VERSION_CONFLICT: "Data staf ini sudah berubah di tempat lain. Tutup dialog, muat ulang daftar, lalu ulangi.",
	LAST_OWNER:
		"Ini Super Admin terakhir dengan verifikasi dua langkah aktif. Pastikan ada Super Admin lain yang aktif sebelum menurunkan akun ini.",
	REAUTHENTICATION_REQUIRED: "Kata sandi salah atau konfirmasi kedaluwarsa. Periksa kata sandi lalu coba lagi.",
	FRESH_MFA_REQUIRED:
		"Verifikasi dua langkah Anda lebih dari 5 menit lalu. Keluar, masuk lagi dengan kode autentikator, lalu ulangi.",
	RATE_LIMITED: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
	INVALID_WAREHOUSE_SCOPE: "Salah satu gudang sudah tidak aktif. Tutup dialog, muat ulang, lalu pilih ulang gudangnya.",
	INVALID_INPUT: "Isian belum valid. Periksa peran, gudang, dan alasan.",
	NOT_FOUND: "Akun ini tidak ditemukan atau bukan staf lagi. Muat ulang daftar.",
};
