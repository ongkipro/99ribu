import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {AccessError} from '../../access/policy.ts';
import {id} from '../../catalog/validation.ts';
import {fulfillmentClock} from '../../fulfillment/core.ts';
import {lockPaymentOrder} from '../../payments/attempts.ts';
import {lockRecoveryCollectionBasis} from './collection.ts';
import {advanceException,type ExceptionHead} from './core.ts';
import {receiptUnitIds} from '../../finance/receipt-units.ts';

// A stored callback result identifies the original money; its actual signed
// receivable is reverified before opening a case. No obligation/cash/stock or
// Purchase effect is created here, including when reconciling an older source.
export async function openCollectionException(tx:TransactionSql,provider:'local.payment'|'local.cod',eventId:string){
 const selected=id(eventId),rows=provider==='local.payment'
  ?await tx`select r.outcome,r.receipt_id,r.transaction_id,a.order_id,e.occurred_at from app.payment_event_result r
    join app.local_payment_event e on e.id=r.event_id join app.local_payment_operation p on p.id=e.operation_id
    join app.payment_attempt a on a.id=p.attempt_id where r.event_id=${selected}`
  :await tx`select r.outcome,r.receipt_id,r.transaction_id,s.order_id,e.occurred_at from app.cod_event_result r
    join app.local_cod_event e on e.id=r.event_id join app.local_cod_operation p on p.id=e.operation_id
    join app.order_shipment s on s.id=p.shipment_id where r.event_id=${selected}`;
 if(rows.length!==1)throw new AccessError(409,'EXCEPTION_COLLECTION_NOT_RECORDED');
 const source=rows[0];if(source.outcome!=='recovery')return null;
 if(!source.transaction_id)throw new AccessError(409,'RECOVERY_COLLECTION_NOT_QUALIFIED');
 const order=await lockPaymentOrder(tx,source.order_id);
 if(provider!==(order.payment_method==='cod'?'local.cod':'local.payment'))throw new AccessError(409,'RECOVERY_COLLECTION_NOT_QUALIFIED');
 const units=source.receipt_id?(await receiptUnitIds(tx,String(source.receipt_id))).map(id=>({id})):[];
 const basis=await lockRecoveryCollectionBasis(tx,order.id,source.receipt_id?{kind:'purchased_units',fulfillment_item_ids:units.map(unit=>String(unit.id))}:{kind:'unallocated_collection',source_transaction_id:String(source.transaction_id)});
 if(basis.sources.length!==1||basis.sources[0].source_transaction_id!==source.transaction_id||basis.sources[0].source_event_id!==selected||basis.sources[0].receipt_id!==source.receipt_id)throw new AccessError(409,'RECOVERY_COLLECTION_NOT_QUALIFIED');
 const kind=source.receipt_id?'late_collection':'unallocated_collection',sourceKind=provider==='local.payment'?'payment_event':'cod_event';
 const [previous]=await tx<ExceptionHead[]>`select * from app.commerce_exception where source_kind=${sourceKind} and source_id=${selected} for update`;
 if(previous){
  if(previous.order_id!==order.id||previous.kind!==kind)throw new AccessError(409,'EXCEPTION_SOURCE_CONFLICT');
  return previous;
 }
 const exceptionId=randomUUID(),createdAt=await fulfillmentClock(tx,order.clock_namespace),occurredAt=new Date(source.occurred_at).toISOString();
 const reason=source.receipt_id?'Late original collection requires buyer recovery without reviving expired stock':'Unallocated original collection requires recovery without inventing purchased goods';
 const [head]=await tx<ExceptionHead[]>`insert into app.commerce_exception (id,order_id,kind,source_kind,source_id,reason,occurred_at,created_at)
  values (${exceptionId},${order.id},${kind},${sourceKind},${selected},${reason},${occurredAt},${createdAt}) returning *`;
 const acceptedAt=new Date(head.created_at).toISOString();
 for(const unit of units)await tx`insert into app.exception_unit (exception_id,kind,fulfillment_item_id,created_at) values (${head.id},${kind},${unit.id},${acceptedAt})`;
 return (await advanceException(tx,head,{kind:'open',status:'open',source_kind:provider==='local.payment'?'payment':'cod',source_id:selected,actor_id:null,reason,occurred_at:acceptedAt,proposal_event_id:null})).head;
}
