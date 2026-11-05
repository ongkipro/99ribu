// Checkout vouchers (S177): the summary control sends the typed code with the quote; the quote answers whether it was
// applied or refused with one of these stable reasons. A constant switch, not an environment variable.
export const VOUCHERS_ENABLED=true;

// Buyer copy for each refusal reason the quote returns (src/modules/checkout/quotes.ts VoucherReason).
export const VOUCHER_REASONS={
 NOT_FOUND:'Kode voucher tidak ditemukan.',
 EXHAUSTED:'Kuota voucher sudah habis.',
 MIN_SUBTOTAL:'Minimal belanja belum terpenuhi.',
 METHOD_NOT_ELIGIBLE:'Voucher tidak berlaku untuk metode pembayaran ini.',
 DESTINATION_NOT_ELIGIBLE:'Voucher tidak berlaku untuk alamat tujuan ini.',
 SHIPPING_METHOD_NOT_ELIGIBLE:'Voucher tidak berlaku untuk kurir yang dipilih.',
 EXPIRED:'Voucher sudah berakhir.',
 PER_BUYER_LIMIT:'Voucher ini sudah Anda pakai.',
 NOT_STARTED:'Voucher belum berlaku.',
 STACKING_CONFLICT:'Promo ongkir yang berlaku sudah lebih hemat dari voucher ini.',
} as const satisfies Record<string,string>;
export type VoucherReason=keyof typeof VOUCHER_REASONS;
export type VoucherDetail={shortfall?:string;method?:string};
// Reasons whose copy needs a value: the amount still missing ("Tambah belanja Rp12.000 lagi …") and the method.
export function voucherMessage(reason:VoucherReason,detail?:VoucherDetail){
 if(reason==='MIN_SUBTOTAL'&&detail?.shortfall)return `Tambah belanja ${detail.shortfall} lagi untuk memakai voucher ini.`;
 if(reason==='METHOD_NOT_ELIGIBLE'&&detail?.method)return `Voucher tidak berlaku untuk ${detail.method}.`;
 return VOUCHER_REASONS[reason];
}
export type VoucherState={kind:'idle'}|{kind:'applied';code:string;discount:number}|{kind:'error';reason:VoucherReason;detail?:VoucherDetail;code?:string};
