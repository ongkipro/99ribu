import {createHash,randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {consumeAccessProof} from '../access/grants.ts';
import {AccessError,type Principal} from '../access/policy.ts';
import {id,integer,invalid,object,text} from '../catalog/validation.ts';
import {lockPaymentOrder} from '../payments/attempts.ts';
import {registerProviderEvent,settleLocalOperation} from '../payments/local.ts';
import {financeAuthority} from './costs.ts';
import {financeEnvironment,financeInstant} from './ledger.ts';
import {nextPageCursor,readPageCursor,STAMP_FORMAT} from './page-cursor.ts';

// DEC-008 (2) / S93: AutoLaris payments for finance. Advice polling is the automated
// path; when a status is unproven, owner/finance confirm after checking the AutoLaris
// dashboard. The confirmation is a settled observation that settles the attempt's own
// payment operation, so exact amounts post the S23 receipt and others become recovery.
async function project(tx:TransactionSql,attemptId:string){
 const [row]=await tx`select l.*,a.status attempt_status,a.expected_amount,a.expires_at,o.id order_id,o.number,o.status order_status,o.payment_status,
  (select json_build_object('source',x.source,'classification',x.classification,'rc',x.rc,'ket',x.ket,'amount',x.amount,'occurred_at',x.occurred_at,'recorded_at',x.created_at,'reason',x.reason)
   from app.autolaris_observation x where x.attempt_id=l.attempt_id order by x.created_at desc,x.id desc limit 1) latest,
  (select count(*)::int from app.autolaris_observation x where x.attempt_id=l.attempt_id) observations
  from app.autolaris_payment l join app.payment_attempt a on a.id=l.attempt_id join app.commerce_order o on o.id=a.order_id where l.attempt_id=${attemptId}`;
 if(!row)throw new AccessError(404,'NOT_FOUND');
 const latest=row.latest as Record<string,unknown>|null;
 return {id:String(row.attempt_id),order_id:String(row.order_id),order_number:String(row.number),status:String(row.attempt_status),currency:'IDR' as const,channel_code:String(row.channel_code),reff_id:String(row.reff_id),
  trx_id:row.trx_id===null?null:String(row.trx_id),expected_amount:Number(row.expected_amount),provider_total:row.provider_total===null?null:Number(row.provider_total),
  // Store-borne: deducted by AutoLaris at settlement and posted as payment cost, never charged to the buyer.
  admin_fee:row.admin_fee===null?null:Number(row.admin_fee),refusal_code:row.refusal_code===null?null:String(row.refusal_code),expires_at:new Date(row.expires_at).toISOString(),
  order_status:String(row.order_status),payment_status:String(row.payment_status),observation_count:Number(row.observations),
  latest_observation:latest===null?null:{source:String(latest.source),classification:String(latest.classification),rc:latest.rc===null?null:String(latest.rc),ket:latest.ket===null?null:String(latest.ket),
   amount:latest.amount===null?null:Number(latest.amount),occurred_at:new Date(String(latest.occurred_at)).toISOString(),recorded_at:new Date(String(latest.recorded_at)).toISOString()}};
}
export async function listAutolarisPayments(identity:LocalAuth,principal:Principal,url:URL){
 for(const key of url.searchParams.keys())if(!['state','limit','cursor'].includes(key)||url.searchParams.getAll(key).length!==1)throw invalid();
 const state=url.searchParams.get('state')??'open',raw=url.searchParams.get('limit')??'50';
 if(!['open','resolved'].includes(state)||!/^\d{1,3}$/.test(raw))throw invalid();const limit=integer(Number(raw),1,100),cursor=readPageCursor(url.searchParams.get('cursor'));
 return identity.sql.begin(async tx=>{
  await financeAuthority(tx,principal,'finance.reconciliation.read');
  // S113 keyset pages: newest deadline first, then attempt id.
  const rows=await tx<{id:string;k:string}[]>`select l.attempt_id id,to_char(a.expires_at at time zone 'UTC',${STAMP_FORMAT}) k from app.autolaris_payment l join app.payment_attempt a on a.id=l.attempt_id
   where (${state}='open')=(a.status in ('preparing','pending','unknown'))
    and (${cursor?.t??null}::timestamptz is null or (a.expires_at,l.attempt_id)<(${cursor?.t??null}::timestamptz,${cursor?.id??null}::uuid))
   order by a.expires_at desc,l.attempt_id desc limit ${limit+1}`;
  const data=[];for(const row of rows.slice(0,limit))data.push(await project(tx,String(row.id)));
  return {data,pagination:{next_cursor:nextPageCursor(rows,limit)}};
 });
}
export async function confirmAutolarisPayment(request:Request,identity:LocalAuth,principal:Principal,attemptId:string,value:unknown){
 const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key))throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');
 const body=object(value,['amount','paid_at','evidence','reason','reauthentication_proof']),selected=id(attemptId);
 const input={attempt_id:selected,amount:integer(body.amount,1,Number.MAX_SAFE_INTEGER),paid_at:financeInstant(body.paid_at),evidence:text(body.evidence,500),reason:text(body.reason,200)};
 const proof=text(body.reauthentication_proof,100),hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 return identity.sql.begin(async tx=>{
  await financeAuthority(tx,principal,'finance.reconciliation.read');await financeAuthority(tx,principal,'finance.reconciliation.write');
  const [previous]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='finance.autolaris_confirm' and key=${key}`;
  if(previous){if(previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return previous.response;}
  const [before]=await tx`select order_id,method_id from app.payment_attempt where id=${selected}`;if(before?.method_id!=='autolaris')throw new AccessError(404,'NOT_FOUND');
  const order=await lockPaymentOrder(tx,before.order_id);await tx`select pg_advisory_xact_lock(hashtextextended(${`payment:${selected}`},0))`;
  const [row]=await tx`select l.trx_id,l.refusal_code,a.created_at,p.status operation_status from app.autolaris_payment l join app.payment_attempt a on a.id=l.attempt_id
   left join app.local_payment_operation p on p.id=l.operation_id where l.attempt_id=${selected} for update of l`;
  if(!row?.trx_id||row.refusal_code)throw new AccessError(409,'AUTOLARIS_TRANSACTION_UNAVAILABLE');
  if(row.operation_status!=='pending')throw new AccessError(409,'PAYMENT_ALREADY_FINAL');
  const [clock]=await tx`select app.reservation_clock(${order.clock_namespace}) now`;
  if(Date.parse(input.paid_at)<new Date(row.created_at).getTime()||Date.parse(input.paid_at)>new Date(clock.now).getTime())throw new AccessError(422,'INVALID_PAYMENT_TIME');
  await consumeAccessProof(tx,principal,'finance.reconcile',selected,proof);
  await tx`insert into app.autolaris_observation (attempt_id,source,classification,amount,occurred_at,actor_id,reason,evidence) values (${selected},'manual','settled',${input.amount},${input.paid_at},${principal.id},${input.reason},${input.evidence})`;
  await registerProviderEvent(tx,await settleLocalOperation(tx,await financeEnvironment(tx),selected,{amount:input.amount,occurred_at:input.paid_at}));
  const response=await project(tx,selected),operationId=randomUUID();
  await tx`insert into app.access_operation (id,actor_id,action,key,request_hash,response) values (${operationId},${principal.id},'finance.autolaris_confirm',${key},${hash},${JSON.stringify(response)}::jsonb)`;
  await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details) values (${principal.id},'finance.autolaris_confirm',${selected},'allowed',${input.reason},${JSON.stringify({operation_id:operationId,order_id:order.id,trx_id:String(row.trx_id),amount:input.amount,expected_amount:response.expected_amount})}::jsonb)`;
  await tx`set constraints all immediate`;return response;
 });
}
