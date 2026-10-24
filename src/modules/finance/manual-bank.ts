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

// DEC-008 / S92 manual bank transfer reconciliation queue. Finance confirms a
// transfer seen on the company bank statement; the confirmation settles the
// attempt's own payment operation with the actually received amount and bank
// time, and the existing payment callback posts the receipt or a recovery case
// (wrong amount / late transfer) through the existing journals.
async function projectTransfer(tx:TransactionSql,attemptId:string){
 const [row]=await tx`select a.id,a.status,a.expected_amount,a.expires_at,a.created_at,o.id order_id,o.number,o.buyer_total,o.transfer_code,o.status order_status,o.payment_status,
  c.amount confirmed_amount,c.bank_reference,c.transferred_at,c.created_at confirmed_at,r.outcome,r.reason result_reason,b.account_number received_account,
  (select v.values->'manual_bank_accounts' from app.policy_version v where v.id=o.payment_policy_version_id) accounts
  from app.payment_attempt a join app.commerce_order o on o.id=a.order_id left join app.manual_bank_confirmation c on c.attempt_id=a.id left join app.manual_bank_reference b on b.attempt_id=a.id
  left join app.local_payment_event e on e.operation_id=c.operation_id and e.status='confirmed' left join app.payment_event_result r on r.event_id=e.id
  where a.id=${attemptId} and a.method_id='manual-bank'`;
 if(!row)throw new AccessError(404,'NOT_FOUND');
 return {id:String(row.id),order_id:String(row.order_id),order_number:String(row.number),status:String(row.status),currency:'IDR' as const,order_total:Number(row.buyer_total),transfer_code:Number(row.transfer_code),
  expected_amount:Number(row.expected_amount),expires_at:new Date(row.expires_at).toISOString(),order_status:String(row.order_status),payment_status:String(row.payment_status),
  accounts:((row.accounts??[]) as {bank_name:string;account_number:string;account_holder:string}[]).map(a=>({bank_name:a.bank_name,account_number:a.account_number,account_holder:a.account_holder})),
  confirmation:row.confirmed_amount===null?null:{amount:Number(row.confirmed_amount),bank_reference:String(row.bank_reference),transferred_at:new Date(row.transferred_at).toISOString(),recorded_at:new Date(row.confirmed_at).toISOString(),
   received_account_number:row.received_account===null?null:String(row.received_account),late_transfer:new Date(row.transferred_at).getTime()>=new Date(row.expires_at).getTime(),
   outcome:row.outcome===null?'processing':String(row.outcome),reason:row.result_reason===null?null:String(row.result_reason),mismatch:Number(row.confirmed_amount)!==Number(row.expected_amount)}};
}
export async function listManualTransfers(identity:LocalAuth,principal:Principal,url:URL){
 for(const key of url.searchParams.keys())if(!['state','limit','cursor'].includes(key)||url.searchParams.getAll(key).length!==1)throw invalid();
 const state=url.searchParams.get('state')??'open',raw=url.searchParams.get('limit')??'50';
 if(!['open','resolved'].includes(state)||!/^\d{1,3}$/.test(raw))throw invalid();const limit=integer(Number(raw),1,100),cursor=readPageCursor(url.searchParams.get('cursor'));
 return identity.sql.begin(async tx=>{
  await financeAuthority(tx,principal,'finance.reconciliation.read');
  // S113 keyset pages: open by deadline then id, resolved by confirmation time (newest first) then id.
  const rows=state==='open'
   ?await tx<{id:string;k:string}[]>`select a.id,to_char(a.expires_at at time zone 'UTC',${STAMP_FORMAT}) k from app.payment_attempt a left join app.manual_bank_confirmation c on c.attempt_id=a.id
     where a.method_id='manual-bank' and a.status in ('pending','unknown') and c.attempt_id is null
      and (${cursor?.t??null}::timestamptz is null or (a.expires_at,a.id)>(${cursor?.t??null}::timestamptz,${cursor?.id??null}::uuid))
     order by a.expires_at,a.id limit ${limit+1}`
   :await tx<{id:string;k:string}[]>`select a.id,to_char(c.created_at at time zone 'UTC',${STAMP_FORMAT}) k from app.payment_attempt a join app.manual_bank_confirmation c on c.attempt_id=a.id
     where a.method_id='manual-bank'
      and (${cursor?.t??null}::timestamptz is null or (c.created_at,a.id)<(${cursor?.t??null}::timestamptz,${cursor?.id??null}::uuid))
     order by c.created_at desc,a.id desc limit ${limit+1}`;
  const data=[];for(const row of rows.slice(0,limit))data.push(await projectTransfer(tx,String(row.id)));
  return {data,pagination:{next_cursor:nextPageCursor(rows,limit)}};
 });
}
export async function confirmManualTransfer(request:Request,identity:LocalAuth,principal:Principal,attemptId:string,value:unknown){
 const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key))throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');
 const body=object(value,['amount','bank_reference','account_number','transferred_at','late_transfer','evidence','reason','reauthentication_proof']),selected=id(attemptId);
 const reference=text(body.bank_reference,80).trim();if(!/^[A-Za-z0-9][A-Za-z0-9_./:-]{2,79}$/.test(reference))throw new AccessError(422,'INVALID_BANK_REFERENCE');
 if(typeof body.account_number!=='string'||!/^[0-9]{6,20}$/.test(body.account_number)||typeof body.late_transfer!=='boolean')throw invalid();
 const input={attempt_id:selected,amount:integer(body.amount,1,Number.MAX_SAFE_INTEGER),bank_reference:reference,account_number:body.account_number,transferred_at:financeInstant(body.transferred_at),late_transfer:body.late_transfer,evidence:text(body.evidence,500),reason:text(body.reason,200)};
 const proof=text(body.reauthentication_proof,100),hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 return identity.sql.begin(async tx=>{
  await financeAuthority(tx,principal,'finance.reconciliation.read');await financeAuthority(tx,principal,'finance.reconciliation.write');
  const [previous]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='finance.manual_transfer' and key=${key}`;
  if(previous){if(previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return previous.response;}
  const [before]=await tx`select order_id,method_id from app.payment_attempt where id=${selected}`;if(before?.method_id!=='manual-bank')throw new AccessError(404,'NOT_FOUND');
  const order=await lockPaymentOrder(tx,before.order_id);
  const [attempt]=await tx`select a.*,p.id operation_id,p.status operation_status from app.payment_attempt a left join app.local_payment_operation p on p.attempt_id=a.id where a.id=${selected} for update of a`;
  if((await tx`select attempt_id from app.manual_bank_confirmation where attempt_id=${selected}`).length)throw new AccessError(409,'TRANSFER_ALREADY_CONFIRMED');
  if(!attempt.operation_id||attempt.operation_status!=='pending'||!['pending','unknown'].includes(attempt.status))throw new AccessError(409,'TRANSFER_NOT_AWAITING');
  const [clock]=await tx`select app.reservation_clock(${order.clock_namespace}) now`;
  // Bounded backdating: the transfer happened after the instructions were issued and not in the future.
  if(Date.parse(input.transferred_at)<new Date(attempt.created_at).getTime()||Date.parse(input.transferred_at)>new Date(clock.now).getTime())throw new AccessError(422,'INVALID_TRANSFER_TIME');
  // The transfer time decides timeliness (spec 11): finance must state explicitly that a transfer was late.
  if(input.late_transfer!==(Date.parse(input.transferred_at)>=new Date(attempt.expires_at).getTime()))throw new AccessError(422,'LATE_TRANSFER_ACKNOWLEDGEMENT_REQUIRED');
  const [policy]=await tx`select v.values->'manual_bank_accounts' accounts from app.policy_version v where v.id=${order.payment_policy_version_id}`;
  if(!((policy?.accounts??[]) as {account_number:string}[]).some(a=>a.account_number===input.account_number))throw new AccessError(422,'INVALID_RECEIVING_ACCOUNT');
  // One bank statement line confirms one order (normalised reference per receiving account).
  if((await tx`select attempt_id from app.manual_bank_reference where account_number=${input.account_number} and reference_key=${input.bank_reference.toUpperCase()}`).length)throw new AccessError(409,'BANK_REFERENCE_ALREADY_USED');
  await consumeAccessProof(tx,principal,'finance.reconcile',selected,proof);
  await tx`insert into app.manual_bank_confirmation (attempt_id,operation_id,amount,bank_reference,transferred_at,evidence,actor_id,reason) values (${selected},${attempt.operation_id},${input.amount},${input.bank_reference},${input.transferred_at},${input.evidence},${principal.id},${input.reason})`;
  await tx`insert into app.manual_bank_reference (account_number,reference_key,attempt_id) values (${input.account_number},${input.bank_reference.toUpperCase()},${selected})`;
  const event=await settleLocalOperation(tx,await financeEnvironment(tx),selected,{amount:input.amount,occurred_at:input.transferred_at});
  await registerProviderEvent(tx,event);
  const response=await projectTransfer(tx,selected),operationId=randomUUID();
  await tx`insert into app.access_operation (id,actor_id,action,key,request_hash,response) values (${operationId},${principal.id},'finance.manual_transfer',${key},${hash},${JSON.stringify(response)}::jsonb)`;
  await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details) values (${principal.id},'finance.manual_transfer',${selected},'allowed',${input.reason},${JSON.stringify({operation_id:operationId,order_id:order.id,amount:input.amount,expected_amount:Number(attempt.expected_amount),bank_reference:input.bank_reference,account_number:input.account_number,transferred_at:input.transferred_at,late_transfer:input.late_transfer})}::jsonb)`;
  await tx`set constraints all immediate`;return response;
 });
}
