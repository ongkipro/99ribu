import {createHash,randomUUID} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {readLocalConfig} from '../../config/local.ts';
import {AccessError,type Principal} from '../access/policy.ts';
import {id,integer,invalid,object,text} from '../catalog/validation.ts';
import {assertInventoryWarehouse,inventoryAuthority} from '../inventory/state.ts';
import {enqueueJob} from '../../jobs/outbox.ts';
import {lockPaymentOrder} from '../payments/attempts.ts';
import {financeEnvironment,financeInstant} from '../finance/ledger.ts';
import {createManualParcelReceiptSource,registerParcelReceiptSource} from '../returns/receipt-source.ts';
import {advanceFulfillment,fulfillmentClock,lockFulfillment,projectFulfillment} from './core.ts';
import {commitHandover,commitPreparation,mutate} from './commands.ts';

// DEC-007 / S91. Every resi belongs to 99ribu's own Mengantar account: the
// operator books in the Mengantar dashboard and enters courier + resi here.
export const COURIERS={jne:'JNE',jnt:'J&T Express',sicepat:'SiCepat',sap:'SAP Express',ninja:'Ninja Xpress',anteraja:'AnterAja',idexpress:'ID Express',lion:'Lion Parcel',pos:'Pos Indonesia'} as const;
export type Courier=keyof typeof COURIERS;
// Flips only when S94 ships a sandbox-verified Mengantar booking adapter.
export const MENGANTAR_API_BOOKING_ENABLED=false;
export type Readiness='complete'|'incomplete';
export type FulfillmentMode='mengantar_api'|'manual_dashboard';
export function fulfillmentMode(readiness:Readiness,enabled:boolean=MENGANTAR_API_BOOKING_ENABLED):FulfillmentMode{return readiness==='complete'&&enabled?'mengantar_api':'manual_dashboard';}
export function pickupReadiness(profile:{street_address:string|null;pic_name:string|null;pic_phone:string|null}|null|undefined):Readiness{
 return profile?.street_address&&profile.pic_name&&profile.pic_phone?'complete':'incomplete';
}
export function courier(value:unknown):Courier{if(typeof value!=='string'||!Object.hasOwn(COURIERS,value))throw new AccessError(422,'INVALID_COURIER');return value as Courier;}
// lazy: one conservative resi format for every courier (uppercase letters, digits,
// hyphen, 8-40). Per-courier patterns need ops-confirmed real samples first.
export function trackingNumber(value:unknown){
 if(typeof value!=='string'||value.length>80)throw new AccessError(422,'INVALID_TRACKING_NUMBER');
 const normalized=value.trim().toUpperCase().replace(/\s+/g,'');
 if(!/^[A-Z0-9][A-Z0-9-]{7,39}$/.test(normalized))throw new AccessError(422,'INVALID_TRACKING_NUMBER');return normalized;
}
function purchaseReference(value:unknown){const result=text(value,80);if(!/^[A-Za-z0-9][A-Za-z0-9._:/#-]{1,79}$/.test(result))throw new AccessError(422,'INVALID_PURCHASE_REFERENCE');return result;}
function phone(value:unknown){
 if(value===null)return null;const raw=text(value,24).replace(/[\s-]/g,''),normalized=raw.startsWith('+62')?raw.slice(1):raw.startsWith('0')?`62${raw.slice(1)}`:raw;
 if(!/^62[1-9][0-9]{7,12}$/.test(normalized))throw new AccessError(422,'INVALID_PIC_PHONE');return normalized;
}
const iso=(value:unknown)=>value==null?null:new Date(value as string).toISOString();
function idempotencyKey(request:Request){const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key))throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');return key;}
const hashOf=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// ---- Pickup profile (private personal data; owner/ecommerce_admin only) ----
async function profileAuthority(tx:TransactionSql,principal:Principal){
 const access=await inventoryAuthority(tx,principal);
 if(!access.roles.some((role:string)=>['owner','ecommerce_admin'].includes(role)))throw new AccessError(403,'FORBIDDEN');
 return access;
}
async function latestProfile(tx:TransactionSql,warehouseId:string,revision?:number){
 const [row]=revision===undefined?await tx`select * from app.warehouse_pickup_profile where warehouse_id=${warehouseId} order by revision desc limit 1`
  :await tx`select * from app.warehouse_pickup_profile where warehouse_id=${warehouseId} and revision=${revision}`;return row??null;
}
export async function warehouseMode(tx:TransactionSql,warehouseId:string){
 const profile=await latestProfile(tx,warehouseId),readiness=pickupReadiness(profile as never);return {readiness,mode:fulfillmentMode(readiness)};
}
function projectProfile(warehouse:{id:string;name:string},row:Record<string,unknown>|null){
 const readiness=pickupReadiness(row as never);
 return {warehouse_id:warehouse.id,warehouse_name:warehouse.name,version:row?Number(row.revision):0,readiness,mode:fulfillmentMode(readiness),mengantar_api_enabled:MENGANTAR_API_BOOKING_ENABLED,
  street_address:(row?.street_address as string|null)??null,pic_name:(row?.pic_name as string|null)??null,pic_phone:(row?.pic_phone as string|null)??null,
  pinpoint:row?.latitude_e6==null?null:{latitude:Number(row.latitude_e6)/1e6,longitude:Number(row.longitude_e6)/1e6},updated_at:iso(row?.created_at)};
}
export async function readPickupProfile(identity:LocalAuth,principal:Principal,warehouseId:string){
 const selected=id(warehouseId);
 return identity.sql.begin(async tx=>{
  await assertInventoryWarehouse(tx,selected,await profileAuthority(tx,principal),false);const [warehouse]=await tx`select id,name from app.warehouse where id=${selected}`;if(!warehouse)throw new AccessError(404,'NOT_FOUND');
  return projectProfile(warehouse as never,await latestProfile(tx,selected));
 });
}
export async function writePickupProfile(request:Request,identity:LocalAuth,principal:Principal,warehouseId:string,value:unknown){
 const selected=id(warehouseId),key=idempotencyKey(request),body=object(value,['expected_version','street_address','pic_name','pic_phone','pinpoint','reason']);
 const pinpoint=body.pinpoint==null?null:object(body.pinpoint,['latitude','longitude']);
 if(pinpoint&&(typeof pinpoint.latitude!=='number'||typeof pinpoint.longitude!=='number'||!Number.isFinite(pinpoint.latitude)||!Number.isFinite(pinpoint.longitude)))throw invalid();
 const input={expected_version:integer(body.expected_version,0),street_address:body.street_address==null?null:text(body.street_address,300),pic_name:body.pic_name==null?null:text(body.pic_name,120),
  pic_phone:phone(body.pic_phone??null),latitude_e6:pinpoint?Math.round(Number(pinpoint.latitude)*1e6):null,longitude_e6:pinpoint?Math.round(Number(pinpoint.longitude)*1e6):null,reason:text(body.reason,200)};
 if(input.street_address!==null&&Array.from(input.street_address).length<10)throw new AccessError(422,'INVALID_STREET_ADDRESS');
 if(input.pic_name!==null&&Array.from(input.pic_name).length<2)throw new AccessError(422,'INVALID_PIC_NAME');
 if(input.latitude_e6!==null&&(input.latitude_e6<-11000000||input.latitude_e6>6000000||(input.longitude_e6 as number)<95000000||(input.longitude_e6 as number)>141000000))throw new AccessError(422,'INVALID_PINPOINT');
 const hash=hashOf({warehouse_id:selected,...input});
 return identity.sql.begin(async tx=>{
  // Same membership scope as the manual queue: non-owners see only their warehouses.
  await assertInventoryWarehouse(tx,selected,await profileAuthority(tx,principal),false);
  const [previous]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='warehouse.pickup_profile' and key=${key}`;
  const [warehouse]=await tx`select id,name from app.warehouse where id=${selected} for update`;if(!warehouse)throw new AccessError(404,'NOT_FOUND');
  // Replay re-projects the revision this key wrote (the stored response holds no personal data).
  if(previous){if(previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return projectProfile(warehouse as never,await latestProfile(tx,selected,Number(previous.response.version)));}
  const current=await latestProfile(tx,selected);if((current?Number(current.revision):0)!==input.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  await tx`insert into app.warehouse_pickup_profile (warehouse_id,revision,street_address,pic_name,pic_phone,latitude_e6,longitude_e6,actor_id,reason)
   values (${selected},${input.expected_version+1},${input.street_address},${input.pic_name},${input.pic_phone},${input.latitude_e6},${input.longitude_e6},${principal.id},${input.reason})`;
  const response=projectProfile(warehouse as never,await latestProfile(tx,selected));
  // Audit records which fields changed, never their personal-data values.
  const changed=['street_address','pic_name','pic_phone'].filter(field=>(current?.[field]??null)!==input[field as 'street_address'])
   .concat((current?.latitude_e6??null)!==input.latitude_e6||(current?.longitude_e6??null)!==input.longitude_e6?['pinpoint']:[]);
  await tx`insert into app.access_operation (id,actor_id,action,key,request_hash,response) values (${randomUUID()},${principal.id},'warehouse.pickup_profile',${key},${hash},${JSON.stringify({warehouse_id:selected,version:response.version})}::jsonb)`;
  await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details) values (${principal.id},'warehouse.pickup_profile',${selected},'allowed',${input.reason},${JSON.stringify({version:response.version,changed_fields:changed,readiness:response.readiness})}::jsonb)`;
  return response;
 });
}

// ---- Manual queue and per-parcel projection ----
// failed = a delivery attempt failed (not terminal); only delivered is terminal.
const RANK={picked_up:1,in_transit:2,failed:3,delivered:4} as const;
export type TrackingStatus=keyof typeof RANK;
export async function projectManual(tx:TransactionSql,fulfillmentId:string){
 const versions=await tx`select id,version,courier,tracking_number,reason,actor_id,created_at from app.manual_tracking where fulfillment_id=${fulfillmentId} order by version`;
 const references=await tx`select version,reference,created_at from app.fulfillment_purchase_reference where fulfillment_id=${fulfillmentId} order by version desc limit 1`;
 const events=await tx`select status,source_kind,adapter,occurred_at from app.shipment_tracking_event where fulfillment_id=${fulfillmentId} order by occurred_at,recorded_at`;
 const current=versions.at(-1);
 return {courier:current?String(current.courier):null,courier_name:current?COURIERS[current.courier as Courier]:null,tracking_number:current?String(current.tracking_number):null,
  tracking_versions:versions.map(v=>({version:Number(v.version),courier:String(v.courier),tracking_number:String(v.tracking_number),reason:String(v.reason),created_at:iso(v.created_at)})),
  purchase_reference:references[0]?{version:Number(references[0].version),reference:String(references[0].reference)}:null,purchase_reference_version:references[0]?Number(references[0].version):0,
  tracking_status:events.length?String(events.at(-1)?.status):null,tracking_events:events.map(e=>({status:String(e.status),source:String(e.source_kind),adapter:e.adapter===null?null:String(e.adapter),occurred_at:iso(e.occurred_at)}))};
}
// Buyer-safe parcel facts: courier, resi and delivery status only.
export async function buyerManualParcel(tx:TransactionSql,shipmentId:string){
 const [row]=await tx`select f.id from app.fulfillment f where f.shipment_id=${shipmentId} and f.booking_id is null and exists(select 1 from app.manual_tracking mt where mt.fulfillment_id=f.id)`;
 if(!row)return null;const manual=await projectManual(tx,String(row.id));
 return {courier:manual.courier,courier_name:manual.courier_name,tracking_number:manual.tracking_number,tracking_status:manual.tracking_status};
}
export async function listManualQueue(identity:LocalAuth,principal:Principal,url:URL){
 const names=['queue','warehouse_id','cursor','limit'];
 if([...url.searchParams.keys()].some(k=>!names.includes(k)||url.searchParams.getAll(k).length!==1))throw invalid();
 const queue=url.searchParams.get('queue')??'to_book';if(!['to_book','shipped'].includes(queue))throw invalid();
 const raw=url.searchParams.get('limit')??'20';if(!/^\d{1,3}$/.test(raw))throw invalid();
 const limit=integer(Number(raw),1,100),cursor=url.searchParams.has('cursor')?id(url.searchParams.get('cursor')):null,warehouse=url.searchParams.has('warehouse_id')?id(url.searchParams.get('warehouse_id')):null;
 return identity.sql.begin(async tx=>{
  const access=await inventoryAuthority(tx,principal);if(warehouse)await assertInventoryWarehouse(tx,warehouse,access,false);
  // Warehouses in Mengantar API mode leave this queue (none while the flag is off).
  const automatedIds:string[]=[];
  if(MENGANTAR_API_BOOKING_ENABLED)for(const row of await tx`select distinct warehouse_id from app.warehouse_pickup_profile`)if((await warehouseMode(tx,String(row.warehouse_id))).mode==='mengantar_api')automatedIds.push(String(row.warehouse_id));
  const membership=queue==='to_book'
   ?tx`f.handover_at is null and f.booking_id is null and not exists(select 1 from app.shipment_booking b where b.fulfillment_id=f.id)
     and (f.status in ('ready','picking') or (f.status='exception' and f.calendar_error is not null))
     and exists(select 1 from app.fulfillment_item unit where unit.shipment_id=f.shipment_id and not exists(select 1 from app.exception_cancellation c where c.fulfillment_item_id=unit.id and c.replacement_link_id is null))`
   :tx`f.handover_at is not null and exists(select 1 from app.manual_tracking mt where mt.fulfillment_id=f.id)
     and not exists(select 1 from app.shipment_tracking_event t where t.fulfillment_id=f.id and t.status='delivered')`;
  const rows=await tx`select f.id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id join app.warehouse w on w.id=s.warehouse_id
   where ${membership} and (${cursor}::uuid is null or f.id>${cursor}::uuid) and (${warehouse}::uuid is null or s.warehouse_id=${warehouse}::uuid)
    and not (s.warehouse_id=any(${automatedIds}::uuid[])) and (w.active or ${warehouse}::uuid is not null)
    and (${access.owner} or exists(select 1 from app.warehouse_membership m where m.user_id=${principal.id} and m.warehouse_id=w.id and w.active))
   order by f.id limit ${limit+1}`;
  const data=[];
  for(const row of rows.slice(0,limit)){
   const fulfillment=await projectFulfillment(tx,row.id),[context]=await tx`select o.number order_number,o.payment_method,w.name warehouse_name,w.city warehouse_city,w.district warehouse_district from app.commerce_order o join app.warehouse w on w.id=${fulfillment.warehouse_id} where o.id=${fulfillment.order_id}`;
   data.push({...fulfillment,manual:await projectManual(tx,String(row.id)),order_number:String(context.order_number),payment_method:String(context.payment_method),warehouse_name:String(context.warehouse_name),warehouse_city:String(context.warehouse_city),warehouse_district:context.warehouse_district===null?null:String(context.warehouse_district),mode:'manual_dashboard'});
  }
  return {data,pagination:{next_cursor:rows.length>limit?rows[limit-1].id:null}};
 });
}

// ---- Manual resi entry, correction and purchase reference ----
async function assertManualMode(tx:TransactionSql,warehouseId:string){if((await warehouseMode(tx,warehouseId)).mode!=='manual_dashboard')throw new AccessError(409,'FULFILLMENT_MODE_AUTOMATED');}
async function activeUnits(tx:TransactionSql,shipmentId:string){
 return (await tx`select unit.id from app.fulfillment_item unit where unit.shipment_id=${shipmentId} and not exists(select 1 from app.exception_cancellation c where c.fulfillment_item_id=unit.id and c.replacement_link_id is null) order by unit.id`).map(row=>String(row.id));
}
async function audit(tx:TransactionSql,actorId:string,action:string,subject:string,reason:string,operationId:string,warehouseId:string){
 await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details) values (${actorId},${action},${subject},'allowed',${reason},${JSON.stringify({operation_id:operationId,warehouse_id:warehouseId})}::jsonb)`;
}
// One live resi per courier across manual parcels (the database guard is the authority).
async function assertResiFree(tx:TransactionSql,fulfillmentId:string,courierCode:Courier,number:string){
 const [taken]=await tx`select mt.fulfillment_id from app.manual_tracking mt where mt.fulfillment_id<>${fulfillmentId} and mt.courier=${courierCode} and mt.tracking_number=${number}
  and mt.version=(select max(version) from app.manual_tracking latest where latest.fulfillment_id=mt.fulfillment_id) limit 1`;
 if(taken)throw new AccessError(409,'TRACKING_NUMBER_IN_USE');
}
async function insertPurchaseReference(tx:TransactionSql,fulfillmentId:string,reference:string,actorId:string,reason:string){
 const [current]=await tx`select coalesce(max(version),0)::int version from app.fulfillment_purchase_reference where fulfillment_id=${fulfillmentId}`;
 await tx`insert into app.fulfillment_purchase_reference (fulfillment_id,version,reference,actor_id,reason) values (${fulfillmentId},${current.version+1},${reference},${actorId},${reason})`;
}
export async function shipManually(request:Request,identity:LocalAuth,principal:Principal,fulfillmentId:string,value:unknown){
 const body=object(value,['expected_version','courier','tracking_number','purchase_reference','reason']);
 const input={expected_version:integer(body.expected_version,1),courier:courier(body.courier),tracking_number:trackingNumber(body.tracking_number),
  purchase_reference:body.purchase_reference==null||body.purchase_reference===''?null:purchaseReference(body.purchase_reference),reason:body.reason===undefined?'Booked in the Mengantar dashboard':text(body.reason,200)};
 return mutate(request,identity,principal,fulfillmentId,'fulfillment.manual_issue',input,async(tx,state,operationId)=>{
  const {head,order}=state;await assertManualMode(tx,head.warehouse_id);
  if(head.handover_at||head.waybill_issued_at)throw new AccessError(409,'FULFILLMENT_ALREADY_SHIPPED');
  if(head.booking_id||(await tx`select id from app.shipment_booking where fulfillment_id=${head.id}`).length)throw new AccessError(409,'FULFILLMENT_PATH_BOOKED');
  // Each milestone event needs its own committed scoped operation (one causal
  // source per event). Sub-operation keys contain '.', which client keys cannot.
  let current=head;const prepareOperation=head.prepared_at?null:randomUUID(),handoverOperation=randomUUID();
  if(prepareOperation){
   const ready=(head.status==='ready'&&head.deadline_id&&!head.calendar_error)||(head.status==='exception'&&head.calendar_error&&!head.deadline_id);
   if(!ready)throw new AccessError(409,'FULFILLMENT_NOT_READY');
   current=(await commitPreparation(tx,state,prepareOperation,principal.id,input.reason)).head;
   await audit(tx,principal.id,'fulfillment.prepare',head.id,input.reason,prepareOperation,head.warehouse_id);
  }else if(head.status!=='picking')throw new AccessError(409,'FULFILLMENT_NOT_READY');
  const units=await activeUnits(tx,head.shipment_id);if(!units.length)throw new AccessError(409,'FULFILLMENT_NO_ACTIVE_UNITS');
  await assertResiFree(tx,head.id,input.courier,input.tracking_number);
  const now=await fulfillmentClock(tx,order.clock_namespace);
  const issued=await advanceFulfillment(tx,current,{kind:'manual_issued',status:'packed',source_kind:'operation',source_id:operationId,actor_id:principal.id,reason:input.reason,occurred_at:now,waybill_issued_at:now,tracking_number:input.tracking_number});
  const [tracking]=await tx`insert into app.manual_tracking (fulfillment_id,version,courier,tracking_number,unit_ids,fulfillment_event_id,actor_id,reason) values (${head.id},1,${input.courier},${input.tracking_number},${JSON.stringify(units)}::jsonb,${issued.eventId},${principal.id},${input.reason}) returning id`;
  if(input.purchase_reference)await insertPurchaseReference(tx,head.id,input.purchase_reference,principal.id,input.reason);
  await commitHandover(tx,{head:issued.head,order},handoverOperation,principal.id,input.reason,`${COURIERS[input.courier]} ${input.tracking_number}`);
  await audit(tx,principal.id,'fulfillment.handover',head.id,input.reason,handoverOperation,head.warehouse_id);
  await enqueueJob(tx,'fulfillment.tracking.poll',`fulfillment-tracking:${tracking.id}`,{fulfillmentId:head.id,trackingId:tracking.id},10);
  const response={...await projectFulfillment(tx,head.id),manual:await projectManual(tx,head.id)},key=String(request.headers.get('idempotency-key'));
  for(const [suffix,subOperation] of [['prepare',prepareOperation],['handover',handoverOperation]] as const)if(subOperation)
   await tx`insert into app.access_operation (id,actor_id,action,key,request_hash,response) values (${subOperation},${principal.id},'fulfillment.mutate',${`${key}.${suffix}`},${hashOf({operation_id:operationId,suffix})},${JSON.stringify(response)}::jsonb)`;
  return response;
 });
}
export async function correctTracking(request:Request,identity:LocalAuth,principal:Principal,fulfillmentId:string,value:unknown){
 const body=object(value,['expected_version','courier','tracking_number','reason']);
 if(body.reason===undefined)throw new AccessError(400,'CORRECTION_REASON_REQUIRED');
 const input={expected_version:integer(body.expected_version,1),courier:courier(body.courier),tracking_number:trackingNumber(body.tracking_number),reason:text(body.reason,200)};
 return mutate(request,identity,principal,fulfillmentId,'fulfillment.tracking_correct',input,async(tx,{head,order},operationId)=>{
  const [latest]=await tx`select * from app.manual_tracking where fulfillment_id=${head.id} order by version desc limit 1`;
  if(head.booking_id||!latest)throw new AccessError(409,'TRACKING_NOT_MANUAL');
  if(latest.courier===input.courier&&latest.tracking_number===input.tracking_number)throw new AccessError(409,'TRACKING_UNCHANGED');
  if((await tx`select 1 from app.shipment_tracking_event where fulfillment_id=${head.id} and status='delivered'`).length)throw new AccessError(409,'TRACKING_ALREADY_DELIVERED');
  await assertResiFree(tx,head.id,input.courier,input.tracking_number);
  const changed=await advanceFulfillment(tx,head,{kind:'tracking_corrected',status:head.status,source_kind:'operation',source_id:operationId,actor_id:principal.id,reason:input.reason,occurred_at:await fulfillmentClock(tx,order.clock_namespace),tracking_number:input.tracking_number});
  const [tracking]=await tx`insert into app.manual_tracking (fulfillment_id,version,courier,tracking_number,unit_ids,fulfillment_event_id,actor_id,reason) values (${head.id},${Number(latest.version)+1},${input.courier},${input.tracking_number},${JSON.stringify(latest.unit_ids)}::jsonb,${changed.eventId},${principal.id},${input.reason}) returning id`;
  await enqueueJob(tx,'fulfillment.tracking.poll',`fulfillment-tracking:${tracking.id}`,{fulfillmentId:head.id,trackingId:tracking.id},10);
  return {...await projectFulfillment(tx,head.id),manual:await projectManual(tx,head.id)};
 });
}
// Scoped staff write outside the fulfillment head lineage (no milestone change).
async function scopedWrite<T>(request:Request,identity:LocalAuth,principal:Principal,fulfillmentId:string,action:string,input:Record<string,unknown>,write:(tx:TransactionSql,state:Awaited<ReturnType<typeof lockFulfillment>>,operationId:string)=>Promise<T>){
 const selected=id(fulfillmentId),key=idempotencyKey(request),hash=hashOf({fulfillment_id:selected,action,input});
 return identity.sql.begin(async tx=>{
  const access=await inventoryAuthority(tx,principal),[scope]=await tx`select s.warehouse_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where f.id=${selected}`;if(!scope)throw new AccessError(404,'NOT_FOUND');
  await assertInventoryWarehouse(tx,scope.warehouse_id,access,false);
  const [previous]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action=${action} and key=${key}`;
  if(previous){if(previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return previous.response as T;}
  const state=await lockFulfillment(tx,selected);await assertInventoryWarehouse(tx,scope.warehouse_id,await inventoryAuthority(tx,principal));
  const operationId=randomUUID(),response=await write(tx,state,operationId);
  await tx`insert into app.access_operation (id,actor_id,action,key,request_hash,response) values (${operationId},${principal.id},${action},${key},${hash},${JSON.stringify(response)}::jsonb)`;
  await audit(tx,principal.id,action,selected,String(input.reason),operationId,scope.warehouse_id);
  return response;
 });
}
export async function recordPurchaseReference(request:Request,identity:LocalAuth,principal:Principal,fulfillmentId:string,value:unknown){
 const body=object(value,['expected_version','reference','reason']);
 const input={expected_version:integer(body.expected_version,0),reference:purchaseReference(body.reference),reason:body.reason===undefined?'Berlapak purchase reference':text(body.reason,200)};
 return scopedWrite(request,identity,principal,fulfillmentId,'fulfillment.purchase_reference',input,async(tx,{head})=>{
  const [current]=await tx`select coalesce(max(version),0)::int version from app.fulfillment_purchase_reference where fulfillment_id=${head.id}`;
  if(current.version!==input.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  await insertPurchaseReference(tx,head.id,input.reference,principal.id,input.reason);
  return {...await projectFulfillment(tx,head.id),manual:await projectManual(tx,head.id)};
 });
}

// ---- Delivery tracking seam ----
export type TrackingObservation={provider_status:string;occurred_at:string};
export type TrackingAdapter={name:'simulated'|'mengantar';track:(tx:TransactionSql,query:{environment:'local'|'test';courier:Courier;tracking_number:string;since:string;clock_namespace:string|null})=>Promise<TrackingObservation[]>};
// Simulator vocabulary only; the real Mengantar status list is unverified (S98).
const SIMULATED_STATUS:Record<string,TrackingStatus>={PICKED_UP:'picked_up',IN_TRANSIT:'in_transit',DELIVERED:'delivered',RETURNED:'failed',FAILED:'failed'};
export function mapTrackingStatus(providerStatus:string):TrackingStatus|null{return Object.hasOwn(SIMULATED_STATUS,providerStatus)?SIMULATED_STATUS[providerStatus]:null;}
export const simulatedTrackingAdapter:TrackingAdapter={name:'simulated',async track(tx,query){
 const rows=await tx`select provider_status,occurred_at from app.local_tracking_observation where environment=${query.environment} and courier=${query.courier} and tracking_number=${query.tracking_number}
  and occurred_at>=${query.since} and occurred_at<=app.reservation_clock(${query.clock_namespace}) order by occurred_at,recorded_at,id limit 200`;
 return rows.map(row=>({provider_status:String(row.provider_status),occurred_at:new Date(row.occurred_at).toISOString()}));
}};
// lazy: the live Mengantar adapter (gated S98) must fetch outside this database
// transaction through a leased job; the simulated adapter only reads local rows.
export const tracking={adapter:simulatedTrackingAdapter};

type Observation={status:TrackingStatus;occurred_at:string;source:'adapter';adapter:'simulated'|'mengantar';provider_status:string}|{status:TrackingStatus;occurred_at:string;source:'operator';actor_id:string;reason:string;evidence:string};
// Caller holds the order lock. Monotonic: an equal or lower rank never applies.
async function applyObservation(tx:TransactionSql,fulfillmentId:string,observation:Observation){
 const [f]=await tx`select id,shipment_id,handover_at,booking_id from app.fulfillment where id=${fulfillmentId} for update`;
 const [current]=await tx`select id from app.manual_tracking where fulfillment_id=${fulfillmentId} order by version desc limit 1`;
 if(!f?.handover_at||f.booking_id!==null||!current)throw new AccessError(409,'TRACKING_NOT_MANUAL');
 const existing=await tx`select status from app.shipment_tracking_event where fulfillment_id=${fulfillmentId}`;
 if(existing.some(row=>RANK[row.status as TrackingStatus]>=RANK[observation.status]))return false;
 if(Date.parse(observation.occurred_at)<new Date(f.handover_at).getTime())throw new AccessError(422,'INVALID_TRACKING_TIME');
 let receipt:string|null=null;
 if(observation.status==='delivered'){
  const source=await createManualParcelReceiptSource(tx,await financeEnvironment(tx),fulfillmentId,observation.occurred_at);
  await registerParcelReceiptSource(tx,source);receipt=source.id;
 }
 const operator=observation.source==='operator'?observation:null,adapter=observation.source==='adapter'?observation:null;
 await tx`insert into app.shipment_tracking_event (fulfillment_id,tracking_id,status,source_kind,adapter,provider_status,occurred_at,actor_id,reason,evidence,receipt_source_id)
  values (${fulfillmentId},${current.id},${observation.status},${observation.source},${adapter?.adapter??null},${adapter?.provider_status??null},${observation.occurred_at},${operator?.actor_id??null},${operator?.reason??null},${operator?.evidence??null},${receipt})`;
 return true;
}
export async function recordTrackingStatus(request:Request,identity:LocalAuth,principal:Principal,fulfillmentId:string,value:unknown){
 const body=object(value,['status','occurred_at','reason','evidence']);
 if(typeof body.status!=='string'||!Object.hasOwn(RANK,body.status))throw invalid();
 const input={status:body.status as TrackingStatus,occurred_at:financeInstant(body.occurred_at),reason:text(body.reason,200),evidence:text(body.evidence,500)};
 // Delivery starts commission maturity and the return window: owner/ecommerce_admin only.
 if(input.status==='delivered'&&!principal.roles.some(role=>['owner','ecommerce_admin'].includes(role)))throw new AccessError(403,'FORBIDDEN');
 return scopedWrite(request,identity,principal,fulfillmentId,'fulfillment.tracking_status',input,async(tx,{head,order})=>{
  if(Date.parse(input.occurred_at)>Date.parse(await fulfillmentClock(tx,order.clock_namespace)))throw new AccessError(422,'INVALID_TRACKING_TIME');
  const applied=await applyObservation(tx,head.id,{...input,source:'operator',actor_id:principal.id});
  if(!applied)throw new AccessError(409,'TRACKING_STATUS_NOT_ADVANCING');
  return {...await projectFulfillment(tx,head.id),manual:await projectManual(tx,head.id)};
 });
}
const POLL_MS=30*60*1000,POLL_WINDOW_MS=30*24*60*60*1000;
export async function processTrackingPoll(tx:TransactionSql,job:{id:string;payload:unknown}){
 const input=object(job.payload,['fulfillmentId','trackingId']),fulfillmentId=id(input.fulfillmentId),trackingId=id(input.trackingId);
 const [scope]=await tx`select s.order_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where f.id=${fulfillmentId}`;if(!scope)throw new AccessError(400,'INVALID_TRACKING_JOB');
 const order=await lockPaymentOrder(tx,scope.order_id);
 const [current]=await tx`select mt.id,mt.courier,mt.tracking_number,f.handover_at from app.manual_tracking mt join app.fulfillment f on f.id=mt.fulfillment_id where mt.fulfillment_id=${fulfillmentId} order by mt.version desc limit 1`;
 if(!current?.handover_at)throw new AccessError(400,'INVALID_TRACKING_JOB');
 // A corrected resi starts its own poll; the superseded one stops quietly.
 if(current.id!==trackingId)return {status:'superseded'};
 if((await tx`select 1 from app.shipment_tracking_event where fulfillment_id=${fulfillmentId} and status='delivered'`).length)return {status:'terminal'};
 let observations:TrackingObservation[];
 try{observations=await tracking.adapter.track(tx,{environment:await financeEnvironment(tx),courier:current.courier as Courier,tracking_number:String(current.tracking_number),since:new Date(current.handover_at).toISOString(),clock_namespace:order.clock_namespace});}
 catch{throw new AccessError(503,'TRACKING_ADAPTER_UNAVAILABLE');}
 for(const observation of observations){
  // Unknown statuses and anything before this parcel's handover (a reused resi) change nothing.
  const status=mapTrackingStatus(observation.provider_status);if(!status||Date.parse(observation.occurred_at)<new Date(current.handover_at).getTime())continue;
  await applyObservation(tx,fulfillmentId,{status,occurred_at:financeInstant(observation.occurred_at),source:'adapter',adapter:tracking.adapter.name,provider_status:observation.provider_status});
 }
 const [terminal]=await tx`select status from app.shipment_tracking_event where fulfillment_id=${fulfillmentId} and status='delivered'`;
 if(terminal)return {status:'delivered'};
 const now=await fulfillmentClock(tx,order.clock_namespace);
 if(Date.parse(now)-new Date(current.handover_at).getTime()>POLL_WINDOW_MS){
  // Operators must take over: the parcel stays in the "Menunggu terkirim" queue.
  await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details) values (null,'fulfillment.tracking_stale',${fulfillmentId},'allowed','Tracking polling stopped after 30 days without delivery; operator follow-up required',${JSON.stringify({tracking_id:current.id})}::jsonb)`;
  return {status:'stale'};
 }
 return {status:'polling',deferMs:POLL_MS};
}
// Host-only simulator of a courier tracking feed (local/test databases only).
export async function simulateTrackingObservation(sql:Sql,target:'local'|'test',value:{courier:string;tracking_number:string;provider_status:string;occurred_at?:string}){
 readLocalConfig(process.env);if(!['local','test'].includes(target))throw invalid();
 return sql.begin(async tx=>{
  const [database]=await tx`select current_database() name,clock_timestamp() now`;if(database.name!==`99ribu_${target}`)throw invalid();
  const selected=courier(value.courier),number=trackingNumber(value.tracking_number);if(!/^[A-Z_]{2,40}$/.test(value.provider_status))throw invalid();
  const [scope]=await tx`select o.clock_namespace from app.manual_tracking mt join app.fulfillment f on f.id=mt.fulfillment_id join app.order_shipment s on s.id=f.shipment_id join app.commerce_order o on o.id=s.order_id where mt.tracking_number=${number} order by mt.created_at desc limit 1`;
  const occurred=value.occurred_at===undefined?new Date((await tx`select app.reservation_clock(${scope?.clock_namespace??null}) now`)[0].now).toISOString():financeInstant(value.occurred_at);
  const [row]=await tx`insert into app.local_tracking_observation (environment,courier,tracking_number,provider_status,occurred_at) values (${target},${selected},${number},${value.provider_status},${occurred}) returning id`;
  return String(row.id);
 });
}
