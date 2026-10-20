import Link from 'next/link';
import {Icon} from './icon';
import {CheckoutExit} from './checkout-exit';

export function CheckoutFrame({children,saveDraft=false,back='cart'}:{children:React.ReactNode;saveDraft?:boolean;back?:'cart'|'catalog'}){
 return <><a className="skip" href="#main">Lewati ke konten</a><div className="local-notice">Data contoh. Pesanan dan pengiriman simulasi.</div>
  {/* A form-associated header exit must never become the implicit Enter action. */}
  {saveDraft&&<button type="submit" form="checkout-form" name="navigate" value="lookup" className="sr-only" tabIndex={-1}>Periksa wilayah pengiriman</button>}
  <header className="checkout-header checkout-wrap">{saveDraft?<CheckoutExit/>:<Link href={back==='catalog'?'/search':'/cart'} className="checkout-back"><Icon name="chevron"/><span>{back==='catalog'?'Katalog':'Keranjang'}</span></Link>}{saveDraft?<CheckoutExit home/>:<Link href="/" className="brand" aria-label="99ribu, beranda">99<span>ribu</span><i aria-hidden="true">.</i></Link>}<a href="#checkout-help" className="checkout-help-link">Bantuan</a></header>
  <main id="main" className="checkout-wrap">{children}</main>
  <footer className="checkout-footer checkout-wrap"><p>Satu pilihan lengkap Rp99.000. Ongkir mengikuti paket dan tujuan yang dipilih.</p><nav aria-label="Kebijakan belanja"><Link href="/help#returns" target="_blank" rel="noopener noreferrer">Pengiriman dan pengembalian<span className="sr-only"> (tab baru)</span></Link><Link href="/help#privacy" target="_blank" rel="noopener noreferrer">Privasi<span className="sr-only"> (tab baru)</span></Link></nav></footer>
 </>;
}

export function CheckoutHelp({children,context='checkout'}:{children?:React.ReactNode;context?:'checkout'|'payment'|'recovery'|'order'}){
 return <section id="checkout-help" className="checkout-help" aria-labelledby="checkout-help-title"><h2 id="checkout-help-title">{context==='payment'?'Bantuan pembayaran':'Bantuan checkout'}</h2>
  {context==='checkout'&&<details><summary>Mengapa ongkir perlu dihitung ulang?</summary><p>Tujuan, isi keranjang, asal paket atau layanan dapat berubah. Periksa rincian dan total terbaru sebelum membuat pesanan.</p></details>}
  {context==='recovery'&&<details><summary>Mengapa akses perlu diperiksa?</summary><p>Rincian pesanan hanya tersedia untuk pemilik atau akses tamu yang masih berlaku. Nomor pesanan saja tidak membuka rinciannya.</p></details>}
  {context==='payment'&&<details><summary>Bagaimana jika status pembayaran belum diketahui?</summary><p>Perbarui status pada pesanan yang sama. Percobaan baru hanya tersedia setelah kegagalan dipastikan dan selama batas pembayaran belum lewat.</p></details>}
  {(context==='checkout'||context==='order')&&<details><summary>Bagaimana jika hasil pembuatan pesanan belum diketahui?</summary><p>Gunakan tindakan ulang pada halaman checkout untuk memeriksa permintaan yang sama. Pesanan yang sudah tersimpan akan dibuka kembali.</p></details>}
  {(context==='checkout'||context==='payment')&&<details><summary>Kapan pembayaran dianggap diterima?</summary><p>Konfirmasi pesanan dan penerimaan pembayaran berbeda. Pembayaran online mengikuti status pembayaran yang terverifikasi; COD dicatat saat pembayaran paket diterima.</p></details>}
  {children}
 </section>;
}
