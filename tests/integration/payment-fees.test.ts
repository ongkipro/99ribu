import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {type AutolarisClient,autolarisAdviceAdapter,persistAutolarisIdentity,simulateAutolarisSettlement,simulateAutolarisStatus} from '../../src/modules/payments/autolaris.ts';
import {handleAutolarisPayments} from '../../src/modules/finance/autolaris-routes.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {advanceAttempt,createAttempt} from '../../src/modules/payments/attempts.ts';
import {enqueueJob} from '../../src/jobs/outbox.ts';
import {autolarisBuyerFee} from '../../src/modules/payments/methods.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {paymentFixture} from './payment-fixture.ts';

// DEC-029 / S172: who bears payment fees, switchable per payment-policy version and frozen per quote (COD) or per
// attempt (AutoLaris). The simulator's fees equal TABLE, so a matching table leaves the store no cost.
type Fixture=Awaited<ReturnType<typeof paymentFixture>>;
const TABLE={VABNI:{kind:'fixed',amount:3000},VAPERMATA:{kind:'fixed',amount:3000},VABCA:{kind:'fixed',amount:6500},VAMANDIRI:{kind:'fixed',amount:3000},VABRI:{kind:'fixed',amount:3000},QRIS:{kind:'bps',bps:70}} as const;
async function proof(f:Fixture){
 const req=f.owner.browser.request('/api/v1/me/reauthentication-proofs',{password:f.owner.password,action:'payment_policy.version',subject_id:'company-payment'});req.headers.set('idempotency-key',randomUUID());
 const response=await handleAccess(req,f.identity);assert.equal(response.status,201);return (await response.json()).proof as string;
}
// Append payment-policy versions through the real owner + reauthentication flow; restore() puts the original back.
async function terms(f:Fixture){
 const read=async()=>(await (await f.owner.browser.access('/admin/policy-versions?kind=payment')).json()) as {latest_version:number;current:{values:Record<string,unknown>}|null};
 const original=(await read()).current?.values??{cod_fee_bps:0,manual_bank_accounts:[]};
 const write=async(values:Record<string,unknown>,expect=201)=>{const history=await read();
  const req=f.owner.browser.request('/api/v1/admin/policy-versions',{kind:'payment',warehouse_id:null,expected_version:history.latest_version,effective_at:null,values:{cod_fee_bps:0,manual_bank_accounts:[],...values},reason:'SYNTHETIC S172 payment fee bearer',reauthentication_proof:await proof(f)});
  req.headers.set('idempotency-key',randomUUID());const response=await handleAccess(req,f.identity);const body=await response.json();assert.equal(response.status,expect,JSON.stringify(body));
  if(expect!==201)return body.code as string;
  // Fixture business clocks stand still: move past the new version's wall-clock effective time.
  const clock=await readFixtureClock('test',f.namespace),[wall]=await f.identity.sql`select clock_timestamp() now`;
  await advanceFixtureClock('test',f.namespace,Math.max(1,Math.ceil((new Date(wall.now).getTime()-Date.parse(clock.now))/1000)+5),clock.version);return null;};
 return {write,restore:()=>write(original)};
}
async function attempt(f:Fixture,orderId:string,channel:string){
 const shown=await f.identity.sql.begin(tx=>createAttempt(tx,orderId,randomUUID(),{method_id:'autolaris',channel_code:channel}));
 const [row]=await f.identity.sql`select creation_job_id,expected_amount,payment_fee_amount from app.payment_attempt where id=${shown.id}`;
 return {id:shown.id,job:String(row.creation_job_id),expected:Number(row.expected_amount),fee:Number(row.payment_fee_amount),action:shown.action as {amount?:number;payment_fee_amount?:number}};
}
async function run(f:Fixture,job:string,adapters:Parameters<typeof runOneJob>[1]){await f.identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${job}`;assert.equal(await runOneJob(f.identity.sql,adapters,job),true);}
async function pay(f:Fixture,a:{id:string;job:string}){
 await run(f,a.job,{'payment.create':paymentAdapter(f.identity.sql,'test')});
 await simulateAutolarisStatus(f.identity.sql,'test',a.id,'paid');
 const [poll]=await f.identity.sql`select id from app.outbox_job where kind='payment.autolaris.advice' and payload->>'attemptId'=${a.id} and status='pending' order by (payload->>'poll')::int desc limit 1`;
 await run(f,String(poll.id),{'payment.autolaris.advice':autolarisAdviceAdapter(f.identity.sql,'test')});
 for(const event of await f.identity.sql`select callback_job_id from app.payment_provider_event where attempt_id=${a.id}`){const [cb]=await f.identity.sql`select status from app.outbox_job where id=${event.callback_job_id}`;if(cb.status==='pending')await run(f,String(event.callback_job_id),{});}
}

test('AutoLaris fee borne by the buyer: priced from the policy, frozen on the attempt, billed on top, receipt stays the order value, settlement nets the fee',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql,policy=await terms(f);
 try{
  // A buyer-borne fee needs a price for every channel.
  assert.equal(await policy.write({payment_fee_bearer:'buyer',autolaris_fees:{VABCA:TABLE.VABCA}},422),'PAYMENT_FEE_TABLE_INCOMPLETE');
  const store=await f.order(1,'prepaid','autolaris');const plain=await attempt(f,store.order.id,'VABCA');
  assert.deepEqual([plain.fee,plain.expected,plain.action.payment_fee_amount],[0,Number(store.order.amount_due),0],'store-borne: no fee, the order value');
  // VA BNI is priced above the simulator's Rp3.000 on purpose: the variance case below.
  await policy.write({payment_fee_bearer:'buyer',autolaris_fees:{...TABLE,VABNI:{kind:'fixed',amount:5000}}});
  // The database applies the same rule as the application.
  const [wall]=await sql`select app.reservation_clock(${f.namespace}) now`;
  for(const due of [1,99,10000,10070,99999,109500,198000]){
   const [row]=await sql`select app.autolaris_buyer_fee('QRIS',${due},${wall.now}) fee`;
   assert.equal(Number(row.fee),autolarisBuyerFee({payment_fee_bearer:'buyer',autolaris_fees:TABLE},'QRIS',due),`SQL and TypeScript agree at ${due}`);
  }
  // Fixed fee (VA BCA).
  const one=await f.order(1,'prepaid','autolaris'),due=Number(one.order.amount_due),va=await attempt(f,one.order.id,'VABCA');
  assert.deepEqual([va.fee,va.expected,va.action.amount,va.action.payment_fee_amount],[6500,due,due+6500,6500],'the attempt stays the order value; the buyer sees and pays the bill');
  await pay(f,va);
  const [bill]=await sql`select requested_amount,provider_amount,provider_total,admin_fee,refusal_code from app.autolaris_payment where attempt_id=${va.id}`;
  assert.deepEqual([Number(bill.requested_amount),Number(bill.provider_total),Number(bill.admin_fee),bill.refusal_code],[due+6500,due+6500,6500,null],'the provider bills exactly the requested amount');
  const [order]=await sql`select payment_status from app.commerce_order where id=${one.order.id}`;assert.equal(order.payment_status,'confirmed');
  const receipts=await sql`select amount,payment_charge from app.economic_receipt where order_id=${one.order.id}`;
  assert.deepEqual(receipts.map(r=>[Number(r.amount),Number(r.payment_charge)]),[[due,0]],'the receipt is the order value; the fee is not buyer revenue');
  const settled=await simulateAutolarisSettlement(sql,'test',va.id);await run(f,String(settled.job),{});
  const [statement]=await sql`select gross_amount,provider_fee from app.local_settlement_statement where id=${settled.event.statement_id}`;
  assert.deepEqual([Number(statement.gross_amount),Number(statement.provider_fee)],[due,0],'gross is the receipt; the buyer fee covered the provider fee');
  // Percentage fee (QRIS), grossed up; the store absorbs at most the rounding rupiah.
  const two=await f.order(1,'prepaid','autolaris'),due2=Number(two.order.amount_due),qr=await attempt(f,two.order.id,'QRIS');
  assert.equal(qr.fee,autolarisBuyerFee({payment_fee_bearer:'buyer',autolaris_fees:TABLE},'QRIS',due2));
  await pay(f,qr);
  const [qbill]=await sql`select provider_total,admin_fee from app.autolaris_payment where attempt_id=${qr.id}`;
  assert.equal(Number(qbill.provider_total),due2+qr.fee);assert.ok(Number(qbill.admin_fee)-qr.fee>=0&&Number(qbill.admin_fee)-qr.fee<=1);
  const qset=await simulateAutolarisSettlement(sql,'test',qr.id);await run(f,String(qset.job),{});
  const [qs]=await sql`select gross_amount,provider_fee from app.local_settlement_statement where id=${qset.event.statement_id}`;
  assert.deepEqual([Number(qs.gross_amount),Number(qs.provider_fee)],[due2,Number(qbill.admin_fee)-qr.fee]);
  // A later switch never changes an existing attempt; a table above the provider's fee is refused at settlement.
  const three=await f.order(1,'prepaid','autolaris');
  const high=await attempt(f,three.order.id,'VABNI');assert.equal(high.fee,5000);
  await policy.write({payment_fee_bearer:'store'});
  const [kept]=await sql`select a.payment_fee_amount,l.requested_amount from app.payment_attempt a join app.autolaris_payment l on l.attempt_id=a.id where a.id=${high.id}`;assert.deepEqual([Number(kept.payment_fee_amount),Number(kept.requested_amount)],[5000,Number(three.order.amount_due)+5000]);
  // The provider deducts Rp3.000 but the table priced Rp5.000: refused at dispatch, before any instruction is shown.
  await run(f,high.job,{'payment.create':paymentAdapter(sql,'test')});
  const [refused]=await sql`select l.refusal_code,l.instruction_value,p.status from app.autolaris_payment l join app.local_payment_operation p on p.attempt_id=l.attempt_id where l.attempt_id=${high.id}`;
  assert.deepEqual([refused.refusal_code,refused.status],['AUTOLARIS_FEE_MISMATCH','failed'],'a buyer fee above the provider fee is never billed');
  const shown=await sql.begin(tx=>createAttempt(tx,three.order.id,randomUUID(),{method_id:'autolaris',channel_code:'VABCA'})).then(()=>null,(e:{code?:string})=>e.code);
  assert.equal(shown,'PAYMENT_ATTEMPT_ACTIVE','until the failed attempt is closed by its event, no second one starts');
  // A forged fee is refused by the database guard.
  await assert.rejects(sql.begin(async tx=>{await tx`update app.payment_attempt set payment_fee_amount=1 where id=${high.id}`;}),/Payment head requires exact immutable event/);
 }finally{await policy.restore();await f.close();}
});

test('buyer-borne AutoLaris fee guards: a forged fee and a fee over Rp1.000.000 are refused at insert; a bill paid after expiry is a late-payment recovery at the order value',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql,policy=await terms(f);
 try{
  await policy.write({payment_fee_bearer:'buyer',autolaris_fees:TABLE});
  // Bypass createAttempt's pricing: the same writes with a fee the policy did not price are refused by the database.
  const forge=(orderId:string,fee:number)=>sql.begin(async tx=>{
   const [o]=await tx`select buyer_total,payment_charge_amount,expires_at,app.reservation_clock(clock_namespace) now from app.commerce_order where id=${orderId}`;
   const id=randomUUID(),job=await enqueueJob(tx,'payment.create',`payment-create:${id}`,{attemptId:id});
   const [a]=await tx`insert into app.payment_attempt (id,order_id,method_id,key,request_hash,creation_job_id,expected_amount,payment_fee_amount,created_at,expires_at)
    values (${id},${orderId},'autolaris',${randomUUID()},${'0'.repeat(64)},${job},${Number(o.buyer_total)+Number(o.payment_charge_amount)},${fee},${new Date(o.now).toISOString()},${o.expires_at}) returning *`;
   await advanceAttempt(tx,a as never,{status:'pending',source_type:'request',source_id:job,occurred_at:new Date(o.now).toISOString()});
   await persistAutolarisIdentity(tx,a as never,'VABCA');
  });
  const forged=await f.order(1,'prepaid','autolaris');
  await assert.rejects(forge(forged.order.id,TABLE.VABCA.amount+1),/freezes the policy payment fee/,'a fee other than the policy price is refused');
  await assert.rejects(forge(forged.order.id,1_000_001),/payment_attempt_fee_check/,'the stored fee ceiling is Rp1.000.000');
  assert.equal((await sql`select count(*)::int n from app.payment_attempt where order_id=${forged.order.id}`)[0].n,0);
  // Late payment: the bill (order value + fee) is paid after the order expired.
  const late=await f.order(1,'prepaid','autolaris'),due=Number(late.order.amount_due),va=await attempt(f,late.order.id,'VABCA');
  assert.equal(va.fee,TABLE.VABCA.amount);
  await run(f,va.job,{'payment.create':paymentAdapter(sql,'test')});
  const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
  await simulateAutolarisStatus(sql,'test',va.id,'paid');
  const [poll]=await sql`select id from app.outbox_job where kind='payment.autolaris.advice' and payload->>'attemptId'=${va.id} and status='pending' order by (payload->>'poll')::int desc limit 1`;
  await run(f,String(poll.id),{'payment.autolaris.advice':autolarisAdviceAdapter(sql,'test')});
  for(const event of await sql`select callback_job_id from app.payment_provider_event where attempt_id=${va.id}`){const [cb]=await sql`select status from app.outbox_job where id=${event.callback_job_id}`;if(cb.status==='pending')await run(f,String(event.callback_job_id),{});}
  const results=await sql`select r.outcome,r.reason from app.payment_event_result r join app.payment_provider_event e on e.id=r.event_id where e.attempt_id=${va.id} and r.outcome in ('confirmed','recovery')`;
  const [times]=await sql`select a.created_at,a.expires_at,t.paid_at,t.status,app.reservation_clock(o.clock_namespace) now from app.payment_attempt a join app.commerce_order o on o.id=a.order_id join app.autolaris_payment l on l.attempt_id=a.id join app.local_autolaris_transaction t on t.trx_id=l.trx_id and t.environment=l.environment where a.id=${va.id}`;
  assert.deepEqual(results.map(r=>[r.outcome,r.reason]),[['recovery','late_payment']],JSON.stringify(times));
  const [order]=await sql`select status,payment_status from app.commerce_order where id=${late.order.id}`;assert.deepEqual([order.status,order.payment_status],['cancelled','expired']);
  const receipts=await sql`select amount,payment_charge from app.economic_receipt where order_id=${late.order.id}`;
  assert.deepEqual(receipts.map(r=>[Number(r.amount),Number(r.payment_charge)]),[[due,0]],'the recovery receipt is the order value; the buyer fee is not booked as buyer revenue');
 }finally{await policy.restore();await f.close();}
});

test('COD fee borne by the store: the quote freezes no buyer COD fee; switching back charges again; existing orders keep theirs',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql,policy=await terms(f);
 try{
  await policy.write({cod_fee_bps:333,cod_fee_bearer:'store'});
  const free=await f.order(1,'cod');
  const [a]=await sql`select payment_charge_amount,cod_fee_bps from app.commerce_order where id=${free.order.id}`;
  assert.deepEqual([Number(a.payment_charge_amount),a.cod_fee_bps],[0,0],'store-borne COD: the buyer pays no COD fee');
  await policy.write({cod_fee_bps:333,cod_fee_bearer:'buyer'});
  const paid=await f.order(1,'cod');
  const [b]=await sql`select payment_charge_amount,cod_fee_bps,buyer_total from app.commerce_order where id=${paid.order.id}`;
  assert.equal(b.cod_fee_bps,333);assert.ok(Number(b.payment_charge_amount)>0,'buyer-borne COD fee charged again');
  const [again]=await sql`select payment_charge_amount,cod_fee_bps from app.commerce_order where id=${free.order.id}`;
  assert.deepEqual([Number(again.payment_charge_amount),again.cod_fee_bps],[0,0],'an order quoted before the switch keeps its fee');
 }finally{await policy.restore();await f.close();}
});

test('AutoLaris buyer fee edges: a reported bill at or below the fee is not a collection; finance confirms the bill and the receipt stays the order value',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql,policy=await terms(f),users:Awaited<ReturnType<typeof actor>>[]=[];
 try{
  await policy.write({payment_fee_bearer:'buyer',autolaris_fees:TABLE});
  // Advice reporting a "paid" bill that only covers the fee: kept as unknown, nothing settles.
  const one=await f.order(1,'prepaid','autolaris'),low=await attempt(f,one.order.id,'VABCA');
  await run(f,low.job,{'payment.create':paymentAdapter(sql,'test')});
  const [trx]=await sql`select trx_id from app.autolaris_payment where attempt_id=${low.id}`;
  const lying:AutolarisClient={listPayment:async()=>({rc:'00',ket:'',data:[]}),createPayment:async()=>({rc:'99',ket:'',data:null}),
   advice:async()=>({rc:'00',ket:'PAID',data:{status:'PAID',amount:low.fee,paid_at:new Date().toISOString()}})};
  const [poll]=await sql`select id from app.outbox_job where kind='payment.autolaris.advice' and payload->>'attemptId'=${low.id} and status='pending' order by (payload->>'poll')::int desc limit 1`;
  await run(f,String(poll.id),{'payment.autolaris.advice':autolarisAdviceAdapter(sql,'test',lying)});
  assert.ok(trx.trx_id);
  const [observed]=await sql`select classification,amount from app.autolaris_observation where attempt_id=${low.id} order by created_at desc limit 1`;
  assert.deepEqual([observed.classification,observed.amount],['unknown',null]);
  assert.equal((await sql`select status from app.local_payment_operation where attempt_id=${low.id}`)[0].status,'pending');
  // Finance confirms from the AutoLaris dashboard: the bill (order value + fee); at or below the fee is refused.
  const finance=await actor(f.identity,'finance',[]);users.push(finance);await enroll(finance.browser,finance.password);
  await sql`update app.role_grant set permissions=${['finance.reconciliation.read','finance.reconciliation.write']} where user_id=${finance.id}`;
  const confirm=async(amount:number)=>{
   const p=finance.browser.request('/api/v1/me/reauthentication-proofs',{password:finance.password,action:'finance.reconcile',subject_id:low.id});p.headers.set('idempotency-key',randomUUID());
   const proof=(await (await handleAccess(p,f.identity)).json()).proof as string;
   const [clock]=await sql`select app.reservation_clock(o.clock_namespace) now from app.commerce_order o where o.id=${one.order.id}`;
   const req=finance.browser.request(`/api/v1/admin/autolaris-payments/${low.id}/confirmations`,{amount,paid_at:new Date(clock.now).toISOString(),evidence:'Dasbor AutoLaris: transaksi lunas',reason:'Advice belum memberi status final',reauthentication_proof:proof});
   req.headers.set('idempotency-key',randomUUID());const response=await handleAutolarisPayments(req,f.identity);return {status:response.status,body:await response.json()};};
  for(const amount of [low.fee,low.fee-1]){const refused=await confirm(amount);assert.deepEqual([refused.status,refused.body.code],[422,'AUTOLARIS_AMOUNT_BELOW_FEE']);}
  const ok=await confirm(low.expected+low.fee);assert.equal(ok.status,201,JSON.stringify(ok.body));
  for(const event of await sql`select callback_job_id from app.payment_provider_event where attempt_id=${low.id}`){const [cb]=await sql`select status from app.outbox_job where id=${event.callback_job_id}`;if(cb.status==='pending')await run(f,String(event.callback_job_id),{});}
  assert.equal((await sql`select payment_status from app.commerce_order where id=${one.order.id}`)[0].payment_status,'confirmed');
  assert.deepEqual((await sql`select amount from app.economic_receipt where order_id=${one.order.id}`).map(r=>Number(r.amount)),[low.expected],'the receipt is the order value, not the bill');
 }finally{await policy.restore();await cleanup(f.identity,users);await f.close();}
});
