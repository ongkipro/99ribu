import type {Sql,TransactionSql} from 'postgres';
import {type MoneyCapability,readRuntimeConfig,runtimeTarget} from '../../config/runtime.ts';
import {AccessError} from '../access/policy.ts';
import {resolvePolicy,TOGGLEABLE_CHANNELS,type AutolarisFeeRule,type BankAccount,type FeeBearer,type ToggleableChannel} from '../settings/policies.ts';

// DEC-008 payment adapter seam. Order and ledger code depend on the channel, never
// on a provider: each channel names its method, the adapter that creates its
// payment intent, and its buyer-visible label. AutoLaris (S93) runs on a local simulated contract.
export const PAYMENT_CHANNELS={
 'local-prepaid':{method:'prepaid',adapter:'local',label:'Pembayaran simulasi'},
 'manual-bank':{method:'prepaid',adapter:'manual_bank',label:'Transfer bank'},
 autolaris:{method:'prepaid',adapter:'autolaris',label:'Virtual Account'},
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
// S181 step 3a (ADR-0008): a production channel is open ONLY while its money capability is listed in MONEY_CAPABILITIES
// (default empty = every channel closed). One function answers "is this channel open", and BOTH the checkout listing and
// order entry read it, so a channel can never be offered that order entry then refuses (that was the state before: manual
// bank and COD were listed while every order answered CHECKOUT_CLOSED). The simulator channel is never open in production.
const CHANNEL_CAPABILITY:Readonly<Record<PaymentChannel,MoneyCapability|null>>={'local-prepaid':null,'manual-bank':'manual_bank',autolaris:'payments',cod:'cod'};
export function productionChannelOpen(channel:PaymentChannel,env:NodeJS.ProcessEnv=process.env):boolean{
 const capability=CHANNEL_CAPABILITY[channel];
 if(!capability)return false;
 const config=readRuntimeConfig(env);
 return config.profile==='production'&&config.moneyCapabilities.includes(capability);
}
export function offeredChannels():PaymentChannel[]{
 const all=Object.keys(PAYMENT_CHANNELS) as PaymentChannel[];
 return runtimeTarget()==='production'?all.filter(channel=>productionChannelOpen(channel)):all;
}
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
// DEC-029: payment_fee_bearer (AutoLaris VA/QRIS admin fee; default store) and cod_fee_bearer (COD service fee; default
// buyer). cod_fee_bps stays the rate; buyer_cod_fee_bps is what a COD quote freezes for the buyer (0 when the store bears it).
export type PaymentTerms={version_id:string|null;cod_fee_bps:number;buyer_cod_fee_bps:number;manual_bank_accounts:BankAccount[];enabled_channels:readonly ToggleableChannel[];
 payment_fee_bearer:FeeBearer;cod_fee_bearer:FeeBearer;autolaris_fees:Readonly<Record<string,AutolarisFeeRule>>};
// The buyer-borne AutoLaris fee for one channel and amount due (app.autolaris_buyer_fee in migration 0046 is the same
// rule and guards it). Fixed: the table amount. Basis points: the largest X - due with X - ceil(X x bps / 10000) <= due,
// so the buyer never pays more than the provider deducts. 0 when the store bears the fee; null for an unpriced channel.
export function autolarisBuyerFee(terms:Pick<PaymentTerms,'payment_fee_bearer'|'autolaris_fees'>,channel:string,due:number):number|null{
 if(terms.payment_fee_bearer!=='buyer')return 0;
 const rule=Object.hasOwn(terms.autolaris_fees,channel)?terms.autolaris_fees[channel]:undefined;if(!rule)return null;
 if(rule.kind==='fixed')return rule.amount;
 const d=BigInt(due),bps=BigInt(rule.bps),deducted=(x:bigint)=>x-(x*bps+9999n)/10000n;
 let x=d*10000n/(10000n-bps);
 while(deducted(x)>d)x--;
 while(deducted(x+1n)<=d)x++;
 return Number(x-d);
}
// A channel the buyer may pick: offered by this runtime and switched on in the payment policy. The local
// simulator ('local-prepaid') is runtime-only. Manual bank also needs at least one account to transfer to.
export function channelEnabled(terms:PaymentTerms,channel:PaymentChannel,offered:readonly PaymentChannel[]=offeredChannels()){
 if(!offered.includes(channel))return false;
 if(channel==='local-prepaid')return true;
 if(channel==='manual-bank'&&!terms.manual_bank_accounts.length)return false;
 return terms.enabled_channels.includes(channel);
}
// The current owner-versioned payment policy at a business instant. No policy
// means no buyer COD fee and no manual transfer channel.
export async function paymentTerms(tx:Sql|TransactionSql,at:Date):Promise<PaymentTerms>{
 try{
  const policy=await resolvePolicy(tx,'payment',null,at),values=policy.values as {cod_fee_bps?:number;manual_bank_accounts?:BankAccount[];enabled_channels?:ToggleableChannel[];payment_fee_bearer?:FeeBearer;cod_fee_bearer?:FeeBearer;autolaris_fees?:Record<string,AutolarisFeeRule>};
  const codBearer=values.cod_fee_bearer??'buyer';
  return {version_id:policy.id,cod_fee_bps:values.cod_fee_bps??0,buyer_cod_fee_bps:codBearer==='store'?0:values.cod_fee_bps??0,manual_bank_accounts:values.manual_bank_accounts??[],enabled_channels:values.enabled_channels??TOGGLEABLE_CHANNELS,
   payment_fee_bearer:values.payment_fee_bearer??'store',cod_fee_bearer:codBearer,autolaris_fees:values.autolaris_fees??{}};
 }catch(error){if(error instanceof AccessError&&error.code==='POLICY_UNCONFIGURED')return {version_id:null,cod_fee_bps:0,buyer_cod_fee_bps:0,manual_bank_accounts:[],enabled_channels:TOGGLEABLE_CHANNELS,payment_fee_bearer:'store',cod_fee_bearer:'buyer',autolaris_fees:{}};throw error;}
}
