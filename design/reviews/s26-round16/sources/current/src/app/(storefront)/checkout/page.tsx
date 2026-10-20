import Link from 'next/link';
import {redirect} from 'next/navigation';
import {CheckoutFrame,CheckoutHelp} from '../../../components/storefront/checkout-frame';
import {CheckoutForm} from '../../../components/storefront/checkout-forms';
import {getLocalAuth} from '../../../modules/access/auth';
import {storefrontRequest} from '../../../modules/storefront/browser';
import {checkoutUnavailableView,initialCheckoutState,readCheckout} from '../../../modules/storefront/checkout';
import {checkoutOrderPath} from '../../../modules/storefront/checkout-order';

export const dynamic='force-dynamic';
export const metadata={title:'Checkout',robots:{index:false,follow:false},referrer:'same-origin' as const};
export default async function Checkout(){
 let view:Awaited<ReturnType<typeof readCheckout>>;try{view=await readCheckout(await storefrontRequest('GET','/checkout'),getLocalAuth());}catch{view=checkoutUnavailableView();}
 if(view.cart?.state==='submitted'&&view.cart.submitted_order_id)redirect(checkoutOrderPath(view.cart.submitted_order_id));
 if(view.kind!=='ready'||!view.cart?.lines.length)return <CheckoutFrame><section className="checkout-recovery"><h1>{view.kind==='denied'?'Sesi belanja perlu diperiksa':view.kind==='unavailable'?'Checkout belum dapat dimuat':'Keranjang masih kosong'}</h1><p>{view.kind==='unavailable'?'Data checkout belum tersedia. Coba muat kembali halaman.':view.kind==='denied'?'Buka keranjang melalui sesi belanja Anda untuk melanjutkan.':'Pilih produk sebelum melanjutkan checkout.'}</p><Link className="button" href={view.kind==='unavailable'?'/checkout':view.kind==='denied'?'/cart':'/search'}>{view.kind==='unavailable'?'Coba lagi':view.kind==='denied'?'Periksa keranjang':'Lihat produk'}</Link><CheckoutHelp context={view.kind==='denied'?'recovery':'checkout'}/></section></CheckoutFrame>;
 return <CheckoutFrame saveDraft={!view.issue}><CheckoutForm initial={initialCheckoutState(view)}/></CheckoutFrame>;
}
