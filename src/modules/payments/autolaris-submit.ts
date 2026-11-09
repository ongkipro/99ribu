import {AccessError} from '../access/policy.ts';

// S181 step 2b (ADR-0008): AutoLaris "Create Order" (`POST /api/h2h/submit`) as a PAYMENT-ONLY order.
//
// Why `submit` and not `create_payment`: the account's production evidence (the AdsBookCMS client on the same
// AutoLaris account, "every live transaction since October: provider total = grand_total") is for `submit`, where
// AutoLaris bills the buyer exactly `grand_total` and deducts its admin fee from it. That is the contract DEC-029 and
// the AUTOLARIS_TOTAL_MISMATCH refusal were written for. `create_payment` was observed live on 2026-11-09 to ADD the
// fee on top (amount 9900, admin 70, total 9970), which the same refusal would reject, so it is not used here.
//
// Privacy: this is a payment-only order (`courir_id: 1`, `cod_value: 0`, no AWB, no pickup, no dispatch). The buyer's
// name, phone, email and address are NOT sent; every personal and logistics field is a fixed placeholder. The only
// per-order facts that leave the server are the reference, the channel, the amount, and one item line.
//
// Observed live on 2026-11-09 (two unpaid QRIS probes of Rp9.900, raw files kept under /data/tmp/99ribu/autolaris-submit-probe):
//  - AutoLaris accepts these placeholders and the digits-only reference; the area ids 3517100 -> 3518010 (the examples in
//    AutoLaris' own published reference) were accepted, so a payment-only order needs no account-specific area values.
//  - `submit` bills `grand_total` with the fee INSIDE it: grand_total 9900 answered total 9900, biaya_admin 70 (the
//    DEC-029 contract; `create_payment` adds the fee on top instead).
//  - `payment_info.expired` is Jakarta time, and `submit` has NO expiry field: AutoLaris chose it itself, exactly 2 hours after
//    creation in both probes (01:40:49 WIB created, 03:40:48 expired). The buyer's QR therefore outlives 99ribu's own 30-minute
//    payment window by 90 minutes (see the consequence in dispatchAutolarisPayment).
//  - A REPEATED reference creates a NEW order: the same reff_id answered a different transaction_id (1121464 then 1121465)
//    and a new QR. AutoLaris does not deduplicate, which is why a production reconciliation pass never replays.
// Still unobserved: the settled `advice` shape for a `submit` transaction (until the owner's own paid rehearsal).
export type SubmitEnvelope={rc:string;ket:string;data:unknown};
export type SubmitConfig={originId:number;destinationId:number};
export type SubmitInput={reff_id:string;channel_code:string;amount:number;expires_at:Date;description:string};
export type ParsedSubmit={rejected:true;rc:string}|{rejected:false;transaction_id:string;instruction_kind:'virtual_account'|'qr'|'url';instruction_value:string;amount:number;admin:number;total:number;expires_at:string|null};

const PLACEHOLDER_NAME='Pembeli 99ribu',PLACEHOLDER_PHONE='081234567890',PLACEHOLDER_ADDRESS='Alamat tidak diperlukan, pembayaran saja';
export const SUBMIT_REFF_MAX=30;
const CHANNELS=/^[A-Z0-9_]{2,20}$/;

// The two area ids are AutoLaris' own identifiers (not Mengantar's), so there is no default; any valid ids work for a
// payment-only order (the published examples were accepted live). They are
// validated once, at startup, by productionAutolaris in config/runtime.ts (both required together with the API key).

// AutoLaris accepts a digits-only reference of at most 30 characters for `submit`. The local reference is derived from
// the attempt id, so the same attempt always replays the same value (never a second order for one checkout).
export function submitReference(attemptId:string):string{
 const hex=attemptId.replaceAll('-','');
 if(!/^[0-9a-f]{32}$/.test(hex))throw new AccessError(409,'AUTOLARIS_IDENTITY_MISSING');
 // 30 decimal digits keep 99.6 of the 128 UUID bits; collisions between two attempts are refused by the unique index
 // on (environment, reff_id) before any request, never silently reused.
 return BigInt(`0x${hex}`).toString().padStart(39,'0').slice(-SUBMIT_REFF_MAX);
}

export function buildSubmitPayload(input:SubmitInput,config:SubmitConfig){
 if(!/^\d{1,30}$/.test(input.reff_id))throw new AccessError(400,'INVALID_INPUT');
 if(!CHANNELS.test(input.channel_code))throw new AccessError(400,'INVALID_INPUT');
 if(!Number.isSafeInteger(input.amount)||input.amount<1)throw new AccessError(400,'INVALID_INPUT');
 const line=input.description.replace(/[\r\n]+/g,' ').trim().slice(0,100)||'Pesanan 99ribu';
 return {
  reff_id:input.reff_id,channel_code:input.channel_code,courir_id:1,origin:config.originId,destination:config.destinationId,
  weight:'1000',length:'1',width:'1',height:'1',
  shipper_name:PLACEHOLDER_NAME,shipper_phone:PLACEHOLDER_PHONE,shipper_email:'',shipper_address:PLACEHOLDER_ADDRESS,
  receiver_name:PLACEHOLDER_NAME,receiver_phone:PLACEHOLDER_PHONE,receiver_email:'',receiver_address:PLACEHOLDER_ADDRESS,
  callback_url:'',grand_total:String(input.amount),cod_value:'0',longitude:'',latitude:'',remark:line,
  order_details:[{name:line,qty:'1',unit_price:String(input.amount)}],
 };
}

// `payment_info.expired` arrives without an offset and is Jakarta time (confirmed against the creation time in the 2026-11-09
// probes, though AutoLaris still publishes no timezone). The failure direction is safe: an unparseable value
// returns null and the instruction simply carries no expiry of its own (the order deadline still applies).
export function parseSubmitExpiry(value:unknown):string|null{
 const m=String(value??'').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
 if(!m)return null;
 const date=new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+07:00`);
 return Number.isNaN(date.getTime())?null:date.toISOString();
}

const money=(v:unknown)=>{const n=typeof v==='string'&&/^\d{1,16}$/.test(v)?Number(v):v;if(!Number.isSafeInteger(n)||Number(n)<0)throw new Error('AutoLaris response malformed');return Number(n);};

// Exactly one non-empty instruction field among payment_info.va / qr / url; the client never guesses from the channel.
// `transaction_id` is the provider's identifier for `advice`; `biaya_admin` is the fee; `total` is what the buyer is billed.
export function parseSubmitResponse(envelope:SubmitEnvelope):ParsedSubmit{
 if(envelope.rc!=='00')return {rejected:true,rc:String(envelope.rc).slice(0,8)};
 const d=envelope.data as Record<string,unknown>|null;if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('AutoLaris response malformed');
 const transaction=String(d.transaction_id??d.trx_id??'');if(!/^[A-Za-z0-9_-]{1,64}$/.test(transaction))throw new Error('AutoLaris response malformed');
 const info=(d.payment_info&&typeof d.payment_info==='object'&&!Array.isArray(d.payment_info)?d.payment_info:{}) as Record<string,unknown>;
 const found:Array<['virtual_account'|'qr'|'url',unknown]>=[['virtual_account',info.va],['qr',info.qr],['url',info.url]];
 const filled=found.filter(([,value])=>typeof value==='string'&&value.length>0);
 if(filled.length!==1||(filled[0][1] as string).length>2048)throw new Error('AutoLaris response malformed');
 const total=money(d.total),admin=money(d.biaya_admin??d.admin??0);
 return {rejected:false,transaction_id:transaction,instruction_kind:filled[0][0],instruction_value:filled[0][1] as string,
  // The provider bills `grand_total` and deducts its fee from it; so the order value it reports is the bill itself.
  amount:total,admin,total,expires_at:parseSubmitExpiry(info.expired)};
}
