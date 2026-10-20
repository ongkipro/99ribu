'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main id="main" className="wrap empty-state"><h1>Katalog belum bisa dimuat</h1><p>Coba lagi. Pencarian tetap tersimpan di alamat halaman ini.</p><button className="button" type="button" onClick={reset}>Coba lagi</button><a href="/">Kembali ke beranda</a></main>;}
