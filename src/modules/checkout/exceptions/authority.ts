import type {TransactionSql} from 'postgres';
import type {Principal} from '../../access/policy.ts';
import {assertReturnReview,returnAuthority} from '../../returns/authority.ts';
import type {ExceptionHead} from './core.ts';

// The caller holds the original order/case. Unallocated money has no invented
// units: its original prepaid order or COD source parcel supplies staff scope.
export async function authorizeExceptionReview(tx:TransactionSql,principal:Principal,head:ExceptionHead){
 const warehouses=await tx`select distinct scoped.warehouse_id from (
  select coalesce(replacement.warehouse_id,original.warehouse_id) warehouse_id from app.exception_unit u
   join app.fulfillment_item f on f.id=u.fulfillment_item_id join app.order_shipment original on original.id=f.shipment_id
   left join app.replacement_link link on link.id=u.replacement_link_id left join app.replacement_shipment replacement on replacement.id=link.shipment_id
   where u.exception_id=${head.id}
  union all
  select s.warehouse_id from app.order_shipment s where s.order_id=${head.order_id} and ${head.kind}='unallocated_collection'
   and (${head.source_kind}='payment_event' or (${head.source_kind}='cod_event' and exists(
    select 1 from app.local_cod_event e join app.local_cod_operation operation on operation.id=e.operation_id
     where e.id=${head.source_id} and operation.shipment_id=s.id)))
 ) scoped order by scoped.warehouse_id`;
 const access=await returnAuthority(tx,principal);
 assertReturnReview(access,warehouses.map(row=>String(row.warehouse_id)));
 return access;
}
