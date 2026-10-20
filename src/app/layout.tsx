import type {Metadata} from 'next';
import './globals.css';

export const metadata:Metadata={title:{default:'99ribu — Pilihan lengkap Rp99.000',template:'%s — 99ribu'},description:'Lihat isi setiap pilihan lengkap seharga Rp99.000. Ongkir dihitung saat checkout.',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="id"><body>{children}</body></html>;
}
