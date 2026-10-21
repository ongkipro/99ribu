import Link from "next/link";
import { Shell } from "../../../components/storefront/shell";
import { CustomerChatView } from "../../../components/support/CustomerChatView";

export const metadata = { title: "Cara pesan dan pengembalian" };

export default function Help() {
	return (
		<Shell active="none">
			<main id="main" className="wrap help-main">
				<h1>Cara pesan</h1>
				<p>
					Harga Rp99.000 berlaku untuk satu pilihan lengkap sesuai rincian isi.
					Dua pilihan lengkap menjadi Rp198.000 sebelum ongkir.
				</p>
				<h2>Ongkir dan pengiriman</h2>
				<p>
					Alamat dan paket pengiriman menentukan ongkir. Biaya ditampilkan
					sebelum konfirmasi. Hari libur tidak dihitung sebagai hari proses
					pengiriman.
				</p>
				<section id="returns">
					<h2>Pengembalian</h2>
					<p>Ketentuan pengembalian untuk katalog contoh belum diterbitkan.</p>
				</section>
				<section id="privacy">
					<h2>Privasi data pesanan</h2>
					<p>
						Nomor HP dan alamat digunakan untuk menghitung pengiriman dan
						memproses pesanan. Email bersifat opsional. Persetujuan pemasaran
						terpisah dari pemesanan.
					</p>
					<p>
						Rincian pesanan hanya dapat dibuka melalui sesi pemilik atau akses
						tamu yang sah. Nomor pesanan saja tidak memberikan akses.
					</p>
				</section>
				<CustomerChatView />
				<Link className="button" href="/search">
					Kembali ke katalog
				</Link>
			</main>
		</Shell>
	);
}
