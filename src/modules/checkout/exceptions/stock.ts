import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../../access/auth.ts';
import {AccessError,type Principal} from '../../access/policy.ts';
import {lockFulfillment} from '../../fulfillment/core.ts';
import {assertReturnInspection,returnAuthority} from '../../returns/authority.ts';
import {intentHash,mutationKey} from '../carts.ts';
import {advanceException,exceptionUnits,finishExceptionOperation,insertExceptionOperation,lockException,type ExceptionHead,type ExceptionProposal} from './core.ts';
import {stockDiscrepancyRequest} from './policy.ts';
import {projectException} from './projection.ts';
import {stockReportPlan,type StockReportComponent} from './stock-policy.ts';

// Caller owns the original order lock. Source acknowledgements remain factual;
// new staff packing/handover cannot bypass an unresolved physical investigation.
export async function assertOriginalStockInvestigationClear(tx:TransactionSql,shipmentId:string){
 const [schema]=await tx`select to_regclass('app.commerce_exception') is not null installed`;
 if(schema.installed)await tx`select app.assert_original_stock_investigation_clear(${shipmentId}::uuid)`;
}

export async function reportStockDiscrepancy(request:Request,identity:LocalAuth,principal:Principal,value:unknown){
 const input=stockDiscrepancyRequest(value),key=mutationKey(request),hash=await intentHash(identity,'commerce_exception.report',input);
 return identity.sql.begin(async tx=>{
  let access=await returnAuthority(tx,principal);
  const [scope]=await tx`select s.warehouse_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where f.id=${input.fulfillment_id}`;
  if(!scope)throw new AccessError(404,'NOT_FOUND');
  assertReturnInspection(access,[String(scope.warehouse_id)]);
  const {head:fulfillment,order}=await lockFulfillment(tx,input.fulfillment_id);
  const authorize=async()=>{access=await returnAuthority(tx,principal);assertReturnInspection(access,[String(fulfillment.warehouse_id)]);};
  await authorize();
  const [prior]=await tx`select exception_id,request_hash,response from app.exception_operation where actor_scope=${`user:${principal.id}`} and action='report' and key=${key}`;
  if(prior){if(prior.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');await authorize();return prior.response;}
  if(fulfillment.revision!==input.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  if(fulfillment.handover_at||!['pending','processing'].includes(order.status))throw new AccessError(409,'EXCEPTION_PHYSICAL_SCOPE_NOT_ELIGIBLE');
  const units=await tx`select id from app.fulfillment_item where shipment_id=${fulfillment.shipment_id} and id in ${tx(input.fulfillment_item_ids)} order by id for update`;
  if(units.length!==input.fulfillment_item_ids.length)throw new AccessError(404,'NOT_FOUND');
  if((await tx`select fulfillment_item_id from app.exception_cancellation where fulfillment_item_id in ${tx(input.fulfillment_item_ids)} and replacement_link_id is null limit 1`).length)throw new AccessError(409,'EXCEPTION_PHYSICAL_SCOPE_NOT_ELIGIBLE');
  let head:ExceptionHead|null=null;
  if(input.reinspection){
   if(!(await tx`select id from app.commerce_exception where id=${input.reinspection.exception_id} and order_id=${order.id} and kind='stock_discrepancy'`).length)throw new AccessError(404,'NOT_FOUND');
   head=(await lockException(tx,input.reinspection.exception_id)).head;
   if(head.revision!==input.reinspection.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
   if(['preparing','refunding','resolved'].includes(head.status)||(await tx`select id from app.recovery_refund where exception_id=${head.id} limit 1`).length)throw new AccessError(409,'EXCEPTION_REINSPECTION_NOT_ELIGIBLE');
   const original=await exceptionUnits(tx,head.id);
   if(original.some(unit=>!unit.active||unit.replacement_link_id!==null)||JSON.stringify(original.map(unit=>unit.fulfillment_item_id).sort())!==JSON.stringify(input.fulfillment_item_ids))throw new AccessError(409,'EXCEPTION_COMPONENT_SCOPE_MISMATCH');
  }else if((await tx`select id from app.exception_unit where kind='stock_discrepancy' and fulfillment_item_id in ${tx(input.fulfillment_item_ids)} and replacement_link_id is null and active limit 1`).length)throw new AccessError(409,'EXCEPTION_REINSPECTION_REQUIRED');
  const [reservation]=await tx`select status,kind from app.stock_reservation where id=${order.stock_reservation_id} for update`;
  if(reservation?.status!=='active'||reservation.kind!=='checkout')throw new AccessError(409,'FULFILLMENT_STOCK_INVALID');
  const allocations=await tx`select a.balance_id,a.stock_item_id,sum(a.quantity)::int quantity from app.fulfillment_component_allocation a where a.fulfillment_item_id in ${tx(input.fulfillment_item_ids)} group by a.balance_id,a.stock_item_id order by a.balance_id`;
  if(!allocations.length)throw new AccessError(409,'FULFILLMENT_STOCK_INVALID');
  await tx`select id from app.inventory_balance where id in ${tx(allocations.map(row=>row.balance_id))} order by id for update`;
  const components=await tx<StockReportComponent[]>`select b.id balance_id,b.stock_item_id,a.quantity,b.revision,b.on_hand,b.reserved,b.quarantined
   from app.inventory_balance b join (select balance_id,sum(quantity)::int quantity from app.fulfillment_component_allocation where fulfillment_item_id in ${tx(input.fulfillment_item_ids)} group by balance_id) a on a.balance_id=b.id order by b.id`;
  // Physical observations cannot rescind a buyer's saved remedy. Only the
  // original accepted event supplies this fact, never a request flag.
  const [accepted]=head?.proposal_event_id?await tx<Pick<ExceptionProposal,'id'|'action'>[]>`select p.id,p.snapshot->'proposal'->>'action' action
   from app.exception_event p join app.exception_event choice on choice.exception_id=p.exception_id and choice.cause_event_id=p.id
   where p.id=${head.proposal_event_id} and p.exception_id=${head.id} and p.kind='propose' and choice.kind='buyer_accept'
    and choice.revision<=${head.revision} and p.revision<choice.revision
    and p.snapshot->'proposal'->>'action' in ('cancel_affected_units','refund_original_entitlement')`:[];
  if(head?.proposal_event_id&&head.status!=='awaiting_buyer'&&!accepted)throw new AccessError(409,'RECOVERY_PROPOSAL_NOT_CURRENT');
  const plan=stockReportPlan(input,components,head!==null,accepted??null);
  await authorize();
  const operationId=randomUUID();
  if(!head){
   const [created]=await tx<ExceptionHead[]>`insert into app.commerce_exception (order_id,kind,source_kind,source_id,reason,occurred_at,created_at)
    values (${order.id},'stock_discrepancy','stock_report',${operationId},${input.reason},date_trunc('milliseconds',app.reservation_clock(${order.clock_namespace})),date_trunc('milliseconds',app.reservation_clock(${order.clock_namespace}))) returning *`;
   head=created;
   for(const unit of units)await tx`insert into app.exception_unit (exception_id,kind,fulfillment_item_id,created_at) values (${head.id},'stock_discrepancy',${unit.id},${head.created_at})`;
  }
  const operation=await insertExceptionOperation(tx,head,{kind:'user',id:principal.id,principal:access.principal},key,'report',head.id,hash,input,null,operationId);
  for(const component of components){
   const observed=input.observed_components.find(row=>row.balance_id===component.balance_id) as (typeof input.observed_components)[number];
   await tx`insert into app.exception_stock_observation (operation_id,balance_id,stock_item_id,balance_revision,missing_quantity,on_hand,reserved,quarantined)
    values (${operation.id},${component.balance_id},${component.stock_item_id},${component.revision},${observed.missing_quantity},${component.on_hand},${component.reserved},${component.quarantined})`;
  }
  await advanceException(tx,head,{...plan,source_kind:'operation',source_id:operation.id,actor_id:principal.id,reason:input.reason,occurred_at:operation.occurred_at});
  return finishExceptionOperation(tx,operation.id,await projectException(tx,head.id));
 });
}
