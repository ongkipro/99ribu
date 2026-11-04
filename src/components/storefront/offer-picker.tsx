import Link from 'next/link';
import {productHref} from '../../modules/storefront/navigation';
import {optionRows} from '../../modules/storefront/variant-options';

// shop.com variant swatches (observed 2026-10-24): the label row names the field and the current
// value ("Color Black"), and choosing a pill switches the product at once. Here each option is a
// plain link to its `?offer=` URL (the page's own default offer is the bare slug) (server HTML, works without JavaScript, `from` kept, URL replaced
// so Back still returns to the list). The current option carries aria-current; an unavailable one
// stays choosable and says so in text, so the PDP can show its state and a way out (the current
// one's state is the stock line below, not repeated in the label).
// Labels that split into colour and size ("Putih / S Atau M") show one row per dimension: Warna with a colour
// dot, Ukuran in size order. Each value links to the offer that keeps the other choice (variant-options.ts).
type Choice={id:string;label:string;available:boolean};
export function OfferPicker({slug,defaultOffer,choices,selected,from}:{slug:string;defaultOffer?:string|null;choices:Choice[];selected:string;from?:string|null}){
 const current=choices.find(c=>c.id===selected);
 const rows=optionRows(choices,selected);
 if(rows)return <div className="offer-picker offer-options">{rows.map((row,i)=>{const id=`offer-option-${i}`;return <div key={id} className="offer-option-row">
  <p id={id} className="field-label">{row.name}{row.current&&<> <span>{row.current}</span></>}</p>
  <ul aria-labelledby={id}>{row.values.map(v=><li key={v.value}>
   <Link href={productHref(slug,v.offerId,from,defaultOffer)} replace scroll={false} prefetch={false} aria-current={v.current||undefined} data-available={v.available||undefined} data-swatch={v.swatch?'':undefined}>
    {v.swatch&&<span className="offer-swatch" aria-hidden="true" style={{background:v.swatch}}/>}{v.value}{!v.available&&<small>Belum tersedia</small>}
   </Link></li>)}</ul>
 </div>;})}</div>;
 return <div className="offer-picker">
  <p id="offer-picker-label" className="field-label">Varian{current&&<> <span>{current.label}</span></>}</p>
  {(choices.length>1||!current)&&<ul aria-labelledby="offer-picker-label">{choices.map(v=><li key={v.id}>
   <Link href={productHref(slug,v.id,from,defaultOffer)} replace scroll={false} prefetch={false} aria-current={v.id===selected||undefined} data-available={v.available||undefined}>
    {v.label}{!v.available&&<small>Belum tersedia</small>}
   </Link></li>)}</ul>}
 </div>;
}
