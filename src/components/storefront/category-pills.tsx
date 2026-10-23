import Link from 'next/link';
import type {Department} from './departments';
import {optimizedUrl} from './media';

// shop.com category pill row (observed 2026-10-23): a fixed short list of 36px pills (circle, then
// the label) ending with a grid-icon link to every category. The circle holds the department's own
// product photo (the same one its home grid tile uses), cropped with object-fit: cover because our
// photos have backgrounds (shop.com uses contain for transparent cutouts), on the department tint.
// Tint colours live in globals.css ([data-tint]).
const cycle=['rose','amber','green','blue','violet','teal','slate'] as const;
type Tint=typeof cycle[number];
// Matched on words in the department name, never on slugs, so renamed or re-slugged departments keep
// their tint; the first match wins.
const tints:[RegExp,Tint][]=[
 [/\b(?:kecantikan|perawatan diri|kosmetik)\b/i,'rose'],[/\b(?:bayi|anak|mainan)\b/i,'blue'],[/\b(?:muslim|ibadah|islami|buku)\b/i,'teal'],
 [/\b(?:wanita)\b/i,'rose'],[/\b(?:pria|fashion|pakaian|busana)\b/i,'blue'],[/\b(?:hewan|peliharaan|akuarium)\b/i,'amber'],
 [/\b(?:hobi|lukis|mancing)\b/i,'violet'],[/\b(?:makanan|minuman|herbal|kesehatan)\b/i,'green'],[/\b(?:otomotif|kendaraan|mobil|motor)\b/i,'slate'],
 [/\b(?:perkakas|lem|elektronik)\b/i,'slate'],[/\b(?:rumah tangga|kebersihan)\b/i,'teal'],[/\b(?:dapur|bekal|botol)\b/i,'amber'],
];
// Shared with the home category grid so a department keeps one tint everywhere; unknown names cycle.
export const departmentTint=(name:string,index:number):Tint=>tints.find(([words])=>words.test(name))?.[1]??cycle[index%cycle.length];

export function CategoryPills({departments,current,allCurrent}:{departments:(Department&{image?:string|null})[];current:string|null;allCurrent:boolean}){
 return <nav className="category-pills" aria-label="Kategori produk"><ul>{departments.map((d,i)=><li key={d.id}><Link href={`/kategori/${d.slug}`} aria-current={current===d.slug?'page':undefined}>
  <span className="pill-art" data-tint={departmentTint(d.name,i)}>{d.image&&
   // biome-ignore lint/performance/noImgElement: same native local media as product cards; no image proxy.
   <img src={d.image.startsWith('/media/catalog/')?optimizedUrl(d.image,64):d.image} alt="" width={36} height={36} decoding="async" fetchPriority="low" referrerPolicy="no-referrer"/>}</span>
  <span className="pill-label">{d.name}</span></Link></li>)}
  <li><Link href="/kategori" className="pill-all" aria-label="Semua kategori" aria-current={allCurrent?'page':undefined}><svg aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg></Link></li>
 </ul></nav>;
}
