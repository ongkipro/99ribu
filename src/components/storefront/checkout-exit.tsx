'use client';

import {Icon} from './icon';

export function CheckoutExit({home=false}:{home?:boolean}){
 return <button type="submit" form="checkout-form" name="navigate" value={home?'home':'cart'} className={home?'brand':'checkout-back'} aria-label={home?'99ribu, beranda':undefined} onClick={()=>{if(!document.getElementById('checkout-form'))window.location.assign(home?'/':'/cart');}}>{home?<>99<span>ribu</span><i aria-hidden="true">.</i></>:<><Icon name="chevron"/><span>Keranjang</span></>}</button>;
}
