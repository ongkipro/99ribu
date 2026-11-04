import {useState} from 'react';
import {rupiah} from '../../modules/storefront/format';
import {voucherMessage,type VoucherState} from '../../modules/storefront/vouchers';
import {Icon} from './ui/icon';

// Voucher control in the order summary (stage 1, render only; S177 wires it). Shopify's discount row: a collapsed
// "Punya kode voucher?" disclosure; open, one floating-label field with "Pakai" beside it. The field has no name and no
// form, so nothing reaches the checkout action yet; "Pakai" and the remove button only call the optional handlers.
export function CheckoutVoucher({state,onApply,onRemove}:{state:VoucherState;onApply?:(code:string)=>void;onRemove?:()=>void}){
 const [code,setCode]=useState(''),[open,setOpen]=useState(state.kind!=='idle');
 if(state.kind==='applied')return <div className="checkout-voucher-applied"><span className="checkout-voucher-chip"><Icon name="tag" size={16}/><span>{state.code}</span>
  <button type="button" aria-label={`Hapus voucher ${state.code}`} onClick={onRemove}><Icon name="close" size={14}/></button></span></div>;
 const error=state.kind==='error'?voucherMessage(state.reason,state.detail):'';
 return <details className="checkout-note checkout-voucher" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary><Icon name="chevron" size={20}/><span>Punya kode voucher?</span></summary>
  <div className="checkout-voucher-row">
   <div className="checkout-field"><div className="checkout-float">
    <input id="checkout-voucher" type="text" value={code} onChange={event=>setCode(event.currentTarget.value)} placeholder=" " maxLength={32} autoComplete="off" autoCapitalize="characters" spellCheck={false}
     aria-invalid={error?true:undefined} aria-describedby={error?'checkout-voucher-error':undefined}/><label htmlFor="checkout-voucher">Kode voucher</label></div>
    {error&&<p id="checkout-voucher-error" className="checkout-field-error"><Icon name="alert"/>{error}</p>}
   </div>
   <button type="button" className="button secondary checkout-voucher-apply" disabled={!code.trim()} onClick={()=>onApply?.(code.trim().toUpperCase())}>Pakai</button>
  </div>
 </details>;
}
// The charges row for an applied voucher, rendered above the total.
export function VoucherDiscountRow({state}:{state:VoucherState}){
 return state.kind==='applied'?<div className="checkout-voucher-discount"><dt>Diskon voucher</dt><dd>−{rupiah(state.discount)}</dd></div>:null;
}
