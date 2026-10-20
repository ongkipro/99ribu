import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { array, id, integer, invalid, object, pageInput, text } from "../catalog/validation.ts";
import { mutateInventory } from "./operations.ts";
import { activateReservation, consumeTransferReservation, prepareReservation, releaseReservation } from "./reservations.ts";
import { assertInventoryWarehouse, ensurePosition, inventoryAuthority, lockInventoryClock, postMovement, readPosition, type InventoryAuthority } from "./state.ts";

type TransferRow = { id:string; from_warehouse_id:string; to_warehouse_id:string; stock_item_id:string; quantity:number;
  reservation_id:string; status:string; revision:number; received_quantity:number; quarantined_quantity:number; created_at:string };

async function transferRow(tx:TransactionSql, transferId:string, lock:'read'|'share'|'update'='read') {
  const rows=await tx<TransferRow[]>`select * from app.warehouse_transfer where id=${transferId}
    ${lock==='update'?tx`for update`:lock==='share'?tx`for share`:tx``}`;
  if (!rows[0]) throw new AccessError(404,"NOT_FOUND"); return rows[0];
}
async function assertTransferRead(tx:TransactionSql, row:TransferRow, access:InventoryAuthority) {
  if (!access.owner && ![row.from_warehouse_id,row.to_warehouse_id].some((wh)=>access.warehouseIds.includes(wh))) throw new AccessError(404,"NOT_FOUND");
  if (access.owner) await assertInventoryWarehouse(tx,row.from_warehouse_id,access,false);
}
async function allocations(tx:TransactionSql, row:TransferRow) {
  return tx<{ source_balance_id:string; lot_id:string|null; lot_code:string|null; expires_on:string|null; quantity:number; received_quantity:number; quarantined_quantity:number }[]>`
    select c.balance_id as source_balance_id,b.lot_id,l.code as lot_code,l.expires_on::text as expires_on,c.quantity,
      coalesce(receipts.received,0)::int as received_quantity,coalesce(receipts.quarantined,0)::int as quarantined_quantity
    from app.stock_reservation_component c join app.inventory_balance b on b.id=c.balance_id left join app.inventory_lot l on l.id=b.lot_id
    left join lateral (select sum(p.quantity::bigint) as received,sum(p.quarantined_quantity::bigint) as quarantined
      from app.transfer_receipt_component p join app.transfer_receipt r on r.id=p.receipt_id
      where r.transfer_id=${row.id} and p.source_balance_id=c.balance_id) receipts on true
    where c.reservation_id=${row.reservation_id} order by c.balance_id`;
}
async function projectTransfer(tx:TransactionSql, row:TransferRow) {
  return { id:row.id,from_warehouse_id:row.from_warehouse_id,to_warehouse_id:row.to_warehouse_id,stock_item_id:row.stock_item_id,
    quantity:row.quantity,status:row.status,version:row.revision,received_quantity:row.received_quantity,quarantined_quantity:row.quarantined_quantity,
    outstanding_quantity:row.status==='requested'||row.status==='cancelled' ? 0 : row.quantity-row.received_quantity,
    created_at:new Date(row.created_at).toISOString(),allocations:await allocations(tx,row) };
}
export async function getTransfer(identity:LocalAuth, principal:Principal, transferId:string) {
  return identity.sql.begin(async(tx)=>{
    const access=await inventoryAuthority(tx,principal); const row=await transferRow(tx,id(transferId),'share'); await assertTransferRead(tx,row,access);
    return projectTransfer(tx,row);
  });
}
export async function listTransfers(identity:LocalAuth, principal:Principal, url:URL) {
  for (const key of url.searchParams.keys()) if (!['cursor','limit','warehouse_id','status'].includes(key)||url.searchParams.getAll(key).length!==1) throw invalid();
  const paging=new URL(url); paging.searchParams.delete('warehouse_id'); paging.searchParams.delete('status'); const page=pageInput(paging);
  const warehouseId=url.searchParams.has('warehouse_id')?id(url.searchParams.get('warehouse_id')):null;
  const status=url.searchParams.get('status'); if (status!==null&&!['requested','dispatched','received','exception','cancelled'].includes(status)) throw invalid();
  return identity.sql.begin(async(tx)=>{
    const access=await inventoryAuthority(tx,principal); if (warehouseId) await assertInventoryWarehouse(tx,warehouseId,access,false);
    const rows=await tx<TransferRow[]>`select t.* from app.warehouse_transfer t where (${access.owner} or t.from_warehouse_id=any(${tx.array(access.warehouseIds)}::uuid[]) or t.to_warehouse_id=any(${tx.array(access.warehouseIds)}::uuid[]))
      and (${warehouseId}::uuid is null or t.from_warehouse_id=${warehouseId} or t.to_warehouse_id=${warehouseId})
      and (${status}::text is null or t.status=${status}) and (${page.cursor}::uuid is null or t.id>${page.cursor}) order by t.id limit ${page.limit+1} for share`;
    const selected=rows.slice(0,page.limit);
    return { data:await Promise.all(selected.map((row)=>projectTransfer(tx,row))),pagination:{ next_cursor:rows.length>page.limit?selected.at(-1)?.id??null:null } };
  });
}

// The namespace is an explicit host/server option, never an HTTP field.
export async function createTransfer(request:Request, identity:LocalAuth, principal:Principal, value:unknown, clockNamespace:string|null=null) {
  const body=object(value,['from_warehouse_id','to_warehouse_id','stock_item_id','quantity','reason']);
  const input={ from_warehouse_id:id(body.from_warehouse_id),to_warehouse_id:id(body.to_warehouse_id),stock_item_id:id(body.stock_item_id),
    quantity:integer(body.quantity,1,1000000),reason:text(body.reason,500) };
  if(input.from_warehouse_id===input.to_warehouse_id) throw invalid();
  return mutateInventory(request,identity,principal,'inventory.transfer.create',{...input,clock_namespace:clockNamespace},[input.from_warehouse_id,input.to_warehouse_id],input.reason,async(tx,_access,sourceRef)=>{
    if(!(await tx`select id from app.stock_item where id=${input.stock_item_id}`).length) throw new AccessError(404,'NOT_FOUND');
    await lockInventoryClock(tx,clockNamespace,[input.from_warehouse_id,input.to_warehouse_id]);
    const reservation=await prepareReservation(tx,{ key:`transfer:${sourceRef}`,kind:'transfer',expiresAt:null,clockNamespace,
      requirements:[{warehouse_id:input.from_warehouse_id,stock_item_id:input.stock_item_id,quantity:input.quantity}],intent:input,actorId:principal.id });
    const [count]=await tx`select count(*)::int as n from app.stock_reservation_component where reservation_id=${reservation.id}`;
    // lazy: one transfer carries at most100 source positions; split larger batch
    // manifests until a paginated allocation contract is justified.
    if(count.n>100) throw new AccessError(409,'TRANSFER_LOT_LIMIT');
    const [row]=await tx<TransferRow[]>`insert into app.warehouse_transfer (from_warehouse_id,to_warehouse_id,stock_item_id,quantity,reservation_id)
      values (${input.from_warehouse_id},${input.to_warehouse_id},${input.stock_item_id},${input.quantity},${reservation.id}) returning *`;
    await activateReservation(tx,reservation.id);
    return {id:row.id,response:await projectTransfer(tx,row)};
  });
}

async function lockedTransfer(tx:TransactionSql, transferId:string, expectedVersion:number) {
  const prior=await transferRow(tx,transferId);
  const [reservation]=await tx`select clock_namespace from app.stock_reservation where id=${prior.reservation_id}`;
  if(!reservation) throw new AccessError(503,'INVENTORY_INVALID');
  const clock=await lockInventoryClock(tx,reservation.clock_namespace,[prior.from_warehouse_id,prior.to_warehouse_id]);
  const row=await transferRow(tx,transferId,'update');
  if(row.revision!==expectedVersion) throw new AccessError(409,'VERSION_CONFLICT');
  return {row,clock};
}
export async function resolveTransfer(request:Request, identity:LocalAuth, principal:Principal, transferId:string, action:'dispatch'|'cancel', value:unknown) {
  const body=object(value,['expected_version','reason']); const input={transfer_id:id(transferId),expected_version:integer(body.expected_version,1),reason:text(body.reason,500)};
  const [scope]=await identity.sql`select from_warehouse_id from app.warehouse_transfer where id=${input.transfer_id}`;
  if(!scope) throw new AccessError(404,'NOT_FOUND');
  return mutateInventory(request,identity,principal,`inventory.transfer.${action}`,input,[scope.from_warehouse_id],input.reason,async(tx)=>{
    const {row}=await lockedTransfer(tx,input.transfer_id,input.expected_version);
    if(row.status!=='requested') throw new AccessError(409,'TRANSFER_NOT_REQUESTED');
    if(action==='dispatch') await consumeTransferReservation(tx,row.reservation_id,principal.id,input.reason);
    else await releaseReservation(tx,row.reservation_id,input.reason,principal.id);
    const [updated]=await tx<TransferRow[]>`update app.warehouse_transfer set status=${action==='dispatch'?'dispatched':'cancelled'},revision=revision+1 where id=${row.id} returning *`;
    return {id:row.id,response:await projectTransfer(tx,updated)};
  });
}
export async function receiveTransfer(request:Request, identity:LocalAuth, principal:Principal, transferId:string, value:unknown) {
  const body=object(value,['expected_version','reason','allocations']);
  const input={ transfer_id:id(transferId),expected_version:integer(body.expected_version,1),reason:text(body.reason,500),allocations:array(body.allocations,(value)=>{
    const part=object(value,['source_balance_id','received_quantity','quarantined_quantity']); const quantity=integer(part.received_quantity,1,1000000);
    return {source_balance_id:id(part.source_balance_id),received_quantity:quantity,quarantined_quantity:integer(part.quarantined_quantity,0,quantity)};
  }).sort((a,b)=>a.source_balance_id.localeCompare(b.source_balance_id)) };
  if(new Set(input.allocations.map((p)=>p.source_balance_id)).size!==input.allocations.length) throw invalid();
  const [scope]=await identity.sql`select to_warehouse_id from app.warehouse_transfer where id=${input.transfer_id}`;
  if(!scope) throw new AccessError(404,'NOT_FOUND');
  return mutateInventory(request,identity,principal,'inventory.transfer.receive',input,[scope.to_warehouse_id],input.reason,async(tx)=>{
    const {row,clock}=await lockedTransfer(tx,input.transfer_id,input.expected_version);
    if(!['dispatched','exception'].includes(row.status)) throw new AccessError(409,'TRANSFER_NOT_DISPATCHED');
    const sources=await allocations(tx,row);
    const plan=input.allocations.map((part)=>{
      const source=sources.find((s)=>s.source_balance_id===part.source_balance_id);
      if(!source||part.received_quantity>source.quantity-source.received_quantity) throw new AccessError(409,'RECEIPT_EXCEEDS_DISPATCHED_LOT');
      return {...part,lot_id:source.lot_id};
    });
    const destination=new Map<string,string>();
    for(const part of [...plan].sort((a,b)=>(a.lot_id??'').localeCompare(b.lot_id??''))) destination.set(part.source_balance_id,await ensurePosition(tx,row.to_warehouse_id,row.stock_item_id,part.lot_id));
    const ids=[...destination.values()].sort(); if(ids.length) await tx`select id from app.inventory_balance where id in ${tx(ids)} order by id for update`;
    const received=plan.reduce((n,p)=>n+p.received_quantity,0); let quarantined=0;
    const prepared=[];
    for(const part of plan){
      const balanceId=destination.get(part.source_balance_id); if(!balanceId) throw new AccessError(503,'INVENTORY_INVALID');
      const expired=(await readPosition(tx,balanceId,clock.namespace)).expired;
      const bad=expired?part.received_quantity:part.quarantined_quantity; quarantined+=bad;
      prepared.push({...part,balanceId,quarantined_quantity:bad});
    }
    const receiptId=randomUUID();
    await tx`insert into app.transfer_receipt (id,transfer_id,revision,received_quantity,quarantined_quantity,actor_id,reason)
      values (${receiptId},${row.id},${row.revision+1},${received},${quarantined},${principal.id},${input.reason})`;
    for(const part of prepared.sort((a,b)=>a.balanceId.localeCompare(b.balanceId))){
      await tx`insert into app.transfer_receipt_component (receipt_id,source_balance_id,quantity,quarantined_quantity)
        values (${receiptId},${part.source_balance_id},${part.received_quantity},${part.quarantined_quantity})`;
      await postMovement(tx,{balanceId:part.balanceId,kind:'transfer_in',quantity:part.received_quantity,onHand:part.received_quantity,reserved:0,
        quarantined:part.quarantined_quantity,sourceRef:receiptId,actorId:principal.id,reason:input.reason});
    }
    const total=row.received_quantity+received;
    const [updated]=await tx<TransferRow[]>`update app.warehouse_transfer set status=${total===row.quantity?'received':'exception'},revision=revision+1,
      received_quantity=${total},quarantined_quantity=${row.quarantined_quantity+quarantined} where id=${row.id} returning *`;
    return {id:row.id,response:await projectTransfer(tx,updated)};
  });
}
