import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {handleAutolarisCallback,handleAutolarisPayments} from '../../src/modules/finance/autolaris-routes.ts';
import {type AutolarisClient,autolarisAdviceAdapter,autolarisClientFor,classifyAdvice,enabledChannels,parseCreatePayment,redactAutolarisCallbacks,simulateAutolarisSettlement,simulateAutolarisStatus} from '../../src/modules/payments/autolaris.ts';
import {expireOwnedOrderJob} from '../../src/modules/checkout/expiry.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {createAttempt,projectAttempt} from '../../src/modules/payments/attempts.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor} from './fulfillment-fixture.ts';
import {paymentFixture} from './payment-fixture.ts';

test('AutoLaris simulated contract: only an explicit settlement status pays; one instruction field; channels from list_payment; live gate refuses',async()=>{
 assert.equal(classifyAdvice({rc:'02',ket:'PENDING',data:{awb:''}}).classification,'pending');
 for(const ket of ['SUCCESS','BERHASIL','DELIVERED'])assert.equal(classifyAdvice({rc:'00',ket,data:{status:ket,amount:1000}}).classification,'unknown',`${ket} is not proof of payment`);
 assert.equal(classifyAdvice({rc:'00',ket:'PAID',data:{status:'PAID'}}).classification,'unknown','a settlement without an amount cannot pay');
 assert.deepEqual(classifyAdvice({rc:'00',ket:'PAID',data:{status:'PAID',amount:111000,paid_at:'2026-10-20T01:02:03.000Z'}}),{classification:'settled',amount:111000,paid_at:'2026-10-20T01:02:03.000Z'});
 assert.equal(classifyAdvice({rc:'99',ket:'GAGAL',data:null}).classification,'unknown');
 const base={trx_id:'671647',virtual_account:'',qr:'',payment_code:'',url:'',amount:11000,admin:3000,total:11000};
 assert.equal(parseCreatePayment({rc:'00',ket:'Sukses',data:{...base,virtual_account:'8779611150001393'}}).rejected,false);
 assert.throws(()=>parseCreatePayment({rc:'00',ket:'Sukses',data:base}),/malformed/,'no instruction field');
 assert.throws(()=>parseCreatePayment({rc:'00',ket:'Sukses',data:{...base,virtual_account:'877',qr:'000201'}}),/malformed/,'two instruction fields');
 assert.equal(parseCreatePayment({rc:'14',ket:'Gagal',data:null}).rejected,true);
 assert.deepEqual(enabledChannels({rc:'00',ket:'Sukses',data:[{channel_code:'COD',name:'COD'},{channel_code:'QRIS',name:'QRIS'},{channel_code:'OVO',name:'OVO'},{channel_code:'VABNI',name:'Bank BNI'}]}).map(c=>c.channel_code),['QRIS','VABNI']);
 for(const target of ['production','live','local'])assert.throws(()=>autolarisClientFor(target),{code:'AUTOLARIS_LIVE_GATED'});
});

type Fixture=Awaited<ReturnType<typeof paymentFixture>>;
const sim=(f:Fixture,options?:Parameters<typeof autolarisClientFor>[2])=>autolarisClientFor('test',f.identity.sql,options);
async function due(f:Fixture,jobId:string){await f.identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${jobId}`;}
async function create(f:Fixture,jobId:string,client:AutolarisClient){await due(f,jobId);return runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test',new Map(),client)},jobId);}
async function callbacks(f:Fixture,attemptId:string){
 for(const job of await f.identity.sql`select callback_job_id from app.payment_provider_event where attempt_id=${attemptId}`){
  const [state]=await f.identity.sql`select status from app.outbox_job where id=${job.callback_job_id}`;if(state.status==='pending')assert.equal(await runOneJob(f.identity.sql,{},job.callback_job_id),true);
 }
}
async function advice(f:Fixture,attemptId:string,poll:number){
 const [job]=await f.identity.sql`select id from app.outbox_job where dedup_key=${`autolaris-advice:${attemptId}:${poll}`}`;assert.ok(job,`advice poll ${poll} scheduled`);
 await due(f,job.id);assert.equal(await runOneJob(f.identity.sql,{'payment.autolaris.advice':autolarisAdviceAdapter(f.identity.sql,'test')},job.id),true);
 await callbacks(f,attemptId);
 const [done]=await f.identity.sql`select status,result from app.outbox_job where id=${job.id}`;assert.equal(done.status,'completed');return done.result as {observed?:string;stopped?:string};
}
async function attempt(f:Fixture,orderId:string,channel='VABNI'){
 const shown=await f.identity.sql.begin(tx=>createAttempt(tx,orderId,randomUUID(),{method_id:'autolaris',channel_code:channel}));
 const [row]=await f.identity.sql`select creation_job_id from app.payment_attempt where id=${shown.id}`;return {id:shown.id,job:String(row.creation_job_id)};
}

test('AutoLaris payment: reff_id before the call, one provider payment across a lost response, advice pays once, callbacks never pay, admin fee is store cost',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql;
 try{
  const {order}=await f.order(1,'prepaid','autolaris');
  assert.equal(order.payment_channel,'autolaris');
  for(const body of [{method_id:'autolaris'},{method_id:'autolaris',channel_code:'OVO'},{method_id:'local-prepaid',channel_code:'VABNI'}])
   assert.equal(await sql.begin(tx=>createAttempt(tx,order.id,randomUUID(),body)).then(()=>null,(e:{code?:string})=>e.code),'INVALID_INPUT');
  assert.equal(await sql.begin(tx=>createAttempt(tx,order.id,randomUUID(),{method_id:'local-prepaid'})).then(()=>null,(e:{code?:string})=>e.code),'PAYMENT_METHOD_UNAVAILABLE');
  const a=await attempt(f,order.id);
  const [identity]=await sql`select reff_id,channel_code,requested_amount,responded_at,operation_id from app.autolaris_payment where attempt_id=${a.id}`;
  assert.ok(identity.reff_id.startsWith('99R')&&identity.responded_at===null&&identity.operation_id===null,'reff_id persisted with the attempt, before any provider call');
  // Lost response after the provider created the payment: the job is unknown, never a second payment.
  assert.equal(await create(f,a.job,sim(f,{fault:'timeout-after'})),true);
  assert.equal((await sql`select status from app.outbox_job where id=${a.job}`)[0].status,'unknown');
  assert.equal((await sql`select responded_at from app.autolaris_payment where attempt_id=${a.id}`)[0].responded_at,null);
  assert.equal(await create(f,a.job,sim(f)),true,'reconciliation replays the same reff_id');
  assert.equal((await sql`select status from app.outbox_job where id=${a.job}`)[0].status,'completed');
  assert.equal((await sql`select count(*)::int n from app.local_autolaris_transaction where environment='test' and reff_id=${identity.reff_id}`)[0].n,1,'one provider payment per reff_id');
  const [recorded]=await sql`select trx_id,instruction_kind,provider_total,admin_fee,refusal_code from app.autolaris_payment where attempt_id=${a.id}`;
  assert.equal(recorded.instruction_kind,'virtual_account');assert.equal(recorded.refusal_code,null);assert.equal(Number(recorded.provider_total),Number(order.buyer_total),'admin fee never added to the buyer total');
  assert.equal(Number(recorded.admin_fee),4000);
  await callbacks(f,a.id);
  const shown=await sql.begin(tx=>projectAttempt(tx,order.id,a.id));
  assert.equal(shown.status,'pending');assert.ok(shown.action.kind==='autolaris'&&shown.action.instruction?.kind==='virtual_account'&&shown.action.amount===Number(order.buyer_total));
  // Advice 02 keeps pending and schedules the next bounded poll.
  assert.equal((await advice(f,a.id,1)).observed,'pending');
  // Generic success wording never pays.
  await simulateAutolarisStatus(sql,'test',a.id,'generic_success');
  assert.equal((await advice(f,a.id,2)).observed,'unknown');
  assert.equal((await sql`select payment_status from app.commerce_order where id=${order.id}`)[0].payment_status,'pending');
  // A raw callback claiming payment is stored for discovery and changes nothing.
  const raw=JSON.stringify({trx_id:recorded.trx_id,status:'PAID',amount:Number(order.buyer_total)});
  const hook=await handleAutolarisCallback(new Request('http://127.0.0.1:3099/api/v1/payments/autolaris/callbacks',{method:'POST',headers:{host:'127.0.0.1:3099','content-type':'application/json'},body:raw}),f.identity);
  assert.equal(hook.status,202);
  assert.equal((await sql`select count(*)::int n from app.autolaris_callback where body=${raw}`)[0].n,1);
  assert.equal((await sql`select status from app.local_payment_operation where attempt_id=${a.id}`)[0].status,'pending','callbacks never change payment state');
  const big=await handleAutolarisCallback(new Request('http://127.0.0.1:3099/api/v1/payments/autolaris/callbacks',{method:'POST',headers:{host:'127.0.0.1:3099'},body:'x'.repeat(16385)}),f.identity);assert.equal(big.status,413);
  // Explicit settlement pays once.
  await simulateAutolarisStatus(sql,'test',a.id,'paid');
  assert.equal((await advice(f,a.id,3)).observed,'settled');
  const [paid]=await sql`select payment_status from app.commerce_order where id=${order.id}`;assert.equal(paid.payment_status,'confirmed');
  const receipts=await sql`select id,amount,payment_charge,merchandise_amount,transaction_id from app.economic_receipt where order_id=${order.id}`;
  assert.equal(receipts.length,1);assert.equal(Number(receipts[0].amount),Number(order.buyer_total));assert.equal(Number(receipts[0].payment_charge),0);
  const purchases=await sql`select merchandise_amount from app.commerce_event where name='Purchase' and order_id=${order.id}`;
  for(const p of purchases)assert.equal(Number(p.merchandise_amount),99000,'Purchase stays merchandise-only');
  // Duplicate advice reads after payment replay nothing.
  const [late]=await sql`select id from app.outbox_job where dedup_key=${`autolaris-advice:${a.id}:4`}`;assert.equal(late,undefined,'no poll scheduled after settlement');
  await sql.begin(async tx=>{const {scheduleAdvice}=await import('../../src/modules/payments/autolaris.ts');await scheduleAdvice(tx,a.id,4);});
  assert.equal((await advice(f,a.id,4)).stopped,'final');
  assert.equal((await sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,1);
  // AutoLaris settles total minus its admin fee: the fee posts as store payment cost.
  const settled=await simulateAutolarisSettlement(sql,'test',a.id);assert.equal(await runOneJob(sql,{},settled.job),true);
  const [fee]=await sql`select p.amount from app.finance_transaction t join app.finance_posting p on p.transaction_id=t.id where t.kind='settlement_fee' and t.effect_reference like ${`fee:${settled.event.statement_id}:%`} and p.account='provider_fee_expense'`;
  assert.equal(Number(fee?.amount),4000,'admin fee recorded as provider_fee_expense');
 }finally{await f.close();}
});

test('AutoLaris refuses a buyer-borne fee and manual confirmation needs authority, reason and fresh reauthentication',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql,users:Awaited<ReturnType<typeof actor>>[]=[];
 try{
  // An account that adds its admin fee to the total is refused, never charged.
  const refused=(await f.order(1,'prepaid','autolaris')).order,r=await attempt(f,refused.id,'QRIS');
  assert.equal(await create(f,r.job,sim(f,{feeMode:'buyer'})),true);await callbacks(f,r.id);
  const [row]=await sql`select refusal_code,instruction_kind from app.autolaris_payment where attempt_id=${r.id}`;assert.equal(row.refusal_code,'AUTOLARIS_TOTAL_MISMATCH');assert.equal(row.instruction_kind,'qr');
  assert.equal((await sql`select status from app.payment_attempt where id=${r.id}`)[0].status,'failed');
  assert.equal((await sql.begin(tx=>projectAttempt(tx,refused.id,r.id))).action.kind,'none');
  // DB guard: a refused payment can never receive a settled observation or a confirmed collection.
  await assert.rejects(sql`insert into app.autolaris_observation (attempt_id,source,rc,ket,classification,amount,occurred_at) values (${r.id},'advice','00','PAID','settled',1,clock_timestamp())`,{code:'23514'});
  await assert.rejects(sql`update app.autolaris_payment set refusal_code=null where attempt_id=${r.id}`,{code:'23514'});

  const {order}=await f.order(1,'prepaid','autolaris'),a=await attempt(f,order.id);
  assert.equal(await create(f,a.job,sim(f)),true);await callbacks(f,a.id);
  // DB guard: the operation cannot become confirmed without a settled observation.
  await assert.rejects(sql.begin(async tx=>{await tx`update app.local_payment_operation set status='confirmed',collected_amount=requested_amount,paid_at=clock_timestamp() where attempt_id=${a.id}`;await tx`set constraints all immediate`;}),{code:'23514'});
  const finance=await actor(f.identity,'finance',[]);users.push(finance);await enroll(finance.browser,finance.password);
  await sql`update app.role_grant set permissions=${['finance.reconciliation.read','finance.reconciliation.write']} where user_id=${finance.id}`;
  const proof=async()=>{const req=finance.browser.request('/api/v1/me/reauthentication-proofs',{password:finance.password,action:'finance.reconcile',subject_id:a.id});req.headers.set('idempotency-key',randomUUID());
   const response=await handleAccess(req,f.identity);assert.equal(response.status,201);return (await response.json()).proof as string;};
  const [clock]=await sql`select app.reservation_clock(o.clock_namespace) now from app.commerce_order o where o.id=${order.id}`;
  const confirm=async(body:Record<string,unknown>,who=finance)=>{const req=who.browser.request(`/api/v1/admin/autolaris-payments/${a.id}/confirmations`,body);req.headers.set('idempotency-key',randomUUID());
   const response=await handleAutolarisPayments(req,f.identity);return {status:response.status,payload:await response.json()};};
  const body={amount:Number(order.buyer_total),paid_at:new Date(clock.now).toISOString(),evidence:'Dashboard AutoLaris: transaksi lunas',reason:'Advice belum memberi status final'};
  const outsider=await actor(f.identity,'ecommerce_admin',[]);users.push(outsider);await enroll(outsider.browser,outsider.password);
  assert.equal((await confirm({...body,reauthentication_proof:'x'.repeat(43)},outsider)).status,403,'finance authority required');
  assert.equal((await confirm({...body,reason:'',reauthentication_proof:await proof()})).status,400,'reason required');
  assert.equal((await confirm({...body,reauthentication_proof:'x'.repeat(43)})).payload.code,'REAUTHENTICATION_REQUIRED');
  const queue=await handleAutolarisPayments(finance.browser.request('/api/v1/admin/autolaris-payments?state=open'),f.identity);assert.equal(queue.status,200);
  assert.ok((await queue.json()).data.some((p:{id:string;admin_fee:number})=>p.id===a.id&&p.admin_fee===4000));
  const ok=await confirm({...body,reauthentication_proof:await proof()});assert.equal(ok.status,201,JSON.stringify(ok.payload));await callbacks(f,a.id);
  assert.equal((await sql`select payment_status from app.commerce_order where id=${order.id}`)[0].payment_status,'confirmed');
  const [audit]=await sql`select actor_id,reason from app.audit_event where action='finance.autolaris_confirm' and subject_id=${a.id}`;assert.equal(audit.actor_id,finance.id);assert.equal(audit.reason,body.reason);
  assert.equal((await confirm({...body,reauthentication_proof:await proof()})).payload.code,'PAYMENT_ALREADY_FINAL');
  await assert.rejects(sql`delete from app.autolaris_observation where attempt_id=${a.id}`,{code:'23514'});
 }finally{for(const user of users)await closeFulfillmentActor(f.identity,user).catch(()=>{});await f.close();}
});

test('AutoLaris deadline: expiry requires a fresh advice read; payment inside the window learned after the deadline still pays; pending stays bounded',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql;
 try{
  const paid=(await f.order(1,'prepaid','autolaris')).order,open=(await f.order(1,'prepaid','autolaris')).order;
  const a=await attempt(f,paid.id),b=await attempt(f,open.id,'QRIS');
  for(const x of [a,b]){assert.equal(await create(f,x.job,sim(f)),true);await callbacks(f,x.id);}
  await simulateAutolarisStatus(sql,'test',a.id,'paid');// the buyer pays inside the window
  const expire=async(orderId:string)=>{const [job]=await sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${orderId}`;return sql.begin(tx=>expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload}));};
  const dueAdvice=async(attemptId:string)=>{const [job]=await sql`select id from app.outbox_job where kind='payment.autolaris.advice' and payload->>'attemptId'=${attemptId} and status='pending' and run_at<=clock_timestamp() order by run_at limit 1`;
   assert.ok(job,'a final advice read is due now');assert.equal(await runOneJob(sql,{'payment.autolaris.advice':autolarisAdviceAdapter(sql,'test')},job.id),true);await callbacks(f,attemptId);};
  let clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
  assert.equal((await expire(paid.id))?.status,'payment_reconciliation','no cancellation before a read after the deadline');
  await dueAdvice(a.id);
  assert.equal((await sql`select payment_status from app.commerce_order where id=${paid.id}`)[0].payment_status,'confirmed','paid inside the window, learned late: still paid');
  // Unpaid: each expiry pass asks for another read while the account says pending, then cancels after the window.
  assert.equal((await expire(open.id))?.status,'payment_reconciliation');await dueAdvice(b.id);
  assert.equal((await expire(open.id))?.status,'payment_reconciliation');
  clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
  assert.equal((await expire(open.id))?.status,'cancelled');
 }finally{await f.close();}
});

test('AutoLaris raw callbacks are rate limited and redacted once after retention; redacted rows stay as evidence',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql;
 try{
  const post=(body:string)=>handleAutolarisCallback(new Request('http://127.0.0.1:3099/api/v1/payments/autolaris/callbacks',{method:'POST',headers:{host:'127.0.0.1:3099','content-type':'application/json'},body}),f.identity);
  const marker=randomUUID(),body=JSON.stringify({marker,payer_phone:'081200000000'});assert.equal((await post(body)).status,202);
  const [row]=await sql`select id from app.autolaris_callback where body=${body}`;
  await assert.rejects(sql`update app.autolaris_callback set body='{}' where id=${row.id}`,{code:'23514'},'no edits besides redaction');
  await assert.rejects(sql`delete from app.autolaris_callback where id=${row.id}`,{code:'23514'});
  assert.ok(await redactAutolarisCallbacks(sql,new Date(Date.now()+60000))>=1);
  const [redacted]=await sql`select body,redacted_at,body_sha256 from app.autolaris_callback where id=${row.id}`;
  assert.equal(redacted.body,'');assert.ok(redacted.redacted_at);assert.match(redacted.body_sha256,/^[0-9a-f]{64}$/);
  await assert.rejects(sql`update app.autolaris_callback set body='',redacted_at=clock_timestamp() where id=${row.id}`,{code:'23514'},'redaction happens once');
  // Global budget on the unauthenticated receiver (bucket pre-filled to its budget).
  await sql`insert into app.auth_rate_limit (id,key,count,last_request) values (${randomUUID()},'rl:autolaris.callback',120,${Date.now()}) on conflict (key) do update set count=120,last_request=${Date.now()}`;
  assert.equal((await post('{}')).status,429);
  await sql`delete from app.auth_rate_limit where key='rl:autolaris.callback'`;
 }finally{await f.close();}
});
