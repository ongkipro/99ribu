'use client';

import {Icon} from './ui/icon';
import {Wordmark} from './ui/brand';

export function CheckoutExit({home=false}:{home?:boolean}){
 return <button type="submit" form="checkout-form" name="navigate" value={home?'home':'cart'} className={home?'brand':'checkout-back'} aria-label={home?'99rb - 99ribu, beranda':undefined} onClick={()=>{if(!document.getElementById('checkout-form'))window.location.assign(home?'/':'/keranjang');}}>{home?<Wordmark/>:<><Icon name="chevron"/><span>Keranjang</span></>}</button>;
}
