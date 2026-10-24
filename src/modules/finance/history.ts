import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError,hasPermission,projectOrderSummary,type Principal} from '../access/policy.ts';
import {id,invalid,object,text} from '../catalog/validation.ts';
import {mac} from '../checkout/access.ts';
import {projectOrder} from '../checkout/orders.ts';
import {financeInstant} from './ledger.ts';

// Keyed with the server's auth secret: a leaked cursor cannot be brute-forced back to its filters
// (S100: the filters may hold a phone suffix).
const fingerprint=(identity:LocalAuth,value:unknown)=>mac(identity,'order-history-cursor',[value]);
async function historyAuthority(tx:TransactionSql,principal:Principal){
 await tx`select id from app.auth_user where id=${principal.id} for update`;
 const [g]=await tx`select g.roles,g.permissions,m.verified_at from app.role_grant g join app.auth_user u on u.id=g.user_id
  join app.auth_session s on s.user_id=u.id join app.mfa_session m on m.session_id=s.id
  where u.id=${principal.id} and s.id=${principal.sessionId} and s.expires_at>clock_timestamp() and u.email_verified and u.two_factor_enabled for share of g,s,m`;
 if(!g) throw new AccessError(403,'FORBIDDEN');
 const warehouses=await tx`select w.id from app.warehouse_membership m join app.warehouse w on w.id=m.warehouse_id where m.user_id=${principal.id} and w.active order by w.id for share of w`;
 const current:Principal={...principal,roles:g.roles,permissions:g.permissions,mfaAt:new Date(g.verified_at),warehouseIds:warehouses.map(w=>w.id)};
 if(!hasPermission(current,'orders.history.read')) throw new AccessError(403,'FORBIDDEN');return current;
}
type Position={t:string;id:string;h:string};
function cursor(value:string|null,hash:string):Position|null{
 if(value===null) return null;if(!/^[A-Za-z0-9_-]{1,2000}$/.test(value)) throw invalid();
 try{const p=object(JSON.parse(Buffer.from(value,'base64url').toString()),['t','id','h']);if(p.h!==hash||typeof p.t!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(p.t)) throw invalid();financeInstant(`${p.t.slice(0,23)}Z`);return {t:p.t,id:id(p.id),h:hash};}catch{throw invalid();}
}
const encode=(row:{stamp:string;id:string},hash:string)=>Buffer.from(JSON.stringify({t:row.stamp,id:row.id,h:hash})).toString('base64url');
function limit(value:string|null){const raw=value??'20';if(!/^(?:[1-9]|[1-9][0-9]|100)$/.test(raw)) throw invalid();return Number(raw);}
function parameters(url:URL,allowed:string[]){for(const key of url.searchParams.keys()) if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1) throw invalid();return url.searchParams;}
// 6–8 digits (DEC-014): enough to narrow a lookup, never a free-text PII search.
function phoneSuffix(value:string|null){if(value===null||!/^\d{6,8}$/.test(value)) throw invalid();return value;}
function state(value:string|null,allowed:string[]){if(value!==null&&!allowed.includes(value)) throw invalid();return value;}
const scope=(p:Principal)=>({id:p.id,roles:[...p.roles].sort(),permissions:[...p.permissions].sort(),warehouses:p.warehouseIds});
async function currentSession(tx:TransactionSql,p:Principal){if(!(await tx`select id from app.auth_session where id=${p.sessionId} and user_id=${p.id} and expires_at>clock_timestamp()`).length) throw new AccessError(403,'FORBIDDEN');}
async function audit(tx:TransactionSql,p:Principal,subjectId:string|null,listed:boolean){await currentSession(tx,p);await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason) values (${p.id},${listed?'orders.history.list':'orders.history.read'},${subjectId},'allowed','Read authorized contact-free order history')`;}
async function referenceLimit(tx:TransactionSql,p:Principal){
 const [clock]=await tx`select floor(extract(epoch from clock_timestamp())*1000)::text now`;const now=Number(clock.now);
 const [rate]=await tx`insert into app.auth_rate_limit (id,key,count,last_request) values (${randomUUID()},${`history-reference:${p.id}`},1,${now}) on conflict (key) do update set
  count=case when app.auth_rate_limit.last_request<${now-60000} then 1 else app.auth_rate_limit.count+1 end,last_request=case when app.auth_rate_limit.last_request<${now-60000} then ${now} else app.auth_rate_limit.last_request end returning count,last_request`;
 if(rate.count>30) throw new AccessError(429,'RATE_LIMITED',Math.max(1,Math.ceil((Number(rate.last_request)+60000-now)/1000)));
}

export async function listOrderHistory(identity:LocalAuth,principal:Principal,url:URL){
 const p=parameters(url,['cursor','limit','from','to','status','payment_status','warehouse_id','reference','phone_suffix','fulfillment_status','return_status']);
 const filters={from:p.has('from')?financeInstant(p.get('from')):null,to:p.has('to')?financeInstant(p.get('to')):null,
  status:state(p.get('status'),['pending','processing','partially_completed','cancelled']),payment_status:state(p.get('payment_status'),['pending','cod_due','partially_collected','confirmed','expired','failed','partially_refunded','refunded']),
  warehouse_id:p.has('warehouse_id')?id(p.get('warehouse_id')):null,reference:p.has('reference')?text(p.get('reference'),100):null,phone_suffix:p.has('phone_suffix')?phoneSuffix(p.get('phone_suffix')):null,
  fulfillment_status:state(p.get('fulfillment_status'),['ready','picking','packed','handover_pending','handed_over','exception']),return_status:state(p.get('return_status'),['requested','reviewing','approved','rejected','awaiting_goods','inspecting','refunding','replacing','resolved'])};
 if(filters.from&&filters.to&&filters.from>=filters.to||filters.reference&&/[\p{Cc}\p{Cf}]/u.test(filters.reference)) throw invalid();
 const take=limit(p.get('limit'));
 return identity.sql.begin(async tx=>{
  const access=await historyAuthority(tx,principal),hash=await fingerprint(identity,{scope:scope(access),filters}),position=cursor(p.get('cursor'),hash);if(filters.reference||filters.phone_suffix) await referenceLimit(tx,access);
  const [installed]=await tx`select to_regclass('app.fulfillment') is not null installed,to_regclass('app.return_case') is not null returns_installed,to_regclass('app.replacement_shipment') is not null replacements_installed`;
  const replacementScope=installed.replacements_installed?tx`not exists(select 1 from app.replacement_shipment s join app.return_case c on c.id=s.case_id where c.order_id=o.id and not (s.warehouse_id=any(${access.warehouseIds}::uuid[])))`:tx`true`;
  const replacementWarehouse=installed.replacements_installed?tx`exists(select 1 from app.replacement_shipment s join app.return_case c on c.id=s.case_id where c.order_id=o.id and s.warehouse_id=${filters.warehouse_id}::uuid)`:tx`false`;
  const fulfillmentMatch=filters.fulfillment_status===null?tx`true`:installed.installed?tx`exists(select 1 from app.fulfillment f join app.order_shipment shipment on shipment.id=f.shipment_id where shipment.order_id=o.id and f.status=${filters.fulfillment_status})`:tx`false`;
  const returnMatch=filters.return_status===null?tx`true`:installed.returns_installed?tx`exists(select 1 from app.return_case c where c.order_id=o.id and c.status=${filters.return_status})`:tx`false`;
  // S100: reference is an exact order number (any case) or an exact resi, current or superseded
  // (spaces removed, upper case), of the carrier booking or a manual Mengantar entry.
  const resi=filters.reference===null?null:filters.reference.replace(/\s+/g,'').toUpperCase();
  // S104: an uncorrelated id set (fulfillment_tracking_number_idx, manual_tracking_number_idx) lets the order
  // lookup use the primary key instead of probing every order's shipments.
  const trackingMatch=resi===null||!installed.installed?tx`false`:tx`o.id=any(array(select s.order_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where f.tracking_number=${resi}
   union select s.order_id from app.manual_tracking mt join app.fulfillment f on f.id=mt.fulfillment_id join app.order_shipment s on s.id=f.shipment_id where mt.tracking_number=${resi}))`;
  // Exact digit suffix of the buyer contact or recipient phone; never echoed, logged or audited.
  // S104: a digit suffix is a prefix of the reversed digits, served by the checkout_quote_*_phone_suffix_idx
  // expression indexes (text_pattern_ops). The suffix is 6-8 validated digits, so the LIKE pattern needs no escaping.
  const reversedSuffix=filters.phone_suffix===null?null:`${[...filters.phone_suffix].reverse().join('')}%`;
  const phoneMatch=reversedSuffix===null?tx`true`:tx`o.quote_id=any(array(select q.id from app.checkout_quote q where
   reverse(regexp_replace(coalesce(q.document->'contact'->>'phone',''),'[^0-9]','','g')) like ${reversedSuffix}
   or reverse(regexp_replace(coalesce(q.document->'address'->>'phone',''),'[^0-9]','','g')) like ${reversedSuffix}))`;
  const rows=await tx`select o.*,to_char(o.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') stamp from app.commerce_order o where o.revision>0
   and (${access.roles.includes('owner')} or (exists(select 1 from app.order_shipment s where s.order_id=o.id) and not exists(select 1 from app.order_shipment s where s.order_id=o.id and not (s.warehouse_id=any(${access.warehouseIds}::uuid[]))) and ${replacementScope}))
   and (${filters.from}::timestamptz is null or o.created_at>=${filters.from}::timestamptz) and (${filters.to}::timestamptz is null or o.created_at<${filters.to}::timestamptz)
   and (${filters.status}::text is null or o.status=${filters.status}) and (${filters.payment_status}::text is null or o.payment_status=${filters.payment_status})
   and (${filters.warehouse_id}::uuid is null or exists(select 1 from app.order_shipment s where s.order_id=o.id and s.warehouse_id=${filters.warehouse_id}::uuid) or ${replacementWarehouse})
   and (${filters.reference}::text is null or o.number=upper(${filters.reference}) or ${trackingMatch}) and ${phoneMatch} and ${returnMatch} and ${fulfillmentMatch}
   and (${position===null} or (o.created_at,o.id)<(${position?.t??'1970-01-01T00:00:00.000000Z'}::timestamptz,${position?.id??'00000000-0000-0000-0000-000000000000'}::uuid)) order by o.created_at desc,o.id desc limit ${take+1}`;
  const selected=rows.slice(0,take),data=[];
  for(const row of selected){const shipments=await tx`select distinct warehouse_id from app.order_shipment where order_id=${row.id}`;
   data.push(projectOrderSummary(access,shipments.map(s=>s.warehouse_id),{id:row.id,number:row.number,status:row.status,payment_status:row.payment_status,payment_method:row.payment_method,buyer_total:Number(row.buyer_total),currency:'IDR',created_at:new Date(row.created_at).toISOString(),version:row.revision}));}
  await audit(tx,access,null,true);const [clock]=await tx`select clock_timestamp() as now`;
  return {data,pagination:{next_cursor:rows.length>take?encode(selected[selected.length-1] as {stamp:string;id:string},hash):null},as_of:new Date(clock.now).toISOString()};
 });
}

export async function readOrderHistory(identity:LocalAuth,principal:Principal,orderId:string,url:URL){
 const order=id(orderId),p=parameters(url,['history_cursor','history_limit']),take=limit(p.get('history_limit'));
 return identity.sql.begin(async tx=>{
  const access=await historyAuthority(tx,principal),hash=await fingerprint(identity,{scope:scope(access),order}),position=cursor(p.get('history_cursor'),hash);
  const [replacementSchema]=await tx`select to_regclass('app.replacement_shipment') is not null installed`;
  const replacementScope=replacementSchema.installed?tx`not exists(select 1 from app.replacement_shipment s join app.return_case c on c.id=s.case_id where c.order_id=o.id and not (s.warehouse_id=any(${access.warehouseIds}::uuid[])))`:tx`true`;
  const [stored]=await tx`select id from app.commerce_order o where o.id=${order} and o.revision>0 and (${access.roles.includes('owner')} or (exists(select 1 from app.order_shipment s where s.order_id=o.id) and not exists(select 1 from app.order_shipment s where s.order_id=o.id and not (s.warehouse_id=any(${access.warehouseIds}::uuid[]))))) for share of o`;
  if(!stored) throw new AccessError(404,'NOT_FOUND');
  // A replacement writer can hold this unchanged order row while adding a new
  // physical origin. Recheck child scope in a fresh statement after that wait.
  const [scoped]=await tx`select o.id from app.commerce_order o where o.id=${order} and (${access.roles.includes('owner')} or (
   not exists(select 1 from app.order_shipment s where s.order_id=o.id and not (s.warehouse_id=any(${access.warehouseIds}::uuid[]))) and ${replacementScope}))`;
  if(!scoped)throw new AccessError(404,'NOT_FOUND');
  const [installed]=await tx`select to_regclass('app.fulfillment_event') is not null installed,to_regclass('app.return_case') is not null returns_installed`;
  const fulfillmentHistory=installed.installed?tx`select event.id,'fulfillment'::text kind,event.occurred_at,event.recorded_at,event.status,shipment.id shipment_id from app.fulfillment_event event join app.fulfillment f on f.id=event.fulfillment_id join app.order_shipment shipment on shipment.id=f.shipment_id where shipment.order_id=${order}`:tx`select null::uuid id,'fulfillment'::text kind,null::timestamptz occurred_at,null::timestamptz recorded_at,null::text status,null::uuid shipment_id where false`;
  const returnHistory=installed.returns_installed?tx`select event.id,'return'::text kind,event.occurred_at,event.recorded_at,event.status,null::uuid shipment_id from app.return_event event join app.return_case c on c.id=event.case_id where c.order_id=${order}`:tx`select null::uuid id,'return'::text kind,null::timestamptz occurred_at,null::timestamptz recorded_at,null::text status,null::uuid shipment_id where false`;
  const refundHistory=installed.returns_installed?tx`select event.id,'refund'::text kind,event.occurred_at,event.recorded_at,event.status,null::uuid shipment_id from app.refund_event event join app.refund r on r.id=event.refund_id where r.order_id=${order}`:tx`select null::uuid id,'refund'::text kind,null::timestamptz occurred_at,null::timestamptz recorded_at,null::text status,null::uuid shipment_id where false`;
  const receiptHistory=installed.returns_installed?tx`select source.id,'fulfillment'::text kind,source.occurred_at,result.recorded_at,'buyer_received'::text status,s.id shipment_id from app.local_parcel_receipt source join app.parcel_receipt_result result on result.event_id=source.id join app.order_shipment s on s.id=source.shipment_id where s.order_id=${order} and result.outcome='received'`:tx`select null::uuid id,'fulfillment'::text kind,null::timestamptz occurred_at,null::timestamptz recorded_at,null::text status,null::uuid shipment_id where false`;
  const replacementHistory=replacementSchema.installed?tx`select event.id,'fulfillment'::text kind,event.occurred_at,event.recorded_at,event.status,s.id shipment_id from app.replacement_event event join app.replacement_shipment s on s.id=event.shipment_id join app.return_case c on c.id=s.case_id where c.order_id=${order}`:tx`select null::uuid id,'fulfillment'::text kind,null::timestamptz occurred_at,null::timestamptz recorded_at,null::text status,null::uuid shipment_id where false`;
  const rows=await tx`with events as (
   select id,'order'::text kind,created_at occurred_at,recorded_at,status,null::uuid shipment_id from app.order_event where order_id=${order}
   union all select id,'payment',occurred_at,recorded_at,'collection_recorded',null from app.economic_receipt where order_id=${order}
   union all select id,'reconciliation',occurred_at,recorded_at,'journal_reversed',null from app.finance_transaction where order_id=${order} and kind='reversal'
   union all ${fulfillmentHistory} union all ${receiptHistory} union all ${returnHistory} union all ${refundHistory} union all ${replacementHistory})
   select *,to_char(occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') stamp from events where ${position===null} or (occurred_at,id)<(${position?.t??'1970-01-01T00:00:00.000000Z'}::timestamptz,${position?.id??'00000000-0000-0000-0000-000000000000'}::uuid) order by occurred_at desc,id desc limit ${take+1}`;
  const selected=rows.slice(0,take);await audit(tx,access,order,false);const [clock]=await tx`select clock_timestamp() as now`;
  return {order:await projectOrder(tx,order),history:selected.map(e=>({id:e.id,kind:e.kind,occurred_at:new Date(e.occurred_at).toISOString(),recorded_at:e.recorded_at===null?null:new Date(e.recorded_at).toISOString(),status:e.status,shipment_id:e.shipment_id===null?null:String(e.shipment_id)})),history_pagination:{next_cursor:rows.length>take?encode(selected[selected.length-1] as {stamp:string;id:string},hash):null},as_of:new Date(clock.now).toISOString()};
 });
}
