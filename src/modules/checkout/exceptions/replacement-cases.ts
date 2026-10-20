import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {AccessError} from '../../access/policy.ts';
import {id} from '../../catalog/validation.ts';
import {fulfillmentClock} from '../../fulfillment/core.ts';
import {lockReplacement} from '../../returns/replacement-core.ts';
import {advanceException,type ExceptionHead} from './core.ts';

// Only the real reserve savepoint's insufficient-stock result calls this
// producer. Repeated stock waits retain one case and every original consent.
export async function openReplacementStockException(tx:TransactionSql,shipmentId:string,eventId:string){
 const [schema]=await tx`select to_regclass('app.commerce_exception') is not null installed`;if(!schema.installed)return null;
 const {head,order}=await lockReplacement(tx,id(shipmentId));
 const [source]=await tx`select * from app.replacement_event where id=${id(eventId)} and shipment_id=${head.id} and kind='stock_wait' and revision=${head.revision}`;
 if(!source||head.status!=='awaiting_stock'||head.stock_reservation_id!==null||head.booking_id!==null)throw new AccessError(409,'REPLACEMENT_STOCK_SOURCE_NOT_CURRENT');
 const [previous]=await tx<ExceptionHead[]>`select * from app.commerce_exception where source_kind='replacement' and source_id=${head.id} for update`;
 if(previous){if(previous.order_id!==order.id||previous.kind!=='replacement_stock')throw new AccessError(409,'EXCEPTION_SOURCE_CONFLICT');return previous;}
 const links=await tx`select link.id,link.original_fulfillment_item_id from app.replacement_link link where link.shipment_id=${head.id}
  and link.id in (select id from app.replacement_active_unit_ids(${head.id}::uuid)) order by link.id`;
 if(!links.length)throw new AccessError(409,'REPLACEMENT_NO_ACTIVE_UNITS');
 const reason='Original replacement reservation could not obtain every complete offer; retain the same physical intent';
 const [created]=await tx<ExceptionHead[]>`insert into app.commerce_exception (id,order_id,kind,source_kind,source_id,reason,occurred_at,created_at)
  values (${randomUUID()},${order.id},'replacement_stock','replacement',${head.id},${reason},${new Date(source.occurred_at).toISOString()},${await fulfillmentClock(tx,order.clock_namespace)}) returning *`;
 for(const link of links)await tx`insert into app.exception_unit (exception_id,kind,fulfillment_item_id,replacement_link_id,created_at)
  values (${created.id},'replacement_stock',${link.original_fulfillment_item_id},${link.id},${created.created_at})`;
 return (await advanceException(tx,created,{kind:'open',status:'awaiting_stock',source_kind:'replacement',source_id:String(source.id),actor_id:null,reason,
  occurred_at:new Date(created.created_at).toISOString(),proposal_event_id:null})).head;
}

// Real complete reservation can end a stock wait. A pending buyer proposal,
// accepted cancellation/refund or financial effect must keep its own remedy.
export async function reconcileReplacementStockException(tx:TransactionSql,shipmentId:string){
 const [schema]=await tx`select to_regclass('app.commerce_exception') is not null installed`;if(!schema.installed)return null;
 const {head,order}=await lockReplacement(tx,id(shipmentId));if(head.status!=='ready'||!head.stock_reservation_id||head.booking_id||head.handover_at)return null;
 const [exception]=await tx<ExceptionHead[]>`select * from app.commerce_exception where source_kind='replacement' and source_id=${head.id} and kind='replacement_stock' for update`;
 if(!exception||!['open','awaiting_stock'].includes(exception.status)||exception.proposal_event_id!==null)return null;
 if((await tx`select 1 from app.exception_cancellation where exception_id=${exception.id} union all select 1 from app.recovery_refund where exception_id=${exception.id} limit 1`).length)return null;
 const [source]=await tx`select event.id from app.replacement_event event join app.stock_reservation hold on hold.id=${head.stock_reservation_id}
  where event.shipment_id=${head.id} and event.kind='reserve' and event.revision=${head.revision} and event.snapshot->>'stock_reservation_id'=hold.id::text
   and hold.status='active' and hold.kind='replacement' and hold.expires_at is null`;
 if(!source)throw new AccessError(409,'REPLACEMENT_STOCK_SOURCE_NOT_CURRENT');
 return (await advanceException(tx,exception,{kind:'resolved',status:'resolved',source_kind:'replacement',source_id:String(source.id),actor_id:null,
  reason:'The same replacement intent now holds every complete original offer; no buyer remedy or money effect was replaced',occurred_at:await fulfillmentClock(tx,order.clock_namespace),proposal_event_id:null})).head;
}
