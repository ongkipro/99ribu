import {createHash,randomInt} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {readLocalConfig} from '../../config/local.ts';
import {enqueueJob} from '../../jobs/outbox.ts';
import type {Claim,JobAdapter,Outcome} from '../../jobs/leases.ts';
import {AccessError} from '../access/policy.ts';
import {id,integer,invalid,object} from '../catalog/validation.ts';
import {financeEnvironment} from '../finance/ledger.ts';
import {registerSettlementEvent,settlementSourceEvent} from '../finance/settlements/local.ts';
import {advanceAttempt,lockPaymentOrder,type AttemptRow} from './attempts.ts';
import {liveAutolaris,originBoundFetch,readAutolarisStandInConfig} from './autolaris-live.ts';
import {openLocalOperation,readProviderEvents,registerProviderEvent,settleLocalOperation} from './local.ts';

// DEC-008 / S93: AutoLaris H2H payments on a LOCAL SIMULATED contract. Shapes follow
// the documented Create Payment / list_payment / advice envelopes (ongkipro/autolaris
// e61b3cc). Unverified facts stay gated in S97: reff_id replay semantics, the `expired`
// timezone, the full advice status list and the callback contract. No network, no key. The settled advice shape is now observed (see AUTOLARIS_SETTLEMENT).
// AutoLaris create_payment requires customer_email; checkout asks buyers no email (owner 2026-11-05), so every payment
// carries the store's address the owner chose (2026-11-05). AutoLaris may send payment notices there.
export const AUTOLARIS_STORE_EMAIL='ongkiardiansyah@gmail.com';
export type Envelope={rc:string;ket:string;data:unknown};
export type CreatePaymentBody={reff_id:string;channel_code:string;customer_id:string;customer_name:string;customer_phone:string;customer_email:string;expired:string;amount:string;callback_url:string};
export type AutolarisClient={listPayment:(signal?:AbortSignal)=>Promise<Envelope>;createPayment:(body:CreatePaymentBody,signal?:AbortSignal)=>Promise<Envelope>;advice:(body:{transaction_id:string},signal?:AbortSignal)=>Promise<Envelope>};
// DEC-008 (1): VA BNI/Permata/BCA/Mandiri/BRI and QRIS, offered only when the account's list_payment enables them.
export const AUTOLARIS_CHANNELS=['VABNI','VAPERMATA','VABCA','VAMANDIRI','VABRI','QRIS'] as const;
export const ADVICE_INTERVAL_SECONDS=300,ADVICE_MAX_POLLS=24,ADVICE_FINAL_POLLS=12;
// S97 (2026-11-09, one live QRIS payment of Rp9.900 on the production account, recorded in BUILD-LOG): the real advice
// answers `{rc:'02',ket:'PENDING',data:{awb:''}}` before payment and `{rc:'00',ket:'PAID',data:{awb:''}}` after it. The
// status is `ket`; `data` carries no amount, transaction id or time. Only this exact pair settles; SUCCESS, BERHASIL and
// shipping words such as DELIVERED never do. Observed for QRIS only; a VA payment is still unobserved.
export const AUTOLARIS_SETTLEMENT={rc:'00',ket:'PAID'} as const;
type Classified={classification:'pending'|'settled'|'unknown';amount:number|null;paid_at:string|null};

// A settled advice carries no amount in the real contract (`amount` is null here); the caller bills the provider total that
// create_payment returned and the adapter already matched to the requested amount. A reported `data.amount`, when present,
// is kept so a different bill still lands in recovery as an amount mismatch.
export function classifyAdvice(envelope:Envelope):Classified{
 const data=envelope.data&&typeof envelope.data==='object'&&!Array.isArray(envelope.data)?envelope.data as Record<string,unknown>:{};
 if(envelope.rc==='02')return {classification:'pending',amount:null,paid_at:null};
 if(envelope.rc===AUTOLARIS_SETTLEMENT.rc&&envelope.ket===AUTOLARIS_SETTLEMENT.ket){
  const reported=data.amount===undefined?null:data.amount;
  if(reported!==null&&(!Number.isSafeInteger(reported)||Number(reported)<=0))return {classification:'unknown',amount:null,paid_at:null};
  return {classification:'settled',amount:reported===null?null:Number(reported),paid_at:typeof data.paid_at==='string'&&Number.isFinite(Date.parse(data.paid_at))?new Date(data.paid_at).toISOString():null};
 }
 return {classification:'unknown',amount:null,paid_at:null};
}
// Exactly one non-empty instruction field; the client never guesses from the channel prefix.
export function parseCreatePayment(envelope:Envelope){
 if(envelope.rc!=='00')return {rejected:true as const,rc:String(envelope.rc).slice(0,8)};
 const d=envelope.data as Record<string,unknown>;if(!d||typeof d!=='object')throw new Error('AutoLaris response malformed');
 const trx=String(d.trx_id??'');if(!/^[A-Za-z0-9_-]{1,64}$/.test(trx))throw new Error('AutoLaris response malformed');
 const filled=(['virtual_account','qr','payment_code','url'] as const).filter(k=>typeof d[k]==='string'&&(d[k] as string).length>0);
 if(filled.length!==1||(d[filled[0]] as string).length>2048)throw new Error('AutoLaris response malformed');
 const money=(v:unknown)=>{const n=typeof v==='string'&&/^\d{1,16}$/.test(v)?Number(v):v;if(!Number.isSafeInteger(n)||Number(n)<0)throw new Error('AutoLaris response malformed');return Number(n);};
 return {rejected:false as const,trx_id:trx,instruction_kind:filled[0],instruction_value:d[filled[0]] as string,amount:money(d.amount),admin:money(d.admin),total:money(d.total)};
}
export function enabledChannels(envelope:Envelope){
 if(envelope.rc!=='00'||!Array.isArray(envelope.data))throw new AccessError(503,'AUTOLARIS_CHANNELS_UNAVAILABLE');
 return envelope.data.flatMap(row=>{const r=row as Record<string,unknown>;const code=String(r?.channel_code??'');
  return (AUTOLARIS_CHANNELS as readonly string[]).includes(code)?[{channel_code:code,name:String(r.name??code).slice(0,60)}]:[];});
}

// Live AutoLaris is gated (S97: static egress IP whitelist, server-secret key,
// verified advice settlement mapping, owner authorization). It never starts here.
// DEC-028 / S166: with LOCAL_PROVIDER_ORIGIN set, local and test use the real HTTP client against the loopback
// stand-in (wire layer only; its settlement shape is not the provider's contract). Unset keeps the simulator.
export function autolarisClientFor(target:string,sql?:Sql,options?:SimulatorOptions):AutolarisClient{
 if(target==='local'||target==='test'){
  const standIn=readAutolarisStandInConfig(process.env);
  if(standIn)return liveAutolaris(standIn,originBoundFetch(standIn.baseUrl));
  if(sql)return simulatedAutolaris(sql,target,options);
 }
 throw new AccessError(503,'AUTOLARIS_LIVE_GATED');
}

// ---- Host-only simulator of the AutoLaris account (database-backed, keyed by reff_id).
export type SimulatorOptions={feeMode?:'merchant'|'buyer';fault?:'timeout-before'|'timeout-after'};
// Owner 2026-11-04 (DEC-029): the account's AutoLaris rates are QRIS 0,7%, VA BCA Rp6.500, every other VA Rp3.000.
const FEES:Record<string,{admin:number;kind:'fix'|'persen'}>={VABNI:{admin:3000,kind:'fix'},VAPERMATA:{admin:3000,kind:'fix'},VABCA:{admin:6500,kind:'fix'},VAMANDIRI:{admin:3000,kind:'fix'},VABRI:{admin:3000,kind:'fix'},QRIS:{admin:0.7,kind:'persen'}};
function simulatedAutolaris(sql:Sql,target:'local'|'test',options:SimulatorOptions={}):AutolarisClient{
 return {
  async listPayment(){
   return {rc:'00',ket:'Sukses',data:[{channel_code:'COD',name:'COD',admin:'0.0',tipe_admin:'fix'},...Object.entries(FEES).map(([code,f])=>({channel_code:code,name:code==='QRIS'?'QRIS':`Bank ${code.slice(2)}`,admin:f.admin.toFixed(1),tipe_admin:f.kind})),{channel_code:'OVO',name:'OVO',admin:'3.0',tipe_admin:'persen'}]};
  },
  async createPayment(body){
   if(options.fault==='timeout-before')throw new Error('Simulated AutoLaris timeout before effect');
   const fee=FEES[body.channel_code];if(!fee)return {rc:'14',ket:'Channel tidak tersedia',data:null};
   const response=await sql.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtextextended(${`autolaris-sim:${target}:${body.reff_id}`},0))`;
    let [row]=await tx`select * from app.local_autolaris_transaction where environment=${target} and reff_id=${body.reff_id}`;
    if(!row){
     const amount=Number(body.amount),admin=fee.kind==='fix'?fee.admin:Math.ceil(amount*fee.admin/100),total=options.feeMode==='buyer'?amount+admin:amount;
     const kind=body.channel_code==='QRIS'?'qr':'virtual_account',value=kind==='qr'?`SIMULATED-QRIS-${body.reff_id}`:`8${String(randomInt(1e9,1e10))}${String(randomInt(1e5,1e6))}`;
     [row]=await tx`insert into app.local_autolaris_transaction (trx_id,environment,reff_id,channel_code,amount,admin_fee,total,instruction_kind,instruction_value,status)
      values (${String(randomInt(1e8,1e9))},${target},${body.reff_id},${body.channel_code},${amount},${admin},${total},${kind},${value},'pending') returning *`;
    }
    return {rc:'00',ket:'Sukses',data:{trx_id:String(row.trx_id),virtual_account:row.instruction_kind==='virtual_account'?row.instruction_value:'',qr:row.instruction_kind==='qr'?row.instruction_value:'',payment_code:'',url:'',amount:Number(row.amount),admin:Number(row.admin_fee),total:Number(row.total)}};
   });
   if(options.fault==='timeout-after')throw new Error('Simulated AutoLaris response lost after effect');
   return response;
  },
  async advice({transaction_id}){
   const [row]=await sql`select * from app.local_autolaris_transaction where environment=${target} and trx_id=${transaction_id}`;
   if(!row)return {rc:'14',ket:'Transaksi tidak ditemukan',data:null};
   // The observed live shape (S97): no amount, id or time in `data`.
   if(row.status==='paid')return {rc:'00',ket:'PAID',data:{awb:''}};
   if(row.status==='generic_success')return {rc:'00',ket:'SUCCESS',data:{awb:''}};
   if(row.status==='expired')return {rc:'03',ket:'EXPIRED',data:{awb:''}};
   return {rc:'02',ket:'PENDING',data:{awb:''}};
  },
 };
}
// Host command: the simulated buyer pays (or the account reports a status) for an attempt's transaction.
export async function simulateAutolarisStatus(sql:Sql,target:'local'|'test',attemptId:string,status:'paid'|'generic_success'|'expired'){
 // In local provider mode payments live at the stand-in; marking the simulator row would silently change nothing.
 if(readAutolarisStandInConfig(process.env))throw new AccessError(409,'AUTOLARIS_STAND_IN_MODE');
 return sql.begin(async tx=>{
  const [row]=await tx`select l.trx_id,app.reservation_clock(o.clock_namespace) now from app.autolaris_payment l join app.payment_attempt a on a.id=l.attempt_id join app.commerce_order o on o.id=a.order_id where l.attempt_id=${id(attemptId)} and l.environment=${target}`;
  if(!row?.trx_id)throw new AccessError(404,'NOT_FOUND');
  await tx`update app.local_autolaris_transaction set status=${status},paid_at=${status==='paid'?new Date(row.now).toISOString():null} where environment=${target} and trx_id=${row.trx_id} and status in ('pending','generic_success')`;
  return {trx_id:String(row.trx_id),status};
 });
}

// ---- Payment creation (leased payment.create job, AutoLaris attempts).
const reffId=(attemptId:string)=>`99R${attemptId.replaceAll('-','')}`;
export async function persistAutolarisIdentity(tx:TransactionSql,attempt:{id:string;expected_amount:number|string;payment_fee_amount?:number|string},channelCode:string){
 if(!(AUTOLARIS_CHANNELS as readonly string[]).includes(channelCode))throw invalid();
 await tx`insert into app.autolaris_payment (attempt_id,environment,reff_id,channel_code,requested_amount) values (${attempt.id},${await financeEnvironment(tx)},${reffId(attempt.id)},${channelCode},${Number(attempt.expected_amount)+Number(attempt.payment_fee_amount??0)})`;
}
function jakarta(at:Date){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(at).map(x=>[x.type,x.value]));
 return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}
async function linkAndIngest(sql:Sql,attemptId:string,operationId:string){
 await sql.begin(async tx=>{
  const [before]=await tx<AttemptRow[]>`select * from app.payment_attempt where id=${attemptId}`;
  await lockPaymentOrder(tx,before.order_id);const [attempt]=await tx<AttemptRow[]>`select * from app.payment_attempt where id=${attemptId} for update`;
  if(!attempt.provider_operation_id&&['pending','unknown'].includes(attempt.status))await advanceAttempt(tx,attempt,{status:attempt.status,source_type:'provider_link',source_id:operationId,provider_operation_id:operationId,occurred_at:new Date(attempt.created_at).toISOString()});
  for(const event of await readProviderEvents(tx,attemptId))await registerProviderEvent(tx,event);
 });
}
async function failOperation(sql:Sql,target:'local'|'test',attemptId:string,write?:(tx:TransactionSql)=>Promise<unknown>){
 await sql.begin(async tx=>{if(write)await write(tx);const [op]=await tx`select status from app.local_payment_operation where attempt_id=${attemptId}`;if(op.status==='pending')await settleLocalOperation(tx,target,attemptId,{status:'failed'});});
}
export async function scheduleAdvice(tx:TransactionSql,attemptId:string,poll:number,delaySeconds=ADVICE_INTERVAL_SECONDS){
 const job=await enqueueJob(tx,'payment.autolaris.advice',`autolaris-advice:${attemptId}:${poll}`,{attemptId,poll});
 await tx`update app.outbox_job set run_at=clock_timestamp()+${delaySeconds}*interval '1 second' where id=${job} and status='pending' and attempts=0`;return job;
}
// Order expiry asks for a final advice read now: wake a queued poll, else add one (bounded budget).
export async function requestFinalAdvice(tx:TransactionSql,attemptId:string){
 const [queued]=await tx`update app.outbox_job set run_at=least(run_at,clock_timestamp()) where kind='payment.autolaris.advice' and payload->>'attemptId'=${attemptId} and status in ('pending','unknown') returning id`;
 if(queued)return String(queued.id);
 const [last]=await tx`select coalesce(max((payload->>'poll')::int),0) poll from app.outbox_job where kind='payment.autolaris.advice' and payload->>'attemptId'=${attemptId}`;
 return Number(last.poll)<ADVICE_MAX_POLLS+ADVICE_FINAL_POLLS?scheduleAdvice(tx,attemptId,Number(last.poll)+1,0):null;
}
export async function dispatchAutolarisPayment(sql:Sql,target:'local'|'test',attemptId:string,client:AutolarisClient,signal?:AbortSignal):Promise<Outcome>{
 const opened=await sql.begin(async tx=>{
  const opened=await openLocalOperation(tx,target,attemptId);
  await tx`update app.autolaris_payment set operation_id=${opened.operation_id} where attempt_id=${attemptId} and operation_id is null`;
  const [identity]=await tx`select l.*,a.payment_fee_amount,o.number,o.expires_at,q.document->'contact' contact,q.document->'address'->>'recipient_name' recipient from app.autolaris_payment l join app.payment_attempt a on a.id=l.attempt_id
   join app.commerce_order o on o.id=a.order_id join app.checkout_quote q on q.id=o.quote_id where l.attempt_id=${attemptId}`;
  if(!identity)throw new AccessError(409,'AUTOLARIS_IDENTITY_MISSING');return {...opened,identity};
 });
 const l=opened.identity;
 if(opened.status==='pending'&&!l.responded_at){
  // The channel must be enabled by the account right now (never a hard-coded list).
  if(!enabledChannels(await client.listPayment(signal)).some(c=>c.channel_code===l.channel_code))await failOperation(sql,target,attemptId);
  else{
   const contact=l.contact as {phone:string;email:string|null};
   // A timeout or lost response leaves responded_at empty; the reconciliation pass replays the SAME reff_id (gated S97 assumption).
   const parsed=parseCreatePayment(await client.createPayment({reff_id:l.reff_id,channel_code:l.channel_code,customer_id:l.number,customer_name:String(l.recipient).slice(0,100),customer_phone:contact.phone,customer_email:contact.email||AUTOLARIS_STORE_EMAIL,
    expired:jakarta(new Date(l.expires_at)),amount:String(l.requested_amount),callback_url:`${readLocalConfig(process.env).origin}/api/v1/payments/autolaris/callbacks`},signal));
   if(parsed.rejected)await failOperation(sql,target,attemptId);
   else{
    // DEC-008 (3) / DEC-029: the provider bills exactly the requested amount (order value plus any frozen buyer fee) and deducts its fee; any other amount or total is refused.
    // DEC-029: a buyer-borne fee must not exceed what the provider deducts, or the store would hold buyer money it
    // cannot settle; refused before any instruction is shown (the attempt fails, the buyer may pick another channel).
    const refusal=parsed.amount!==Number(l.requested_amount)?'AUTOLARIS_AMOUNT_MISMATCH':parsed.total!==Number(l.requested_amount)?'AUTOLARIS_TOTAL_MISMATCH':parsed.admin<Number(l.payment_fee_amount)?'AUTOLARIS_FEE_MISMATCH':null;
    const record=(tx:TransactionSql)=>tx`update app.autolaris_payment set trx_id=${parsed.trx_id},instruction_kind=${parsed.instruction_kind},instruction_value=${parsed.instruction_value},provider_amount=${parsed.amount},admin_fee=${parsed.admin},provider_total=${parsed.total},refusal_code=${refusal},responded_at=clock_timestamp() where attempt_id=${attemptId} and responded_at is null`;
    if(refusal)await failOperation(sql,target,attemptId,record);
    else await sql.begin(async tx=>{await record(tx);await scheduleAdvice(tx,attemptId,1);});
   }
  }
 }
 await linkAndIngest(sql,attemptId,opened.operation_id);
 return {status:'succeeded',receipt:{operation_id:opened.operation_id}};
}

// ---- Advice polling (leased payment.autolaris.advice job). Read-only at the provider,
// so an unknown outcome simply re-reads; only an explicit settlement status pays.
export function autolarisAdviceAdapter(sql:Sql,target:'local'|'test',client:AutolarisClient=autolarisClientFor(target,sql)):JobAdapter{
 const run=async(claim:Claim,signal:AbortSignal):Promise<Outcome>=>{
  const body=object(claim.payload,['attemptId','poll']),attemptId=id(body.attemptId),poll=integer(body.poll,1,ADVICE_MAX_POLLS+ADVICE_FINAL_POLLS);
  const [row]=await sql`select l.trx_id,l.refusal_code,l.provider_total,p.status operation_status,a.payment_fee_amount,j.id job from app.autolaris_payment l join app.payment_attempt a on a.id=l.attempt_id join app.local_payment_operation p on p.id=l.operation_id
   join app.outbox_job j on j.dedup_key=${`autolaris-advice:${attemptId}:${poll}`} and j.id=${claim.id} where l.attempt_id=${attemptId} and l.environment=${target}`;
  if(!row?.trx_id||row.refusal_code)return {status:'failed',code:'INVALID_PAYLOAD'};
  if(row.operation_status!=='pending')return {status:'succeeded',receipt:{stopped:'final'}};
  const envelope=await client.advice({transaction_id:String(row.trx_id)},signal),classified=classifyAdvice(envelope);
  // DEC-029: a reported bill at or below the frozen buyer fee cannot be a collection; kept as unknown for finance.
  // S97: the real advice has no amount, so a settled answer bills the provider total verified at creation.
  const billed=classified.classification==='settled'?(classified.amount??Number(row.provider_total)):null;
  const seen=classified.classification==='settled'&&(billed===null||!Number.isSafeInteger(billed)||billed-Number(row.payment_fee_amount)<1)?{classification:'unknown' as const,amount:null,paid_at:null}
   :classified.classification==='settled'?{...classified,amount:billed}:classified;
  const result=await sql.begin(async tx=>{
   const [attempt]=await tx`select order_id from app.payment_attempt where id=${attemptId}`;const order=await lockPaymentOrder(tx,attempt.order_id);
   await tx`select pg_advisory_xact_lock(hashtextextended(${`payment:${attemptId}`},0))`;
   const [state]=await tx`select p.status,app.reservation_clock(${order.clock_namespace}) now,a.created_at,a.expires_at from app.local_payment_operation p join app.payment_attempt a on a.id=p.attempt_id where p.attempt_id=${attemptId} for update of p`;
   if(state.status!=='pending')return 'final';
   const now=new Date(state.now),paidAt=seen.paid_at&&Date.parse(seen.paid_at)<=now.getTime()&&Date.parse(seen.paid_at)>=new Date(state.created_at).getTime()?seen.paid_at:now.toISOString();
   await tx`insert into app.autolaris_observation (attempt_id,source,rc,ket,classification,amount,occurred_at) values (${attemptId},'advice',${String(envelope.rc).slice(0,8)},${String(envelope.ket??'').slice(0,120)},${seen.classification},${seen.amount},${paidAt})`;
   // DEC-029: the provider reports the bill; the collection we record is the bill minus the frozen buyer fee (the order
   // value when the bill is exact; any other amount still lands in recovery as an amount mismatch).
   if(seen.classification==='settled'){await registerProviderEvent(tx,await settleLocalOperation(tx,target,attemptId,{amount:(seen.amount as number)-Number(row.payment_fee_amount),occurred_at:paidAt}));return 'settled';}
   // Bounded: stop after the window plus one interval, or the poll budget; manual confirmation remains.
   if(poll<ADVICE_MAX_POLLS&&now.getTime()<new Date(state.expires_at).getTime()+ADVICE_INTERVAL_SECONDS*1000)await scheduleAdvice(tx,attemptId,poll+1);
   return seen.classification;
  });
  return {status:'succeeded',receipt:{observed:result,poll}};
 };
 return {dispatch:run,reconcile:run};
}

// ---- Admin fee: the AutoLaris settlement deducts it, posting the part the store bears as provider_fee_expense
// through the existing S30 settlement journals (never buyer revenue, Purchase or commission).
export async function simulateAutolarisSettlement(sql:Sql,target:'local'|'test',attemptId:string){
 return sql.begin(async tx=>{
  const [row]=await tx`select l.trx_id,l.provider_total,l.admin_fee,a.payment_fee_amount,r.transaction_id,o.clock_namespace from app.autolaris_payment l join app.payment_attempt a on a.id=l.attempt_id join app.commerce_order o on o.id=a.order_id
   join app.economic_receipt r on r.id=a.receipt_id where l.attempt_id=${id(attemptId)} and l.environment=${target}`;
  if(!row)throw new AccessError(409,'AUTOLARIS_SETTLEMENT_UNAVAILABLE');
  // DEC-029: the buyer-paid fee is a pass-through: the statement's gross is the receipt (bill minus that fee) and the
  // store's cost is only what the provider deducts beyond it. A buyer fee above the provider fee would mean the store
  // charged the buyer more than the bank took: refused for finance review, never booked silently.
  const buyerFee=Number(row.payment_fee_amount),gross=Number(row.provider_total)-buyerFee,fee=Number(row.admin_fee)-buyerFee;
  if(fee<0)throw new AccessError(409,'AUTOLARIS_FEE_VARIANCE');
  const event=await settlementSourceEvent(tx,target,{provider:'local.payment',reference:`autolaris:${row.trx_id}`,direction:'credit',net_amount:gross-fee,clock_namespace:row.clock_namespace,
   statement:{gross_amount:gross,carrier_fee:0,provider_fee:fee,allocation_claims:[{receivable_transaction_id:String(row.transaction_id),gross_amount:gross,reopens_allocation_id:null}],reverses_reference:null}});
  return {event,job:await registerSettlementEvent(tx,event)};
 });
}
// Raw callback evidence for contract discovery (S97). Never parsed into payment state.
export async function recordAutolarisCallback(sql:Sql,contentType:string,body:string){
 if(Buffer.byteLength(body)>16384)throw new AccessError(413,'PAYLOAD_TOO_LARGE');
 const [row]=await sql`insert into app.autolaris_callback (content_type,body,body_sha256) values (${contentType.slice(0,120)},${body},${createHash('sha256').update(body).digest('hex')}) returning id`;
 return {id:String(row.id)};
}
// Retention (R4): raw bodies may carry payer data. After AUTOLARIS_CALLBACK_RETENTION_DAYS the
// worker empties the body once (the digest, content type and receipt time stay as evidence).
export const AUTOLARIS_CALLBACK_RETENTION_DAYS=30;
export async function redactAutolarisCallbacks(sql:Sql,receivedBefore:Date=new Date(Date.now()-AUTOLARIS_CALLBACK_RETENTION_DAYS*86400000),limit=500){
 const rows=await sql`update app.autolaris_callback set body='',redacted_at=clock_timestamp() where id in (select id from app.autolaris_callback where redacted_at is null and received_at<${receivedBefore.toISOString()} order by received_at limit ${limit}) returning id`;
 return rows.length;
}
