import Link from 'next/link';
import {Shell} from './shell';

// Footer destinations whose content the owner has not supplied yet: a real page (no dead link),
// kept out of search engines and the sitemap until the content exists.
export function PlaceholderPage({title}:{title:string}){
 return <Shell active="none"><main id="main" className="wrap empty-state"><h1>{title}</h1><p>Halaman ini sedang disiapkan.</p><Link className="button secondary" href="/bantuan">Ke halaman Bantuan</Link></main></Shell>;
}
