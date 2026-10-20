import Link from 'next/link';
import {Icon} from './icon';

export function CheckoutFrame({children}:{children:React.ReactNode}){
 return <><a className="skip" href="#main">Lewati ke konten</a><div className="local-notice">Data contoh. Pesanan dan pengiriman simulasi.</div>
  <header className="checkout-header checkout-wrap"><Link href="/cart" className="checkout-back"><Icon name="chevron"/><span>Keranjang</span></Link><Link href="/" className="brand" aria-label="99ribu, beranda">99<span>ribu</span><i aria-hidden="true">.</i></Link><a href="#checkout-help" className="checkout-help-link">Bantuan</a></header>
  <main id="main" className="checkout-wrap">{children}</main>
  <footer className="checkout-footer checkout-wrap"><p>Satu pilihan lengkap Rp99.000. Ongkir mengikuti paket dan tujuan yang dipilih.</p><nav aria-label="Kebijakan belanja"><Link href="/help#returns" target="_blank" rel="noopener noreferrer">Pengiriman dan pengembalian<span className="sr-only"> (tab baru)</span></Link><Link href="/help#privacy" target="_blank" rel="noopener noreferrer">Privasi<span className="sr-only"> (tab baru)</span></Link></nav></footer>
 </>;
}

export function CheckoutHelp({children}:{children?:React.ReactNode}){
 return <section id="checkout-help" className="checkout-help" aria-labelledby="checkout-help-title"><h2 id="checkout-help-title">Bantuan checkout</h2>
  <details><summary>Mengapa ongkir perlu dihitung ulang?</summary><p>Tujuan, isi keranjang, asal paket atau layanan dapat berubah. Periksa rincian dan total terbaru sebelum membuat pesanan.</p></details>
  <details><summary>Bagaimana jika hasil pengiriman pesanan belum diketahui?</summary><p>Gunakan tindakan ulang pada halaman checkout untuk memeriksa permintaan yang sama. Pesanan yang sudah tersimpan akan dibuka kembali.</p></details>
  <details><summary>Kapan pembayaran dianggap diterima?</summary><p>Konfirmasi pesanan dan penerimaan pembayaran berbeda. Pembayaran online mengikuti status pembayaran yang terverifikasi; COD dicatat saat pembayaran paket diterima.</p></details>
  {children}
 </section>;
}
