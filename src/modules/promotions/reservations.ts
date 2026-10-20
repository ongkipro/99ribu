import {createHash} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {enqueueJob} from '../../jobs/outbox.ts';
import {AccessError} from '../access/policy.ts';
import {array,id,integer,invalid,object,text} from '../catalog/validation.ts';
import {lockInventoryClock} from '../inventory/state.ts';
import {allocate,compare,safeMoney,type Rule,type Shipment} from './allocation.ts';
import {identifier,instant,MAX_MONEY} from './configuration.ts';

type Line={line_id:string;product_id:string;product_revision:number;offer_id:string;quantity:number};
type Header={id:string;key:string;request_hash:string;customer_key:string;status:string;payment_method:string;merchandise_amount:string;shipping_amount:string;subsidy_amount:string;clock_namespace:string|null;expires_at:string;created_at:string;resolved_at:string|null;resolution_reason:string|null};
export async function readPromotionReservation(sql:Sql|TransactionSql,reservationId:string){
  const [header]=await sql<Header[]>`select * from app.promotion_reservation where id=${id(reservationId)}`;
  if(!header) throw new AccessError(404,'NOT_FOUND');
  const allocations=await sql<{promotion_id:string;version_id:string;amount:string}[]>`select promotion_id,version_id,amount from app.promotion_allocation where reservation_id=${header.id} order by promotion_id`;
  const shipments=await sql<{promotion_id:string;shipment_id:string;amount:string}[]>`select promotion_id,shipment_id,amount from app.promotion_shipment_allocation where reservation_id=${header.id} order by promotion_id,shipment_id`;
  return {id:header.id,status:header.status,merchandise_amount:Number(header.merchandise_amount),shipping_amount:Number(header.shipping_amount),subsidy_amount:Number(header.subsidy_amount),expires_at:new Date(header.expires_at).toISOString(),
    allocations:allocations.map((a)=>({...a,amount:Number(a.amount),shipments:shipments.filter((s)=>s.promotion_id===a.promotion_id).map((s)=>({shipment_id:s.shipment_id,amount:Number(s.amount)}))}))};
}
async function lockRules(tx:TransactionSql,promotionIds:readonly string[]){
  const rows=await tx`select id from app.promotion where id in ${tx([...promotionIds].sort())} order by id for update`;
  if(rows.length!==promotionIds.length) throw new AccessError(404,'NOT_FOUND');
}
async function lockBuyers(tx:TransactionSql,promotionIds:readonly string[],customerKey:string){
  for(const selected of [...promotionIds].sort()) await tx`insert into app.promotion_buyer_usage (promotion_id,customer_key) values (${selected},${customerKey}) on conflict do nothing`;
  await tx`select promotion_id from app.promotion_buyer_usage where promotion_id in ${tx([...promotionIds].sort())} and customer_key=${customerKey} order by promotion_id for update`;
}
type MovementKind='reserve'|'release'|'consume'|'cancel_reserved'|'cancel_committed';
// Original immutable unit subsidies partition each original parcel's campaign
// allocations by stable intervals. No current campaign terms or new quote apply.
export function cancelledPromotionAmounts(campaigns:readonly {promotion_id:string;amount:number}[],units:readonly {id:string;line_id:string;unit_index:number;subsidy_amount:number}[],cancelledIds:readonly string[]){
 const allocations=campaigns.map(row=>({promotion_id:id(row.promotion_id),amount:integer(row.amount,1,MAX_MONEY)})).sort((a,b)=>compare(a.promotion_id,b.promotion_id));
 const originals=units.map(row=>({id:id(row.id),line_id:id(row.line_id),unit_index:integer(row.unit_index,1),amount:integer(row.subsidy_amount,0,MAX_MONEY)}))
  .sort((a,b)=>compare(a.line_id,b.line_id)||a.unit_index-b.unit_index||compare(a.id,b.id));
 const cancelled=cancelledIds.map(id);
 if(new Set(allocations.map(row=>row.promotion_id)).size!==allocations.length||new Set(originals.map(row=>row.id)).size!==originals.length
  ||new Set(cancelled).size!==cancelled.length||cancelled.some(selected=>!originals.some(row=>row.id===selected)))throw invalid();
 const total=allocations.reduce((sum,row)=>sum+BigInt(row.amount),0n);
 if(total>BigInt(MAX_MONEY)||total!==originals.reduce((sum,row)=>sum+BigInt(row.amount),0n))throw new AccessError(409,'PROMOTION_UNIT_ALLOCATION_INVALID');
 let start=0n;
 const intervals=originals.map(row=>{const lower=start;start+=BigInt(row.amount);return {...row,lower,upper:start};});
 start=0n;const selected=new Set(cancelled);
 return allocations.map(row=>{
  const lower=start;start+=BigInt(row.amount);let amount=0n;
  for(const unit of intervals)if(selected.has(unit.id)){
   const intersection=(start<unit.upper?start:unit.upper)-(lower>unit.lower?lower:unit.lower);
   if(intersection>0n)amount+=intersection;
  }
  return {promotion_id:row.promotion_id,amount:Number(amount)};
 }).filter(row=>row.amount>0);
}
export function cancelledPromotionDelta(amount:number,reservedAmount:number,committed:boolean){
 integer(amount,1,MAX_MONEY);integer(reservedAmount,0,MAX_MONEY);
 if(typeof committed!=='boolean')throw invalid();
 if((committed&&reservedAmount!==0)||(!committed&&amount>reservedAmount))throw new AccessError(409,'PROMOTION_CANCELLATION_CAPACITY_EXCEEDED');
 return {reserved:committed?0:-amount,committed:committed?-amount:0,held:committed||amount<reservedAmount?0:-1,used:0};
}
async function post(tx:TransactionSql,reservationId:string,promotionId:string,customerKey:string,amount:number,kind:MovementKind,reason:string,actorId:string|null,exceptionOperationId:string|null=null){
 const [head]=await tx`select * from app.promotion where id=${promotionId}`;
 const [buyer]=await tx`select * from app.promotion_buyer_usage where promotion_id=${promotionId} and customer_key=${customerKey}`;
 const cancellation=kind==='cancel_reserved'||kind==='cancel_committed';
 const [prior]=cancellation?await tx`select coalesce(sum(reserved_delta),0)::text amount from app.promotion_movement where reservation_id=${reservationId} and promotion_id=${promotionId}`:[];
 const {reserved,committed,held,used}=cancellation?cancelledPromotionDelta(amount,Number(prior.amount),kind==='cancel_committed')
  :{reserved:kind==='reserve'?amount:-amount,committed:kind==='consume'?amount:0,held:kind==='reserve'?1:-1,used:kind==='consume'?1:0};
 // The legacy installed branch has no exception metadata column.
 if(cancellation){
  if(exceptionOperationId===null)throw invalid();
  await tx`insert into app.promotion_movement (promotion_id,customer_key,reservation_id,kind,amount,budget_revision,buyer_revision,reserved_delta,committed_delta,reserved_uses_delta,committed_uses_delta,actor_id,reason,exception_operation_id)
   values (${promotionId},${customerKey},${reservationId},${kind},${amount},${head.budget_revision+1},${buyer.revision+1},${reserved},${committed},${held},${used},${actorId},${reason},${exceptionOperationId})`;
 }else await tx`insert into app.promotion_movement (promotion_id,customer_key,reservation_id,kind,amount,budget_revision,buyer_revision,reserved_delta,committed_delta,reserved_uses_delta,committed_uses_delta,actor_id,reason)
   values (${promotionId},${customerKey},${reservationId},${kind},${amount},${head.budget_revision+1},${buyer.revision+1},${reserved},${committed},${held},${used},${actorId},${reason})`;
 await tx`update app.promotion set reserved_amount=reserved_amount+${reserved},committed_amount=committed_amount+${committed},budget_revision=budget_revision+1 where id=${promotionId}`;
 await tx`update app.promotion_buyer_usage set reserved_uses=reserved_uses+${held},committed_uses=committed_uses+${used},revision=revision+1 where promotion_id=${promotionId} and customer_key=${customerKey}`;
}
// Trusted quote/order transaction only. S19/S20 supply authenticated cart,
// canonical fees/regions/customer identity and current publication/cost checks.
// A requote locks the union of old/new campaign IDs before release+reserve.
export async function reservePromotions(tx:TransactionSql,value:{key:string;customer_key:string;promotion_ids:readonly string[];payment_method:string;lines:readonly Line[];shipments:readonly Shipment[];expires_at:string;clock_namespace?:string|null;actor_id?:string|null}){
  if(typeof value.key!=='string'||!/^checkout:[A-Za-z0-9_-]{1,191}$/.test(value.key)||typeof value.customer_key!=='string'||!/^[0-9a-f]{64}$/.test(value.customer_key)||!['prepaid','cod'].includes(value.payment_method)) throw invalid();
  const promotionIds=array(value.promotion_ids,id,1,100).sort();if(new Set(promotionIds).size!==promotionIds.length) throw invalid();
  const lines=array(value.lines,(value)=>{const v=object(value,['line_id','product_id','product_revision','offer_id','quantity']);return {line_id:identifier(v.line_id),product_id:id(v.product_id),product_revision:integer(v.product_revision,1),offer_id:id(v.offer_id),quantity:integer(v.quantity,1,1000000)};},1).sort((a,b)=>compare(a.line_id,b.line_id));
  const shipments=array(value.shipments,(value)=>{const v=object(value,['shipment_id','origin_warehouse_id','shipping_fee','service_id','region_ids']);const regions=array(v.region_ids,identifier,1,10);if(new Set(regions).size!==regions.length) throw invalid();return {shipment_id:identifier(v.shipment_id),origin_warehouse_id:id(v.origin_warehouse_id),shipping_fee:integer(v.shipping_fee,0,MAX_MONEY),service_id:identifier(v.service_id),region_ids:regions.sort()};},1).sort((a,b)=>compare(a.shipment_id,b.shipment_id));
  if(new Set(lines.map((l)=>l.line_id)).size!==lines.length||new Set(shipments.map((s)=>s.shipment_id)).size!==shipments.length) throw invalid();
  const expiresAt=instant(value.expires_at);const namespace=value.clock_namespace??null;
  const actorId=value.actor_id??null;if(actorId!==null) text(actorId,200);
  const input={key:value.key,customer_key:value.customer_key,promotion_ids:promotionIds,payment_method:value.payment_method,lines,shipments,expires_at:expiresAt,clock_namespace:namespace};
  const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const originIds=[...new Set(shipments.map((s)=>s.origin_warehouse_id))];
  const clock=await lockInventoryClock(tx,namespace,originIds);
  await lockRules(tx,promotionIds);await lockBuyers(tx,promotionIds,value.customer_key);
  const [prior]=await tx<Header[]>`select * from app.promotion_reservation where key=${value.key} for update`;
  if(prior){if(prior.request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return readPromotionReservation(tx,prior.id);}
  await tx`select id from app.warehouse where id in ${tx(originIds.sort())} order by id for share`;
  if((await tx`select id from app.warehouse where id in ${tx(originIds)} and active`).length!==originIds.length) throw new AccessError(404,'NOT_FOUND');
  const definitions=await tx`select wanted.*,v.price,v.retired from jsonb_to_recordset(${JSON.stringify(lines)}::jsonb)
    as wanted(line_id text,product_id uuid,product_revision int,offer_id uuid,quantity int) left join app.offer_revision v on v.product_id=wanted.product_id and v.revision=wanted.product_revision and v.offer_id=wanted.offer_id`;
  if(definitions.length!==lines.length||definitions.some((d)=>d.price!==99000||d.retired)) throw new AccessError(404,'NOT_FOUND');
  const merchandise=safeMoney(definitions.reduce((sum,d)=>sum+BigInt(d.price)*BigInt(d.quantity),0n));
  const shipping=safeMoney(shipments.reduce((sum,s)=>sum+BigInt(s.shipping_fee),0n));
  const [wall]=await tx`select clock_timestamp()::text as now`;const now=namespace===null?wall.now:clock.now.toISOString();
  const duration=Date.parse(expiresAt)-Date.parse(now);if(duration<=0) throw new AccessError(409,'RESERVATION_EXPIRED');if(duration>3600000) throw new AccessError(400,'RESERVATION_DEADLINE_TOO_DISTANT');
  const rules=await tx<(Rule&{active:boolean;starts_at:string;ends_at:string;payment_methods:string[];minimum_merchandise:string;budget:string;reserved_amount:string;committed_amount:string;reserved_uses:number;committed_uses:number;per_buyer_limit:number})[]>`
    select v.*,p.reserved_amount,p.committed_amount,b.reserved_uses,b.committed_uses from app.promotion p
    join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision
    join app.promotion_buyer_usage b on b.promotion_id=p.id and b.customer_key=${value.customer_key} where p.id in ${tx(promotionIds)}`;
  for(const rule of rules) if(!rule.active||Date.parse(now)<Date.parse(rule.starts_at)||Date.parse(now)>=Date.parse(rule.ends_at)||!rule.payment_methods.includes(value.payment_method)||BigInt(merchandise)<BigInt(rule.minimum_merchandise)) throw new AccessError(409,'PROMOTION_INELIGIBLE');
  const allocations=allocate(rules,shipments);if(!allocations.length) throw new AccessError(409,'NO_PROMOTION_BENEFIT');
  for(const a of allocations){const rule=rules.find((r)=>r.promotion_id===a.promotion_id);if(!rule) throw new AccessError(503,'PROMOTION_INVALID');
    if(BigInt(rule.reserved_amount)+BigInt(rule.committed_amount)+BigInt(a.amount)>BigInt(rule.budget)) throw new AccessError(409,'PROMOTION_BUDGET_EXHAUSTED');
    if(rule.reserved_uses+rule.committed_uses>=rule.per_buyer_limit) throw new AccessError(409,'PROMOTION_BUYER_LIMIT');}
  const subsidy=safeMoney(allocations.reduce((sum,a)=>sum+BigInt(a.amount),0n));
  const inserted=await tx`insert into app.promotion_reservation (key,request_hash,customer_key,payment_method,merchandise_amount,shipping_amount,subsidy_amount,clock_namespace,expires_at,created_at)
    values (${value.key},${hash},${value.customer_key},${value.payment_method},${merchandise},${shipping},${subsidy},${namespace},${expiresAt},${now}) on conflict (key) do nothing returning id`;
  const [header]=await tx<Header[]>`select * from app.promotion_reservation where key=${value.key} for update`;
  if(header.request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');
  if(!inserted.length) return readPromotionReservation(tx,header.id);
  for(const l of lines) await tx`insert into app.promotion_reservation_item (reservation_id,line_id,product_id,product_revision,offer_id,quantity) values (${header.id},${l.line_id},${l.product_id},${l.product_revision},${l.offer_id},${l.quantity})`;
  for(const s of shipments) await tx`insert into app.promotion_shipment (reservation_id,shipment_id,origin_warehouse_id,shipping_fee,service_id,region_ids) values (${header.id},${s.shipment_id},${s.origin_warehouse_id},${s.shipping_fee},${s.service_id},${s.region_ids})`;
  for(const a of [...allocations].sort((a,b)=>compare(a.promotion_id,b.promotion_id))){
    await tx`insert into app.promotion_allocation (reservation_id,promotion_id,version_id,amount) values (${header.id},${a.promotion_id},${a.version_id},${a.amount})`;
    for(const s of a.shipments) await tx`insert into app.promotion_shipment_allocation (reservation_id,promotion_id,shipment_id,amount) values (${header.id},${a.promotion_id},${s.shipment_id},${s.amount})`;
    await post(tx,header.id,a.promotion_id,value.customer_key,a.amount,'reserve','Reserve frozen shipping benefit',actorId);
  }
  await tx`update app.promotion_reservation set status='active' where id=${header.id}`;
  const jobId=await enqueueJob(tx,'promotion.reservation.expire',`promotion-expire:${header.id}`,{reservationId:header.id});
  if(namespace===null) await tx`update app.outbox_job set run_at=${expiresAt} where id=${jobId}`;
  else await tx`update app.outbox_job set run_at=clock_timestamp()+${duration}*interval '1 millisecond' where id=${jobId}`;
  return readPromotionReservation(tx,header.id);
}
async function lockReservation(tx:TransactionSql,reservationId:string){
  const [prior]=await tx<Header[]>`select * from app.promotion_reservation where id=${id(reservationId)}`;
  if(!prior) throw new AccessError(404,'NOT_FOUND');
  const origins=await tx`select origin_warehouse_id from app.promotion_shipment where reservation_id=${prior.id}`;
  const clock=await lockInventoryClock(tx,prior.clock_namespace,[...new Set(origins.map((s)=>String(s.origin_warehouse_id)))]);
  const allocations=await tx<{promotion_id:string;amount:string}[]>`select promotion_id,amount from app.promotion_allocation where reservation_id=${prior.id} order by promotion_id`;
  if(!allocations.length) throw new AccessError(503,'PROMOTION_INVALID');
  await lockRules(tx,allocations.map((a)=>a.promotion_id));await lockBuyers(tx,allocations.map((a)=>a.promotion_id),prior.customer_key);
  const [header]=await tx<Header[]>`select * from app.promotion_reservation where id=${prior.id} for update`;
  const [wall]=await tx`select clock_timestamp()::text as now`;
  return {header,allocations,now:prior.clock_namespace===null?wall.now:clock.now.toISOString()};
}
export async function resolvePromotionReservation(tx:TransactionSql,reservationId:string,kind:'released'|'expired'|'consumed',reason:string,actorId:string|null=null){
  text(reason,500);if(!['released','expired','consumed'].includes(kind)) throw invalid();
  const state=await lockReservation(tx,reservationId);
  if(state.header.status!=='active') return readPromotionReservation(tx,state.header.id);
  const due=Date.parse(state.header.expires_at)<=Date.parse(state.now);
  if(kind==='expired'&&!due) throw new AccessError(409,'RESERVATION_NOT_DUE');
  if(kind==='consumed'&&due){
    const [installed]=await tx`select to_regclass('app.fulfillment') is not null installed`;
    const accepted=installed.installed?(await tx`select o.id from app.commerce_order o join app.order_shipment s on s.order_id=o.id join app.fulfillment f on f.shipment_id=s.id where o.promotion_reservation_id=${state.header.id} and o.actionable_at is not null and f.handover_at is not null limit 1`).length===1:false;
    if(!accepted)throw new AccessError(409,'RESERVATION_EXPIRED');
  }
  for(const a of state.allocations){
    const [remaining]=await tx`select coalesce(sum(reserved_delta),0)::text amount from app.promotion_movement where reservation_id=${state.header.id} and promotion_id=${a.promotion_id}`;
    const amount=integer(Number(remaining.amount),0,MAX_MONEY);
    if(amount)await post(tx,state.header.id,a.promotion_id,state.header.customer_key,amount,kind==='consumed'?'consume':'release',reason,actorId);
  }
  await tx`update app.promotion_reservation set status=${kind},resolved_at=${state.now},resolution_reason=${reason} where id=${state.header.id}`;
  return readPromotionReservation(tx,state.header.id);
}
export async function expirePromotionJob(tx:TransactionSql,payload:unknown){
  const body=object(payload,['reservationId']);const reservationId=id(body.reservationId);const state=await lockReservation(tx,reservationId);
  if(state.header.status!=='active') return {reservationId,status:state.header.status,deferMs:null};
  const remaining=Date.parse(state.header.expires_at)-Date.parse(state.now);
  if(remaining>0) return {reservationId,status:'active',deferMs:Math.min(3600000,Math.max(50,remaining))};
  const result=await resolvePromotionReservation(tx,reservationId,'expired','Shipping promotion reservation expired');
  return {reservationId,status:result.status,deferMs:null};
}

// Final staff cancellation transaction only; it must already hold the original
// order/case and persist exact original-unit cancellations. Call before taking
// component-balance locks, preserving order -> promotions -> stock. No client amount or
// proposal/choice can call this primitive as authority. Native seals rederive it.
export async function releaseCancelledPromotionUnits(tx:TransactionSql,operationId:string,reason:string,actorId:string){
 text(reason,500);text(actorId,200);
 const [operation]=await tx`select o.id order_id,o.promotion_reservation_id from app.exception_operation operation
  join app.commerce_exception c on c.id=operation.exception_id join app.commerce_order o on o.id=c.order_id
  where operation.id=${id(operationId)} and operation.action='apply' and operation.actor_id=${actorId}
   and operation.created_xid=pg_current_xact_id()::text and operation.response='{}'::jsonb for update of o`;
 if(!operation)throw new AccessError(409,'EXCEPTION_CANCELLATION_NOT_CURRENT');
 if(operation.promotion_reservation_id===null)return;
 const state=await lockReservation(tx,String(operation.promotion_reservation_id));
 const selected=await tx<{id:string;shipment_id:string}[]>`select c.fulfillment_item_id id,f.shipment_id from app.exception_cancellation c
  join app.fulfillment_item f on f.id=c.fulfillment_item_id join app.order_shipment s on s.id=f.shipment_id
  where c.operation_id=${operationId} and c.replacement_link_id is null and c.stock_disposition='released' and s.order_id=${operation.order_id} order by c.fulfillment_item_id`;
 const amounts=new Map<string,number>();
 for(const shipmentId of [...new Set(selected.map(row=>row.shipment_id))].sort()){
  const campaigns=await tx<{promotion_id:string;amount:string}[]>`select a.promotion_id,a.amount from app.promotion_shipment_allocation a
   join app.order_shipment s on s.parcel_id=a.shipment_id where a.reservation_id=${state.header.id} and s.id=${shipmentId} and s.order_id=${operation.order_id}`;
  const units=await tx<{id:string;line_id:string;unit_index:number;subsidy_amount:string}[]>`select f.id,i.line_id,f.unit_index,f.subsidy_amount from app.fulfillment_item f
   join app.order_item i on i.id=f.order_item_id where f.shipment_id=${shipmentId}`;
  const shares=cancelledPromotionAmounts(campaigns.map(row=>({...row,amount:Number(row.amount)})),units.map(row=>({...row,subsidy_amount:Number(row.subsidy_amount)})),selected.filter(row=>row.shipment_id===shipmentId).map(row=>row.id));
  for(const share of shares)amounts.set(share.promotion_id,integer((amounts.get(share.promotion_id)??0)+share.amount,1,MAX_MONEY));
 }
 for(const [promotionId,amount] of [...amounts].sort(([a],[b])=>compare(a,b))){
  const prior=await tx`select amount from app.promotion_movement where reservation_id=${state.header.id} and promotion_id=${promotionId} and exception_operation_id=${operationId}`;
  if(prior.length){if(prior.length!==1||Number(prior[0].amount)!==amount)throw new AccessError(409,'PROMOTION_CANCELLATION_CONFLICT');continue;}
  if(!['active','consumed'].includes(state.header.status))throw new AccessError(409,'PROMOTION_CANCELLATION_NOT_ELIGIBLE');
  await post(tx,state.header.id,promotionId,state.header.customer_key,amount,state.header.status==='active'?'cancel_reserved':'cancel_committed',reason,actorId,operationId);
 }
 if(state.header.status==='active'){
  const [held]=await tx`select coalesce(sum(reserved_delta),0)::text amount from app.promotion_movement where reservation_id=${state.header.id}`;
  if(BigInt(held.amount)===0n)await tx`update app.promotion_reservation set status='released',resolved_at=${state.now},resolution_reason=${reason} where id=${state.header.id}`;
 }
}
