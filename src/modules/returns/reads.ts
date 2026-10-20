import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError,type Principal} from '../access/policy.ts';
import {id,integer,invalid} from '../catalog/validation.ts';
import type {CommerceActor} from '../checkout/access.ts';
import {authorizeOrder} from '../checkout/orders.ts';
import {financeAuthority} from '../finance/costs.ts';
import {canReadReturnWarehouse,returnAuthority,type ReturnAuthority} from './authority.ts';
import {projectBuyerReturn,returnUnits,type ReturnHead} from './cases.ts';
import {projectReturnEligibility} from './receipts.ts';
import {projectBuyerRefund} from './refunds.ts';

function page(url:URL){
 for(const name of url.searchParams.keys())if(!['cursor','limit'].includes(name)||url.searchParams.getAll(name).length!==1)throw invalid();
 const raw=url.searchParams.get('limit')??'20';if(!/^(?:[1-9]|[1-9][0-9]|100)$/.test(raw))throw invalid();
 return {limit:integer(Number(raw),1,100),cursor:url.searchParams.has('cursor')?id(url.searchParams.get('cursor')):null};
}

export async function readBuyerReturns(request:Request,identity:LocalAuth,actor:CommerceActor|null,orderId:string,url:URL,caseId?:string){
 const selected=caseId===undefined?null:id(caseId),paging=selected?null:page(url);if(selected&&url.search)throw invalid();
 return identity.sql.begin(async tx=>{
  const order=await authorizeOrder(tx,request,identity,actor,id(orderId));let result:unknown;
  if(selected){
   if(!(await tx`select id from app.return_case where id=${selected} and order_id=${order.id} for share`).length)throw new AccessError(404,'NOT_FOUND');
   result=await projectBuyerReturn(tx,selected);
  }else{
   if(!paging)throw invalid();
   const [position]=paging.cursor?await tx`select recorded_at::text stamp from app.return_case where id=${paging.cursor} and order_id=${order.id}`:[];
   if(paging.cursor&&!position)throw invalid();
   const rows=await tx`select id from app.return_case where order_id=${order.id} and (${paging.cursor}::uuid is null or (recorded_at,id)<(${position?.stamp??null}::timestamptz,${paging.cursor}::uuid)) order by recorded_at desc,id desc limit ${paging.limit+1}`,chosen=rows.slice(0,paging.limit),data=[];
   for(const row of chosen)data.push(await projectBuyerReturn(tx,row.id));
   result={data,pagination:{next_cursor:rows.length>paging.limit?String(chosen.at(-1)?.id):null}};
  }
  await authorizeOrder(tx,request,identity,actor,order.id);return result;
 });
}

export async function readBuyerEligibility(request:Request,identity:LocalAuth,actor:CommerceActor|null,orderId:string,url:URL){
 const paging=page(url);
 return identity.sql.begin(async tx=>{
  const order=await authorizeOrder(tx,request,identity,actor,id(orderId)),result=await projectReturnEligibility(tx,order.id,paging.limit,paging.cursor);
  await authorizeOrder(tx,request,identity,actor,order.id);return result;
 });
}

export async function readBuyerRefund(request:Request,identity:LocalAuth,actor:CommerceActor|null,orderId:string,refundId:string){
 const selected=id(refundId);
 return identity.sql.begin(async tx=>{
  const order=await authorizeOrder(tx,request,identity,actor,id(orderId));
  if(!(await tx`select id from app.refund where id=${selected} and order_id=${order.id} for share`).length)throw new AccessError(404,'NOT_FOUND');
  const result=await projectBuyerRefund(tx,selected);await authorizeOrder(tx,request,identity,actor,order.id);return result;
 });
}

function staffScope(tx:TransactionSql,access:ReturnAuthority,replacementsInstalled:boolean){
 if(replacementsInstalled)return tx`(${access.owner||access.finance} or exists(select 1 from app.return_item scoped
  join app.fulfillment_item f on f.id=scoped.fulfillment_item_id join app.order_shipment s on s.id=f.shipment_id
  left join app.replacement_link link on link.id=scoped.replacement_link_id left join app.replacement_shipment parcel on parcel.id=link.shipment_id
  where scoped.case_id=c.id and coalesce(parcel.warehouse_id,s.warehouse_id)=any(${access.warehouseIds}::uuid[])))`;
 return tx`(${access.owner||access.finance} or exists(select 1 from app.return_item scoped join app.fulfillment_item f on f.id=scoped.fulfillment_item_id join app.order_shipment s on s.id=f.shipment_id where scoped.case_id=c.id and s.warehouse_id=any(${access.warehouseIds}::uuid[])))`;
}

async function staffCase(tx:TransactionSql,head:ReturnHead,access:ReturnAuthority){
 const all=await returnUnits(tx,head.id),visible=all.filter(item=>canReadReturnWarehouse(access,item.warehouse_id));
 if(!visible.length)throw new AccessError(404,'NOT_FOUND');
 const canInspect=(warehouseId:string)=>access.owner||access.principal.roles.includes('warehouse')&&access.warehouseIds.includes(warehouseId);
 const reviewScope=access.owner||access.principal.roles.includes('customer_service')&&all.every(item=>access.warehouseIds.includes(item.warehouse_id));
 const refunds=await tx`select id from app.refund where case_id=${head.id}`;
 return {id:head.id,order_id:head.order_id,version:head.revision,status:head.status,requested_resolution:head.requested_resolution,resolution:head.resolution,requires_goods:head.requires_goods,created_at:new Date(head.created_at).toISOString(),
  items_complete:visible.length===all.length,can_decide:reviewScope&&!refunds.length&&['requested','reviewing','approved','awaiting_goods','inspecting'].includes(head.status),
  ...(access.owner||access.finance?{refund_ids:refunds.map(row=>String(row.id))}:{}),
  items:visible.map(item=>({id:item.id,fulfillment_item_id:item.fulfillment_item_id,order_item_id:item.order_item_id,shipment_id:item.shipment_id,warehouse_id:item.warehouse_id,reason:item.reason,details:item.details,claim_state:item.claim_state,inspection_status:item.inspection_status,can_inspect:canInspect(item.warehouse_id)}))};
}

async function readAudit(tx:TransactionSql,principal:Principal,action:string,subjectId:string|null){
 await returnAuthority(tx,principal);
 await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason) values (${principal.id},${action},${subjectId},'allowed','Read current authorized contact-free return/refund projection')`;
}

export async function readAdminReturns(identity:LocalAuth,principal:Principal,url:URL,caseId?:string){
 const selected=caseId===undefined?null:id(caseId),paging=selected?null:page(url);if(selected&&url.search)throw invalid();
 return identity.sql.begin(async tx=>{
  const access=await returnAuthority(tx,principal),[installed]=await tx`select to_regclass('app.replacement_link') is not null installed`;
  const scope=staffScope(tx,access,Boolean(installed.installed));let result:unknown;
  if(selected){
   const [head]=await tx<ReturnHead[]>`select c.* from app.return_case c where c.id=${selected} and ${scope} for share of c`;
   if(!head)throw new AccessError(404,'NOT_FOUND');result=await staffCase(tx,head,access);
  }else{
   if(!paging)throw invalid();
   const [position]=paging.cursor?await tx`select c.recorded_at::text stamp from app.return_case c where c.id=${paging.cursor} and ${scope}`:[];
   if(paging.cursor&&!position)throw invalid();
   const rows=await tx<ReturnHead[]>`select c.* from app.return_case c where ${scope} and (${paging.cursor}::uuid is null or (c.recorded_at,c.id)<(${position?.stamp??null}::timestamptz,${paging.cursor}::uuid)) order by c.recorded_at desc,c.id desc limit ${paging.limit+1} for share of c`,chosen=rows.slice(0,paging.limit),data=[];
   for(const row of chosen)data.push(await staffCase(tx,row,access));
   result={data,pagination:{next_cursor:rows.length>paging.limit?String(chosen.at(-1)?.id):null}};
  }
  await readAudit(tx,principal,selected?'return.read':'return.list',selected);return result;
 });
}

export async function readAdminRefund(identity:LocalAuth,principal:Principal,refundId:string){
 const selected=id(refundId);
 return identity.sql.begin(async tx=>{
  await returnAuthority(tx,principal);await financeAuthority(tx,principal,'finance.refunds.read');
  if(!(await tx`select id from app.refund where id=${selected} for share`).length)throw new AccessError(404,'NOT_FOUND');
  const result=await projectBuyerRefund(tx,selected);await financeAuthority(tx,principal,'finance.refunds.read');await readAudit(tx,principal,'refund.read',selected);return result;
 });
}
