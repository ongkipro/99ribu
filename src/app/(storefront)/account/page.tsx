import Link from 'next/link';
import {Shell} from '../../../components/storefront/shell';
export default function Account(){return <Shell active="account"><main id="main" className="wrap empty-state"><h1>Halaman akun sedang disiapkan</h1><p>Katalog bisa dilihat tanpa membuat akun.</p><Link className="button" href="/search">Lihat produk</Link></main></Shell>;}
