// Checkout vouchers, stage 1 (owner 2026-11-05): the summary control is built but hidden. There is no voucher backend
// yet; S177 adds validation, the quote discount and this flag's switch-on. Keep it false until then, so nothing on
// screen pretends to apply a discount. A constant, not an environment variable.
export const VOUCHERS_ENABLED=false;

// Why a code was refused, as stable reason codes the S177 backend answers with, and the buyer copy for each.
export const VOUCHER_REASONS={
 NOT_FOUND:'Kode voucher tidak ditemukan.',
 EXHAUSTED:'Voucher sudah habis.',
 MIN_SUBTOTAL:'Minimal belanja belum terpenuhi.',
 METHOD_NOT_ELIGIBLE:'Voucher tidak berlaku untuk metode pembayaran ini.',
 DESTINATION_NOT_ELIGIBLE:'Voucher tidak berlaku untuk kecamatan tujuan ini.',
 SHIPPING_METHOD_NOT_ELIGIBLE:'Voucher tidak berlaku untuk kurir yang dipilih.',
 EXPIRED:'Voucher sudah kedaluwarsa.',
 PER_BUYER_LIMIT:'Voucher ini sudah Anda pakai.',
 NOT_STARTED:'Voucher belum berlaku.',
} as const satisfies Record<string,string>;
export type VoucherReason=keyof typeof VOUCHER_REASONS;
// Reasons whose copy needs a value from the backend (e.g. "Minimal belanja Rp50.000.", "… untuk COD.").
export function voucherMessage(reason:VoucherReason,detail?:{min_subtotal?:string;method?:string}){
 if(reason==='MIN_SUBTOTAL'&&detail?.min_subtotal)return `Minimal belanja ${detail.min_subtotal}.`;
 if(reason==='METHOD_NOT_ELIGIBLE'&&detail?.method)return `Voucher tidak berlaku untuk ${detail.method}.`;
 return VOUCHER_REASONS[reason];
}
export type VoucherState={kind:'idle'}|{kind:'applied';code:string;discount:number}|{kind:'error';reason:VoucherReason;detail?:{min_subtotal?:string;method?:string}};
