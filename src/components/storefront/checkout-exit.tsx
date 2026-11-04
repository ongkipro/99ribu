'use client';

import {Icon} from './ui/icon';
import {BrandName} from './ui/brand';
import {CartCount} from './ui/cart-count';

// Header exits while the checkout form is open: each submits the form so the draft is saved before leaving.
export function CheckoutExit({home=false,label='Keranjang',count=0}:{home?:boolean;label?:string;count?:number}){
 return <button type="submit" form="checkout-form" name="navigate" value={home?'home':'cart'} className={home?'brand brand-reveal':'checkout-cart'} aria-label={home?undefined:label} onClick={()=>{if(!document.getElementById('checkout-form'))window.location.assign(home?'/':'/keranjang');}}>{home?<BrandName/>:<><Icon name="cart"/><CartCount count={count}/></>}</button>;
}
