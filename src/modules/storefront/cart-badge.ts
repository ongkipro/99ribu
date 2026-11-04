import 'server-only';
import {currentBrowserCart} from './browser';
import {cartUnits} from './cart';

// The header cart icon's unit count and accessible name (storefront and checkout headers): an open, unexpired cart only.
export async function cartBadge(){
 const current=await currentBrowserCart(),count=current.kind==='ready'&&current.cart.state==='open'&&Date.parse(current.cart.expires_at)>Date.parse(current.now)?cartUnits(current.cart):0;
 return {count,label:count?`Keranjang, ${count} pilihan`:'Keranjang'};
}
