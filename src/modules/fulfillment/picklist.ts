import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem} from '../access/http.ts';
import {AccessError,getPrincipal} from '../access/policy.ts';
import {id} from '../catalog/validation.ts';
import {assertInventoryWarehouse,inventoryAuthority} from '../inventory/state.ts';

export type PicklistLine={shipment_id:string;order_number:string;warehouse_id:string;warehouse_name:string;stock_item_id:string;sku:string;name:string;quantity:number};
export type Picklist={warehouses:{warehouse_id:string;warehouse_name:string;parcel_count:number;orders:string[];items:{stock_item_id:string;sku:string;name:string;quantity:number;parcels:number}[]}[]};

/** One picklist: component quantities summed per stock item across the selected parcels, grouped by warehouse (name, then id). */
export function aggregatePicklist(lines:readonly PicklistLine[]):Picklist{
 const byWarehouse=new Map<string,{name:string;parcels:Set<string>;orders:Set<string>;items:Map<string,{sku:string;name:string;quantity:number;parcels:Set<string>}>}>();
 for(const line of lines){
  const group=byWarehouse.get(line.warehouse_id)??{name:line.warehouse_name,parcels:new Set<string>(),orders:new Set<string>(),items:new Map()};
  byWarehouse.set(line.warehouse_id,group);group.parcels.add(line.shipment_id);group.orders.add(line.order_number);
  const item=group.items.get(line.stock_item_id)??{sku:line.sku,name:line.name,quantity:0,parcels:new Set<string>()};
  item.quantity+=line.quantity;item.parcels.add(line.shipment_id);group.items.set(line.stock_item_id,item);
 }
 return {warehouses:[...byWarehouse].sort((a,b)=>a[1].name.localeCompare(b[1].name,'id')||a[0].localeCompare(b[0])).map(([warehouse_id,g])=>({
  warehouse_id,warehouse_name:g.name,parcel_count:g.parcels.size,orders:[...g.orders].sort(),
  items:[...g.items].map(([stock_item_id,i])=>({stock_item_id,sku:i.sku,name:i.name,quantity:i.quantity,parcels:i.parcels.size})).sort((a,b)=>a.sku.localeCompare(b.sku,'id')||a.stock_item_id.localeCompare(b.stock_item_id)),
 }))};
}

const PICKLIST_MAX=100;

/**
 * Read-only: parcels outside the caller's warehouse scope (or unknown) answer 404 for the whole request.
 * Parcels already handed over, or whose order is cancelled, are not picked any more and are returned in `skipped`.
 */
export async function readPicklist(identity:LocalAuth,principal:Parameters<typeof inventoryAuthority>[1],url:URL){
 for(const name of url.searchParams.keys())if(name!=='shipment_id')throw new AccessError(400,'INVALID_INPUT');
 const raw=url.searchParams.getAll('shipment_id');
 if(!raw.length||raw.length>PICKLIST_MAX)throw new AccessError(400,'INVALID_INPUT');
 const ids=[...new Set(raw.map(value=>id(value)))].sort();
 return identity.sql.begin(async tx=>{
  const access=await inventoryAuthority(tx,principal);
  // fulfillment.shipment_id is UNIQUE (migration 0019), so the left join yields at most one row per shipment.
  const shipments=await tx`select s.id,s.warehouse_id,o.number order_number,o.status order_status,w.name warehouse_name,f.id fulfillment_id,f.handover_at
   from app.order_shipment s join app.commerce_order o on o.id=s.order_id join app.warehouse w on w.id=s.warehouse_id left join app.fulfillment f on f.shipment_id=s.id
   where s.id in ${tx(ids)}`;
  if(shipments.length!==ids.length)throw new AccessError(404,'NOT_FOUND');
  for(const warehouseId of new Set(shipments.map(row=>String(row.warehouse_id))))await assertInventoryWarehouse(tx,warehouseId,access,false);
  const open=shipments.filter(row=>row.fulfillment_id!==null&&row.handover_at===null&&row.order_status!=='cancelled');
  const skipped=shipments.filter(row=>!open.includes(row)).map(row=>String(row.id)).sort();
  // fulfillment_item is one physical UNIT (unique order_item_id+unit_index), and exception_cancellation.fulfillment_item_id
  // names that unit, so excluding a cancelled unit subtracts exactly that unit's component quantities.
  // A cancellation WITH replacement_link_id cancels the replacement occurrence: replacement parcels live in
  // app.replacement_shipment with their own allocations and are never order_shipment ids, so the original unit is not
  // affected and cannot be counted twice here.
  const rows=open.length?await tx`select a.stock_item_id,stock.sku,stock.name,fi.shipment_id,sum(a.quantity)::int quantity
   from app.fulfillment_component_allocation a join app.fulfillment_item fi on fi.id=a.fulfillment_item_id join app.stock_item stock on stock.id=a.stock_item_id
   where fi.shipment_id in ${tx(open.map(row=>String(row.id)))}
    and not exists(select 1 from app.exception_cancellation c where c.fulfillment_item_id=fi.id and c.replacement_link_id is null)
   group by a.stock_item_id,stock.sku,stock.name,fi.shipment_id`:[];
  const info=new Map(open.map(row=>[String(row.id),row]));
  const lines:PicklistLine[]=rows.map(row=>{const s=info.get(String(row.shipment_id));if(!s)throw new AccessError(409,'FULFILLMENT_STOCK_INVALID');
   return {shipment_id:String(row.shipment_id),order_number:String(s.order_number),warehouse_id:String(s.warehouse_id),warehouse_name:String(s.warehouse_name),stock_item_id:String(row.stock_item_id),sku:String(row.sku),name:String(row.name),quantity:Number(row.quantity)};});
  return {...aggregatePicklist(lines),skipped_shipment_ids:skipped};
 });
}

export async function handlePicklists(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);
  if(['authorization','x-cart-token','x-order-token'].some(h=>request.headers.has(h)))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  if(request.method!=='GET')throw new AccessError(404,'NOT_FOUND');
  const principal=await getPrincipal(request,identity);
  if(!principal.roles.some(r=>['owner','ecommerce_admin','warehouse'].includes(r)))throw new AccessError(403,'FORBIDDEN');
  return privateJson(await readPicklist(identity,principal,new URL(request.url)));
 }catch(error){return problem(error);}
}
