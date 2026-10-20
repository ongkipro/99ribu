import Link from 'next/link';
import {Icon} from './icon';
import {CheckoutExit} from './checkout-exit';

export function CheckoutFrame({children,saveDraft=false,back='cart',payment=false}:{children:React.ReactNode;saveDraft?:boolean;back?:'cart'|'catalog';payment?:boolean}){
 const wrap=payment?'checkout-wrap checkout-payment-wrap':'checkout-wrap';
 return <><a className="skip" href="#main">Lewati ke konten</a><div className="local-notice">Data contoh. Pesanan dan pengiriman simulasi.</div>
  {/* A form-associated header exit must never become the implicit Enter action. */}
  {saveDraft&&<button type="submit" form="checkout-form" name="navigate" value="stay" className="sr-only" tabIndex={-1}>Periksa langkah checkout</button>}
  <header className={`checkout-header ${wrap}`}>{saveDraft?<CheckoutExit/>:<Link href={back==='catalog'?'/search':'/cart'} className="checkout-back"><Icon name="chevron"/><span>{back==='catalog'?'Katalog':'Keranjang'}</span></Link>}{saveDraft?<CheckoutExit home/>:<Link href="/" className="brand" aria-label="99ribu, beranda">99<span>ribu</span><i aria-hidden="true">.</i></Link>}<a href="#checkout-help" className="checkout-help-link" aria-label="Bantuan"><span>Bantuan</span></a></header>
  <main id="main" className={wrap}>{children}</main>
  <footer className={`checkout-footer ${wrap}`}><p>Satu pilihan lengkap Rp99.000. Ongkir mengikuti paket dan tujuan yang dipilih.</p><nav aria-label="Kebijakan belanja"><Link href="/help#returns" target="_blank" rel="noopener noreferrer">Pengiriman dan pengembalian<span className="sr-only"> (tab baru)</span></Link><Link href="/help#privacy" target="_blank" rel="noopener noreferrer">Privasi<span className="sr-only"> (tab baru)</span></Link></nav></footer>
 </>;
}

export function CheckoutHelp({children,context='checkout'}:{children?:React.ReactNode;context?:'checkout'|'payment'|'recovery'|'order'|'cart'}){
 return <section id="checkout-help" className="checkout-help" aria-labelledby="checkout-help-title"><h2 id="checkout-help-title">{context==='payment'?'Bantuan pembayaran':'Bantuan checkout'}</h2>
  {context==='cart'&&<details><summary><Icon name="chevron"/><span>Bagaimana melanjutkan belanja?</span></summary><p>Periksa keranjang Anda. Jika sudah kedaluwarsa atau kosong, pilih produk dari katalog sebelum melanjutkan checkout.</p></details>}
  {context==='checkout'&&<details><summary><Icon name="chevron"/><span>Mengapa ongkir perlu dihitung ulang?</span></summary><p>Tujuan, isi keranjang, asal paket atau layanan dapat berubah. Periksa rincian dan total terbaru sebelum membuat pesanan.</p></details>}
  {context==='recovery'&&<details><summary><Icon name="chevron"/><span>Mengapa akses perlu diperiksa?</span></summary><p>Rincian hanya dapat dibuka melalui sesi pemilik atau akses tamu yang masih berlaku. Periksa sesi belanja yang Anda gunakan.</p></details>}
  {context==='payment'&&<details><summary><Icon name="chevron"/><span>Bagaimana jika status pembayaran belum diketahui?</span></summary><p>Perbarui status pada pesanan yang sama. Percobaan baru hanya tersedia setelah kegagalan dipastikan dan selama batas pembayaran belum lewat.</p></details>}
  {(context==='checkout'||context==='order')&&<details><summary><Icon name="chevron"/><span>Bagaimana jika hasil pembuatan pesanan belum diketahui?</span></summary><p>Gunakan tindakan ulang pada halaman checkout untuk memeriksa permintaan yang sama. Pesanan yang sudah tersimpan akan dibuka kembali.</p></details>}
  {(context==='checkout'||context==='payment')&&<details><summary><Icon name="chevron"/><span>Kapan pembayaran dianggap diterima?</span></summary><p>Konfirmasi pesanan dan penerimaan pembayaran berbeda. Pembayaran online mengikuti status pembayaran yang terverifikasi; COD dicatat saat pembayaran paket diterima.</p></details>}
  {children}
 </section>;
}
