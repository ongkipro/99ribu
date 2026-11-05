import {useState} from 'react';
import {rupiah} from '../../modules/storefront/format';
import {voucherMessage,type VoucherState} from '../../modules/storefront/vouchers';
import {Icon} from './ui/icon';

// Voucher control in the order summary (S177). Shopify's discount row: a collapsed "Punya kode voucher?" disclosure;
// open, one floating-label field with "Pakai" beside it. The field and both buttons belong to the checkout form
// (`form="checkout-form"`), so they work without JavaScript: "Pakai" posts `voucher_apply` with the typed
// `voucher_input`, the chip's remove button posts `voucher_remove`; the action recomputes the quote either way.
export function CheckoutVoucher({state,disabled=false}:{state:VoucherState;disabled?:boolean}){
 const [code,setCode]=useState(state.kind==='error'?state.code??'':''),[open,setOpen]=useState(state.kind!=='idle');
 if(state.kind==='applied')return <div className="checkout-voucher-applied"><span className="checkout-voucher-chip"><Icon name="tag" size={16}/><span>{state.code}</span>
  <button type="submit" form="checkout-form" name="voucher_remove" value="1" disabled={disabled} aria-label={`Hapus voucher ${state.code}`}><Icon name="close" size={14}/></button></span></div>;
 const error=state.kind==='error'?voucherMessage(state.reason,state.detail):'';
 return <details className="checkout-note checkout-voucher" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary><Icon name="chevron" size={20}/><span>Punya kode voucher?</span></summary>
  <div className="checkout-voucher-row">
   <div className="checkout-field"><div className="checkout-float">
    <input id="checkout-voucher" name="voucher_input" form="checkout-form" type="text" value={code} onChange={event=>setCode(event.currentTarget.value)} placeholder=" " maxLength={32} autoComplete="off" autoCapitalize="characters" spellCheck={false}
     onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(code.trim())(event.currentTarget.closest('.checkout-voucher-row')?.querySelector('button') as HTMLButtonElement|null)?.click();}}}
     aria-invalid={error?true:undefined} aria-describedby={error?'checkout-voucher-error':undefined}/><label htmlFor="checkout-voucher">Kode voucher</label></div>
    {error&&<p id="checkout-voucher-error" className="checkout-field-error" role="alert"><Icon name="alert"/>{error}</p>}
   </div>
   <button type="submit" form="checkout-form" name="voucher_apply" value="1" className="button secondary checkout-voucher-apply" disabled={disabled}>Pakai</button>
  </div>
 </details>;
}
// The charges row for an applied voucher, rendered above the total (it replaces the automatic shipping subsidy row).
export function VoucherDiscountRow({state}:{state:VoucherState}){
 return state.kind==='applied'?<div className="checkout-voucher-discount"><dt>Voucher {state.code}</dt><dd>−{rupiah(state.discount)}</dd></div>:null;
}
