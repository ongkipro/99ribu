import {randomUUID} from 'node:crypto';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError,type Principal} from '../access/policy.ts';
import {id} from '../catalog/validation.ts';
import {actorScope,type CommerceActor} from '../checkout/access.ts';
import {intentHash,mutationKey} from '../checkout/carts.ts';
import {assertInventoryWarehouse,postMovement} from '../inventory/state.ts';
import {assertReturnInspection,returnAuthority} from './authority.ts';
import {advanceReturn,finishReturnOperation,insertReturnOperation,lockStaffReturn} from './cases.ts';
import {returnInspectionRequest} from './policy.ts';

export async function inspectReturn(request:Request,identity:LocalAuth,principal:Principal,caseId:string,value:unknown){
 const selected=id(caseId),input=returnInspectionRequest(value),key=mutationKey(request),hash=await intentHash(identity,'return.inspect',{case_id:selected,...input});
 return identity.sql.begin(async tx=>{
  const {head,order,access,items}=await lockStaffReturn(tx,principal,selected),selectedIds=input.items.map(item=>item.return_item_id),selectedItems=items.filter(item=>selectedIds.includes(item.id));
  if(selectedItems.length!==selectedIds.length)throw new AccessError(404,'NOT_FOUND');
  const warehouseIds=[...new Set(selectedItems.map(item=>item.warehouse_id))].sort();assertReturnInspection(access,warehouseIds);
  // Intake is at the original fulfilling warehouse. A different return site
  // requires an explicit intake assignment before this can credit that location.
  for(const warehouseId of warehouseIds)await assertInventoryWarehouse(tx,warehouseId,{owner:access.owner,roles:access.principal.roles,warehouseIds:access.warehouseIds});
  const actor:CommerceActor={kind:'user',id:principal.id,principal:access.principal},[previous]=await tx`select action,request_hash,response from app.return_operation where actor_scope=${actorScope(actor)} and key=${key}`;
  if(previous){if(previous.action!=='return.inspect'||previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return previous.response;}
  if(head.revision!==input.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  // Late goods can be recorded after an obligation/payment. Changed financial
  // inspection findings need the explicit S33 finance exception/recovery path.
  if(['refunding','resolved','replacing'].includes(head.status)&&input.result!=='record_goods'&&selectedItems.some(item=>item.inspection_status!==input.result))throw new AccessError(409,'RETURN_FINANCE_REVIEW_REQUIRED');
  const goods=[];
  const [replacementSchema]=await tx`select to_regclass('app.replacement_link') is not null installed`;
  const [exceptionSchema]=await tx`select to_regclass('app.exception_goods_line') is not null installed`;
  for(const item of input.items){
   const current=selectedItems.find(row=>row.id===item.return_item_id);if(!current)throw new AccessError(404,'NOT_FOUND');
   const original=current.replacement_link_id===null
    ?await tx`select balance_id,quantity from app.fulfillment_component_allocation where fulfillment_item_id=${current.fulfillment_item_id} order by balance_id`
    :await tx`select balance_id,quantity from app.replacement_component_allocation where replacement_link_id=${current.replacement_link_id} order by balance_id`;
   const occurrence=tx`r.fulfillment_item_id=${current.fulfillment_item_id} ${replacementSchema.installed?tx`and r.replacement_link_id is not distinct from ${current.replacement_link_id}::uuid`:tx``}`;
   for(const intake of item.goods){
    const component=original.find(row=>row.balance_id===intake.expected_balance_id);if(!component)throw new AccessError(404,'NOT_FOUND');
    if(intake.identity_confirmed){
     const [received]=exceptionSchema.installed
      ?await tx`select known_quantity::text n from app.physical_intake_basis(${current.fulfillment_item_id}::uuid,${current.replacement_link_id}::uuid,${intake.expected_balance_id}::uuid)`
      :await tx`select coalesce(sum(g.quantity),0)::text n from app.return_goods g join app.return_item r on r.id=g.return_item_id where ${occurrence} and g.expected_balance_id=${intake.expected_balance_id} and g.identity_confirmed`;
     if(BigInt(received.n)+BigInt(intake.quantity)>BigInt(component.quantity))throw new AccessError(409,'RETURN_COMPONENT_ALREADY_RECEIVED');
    }
    goods.push({id:randomUUID(),item:current,...intake});
   }
   if(input.result==='accepted'){
    const [received]=exceptionSchema.installed
     ?await tx`select records::text n from app.physical_intake_basis(${current.fulfillment_item_id}::uuid,${current.replacement_link_id}::uuid)`
     :await tx`select count(*)::text n from app.return_goods g join app.return_item r on r.id=g.return_item_id where ${occurrence}`;
    if(BigInt(received.n)+BigInt(item.goods.length)===0n)throw new AccessError(422,'RETURN_GOODS_NOT_RECEIVED');
   }
  }
  const positions=[...new Set(goods.filter(row=>row.identity_confirmed).map(row=>row.expected_balance_id))].sort();
  if(positions.length)await tx`select id from app.inventory_balance where id in ${tx(positions)} order by id for update`;
  const currentAccess=await returnAuthority(tx,principal);assertReturnInspection(currentAccess,warehouseIds);
  const {id:operationId,occurred_at:occurredAt}=await insertReturnOperation(tx,actor,key,'return.inspect',head.id,order.id,hash),states=selectedItems.map(item=>({id:item.id,claim_state:item.claim_state,inspection_status:input.result==='record_goods'?item.inspection_status:input.result}));
  const allStates=items.map(item=>states.find(state=>state.id===item.id)??item),ready=allStates.every(item=>['accepted','waived'].includes(item.inspection_status));
  const status=['approved','awaiting_goods','inspecting'].includes(head.status)?ready?(head.resolution==='replacement'?'replacing':'approved'):'inspecting':head.status;
  const changed=await advanceReturn(tx,head,{kind:'inspection',status,resolution:head.resolution,requires_goods:head.requires_goods,cause:{source_kind:'operation',source_id:operationId,actor_id:principal.id,reason:input.reason,occurred_at:occurredAt},states});
  for(const row of goods){
   const movement=row.identity_confirmed?await postMovement(tx,{balanceId:row.expected_balance_id,kind:'receive',quantity:row.quantity,onHand:row.quantity,reserved:0,quarantined:row.quantity,sourceRef:`return-goods:${row.id}`,actorId:principal.id,reason:'Verified returned component occurrence received into quarantine'}):null;
   await tx`insert into app.return_goods (id,event_id,return_item_id,expected_balance_id,quantity,identity_confirmed,stock_movement_id) values (${row.id},${changed.eventId},${row.item.id},${row.expected_balance_id},${row.quantity},${row.identity_confirmed},${movement?.id??null})`;
  }
  const response={case_id:head.id,version:changed.head.revision,status:changed.head.status};
  return finishReturnOperation(tx,operationId,response,principal.id,'return.inspect',head.id,{result:input.result,units:states.length,goods_records:goods.length,version:changed.head.revision});
 });
}
