import Link from 'next/link';
import {Icon} from './ui/icon';
import {CheckoutExit} from './checkout-exit';
import {SiteNotice,Wordmark} from './ui/brand';

export function CheckoutFrame({children,saveDraft=false,back='cart',payment=false}:{children:React.ReactNode;saveDraft?:boolean;back?:'cart'|'catalog';payment?:boolean}){
 const wrap=payment?'checkout-wrap checkout-payment-wrap':'checkout-wrap';
 return <><SiteNotice/>
  {/* A form-associated header exit must never become the implicit Enter action. */}
  {saveDraft&&<button type="submit" form="checkout-form" name="navigate" value="stay" className="sr-only" tabIndex={-1}>Periksa langkah checkout</button>}
  <header className={`checkout-header ${wrap}`}>{saveDraft?<CheckoutExit/>:<Link href={back==='catalog'?'/cari':'/keranjang'} className="checkout-back"><Icon name="chevron"/><span>{back==='catalog'?'Katalog':'Keranjang'}</span></Link>}{saveDraft?<CheckoutExit home/>:<Link href="/" className="brand" aria-label="99rb - 99ribu, beranda"><Wordmark/></Link>}<a href="#checkout-help" className="checkout-help-link" aria-label="Bantuan"><span>Bantuan</span></a></header>
  <main id="main" className={wrap}>{children}</main>
  <footer className={`checkout-footer ${wrap}`}><p>Satu pilihan lengkap Rp99.000. Ongkir mengikuti paket dan tujuan yang dipilih.</p><nav aria-label="Kebijakan belanja"><Link href="/bantuan#returns" target="_blank" rel="noopener noreferrer">Pengiriman dan pengembalian<span className="sr-only"> (tab baru)</span></Link><Link href="/bantuan#privacy" target="_blank" rel="noopener noreferrer">Privasi<span className="sr-only"> (tab baru)</span></Link></nav></footer>
 </>;
}

export type HelpContext='checkout'|'payment'|'recovery'|'receipt-recovery'|'order'|'cart'|'receipt'|'receipt-prepaid'|'receipt-paid'|'receipt-cod'|'receipt-expired';

export function CheckoutHelp({children,context='checkout'}:{children?:React.ReactNode;context?:HelpContext}){
 const isReceipt=context.startsWith('receipt');
 return <section id="checkout-help" className="checkout-help" aria-labelledby="checkout-help-title"><h2 id="checkout-help-title">{context==='payment'?'Bantuan pembayaran':isReceipt?'Bantuan pesanan':'Bantuan checkout'}</h2>
  {context==='cart'&&<details><summary><Icon name="chevron"/><span>Bagaimana melanjutkan belanja?</span></summary><p>Periksa keranjang Anda. Jika sudah kedaluwarsa atau kosong, pilih produk dari katalog sebelum melanjutkan checkout.</p></details>}
  {context==='checkout'&&<details><summary><Icon name="chevron"/><span>Mengapa ongkir perlu dihitung ulang?</span></summary><p>Tujuan, isi keranjang, asal paket atau layanan dapat berubah. Periksa rincian dan total terbaru sebelum membuat pesanan.</p></details>}
  {(context==='recovery'||context==='receipt-recovery')&&<details><summary><Icon name="chevron"/><span>Mengapa akses perlu diperiksa?</span></summary><p>Rincian hanya dapat dibuka melalui sesi pemilik atau akses tamu yang masih berlaku. Periksa sesi belanja yang Anda gunakan.</p></details>}
  {context==='receipt-expired'&&<details><summary><Icon name="chevron"/><span>Mengapa pesanan saya tidak lagi aktif?</span></summary><p>Batas waktu pembayaran telah berakhir sehingga reservasi stok dilepas. Pilih kembali produk dari katalog untuk memulai pesanan baru.</p></details>}
  {context==='receipt-expired'&&<details><summary><Icon name="chevron"/><span>Apakah pesanan yang kedaluwarsa ditagihkan?</span></summary><p>Pesanan yang berakhir sebelum pembayaran terkonfirmasi tidak ditagihkan. Jika Anda merasa sudah membayar, gunakan nomor pesanan ini saat menghubungi bantuan.</p></details>}
  {context==='receipt-cod'&&<details><summary><Icon name="chevron"/><span>Bagaimana pembayaran COD untuk beberapa paket?</span></summary><p>Setiap paket COD ditagihkan terpisah oleh kurir sesuai nominal pada kartu paket masing-masing saat paket diserahkan di alamat tujuan.</p></details>}
  {(context==='payment'||context==='receipt'||context==='receipt-prepaid')&&<details><summary><Icon name="chevron"/><span>Bagaimana jika status pembayaran belum diketahui?</span></summary><p>Perbarui status pada pesanan yang sama. Percobaan baru hanya tersedia setelah kegagalan dipastikan dan selama batas pembayaran belum lewat.</p></details>}
  {(context==='checkout'||context==='order')&&<details><summary><Icon name="chevron"/><span>Bagaimana jika hasil pembuatan pesanan belum diketahui?</span></summary><p>Gunakan tindakan ulang pada halaman checkout untuk memeriksa permintaan yang sama. Pesanan yang sudah tersimpan akan dibuka kembali.</p></details>}
  {(context==='checkout'||context==='payment'||context==='receipt'||context==='receipt-prepaid')&&<details><summary><Icon name="chevron"/><span>Kapan pembayaran dianggap diterima?</span></summary><p>Konfirmasi pesanan dan penerimaan pembayaran berbeda. Pembayaran online mengikuti status pembayaran yang terverifikasi; COD dicatat saat pembayaran paket diterima.</p></details>}
  {(context==='receipt'||context==='receipt-prepaid'||context==='receipt-paid'||context==='receipt-cod')&&<details><summary><Icon name="chevron"/><span>Kapan nomor resi dan pelacakan paket tersedia?</span></summary><p>Nomor resi tampil pada kartu paket setelah gudang menerbitkan pengiriman. Pesanan dari beberapa gudang memiliki status dan resi per paket.</p></details>}
  {(context==='receipt'||context==='receipt-paid'||context==='receipt-cod')&&<details><summary><Icon name="chevron"/><span>Bagaimana ketentuan retur atau pengembalian dana?</span></summary><p>Pemeriksaan retur dan pengembalian dana mengikuti isi pilihan serta rincian biaya yang dibekukan pada tanda terima ini.</p></details>}
  {children}
 </section>;
}
