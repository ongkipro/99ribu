import {Shell} from '../../../components/storefront/shell';
import {ProductGrid,rupiah} from '../../../components/storefront/ui/product-card';
import {getLocalAuth} from '../../../modules/access/auth';
import {activeShippingPromotions,bundleOffers} from '../../../modules/storefront/promotions';
import {siteConfig} from '../../../config/site';
import {promoDescription,promoTitle,publicMetadata} from '../../../modules/storefront/seo';
export const dynamic='force-dynamic';
export function generateMetadata(){return publicMetadata(siteConfig(),{path:'/promo',title:promoTitle,description:promoDescription});}
const date=new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Jakarta'});
const methods=(list:string[])=>list.map(m=>m==='cod'?'COD':'bayar di muka').join(' atau ');
// Prices are fixed at Rp99.000, so "promo" means only what really exists: active shipping
// promotions as stored, and the published mixed bundles. With no active shipping promotion the
// bundles come first, so the page does not open on an empty state.
export default async function Promo(){
 const identity=getLocalAuth(),[promotions,bundles]=await Promise.all([activeShippingPromotions(identity),bundleOffers(identity)]);
 const shipping=<section className="promo-section" aria-labelledby="promo-shipping"><h2 id="promo-shipping">Promo ongkir</h2>
   {promotions.length?<ul className="promo-list">{promotions.map(p=><li key={p.id} data-promotion-id={p.id}><h3>{p.name}</h3><p>{p.kind==='percentage'?`Potongan ongkir ${p.value/100}%`:`Potongan ongkir ${rupiah(p.value)}`}, maksimal {rupiah(p.maximum_per_order)} per pesanan.</p>
    <p>{p.minimum_merchandise>0?`Minimal belanja ${rupiah(p.minimum_merchandise)}. `:''}Untuk {methods(p.payment_methods)}. {p.regions?`Berlaku di ${p.regions} wilayah tertentu.`:'Berlaku di semua wilayah.'} Berakhir {date.format(new Date(p.ends_at))}.</p></li>)}</ul>
   :<p>Belum ada promo ongkir aktif.</p>}
  </section>;
 const mixed=<section className="promo-section" aria-labelledby="promo-bundles"><h2 id="promo-bundles">Paket campuran</h2>
   {bundles.length?<><p>Beberapa barang berbeda dalam satu pilihan lengkap, tetap Rp99.000.</p><ProductGrid products={bundles}/></>:<p>Belum ada paket campuran yang terbit.</p>}
  </section>;
 return <Shell active="promo"><main id="main" className="wrap promo-main"><h1>Promo</h1>
  {promotions.length?<>{shipping}{mixed}</>:<>{mixed}{shipping}</>}
 </main></Shell>;
}
