import { AccessDenied } from "../../../../../components/admin/access-denied";
import {
	AdminPage,
	DetailSection,
	PageHeader,
} from "../../../../../components/admin/page-blocks";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../../../../../components/ui/table";
import { getLocalAuth } from "../../../../../modules/access/auth";
import { getPrincipal } from "../../../../../modules/access/policy";
import {
	type BuyerSegmentsResponse,
	readBuyerSegments,
} from "../../../../../modules/accounts/profile-completion";
import { storefrontRequest } from "../../../../../modules/storefront/browser";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Segmen Pembeli · Admin 99ribu",
	robots: { index: false, follow: false },
};

const MONTHS = [
	"Januari",
	"Februari",
	"Maret",
	"April",
	"Mei",
	"Juni",
	"Juli",
	"Agustus",
	"September",
	"Oktober",
	"November",
	"Desember",
];
const PROGRAM: Record<
	BuyerSegmentsResponse["programs"][number]["key"],
	[string, string]
> = {
	birthday_voucher: [
		"Voucher ulang tahun",
		"Ketentuan (nilai, masa berlaku, satu per tahun) menunggu keputusan pemilik (S127).",
	],
	category_promo: [
		"Promo kategori",
		"Jadwal dan ketentuan menunggu keputusan pemilik (S127).",
	],
	doorprize: [
		"Doorprize",
		"Segera. Tanpa pendaftaran atau undian sampai izin undian Kemensos ada (S127).",
	],
};
const count = (n: number) => new Intl.NumberFormat("id-ID").format(n);

function CountTable({
	label,
	rows,
}: {
	label: string;
	rows: { key: string; name: string; count: number }[];
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>{label}</TableHead>
					<TableHead className="text-right">Pembeli</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((row) => (
					<TableRow key={row.key}>
						<TableCell>{row.name}</TableCell>
						<TableCell className="text-right tabular-nums">
							{count(row.count)}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

// S126 / DEC-017: aggregate counts only. No list, contact, birthday or export of individual buyers; the read
// re-checks owner / e-commerce admin with MFA (the role check below only chooses the screen).
export default async function BuyerSegmentsPage() {
	const { roles } = await readStaffAccess();
	const identity = getLocalAuth();
	const data = roles.some(
		(role) => role === "owner" || role === "ecommerce_admin",
	)
		? await storefrontRequest("GET", "/admin/pelanggan/segmen")
				.then((request) => getPrincipal(request, identity))
				.then((principal) => readBuyerSegments(identity, principal))
				.catch(() => null)
		: null;
	if (!data)
		return (
			<AccessDenied title="Segmen Pembeli" heading="Akses pemasaran diperlukan">
				Jumlah segmen pembeli dibuka untuk Super Admin dan Admin E-Commerce
				dengan verifikasi dua langkah (MFA) aktif.
			</AccessDenied>
		);
	const asOf = new Intl.DateTimeFormat("id-ID", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Asia/Jakarta",
	}).format(new Date(data.as_of));
	return (
		<AdminPage testId="buyer-segments-page">
			<PageHeader
				title="Segmen Pembeli"
				description="Jumlah pembeli per bulan lahir, kategori favorit, dan saluran promo yang disetujui. Hanya angka: tidak ada daftar, kontak, atau unduhan per pembeli."
				meta={
					<span>
						Per {asOf} WIB · {count(data.profiles)} profil dengan data tambahan
					</span>
				}
			/>
			<div className="grid gap-4 md:grid-cols-2">
				<DetailSection
					id="segment-consent"
					title="Setuju menerima promo"
					description="Persetujuan aktif dan kontaknya masih ada di profil."
					testId="segment-consent"
				>
					<CountTable
						label="Saluran"
						rows={data.consent_channels.map((row) => ({
							key: row.channel,
							name: row.channel === "whatsapp" ? "WhatsApp" : "Email",
							count: row.count,
						}))}
					/>
				</DetailSection>
				<DetailSection
					id="segment-programs"
					title="Program"
					description="Belum ada yang diterbitkan sampai ketentuannya dicatat."
					testId="segment-programs"
				>
					<ul className="flex flex-col gap-2 text-sm">
						{data.programs.map((program) => (
							<li key={program.key}>
								<strong>{PROGRAM[program.key][0]}</strong>
								<span className="block text-muted-foreground">
									{PROGRAM[program.key][1]}
								</span>
							</li>
						))}
					</ul>
				</DetailSection>
				<DetailSection
					id="segment-birth-months"
					title="Bulan lahir"
					description="Untuk voucher ulang tahun."
					testId="segment-birth-months"
				>
					<CountTable
						label="Bulan"
						rows={data.birth_months.map((row) => ({
							key: String(row.month),
							name: MONTHS[row.month - 1],
							count: row.count,
						}))}
					/>
				</DetailSection>
				<DetailSection
					id="segment-categories"
					title="Kategori favorit"
					description="Untuk promo kategori. Satu pembeli bisa memilih hingga 5."
					testId="segment-categories"
				>
					{data.favourite_categories.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							Belum ada pembeli yang memilih kategori favorit.
						</p>
					) : (
						<CountTable
							label="Kategori"
							rows={data.favourite_categories.map((row) => ({
								key: row.category_id,
								name: row.name,
								count: row.count,
							}))}
						/>
					)}
				</DetailSection>
			</div>
		</AdminPage>
	);
}
