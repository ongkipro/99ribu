import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {id,integer} from '../catalog/validation.ts';
import {prepareReservation,readReservation} from '../inventory/reservations.ts';
import {readPosition} from '../inventory/state.ts';

type UnitContents={id:string;components:{stock_item_id:string;quantity:number}[]};
type ReservedComponent={balance_id:string;stock_item_id:string;quantity:number};

// Split the already reserved physical lots across complete replacement units.
// Every reserved piece must belong to exactly one unit of the original offer.
export function allocateReplacementComponents(units:readonly UnitContents[],reserved:readonly ReservedComponent[]){
 const invalid=()=>new AccessError(503,'REPLACEMENT_ALLOCATION_INVALID');
 if(!units.length||units.length>100||new Set(units.map(unit=>id(unit.id))).size!==units.length||!reserved.length)throw invalid();
 const remaining=reserved.map(row=>({balance_id:id(row.balance_id),stock_item_id:id(row.stock_item_id),remaining:integer(row.quantity,1)})).sort((a,b)=>a.balance_id.localeCompare(b.balance_id));
 if(new Set(remaining.map(row=>row.balance_id)).size!==remaining.length)throw invalid();
 const allocations:{replacement_link_id:string;balance_id:string;stock_item_id:string;quantity:number}[]=[];
 for(const unit of [...units].sort((a,b)=>a.id.localeCompare(b.id))){
  if(!unit.components.length||new Set(unit.components.map(component=>id(component.stock_item_id))).size!==unit.components.length)throw invalid();
  for(const component of [...unit.components].sort((a,b)=>a.stock_item_id.localeCompare(b.stock_item_id))){
   let needed=integer(component.quantity,1,1000000);
   for(const balance of remaining.filter(row=>row.stock_item_id===component.stock_item_id&&row.remaining>0)){
    const quantity=Math.min(needed,balance.remaining);
    allocations.push({replacement_link_id:unit.id,balance_id:balance.balance_id,stock_item_id:component.stock_item_id,quantity});
    balance.remaining-=quantity;needed-=quantity;if(!needed)break;
   }
   if(needed)throw invalid();
  }
 }
 if(remaining.some(row=>row.remaining))throw invalid();
 return allocations;
}

// Use the immutable purchased revision, even if today's offer is retired or
// changed. The replacement origin and eligible FEFO lots can differ.
export async function replacementContents(tx:TransactionSql,shipmentId:string){
 const [schema]=await tx`select to_regclass('app.exception_cancellation') is not null installed`;
 const active=schema.installed?tx`and not exists(select 1 from app.exception_cancellation cancelled where cancelled.replacement_link_id=link.id)`:tx``;
 const rows=await tx`select link.id,c.stock_item_id,c.quantity from app.replacement_link link
  join app.fulfillment_item f on f.id=link.original_fulfillment_item_id join app.order_item i on i.id=f.order_item_id
  join app.offer_component c on c.product_id=i.product_id and c.revision=i.product_revision and c.offer_id=i.offer_id
  where link.shipment_id=${id(shipmentId)} ${active} order by link.id,c.stock_item_id`;
 const units=new Map<string,UnitContents>();
 for(const row of rows){const unit=units.get(String(row.id))??{id:String(row.id),components:[]};unit.components.push({stock_item_id:String(row.stock_item_id),quantity:Number(row.quantity)});units.set(unit.id,unit);}
 if(!units.size)throw new AccessError(409,'REPLACEMENT_NO_ACTIVE_UNITS');
 return [...units.values()];
}

// Caller owns the current case, shipment, authority and transaction/savepoint.
// An insufficient-stock exception must roll this entire attempt back while the
// enclosing replacement intent survives. Activation follows the causal event.
export async function reserveReplacementStock(tx:TransactionSql,input:{shipment_id:string;warehouse_id:string;clock_namespace:string|null;actor_id:string}){
 const units=await replacementContents(tx,input.shipment_id),requirements=units.flatMap(unit=>unit.components.map(component=>({warehouse_id:input.warehouse_id,...component})));
 const held=await prepareReservation(tx,{key:`replacement:${input.shipment_id}`,kind:'replacement',expiresAt:null,clockNamespace:input.clock_namespace,requirements,intent:{shipment_id:input.shipment_id,units},actorId:input.actor_id});
 if(!held.created)throw new AccessError(409,'REPLACEMENT_STOCK_ALREADY_RESERVED');
 const reservation=await readReservation(tx,held.id),allocations=allocateReplacementComponents(units,reservation.components.map(row=>({balance_id:String(row.balance_id),stock_item_id:String(row.stock_item_id),quantity:Number(row.quantity)})));
 for(const allocation of allocations)await tx`insert into app.replacement_component_allocation (replacement_link_id,balance_id,stock_item_id,quantity)
  values (${allocation.replacement_link_id},${allocation.balance_id},${allocation.stock_item_id},${allocation.quantity})`;
 return held.id;
}
export async function lockReplacementStock(tx:TransactionSql,shipmentId:string,namespace:string|null,bookingId:string|null=null){
 const [head]=await tx`select stock_reservation_id from app.replacement_shipment where id=${id(shipmentId)}`;
 if(!head?.stock_reservation_id)throw new AccessError(409,'REPLACEMENT_STOCK_NOT_READY');
 const [header]=await tx`select kind,status,expires_at,clock_namespace from app.stock_reservation where id=${head.stock_reservation_id} for update`;
 if(header?.kind!=='replacement'||header.status!=='active'||header.expires_at!==null||header.clock_namespace!==namespace)throw new AccessError(409,'REPLACEMENT_STOCK_NOT_READY');
 const [schema]=await tx`select to_regclass('app.exception_cancellation') is not null installed`;
 if(schema.installed)await tx`select app.assert_replacement_stock_investigation_clear(${shipmentId}::uuid)`;
 // Retirement is forbidden after booking. Its immutable accepted source scope
 // remains the physical handover scope, independently of later refund states.
 const active=schema.installed?(bookingId?tx`link.id in (select id from app.replacement_request_unit_ids(${bookingId}::uuid))`:tx`not exists(select 1 from app.exception_cancellation cancelled where cancelled.replacement_link_id=link.id)`):tx`true`;
 const components=await tx`select a.balance_id,sum(a.quantity)::int quantity from app.replacement_component_allocation a
  join app.replacement_link link on link.id=a.replacement_link_id where link.shipment_id=${shipmentId} and ${active} group by a.balance_id order by a.balance_id`;
 if(!components.length)throw new AccessError(409,'REPLACEMENT_NO_ACTIVE_UNITS');
 await tx`select id from app.inventory_balance where id in ${tx(components.map(row=>row.balance_id))} order by id for update`;
 for(const component of components){const position=await readPosition(tx,component.balance_id,namespace);if(position.expired)throw new AccessError(409,'LOT_EXPIRED');if(position.reserved<Number(component.quantity))throw new AccessError(409,'REPLACEMENT_STOCK_NOT_READY');}
 return {reservation_id:String(head.stock_reservation_id),components};
}
