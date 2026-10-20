import type {LocalAuth} from '../access/auth.ts';
import {AccessError,type Principal} from '../access/policy.ts';
import {id,integer,invalid} from '../catalog/validation.ts';
import {projectOrder} from '../checkout/orders.ts';
import {assertInventoryWarehouse,inventoryAuthority} from '../inventory/state.ts';
import {projectFulfillment} from './core.ts';

export async function listFulfillments(identity:LocalAuth,principal:Principal,url:URL){
 const names=['warehouse_id','status','cursor','limit'];
 if([...url.searchParams.keys()].some(k=>!names.includes(k)||url.searchParams.getAll(k).length!==1))throw invalid();
 const raw=url.searchParams.get('limit')??'20';if(!/^\d{1,3}$/.test(raw))throw invalid();
 const limit=integer(Number(raw),1,100),cursor=url.searchParams.has('cursor')?id(url.searchParams.get('cursor')):null;
 const warehouse=url.searchParams.has('warehouse_id')?id(url.searchParams.get('warehouse_id')):null,status=url.searchParams.get('status');
 if(status!==null&&!['ready','picking','packed','handover_pending','handed_over','exception'].includes(status))throw invalid();
 return identity.sql.begin(async tx=>{
  const access=await inventoryAuthority(tx,principal);if(warehouse)await assertInventoryWarehouse(tx,warehouse,access,false);
  const rows=await tx`select f.id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id join app.warehouse w on w.id=s.warehouse_id
   where (${cursor}::uuid is null or f.id>${cursor}::uuid) and (${warehouse}::uuid is null or s.warehouse_id=${warehouse}::uuid)
    and (w.active or ${warehouse}::uuid is not null) and (${status}::text is null or f.status=${status})
    and (${access.owner} or exists(select 1 from app.warehouse_membership m where m.user_id=${principal.id} and m.warehouse_id=w.id and w.active))
   order by f.id limit ${limit+1}`;
  const data=[];for(const row of rows.slice(0,limit))data.push(await projectFulfillment(tx,row.id));
  return {data,pagination:{next_cursor:rows.length>limit?rows[limit-1].id:null}};
 });
}
export async function readFulfillment(identity:LocalAuth,principal:Principal,selected:string,shipment=false){
 const resource=id(selected);
 return identity.sql.begin(async tx=>{
  const access=await inventoryAuthority(tx,principal),[scope]=await tx`select f.id,s.id shipment_id,s.warehouse_id,s.order_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where ${shipment?tx`s.id=${resource}`:tx`f.id=${resource}`}`;
  if(!scope)throw new AccessError(404,'NOT_FOUND');await assertInventoryWarehouse(tx,scope.warehouse_id,access,false);
  // Provider callbacks take UPDATE on this parent. Hold one shared fence before
  // either projection so parcel tracking and booking metadata cannot straddle it.
  await tx`select id from app.commerce_order where id=${scope.order_id} for share`;
  await assertInventoryWarehouse(tx,scope.warehouse_id,await inventoryAuthority(tx,principal),false);
  const fulfillment=await projectFulfillment(tx,scope.id);if(!shipment)return fulfillment;
  const parcel=(await projectOrder(tx,scope.order_id)).shipments.find(s=>s.id===scope.shipment_id);if(!parcel)throw new AccessError(404,'NOT_FOUND');
  return {...parcel,order_id:scope.order_id,fulfillment_id:scope.id,booking_id:fulfillment.booking_id,booking_status:fulfillment.booking_status,operation_status:fulfillment.operation_status,version:fulfillment.version};
 });
}
