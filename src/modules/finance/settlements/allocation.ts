import {AccessError} from '../../access/policy.ts';
import {array,id,integer,invalid,object} from '../../catalog/validation.ts';

export type SettlementTotals={gross_amount:number|null;carrier_fee:number|null;provider_fee:number|null};
type Portion={key:string;gross:bigint;receivable_transaction_id:string;reopens_allocation_id:string|null};
export function settlementClaims(value:unknown){
 return array(value,line=>{
  const input=object(line,['receivable_transaction_id','gross_amount','reopens_allocation_id']);
  return {receivable_transaction_id:id(input.receivable_transaction_id),gross_amount:integer(input.gross_amount,1,Number.MAX_SAFE_INTEGER),reopens_allocation_id:input.reopens_allocation_id==null?null:id(input.reopens_allocation_id)};
 },0,100).sort((a,b)=>{const first=`${a.receivable_transaction_id}:${a.reopens_allocation_id??''}`,second=`${b.receivable_transaction_id}:${b.reopens_allocation_id??''}`;return first<second?-1:first>second?1:0;});
}
export function settlementTotals(value:unknown):SettlementTotals{
 const input=object(value,['gross_amount','carrier_fee','provider_fee']);
 return {gross_amount:input.gross_amount===null?null:integer(input.gross_amount,1,Number.MAX_SAFE_INTEGER),carrier_fee:input.carrier_fee===null?null:integer(input.carrier_fee,0,Number.MAX_SAFE_INTEGER),provider_fee:input.provider_fee===null?null:integer(input.provider_fee,0,Number.MAX_SAFE_INTEGER)};
}
function apportion(amount:bigint,rows:readonly {key:string;weight:bigint}[]){
 const total=rows.reduce((sum,row)=>sum+row.weight,0n);
 if(total===0n){if(amount!==0n)throw new AccessError(422,'SETTLEMENT_TOTAL_MISMATCH');return new Map(rows.map(row=>[row.key,0n]));}
 const shares=rows.map(row=>({...row,amount:amount*row.weight/total,remainder:amount*row.weight%total}));
 let extra=amount-shares.reduce((sum,row)=>sum+row.amount,0n);
 shares.sort((a,b)=>a.remainder===b.remainder?a.key<b.key?-1:a.key>b.key?1:0:a.remainder>b.remainder?-1:1);
 for(const share of shares)if(extra>0n){share.amount++;extra--;}
 return new Map(shares.map(row=>[row.key,row.amount]));
}
export function allocateSettlement(netAmount:unknown,value:unknown,lines:unknown){
 const net=BigInt(integer(netAmount,0,Number.MAX_SAFE_INTEGER)),totals=settlementTotals(value);
 if(totals.gross_amount===null||totals.carrier_fee===null||totals.provider_fee===null)throw new AccessError(409,'SETTLEMENT_STATEMENT_INCOMPLETE');
 const gross=BigInt(totals.gross_amount),carrier=BigInt(totals.carrier_fee),provider=BigInt(totals.provider_fee);
 if(net+carrier+provider!==gross)throw new AccessError(422,'SETTLEMENT_TOTAL_MISMATCH');
 const portions:Portion[]=settlementClaims(lines).map(row=>({...row,key:`${row.receivable_transaction_id}:${row.reopens_allocation_id??''}`,gross:BigInt(row.gross_amount)}));
 if(!portions.length)throw invalid();
 if(new Set(portions.map(row=>row.key)).size!==portions.length)throw new AccessError(422,'DUPLICATE_SETTLEMENT_ALLOCATION');
 const selected=portions.reduce((sum,row)=>sum+row.gross,0n);if(selected>gross)throw new AccessError(422,'SETTLEMENT_GROSS_EXCEEDED');
 const remainderKey='~unallocated',weights=[...portions.map(row=>({key:row.key,weight:row.gross})),{key:remainderKey,weight:gross-selected}];
 // Split net first, then carrier within each fee portion. Independently rounded
 // fee categories can otherwise exceed a small row's original gross.
 const nets=apportion(net,weights),fees=weights.map(row=>({key:row.key,weight:row.weight-(nets.get(row.key)??0n)})),carriers=apportion(carrier,fees);
 const amounts=(key:string,gross:bigint)=>{const n=nets.get(key)??0n,c=carriers.get(key)??0n;return {gross_amount:Number(gross),net_amount:Number(n),carrier_fee:Number(c),provider_fee:Number(gross-n-c)};};
 return {totals:{gross_amount:Number(gross),net_amount:Number(net),carrier_fee:Number(carrier),provider_fee:Number(provider)},allocations:portions.map(row=>({receivable_transaction_id:row.receivable_transaction_id,reopens_allocation_id:row.reopens_allocation_id,...amounts(row.key,row.gross)})),remaining:amounts(remainderKey,gross-selected)};
}
