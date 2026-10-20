import Link from 'next/link';
import {Shell} from '../../components/storefront/shell';
import {ProductGrid} from '../../components/storefront/products';
import {Departments,type Department} from '../../components/storefront/departments';
import {getLocalAuth} from '../../modules/access/auth';
import {featuredProducts,featuredDepartments} from '../../modules/storefront/catalog';
export const dynamic='force-dynamic';
export default async function Home(){
 const identity=getLocalAuth(),products=await featuredProducts(identity);
 const departments=await featuredDepartments(identity);
 return <Shell><main id="main" className="wrap home-main"><div className="home-entry"><section className="price-intro" aria-labelledby="offer-heading"><h1 id="offer-heading">Pilihan lengkap.<br/>Harga tetap.</h1><div className="price-statement"><span>Setiap pilihan</span><strong>Rp99.000</strong><p>Untuk seluruh isi pilihan. Dua pilihan Rp198.000 sebelum ongkir.</p><Link href="/search?offer_kind=bundle">Lihat paket campuran</Link></div></section>
  <section className="department-section" aria-labelledby="departments-heading"><div className="section-heading"><h2 id="departments-heading">Pilih kategori</h2><Link href="/categories">Semua kategori</Link></div><Departments categories={departments as Department[]}/></section></div>
  <section className="discovery" aria-labelledby="products-heading"><div className="section-heading"><div><h2 id="products-heading">Mulai dari pilihan ini</h2></div><Link href="/search">Semua produk</Link></div>{products.length?<ProductGrid products={products}/>:<div className="empty-state"><h3>Pilihan sedang disiapkan</h3><p>Produk akan tampil setelah publikasi dan rincian isinya siap.</p><Link href="/search">Lihat katalog</Link></div>}</section>
  <section className="shopping-help"><h2>Sebelum memesan</h2><div><p>Ongkir ditampilkan sebelum konfirmasi, berdasarkan alamat dan paket pengiriman.</p><p>Periksa rincian isi dan ketentuan pengembalian sebelum menyelesaikan pesanan.</p><Link href="/help#returns">Cara pesan dan pengembalian</Link></div></section>
 </main></Shell>;
}
