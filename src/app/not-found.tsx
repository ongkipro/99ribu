import Link from 'next/link';
import {Shell} from '../components/storefront/shell';
export default function NotFound(){return <Shell active="none"><main id="main" className="wrap empty-state"><h1>Halaman belum tersedia</h1><p>Produk atau kategori ini belum bisa ditampilkan.</p><Link className="button" href="/search">Kembali ke katalog</Link></main></Shell>;}
