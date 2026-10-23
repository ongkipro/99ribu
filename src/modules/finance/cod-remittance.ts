import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {consumeAccessProof} from '../access/grants.ts';
import {AccessError,type Principal} from '../access/policy.ts';
import {array,id,integer,invalid,object,text} from '../catalog/validation.ts';
import {enqueueJob} from '../../jobs/outbox.ts';
import {codSourceEvent,registerCodEvent} from '../payments/cod-local.ts';
import {lockPaymentOrder} from '../payments/attempts.ts';
import {financeAuthority} from './costs.ts';
import {financeEnvironment} from './ledger.ts';
import {readCodCollectionBasis} from './receipt-units.ts';
import {registerSettlementEvent,reviseSettlementStatement,settlementSourceEvent} from './settlements/local.ts';

// DEC-007 / S91. Mengantar collects COD on 99ribu's own account and remits
// through its balance/settlement. Until a settlement adapter exists finance
// records each dashboard statement here. Money posts only through the existing
// COD collection (S28) and settlement reconciliation (S30) journals; this module
// writes their sources, never postings. No seller payable exists (OD-12).
const money=(value:unknown,minimum=0)=>integer(value,minimum,Number.MAX_SAFE_INTEGER);
function reference(value:unknown){const result=text(value,80);if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}$/.test(result))throw new AccessError(422,'INVALID_STATEMENT_REFERENCE');return result;}

export async function recordCodRemittance(request:Request,identity:LocalAuth,principal:Principal,value:unknown){
 const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key))throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');
 const body=object(value,['id','reference','statement_at','lines','shipping_deduction','cod_fee_deduction','other_deduction','net_amount','evidence','reason','reauthentication_proof']);
 const lines=array(body.lines,line=>{const row=object(line,['shipment_id','amount']);return {shipment_id:id(row.shipment_id),amount:money(row.amount,1)};},1,100).sort((a,b)=>a.shipment_id<b.shipment_id?-1:1);
 if(new Set(lines.map(line=>line.shipment_id)).size!==lines.length)throw new AccessError(422,'DUPLICATE_STATEMENT_PARCEL');
 if(typeof body.statement_at!=='string'||!Number.isFinite(Date.parse(body.statement_at)))throw invalid();
 const input={id:id(body.id),reference:reference(body.reference),statement_at:new Date(body.statement_at).toISOString(),lines,shipping_deduction:money(body.shipping_deduction),cod_fee_deduction:money(body.cod_fee_deduction),
  other_deduction:money(body.other_deduction),net_amount:money(body.net_amount),evidence:text(body.evidence,500),reason:text(body.reason,200)};
 const gross=lines.reduce((sum,line)=>sum+BigInt(line.amount),0n);if(gross>BigInt(Number.MAX_SAFE_INTEGER))throw new AccessError(422,'STATEMENT_AMOUNT_LIMIT_EXCEEDED');
 // Refuse an unbalanced statement before any cash is recorded; finance re-enters the breakdown.
 if(gross!==BigInt(input.net_amount)+BigInt(input.shipping_deduction)+BigInt(input.cod_fee_deduction)+BigInt(input.other_deduction))throw new AccessError(422,'STATEMENT_TOTAL_MISMATCH');
 if(Date.parse(input.statement_at)>Date.now())throw new AccessError(422,'STATEMENT_DATE_IN_FUTURE');
 const proof=text(body.reauthentication_proof,100),hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 return identity.sql.begin(async tx=>{
  await financeAuthority(tx,principal,'finance.reconciliation.read');await financeAuthority(tx,principal,'finance.reconciliation.write');
  const [previous]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='finance.cod_remittance' and key=${key}`;
  if(previous){if(previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return previous.response;}
  const environment=await financeEnvironment(tx);
  if((await tx`select id from app.cod_remittance where id=${input.id} or (environment=${environment} and reference=${input.reference})`).length)throw new AccessError(409,'STATEMENT_ALREADY_RECORDED');
  // Lock every original order in stable order before writing any source.
  const parcels=await tx`select s.id,s.order_id,o.payment_method,o.clock_namespace,f.handover_at,f.booking_id,exists(select 1 from app.manual_tracking mt where mt.fulfillment_id=f.id) manual,
   exists(select 1 from app.cod_remittance_line l where l.shipment_id=s.id) or exists(select 1 from app.economic_receipt e where e.shipment_id=s.id and e.kind='cod')
    or exists(select 1 from app.local_cod_operation c where c.shipment_id=s.id and c.status='collected') remitted
   from app.order_shipment s join app.commerce_order o on o.id=s.order_id left join app.fulfillment f on f.shipment_id=s.id where s.id in ${tx(lines.map(line=>line.shipment_id))}`;
  if(parcels.length!==lines.length)throw new AccessError(404,'NOT_FOUND');
  if(parcels.some(parcel=>parcel.payment_method!=='cod'))throw new AccessError(422,'STATEMENT_PARCEL_NOT_COD');
  if(parcels.some(parcel=>!parcel.handover_at))throw new AccessError(409,'STATEMENT_PARCEL_NOT_SHIPPED');
  // Only parcels shipped via a manual resi on 99ribu's Mengantar account, once each.
  if(parcels.some(parcel=>parcel.booking_id!==null||!parcel.manual))throw new AccessError(422,'STATEMENT_PARCEL_NOT_MANUAL');
  if(parcels.some(parcel=>parcel.remitted))throw new AccessError(409,'PARCEL_ALREADY_REMITTED');
  const namespaces=new Set(parcels.map(parcel=>parcel.clock_namespace??null));if(namespaces.size!==1)throw new AccessError(422,'STATEMENT_CLOCK_CONTEXT_MIXED');
  for(const orderId of [...new Set(parcels.map(parcel=>String(parcel.order_id)))].sort())await lockPaymentOrder(tx,orderId);
  // Validation needs no proof; the fresh reauthentication is consumed only for an actual recording.
  await consumeAccessProof(tx,principal,'finance.reconcile',input.id,proof);
  const clock=[...namespaces][0] as string|null,codReference=`remit:${input.id}`,collected=[];
  for(const line of lines){
   const event=await codSourceEvent(tx,environment,line.shipment_id,{reference:codReference,status:'collected',amount:line.amount});
   const [operation]=await tx`select requested_amount from app.local_cod_operation where id=${event.operation_id}`;
   await registerCodEvent(tx,event);collected.push({...line,operation_id:event.operation_id,expected_amount:Number(operation.requested_amount)});
  }
  const statement={gross_amount:Number(gross),carrier_fee:input.shipping_deduction+input.cod_fee_deduction,provider_fee:input.other_deduction,allocation_claims:null,reverses_reference:null};
  const settlement=await settlementSourceEvent(tx,environment,{provider:'local.cod',reference:`mengantar-cod:${input.reference}`,direction:'credit',net_amount:input.net_amount,clock_namespace:clock,statement});
  await registerSettlementEvent(tx,settlement);
  const job=await enqueueJob(tx,'cod.remittance.match',`cod-remittance-match:${input.id}`,{remittanceId:input.id},10);
  await tx`insert into app.cod_remittance (id,reference,environment,settlement_operation_id,gross_amount,shipping_deduction,cod_fee_deduction,other_deduction,net_amount,statement_at,evidence,match_job_id,actor_id,reason)
   values (${input.id},${input.reference},${environment},${settlement.operation_id},${Number(gross)},${input.shipping_deduction},${input.cod_fee_deduction},${input.other_deduction},${input.net_amount},${input.statement_at},${input.evidence},${job},${principal.id},${input.reason})`;
  for(const [index,line] of collected.entries())await tx`insert into app.cod_remittance_line (remittance_id,shipment_id,ordinal,amount,expected_amount,cod_operation_id) values (${input.id},${line.shipment_id},${index+1},${line.amount},${line.expected_amount},${line.operation_id})`;
  const response=await projectCodRemittance(tx,input.id);
  await tx`insert into app.access_operation (id,actor_id,action,key,request_hash,response) values (${input.id},${principal.id},'finance.cod_remittance',${key},${hash},${JSON.stringify(response)}::jsonb)`;
  await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details) values (${principal.id},'finance.cod_remittance',${input.id},'allowed',${input.reason},${JSON.stringify({operation_id:input.id,reference:input.reference,gross_amount:Number(gross),net_amount:input.net_amount,parcels:lines.length})}::jsonb)`;
  await tx`set constraints all immediate`;return response;
 });
}

// Worker: once every line's COD callback has a result, revise the settlement
// statement with exact receivable claims so S30 matching runs (or flags).
export async function processCodRemittanceMatch(tx:TransactionSql,job:{id:string;payload:unknown}){
 const input=object(job.payload,['remittanceId']),remittanceId=id(input.remittanceId);
 const [remittance]=await tx`select * from app.cod_remittance where id=${remittanceId} and match_job_id=${job.id}`;if(!remittance)throw new AccessError(400,'INVALID_COD_REMITTANCE_JOB');
 await tx`select id from app.local_settlement_operation where id=${remittance.settlement_operation_id} for update`;
 const [latest]=await tx`select revision from app.local_settlement_statement where operation_id=${remittance.settlement_operation_id} order by revision desc limit 1`;
 if(Number(latest.revision)>1)return {status:'claimed'};
 const lines=await tx`select l.amount,l.cod_operation_id,r.outcome,r.transaction_id,j.status job_status from app.cod_remittance_line l join app.local_cod_event e on e.operation_id=l.cod_operation_id
  join app.cod_provider_event p on p.id=e.id join app.outbox_job j on j.id=p.callback_job_id left join app.cod_event_result r on r.event_id=e.id where l.remittance_id=${remittanceId} order by l.ordinal`;
 if(lines.some(line=>line.job_status==='failed'))return {status:'collection_callback_failed'};
 // Retryable: the worker's bounded backoff (max_attempts) applies, then the job fails and is flagged.
 if(lines.some(line=>!line.outcome))throw new AccessError(409,'COD_COLLECTION_PENDING');
 const claims=lines.filter(line=>line.transaction_id).map(line=>({receivable_transaction_id:String(line.transaction_id),gross_amount:Number(line.amount),reopens_allocation_id:null}));
 if(!claims.length)return {status:'no_receivable'};
 const [current]=await tx`select gross_amount,carrier_fee,provider_fee from app.local_settlement_statement where operation_id=${remittance.settlement_operation_id} and revision=1`;
 const event=await reviseSettlementStatement(tx,remittance.environment,remittance.settlement_operation_id,1,{gross_amount:Number(current.gross_amount),carrier_fee:Number(current.carrier_fee),provider_fee:Number(current.provider_fee),allocation_claims:claims,reverses_reference:null});
 await registerSettlementEvent(tx,event);
 return {status:'claimed'};
}

// Expected-vs-received view. Flags are derived from stored facts, never inputs.
export async function projectCodRemittance(tx:TransactionSql,remittanceId:string){
 const [r]=await tx`select * from app.cod_remittance where id=${id(remittanceId)}`;if(!r)throw new AccessError(404,'NOT_FOUND');
 const lines=await tx`select l.*,o.number order_number,r.outcome,r.reason result_reason,j.status callback_status from app.cod_remittance_line l join app.order_shipment s on s.id=l.shipment_id join app.commerce_order o on o.id=s.order_id
  left join app.local_cod_event e on e.operation_id=l.cod_operation_id left join app.cod_event_result r on r.event_id=e.id
  left join app.cod_provider_event p on p.id=e.id left join app.outbox_job j on j.id=p.callback_job_id where l.remittance_id=${r.id} order by l.ordinal`;
 const [settlement]=await tx`select p.id,p.status,p.problem_code from app.provider_settlement p where p.operation_id=${r.settlement_operation_id}`;
 const gross=Number(r.gross_amount),deductions=Number(r.shipping_deduction)+Number(r.cod_fee_deduction)+Number(r.other_deduction),expectedNet=gross-Number(r.shipping_deduction)-Number(r.cod_fee_deduction);
 const flags=[...lines.some(line=>Number(line.amount)!==Number(line.expected_amount))?['PARCEL_AMOUNT_MISMATCH']:[],...gross!==Number(r.net_amount)+deductions?['STATEMENT_TOTAL_MISMATCH']:[],
  ...Number(r.other_deduction)>0?['OTHER_DEDUCTION_REVIEW']:[],...lines.some(line=>line.callback_status==='failed')?['COLLECTION_CALLBACK_FAILED']:[],
  ...(await tx`select 1 from app.outbox_job where id=${r.match_job_id} and status='failed'`).length?['COLLECTION_MATCH_FAILED']:[]];
 return {id:String(r.id),reference:String(r.reference),statement_at:new Date(r.statement_at).toISOString(),currency:'IDR' as const,gross_amount:gross,shipping_deduction:Number(r.shipping_deduction),cod_fee_deduction:Number(r.cod_fee_deduction),
  other_deduction:Number(r.other_deduction),net_amount:Number(r.net_amount),expected_net_amount:expectedNet,evidence:String(r.evidence),flags,
  settlement:settlement?{id:String(settlement.id),status:String(settlement.status),problem_code:settlement.problem_code===null?null:String(settlement.problem_code)}:null,
  lines:lines.map(line=>({shipment_id:String(line.shipment_id),order_number:String(line.order_number),amount:Number(line.amount),expected_amount:Number(line.expected_amount),collection_status:line.outcome===null?'pending':String(line.outcome),collection_reason:line.result_reason===null?null:String(line.result_reason)})),
  recorded_at:new Date(r.created_at).toISOString()};
}
export async function readCodRemittance(identity:LocalAuth,principal:Principal,remittanceId:string){
 return identity.sql.begin(async tx=>{await financeAuthority(tx,principal,'finance.reconciliation.read');return projectCodRemittance(tx,remittanceId);});
}
export async function listCodRemittances(identity:LocalAuth,principal:Principal,url:URL){
 for(const key of url.searchParams.keys())if(!['limit','cursor'].includes(key)||url.searchParams.getAll(key).length!==1)throw invalid();
 const raw=url.searchParams.get('limit')??'20';if(!/^\d{1,3}$/.test(raw))throw invalid();const limit=integer(Number(raw),1,100),cursor=url.searchParams.has('cursor')?id(url.searchParams.get('cursor')):null;
 return identity.sql.begin(async tx=>{
  await financeAuthority(tx,principal,'finance.reconciliation.read');
  const [position]=cursor?await tx`select created_at::text created_at from app.cod_remittance where id=${cursor}`:[];if(cursor&&!position)throw invalid();
  const rows=await tx`select id from app.cod_remittance where (${cursor}::uuid is null or (created_at,id)<(${position?.created_at??null}::timestamptz,${cursor}::uuid)) order by created_at desc,id desc limit ${limit+1}`;
  const data=[];for(const row of rows.slice(0,limit))data.push(await projectCodRemittance(tx,String(row.id)));
  return {data,pagination:{next_cursor:rows.length>limit?String(rows[limit-1].id):null}};
 });
}
// Shipped COD parcels not yet collected, for the statement form (finance only).
export async function listCollectibleParcels(identity:LocalAuth,principal:Principal,url:URL){
 for(const key of url.searchParams.keys())if(!['reference'].includes(key)||url.searchParams.getAll(key).length!==1)throw invalid();
 const number=url.searchParams.get('reference');if(number!==null&&!/^[A-Za-z0-9-]{3,40}$/.test(number))throw invalid();
 return identity.sql.begin(async tx=>{
  await financeAuthority(tx,principal,'finance.reconciliation.read');
  const rows=await tx`select s.id shipment_id,o.number order_number,f.handover_at,mt.courier,mt.tracking_number from app.order_shipment s join app.commerce_order o on o.id=s.order_id join app.fulfillment f on f.shipment_id=s.id
   left join lateral (select courier,tracking_number from app.manual_tracking where fulfillment_id=f.id order by version desc limit 1) mt on true
   where o.payment_method='cod' and f.handover_at is not null and f.booking_id is null and mt.tracking_number is not null and not exists(select 1 from app.economic_receipt e where e.shipment_id=s.id and e.kind='cod')
    and not exists(select 1 from app.cod_remittance_line l where l.shipment_id=s.id)
    and (${number}::text is null or o.number=${number}) order by f.handover_at desc,s.id limit 100`;
  // cod_due is the CURRENT collection basis (what a statement line is checked against), read without
  // order locks; the frozen order_shipment.cod_due overstates it after a unit cancellation.
  const data=[];
  for(const row of rows)data.push({shipment_id:String(row.shipment_id),order_number:String(row.order_number),cod_due:(await readCodCollectionBasis(tx,String(row.shipment_id))).amount,handed_over_at:new Date(row.handover_at).toISOString(),courier:row.courier===null?null:String(row.courier),tracking_number:row.tracking_number===null?null:String(row.tracking_number)});
  return {data};
 });
}
