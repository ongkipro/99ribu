import type {TransactionSql} from 'postgres';
import {runtimeTarget} from '../../config/runtime.ts';
import {AccessError} from '../access/policy.ts';
import {resolvePolicy,type BankAccount} from '../settings/policies.ts';

// DEC-008 payment adapter seam. Order and ledger code depend on the channel, never
// on a provider: each channel names its method, the adapter that creates its
// payment intent, and its buyer-visible label. AutoLaris (S93) runs on a local simulated contract.
export const PAYMENT_CHANNELS={
 'local-prepaid':{method:'prepaid',adapter:'local',label:'Pembayaran simulasi'},
 'manual-bank':{method:'prepaid',adapter:'manual_bank',label:'Transfer bank'},
 autolaris:{method:'prepaid',adapter:'autolaris',label:'Virtual Account / QRIS'},
 cod:{method:'cod',adapter:'cod',label:'Bayar di tempat (COD)'},
} as const;
export type PaymentChannel=keyof typeof PAYMENT_CHANNELS;
// Spec 11 (R4): the buyer deadline is judged by transfer/payment time, not by when we learn of it.
// Manual bank: finance may confirm an on-time transfer for this long after the deadline before the
// order is cancelled; a transfer after the deadline (or a confirmation after the grace) is recovery.
export const MANUAL_BANK_CONFIRMATION_GRACE_MS=12*3600000;
// AutoLaris: before cancelling, a fresh advice read after the deadline is required; pending or
// unknown answers keep the order for at most this window.
export const AUTOLARIS_FINAL_ADVICE_WINDOW_MS=30*60000;
// S95: production offers only channels with a real effect path, manual bank transfer and COD. The simulator never
// runs there, and AutoLaris stays local until its live gate (S97) passes.
export function offeredChannels():PaymentChannel[]{return runtimeTarget()==='production'?['manual-bank','cod']:Object.keys(PAYMENT_CHANNELS) as PaymentChannel[];}
export function paymentChannel(method:'prepaid'|'cod',requested:unknown):PaymentChannel{
 const channel=requested===undefined||requested===null?method==='cod'?'cod':'local-prepaid':requested;
 if(typeof channel!=='string'||!Object.hasOwn(PAYMENT_CHANNELS,channel)||PAYMENT_CHANNELS[channel as PaymentChannel].method!==method)throw new AccessError(400,'INVALID_INPUT');
 if(!offeredChannels().includes(channel as PaymentChannel))throw new AccessError(422,'PAYMENT_CHANNEL_UNAVAILABLE');
 return channel as PaymentChannel;
}
// DEC-009: per COD parcel ceil(base x bps / 10000) in whole rupiah (integer math).
export function codFee(base:number|bigint,bps:number){
 if(!Number.isSafeInteger(bps)||bps<0||bps>2000)throw new AccessError(503,'POLICY_INVALID');
 return Number((BigInt(base)*BigInt(bps)+9999n)/10000n);
}
// Stable largest remainder by weight; ties by id. Shares sum to the total exactly.
export function allocateByWeight(total:number,rows:readonly {id:string;weight:number}[]){
 const sum=rows.reduce((n,r)=>n+BigInt(r.weight),0n),amount=BigInt(total);
 if(!rows.length)return new Map<string,number>();
 if(sum===0n){const even=rows.map(r=>({id:r.id,weight:1}));return allocateByWeight(total,even);}
 const shares=rows.map(r=>({id:r.id,amount:amount*BigInt(r.weight)/sum,remainder:amount*BigInt(r.weight)%sum}));
 let extra=amount-shares.reduce((n,s)=>n+s.amount,0n);
 const order=[...shares].sort((a,b)=>a.remainder===b.remainder?(a.id<b.id?-1:a.id>b.id?1:0):a.remainder>b.remainder?-1:1);
 for(const share of order)if(extra>0n){share.amount++;extra--;}
 return new Map(shares.map(s=>[s.id,Number(s.amount)]));
}
export type PaymentTerms={version_id:string|null;cod_fee_bps:number;manual_bank_accounts:BankAccount[]};
// The current owner-versioned payment policy at a business instant. No policy
// means no buyer COD fee and no manual transfer channel.
export async function paymentTerms(tx:TransactionSql,at:Date):Promise<PaymentTerms>{
 try{
  const policy=await resolvePolicy(tx,'payment',null,at),values=policy.values as {cod_fee_bps?:number;manual_bank_accounts?:BankAccount[]};
  return {version_id:policy.id,cod_fee_bps:values.cod_fee_bps??0,manual_bank_accounts:values.manual_bank_accounts??[]};
 }catch(error){if(error instanceof AccessError&&error.code==='POLICY_UNCONFIGURED')return {version_id:null,cod_fee_bps:0,manual_bank_accounts:[]};throw error;}
}
