import Link from 'next/link';
import {productHref} from '../../modules/storefront/navigation';

// shop.com variant swatches (observed 2026-10-24): the label row names the field and the current
// value ("Color Black"), and choosing a pill switches the product at once. Here each option is a
// plain link to its `?offer=` URL (server HTML, works without JavaScript, `from` kept, URL replaced
// so Back still returns to the list). The current option carries aria-current; an unavailable one
// stays choosable and says so in text, so the PDP can show its state and a way out (the current
// one's state is the stock line below, not repeated in the label).
type Choice={id:string;label:string;available:boolean};
export function OfferPicker({product,name,choices,selected,from}:{product:string;name:string;choices:Choice[];selected:string;from?:string|null}){
 const current=choices.find(c=>c.id===selected);
 return <div className="offer-picker">
  <p id="offer-picker-label" className="field-label">Pilihan lengkap{current&&<> <span>{current.label}</span></>}</p>
  {(choices.length>1||!current)&&<ul aria-labelledby="offer-picker-label">{choices.map(v=><li key={v.id}>
   <Link href={productHref(product,v.id,from,name)} replace scroll={false} prefetch={false} aria-current={v.id===selected||undefined} data-available={v.available||undefined}>
    {v.label}{!v.available&&<small>Belum tersedia</small>}
   </Link></li>)}</ul>}
 </div>;
}
