import Link from 'next/link';
import {Icon} from './ui/icon';
import {CheckoutExit} from './checkout-exit';
import {BrandLink,SiteNotice} from './ui/brand';
import {cartBadge} from '../../modules/storefront/cart-badge';
import {CartCount} from './ui/cart-count';

export async function CheckoutFrame({children,saveDraft=false,back='cart',payment=false}:{children:React.ReactNode;saveDraft?:boolean;back?:'cart'|'catalog';payment?:boolean}){
 const wrap=payment?'checkout-wrap checkout-payment-wrap':'checkout-wrap';
 // The cart icon carries the storefront header's unit badge (owner 2026-11-05; same rule as shell.tsx): an open,
 // unexpired cart only. Read only where the icon is shown.
 const {count,label:cartLabel}=back==='cart'?await cartBadge():{count:0,label:'Keranjang'};
 return <><SiteNotice/>
  {/* A form-associated header exit must never become the implicit Enter action. */}
  {saveDraft&&<button type="submit" form="checkout-form" name="navigate" value="stay" className="sr-only" tabIndex={-1}>Periksa langkah checkout</button>}
  {/* Shopify-style checkout header (owner 2026-11-05): the storefront logo on the left, the cart on the right; the order
      and receipt pages (back="catalog") have no open cart, so they keep the logo only. Help stays in the page body. */}
  <header className={`checkout-header ${wrap}`}>{saveDraft?<CheckoutExit home/>:<BrandLink/>}{back==='cart'&&(saveDraft?<CheckoutExit label={cartLabel} count={count}/>:<Link href="/keranjang" className="checkout-cart" aria-label={cartLabel}><Icon name="cart"/><CartCount count={count}/></Link>)}</header>
  <main id="main" className={wrap}>{children}</main>
  <footer className={`checkout-footer ${wrap}`}><nav aria-label="Kebijakan belanja"><Link href="/bantuan#returns" target="_blank" rel="noopener noreferrer">Pengiriman dan pengembalian<span className="sr-only"> (tab baru)</span></Link><Link href="/bantuan#privacy" target="_blank" rel="noopener noreferrer">Privasi<span className="sr-only"> (tab baru)</span></Link></nav></footer>
 </>;
}

