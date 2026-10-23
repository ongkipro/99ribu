import assert from 'node:assert/strict';
import test from 'node:test';
import {allocateByWeight,codFee,paymentChannel} from '../../src/modules/payments/methods.ts';
import {randomUUID} from 'node:crypto';
import {runOneJob} from '../../src/jobs/worker.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {projectOrder,reservedTransferCodes} from '../../src/modules/checkout/orders.ts';
import {expireOwnedOrderJob} from '../../src/modules/checkout/expiry.ts';
import {handleManualTransfers} from '../../src/modules/finance/manual-bank-routes.ts';
import {handleManualFulfillment} from '../../src/modules/fulfillment/manual-routes.ts';
import {lockRefundCollectionBasis} from '../../src/modules/returns/financial-basis.ts';
import {readFixtureClock,advanceFixtureClock} from '../../src/modules/local/fixtures.ts';
import {simulateCodCollection,ingestCodEvent} from '../../src/modules/payments/cod-local.ts';
import {createAttempt,projectAttempt} from '../../src/modules/payments/attempts.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor} from './fulfillment-fixture.ts';
import {paymentFixture} from './payment-fixture.ts';
import {installFulfillmentCalendars} from './fulfillment-fixture.ts';
import {handleFulfillment} from '../../src/modules/fulfillment/routes.ts';
import {shippingAdapter} from '../../src/modules/fulfillment/worker.ts';
import {ingestWaybillEvent,simulateWaybillIssue} from '../../src/modules/fulfillment/local.ts';
import {projectOrderReceipt} from '../../src/modules/orders/receipt.ts';
import {rupiah} from '../../src/modules/storefront/format.ts';
import {paymentTerms} from '../../src/modules/payments/methods.ts';

test('DEC-009 COD fee is a per-parcel whole-rupiah ceiling at the frozen basis-point rate',()=>{
 assert.equal(codFee(111000,333),3697,'spec 11 example: 111,000 x 3.33% = 3,696.3 -> 3,697');
 assert.equal(codFee(213001,333),7093);
 assert.equal(codFee(300300,333),10000,'an exact product stays exact');
 assert.equal(codFee(99000,0),0,'no configured rate means no fee');
 assert.throws(()=>codFee(99000,2001),{code:'POLICY_INVALID'});
});

test('payment charges split by stable largest remainder and conserve every rupiah',()=>{
 const shares=allocateByWeight(7093,[{id:'b',weight:106500},{id:'a',weight:106501}]);
 assert.deepEqual([shares.get('a'),shares.get('b')],[3547,3546],'spec 11 example');
 const code=allocateByWeight(137,[{id:'u1',weight:112501},{id:'u2',weight:112499}]);
 assert.equal((code.get('u1')??0)+(code.get('u2')??0),137);assert.deepEqual([code.get('u1'),code.get('u2')],[69,68]);
 const ties=allocateByWeight(1,[{id:'z',weight:5},{id:'y',weight:5}]);assert.deepEqual([ties.get('y'),ties.get('z')],[1,0],'ties break by id');
});

test('the payment channel must belong to the chosen method',()=>{
 assert.equal(paymentChannel('prepaid',undefined),'local-prepaid');assert.equal(paymentChannel('cod',null),'cod');
 assert.equal(paymentChannel('prepaid','manual-bank'),'manual-bank');
 assert.equal(paymentChannel('prepaid','autolaris'),'autolaris','S93 AutoLaris VA/QRIS is a prepaid channel');
 for(const [method,channel] of [['cod','manual-bank'],['prepaid','cod'],['cod','autolaris'],['prepaid','virgo']] as const)assert.throws(()=>paymentChannel(method,channel),{code:'INVALID_INPUT'});
});


type Fixture=Awaited<ReturnType<typeof paymentFixture>>;
const ACCOUNTS=[{bank_name:'Bank SINTETIS',account_number:'1234567890',account_holder:'PT SINTETIS 99RIBU'}];
async function issue(f:Fixture,user:{password:string;browser:{request:(p:string,b?:Record<string,unknown>)=>Request}},action:string,subject:string){
 const req=user.browser.request('/api/v1/me/reauthentication-proofs',{password:user.password,action,subject_id:subject});req.headers.set('idempotency-key',randomUUID());
 const response=await handleAccess(req,f.identity);assert.equal(response.status,201);return (await response.json()).proof as string;
}
// Append a payment-policy version through the real owner flow; returns set/restore.
async function withCommercialTerms(f:Fixture,values:Record<string,unknown>){
 const read=async()=>(await (await f.owner.browser.access('/admin/policy-versions?kind=payment')).json()) as {latest_version:number;current:{values:Record<string,unknown>}|null};
 const write=async(next:Record<string,unknown>,reason:string)=>{const history=await read();
  const req=f.owner.browser.request('/api/v1/admin/policy-versions',{kind:'payment',warehouse_id:null,expected_version:history.latest_version,effective_at:null,values:next,reason,reauthentication_proof:await issue(f,f.owner,'payment_policy.version','company-payment')});
  req.headers.set('idempotency-key',randomUUID());const response=await handleAccess(req,f.identity);assert.equal(response.status,201,JSON.stringify(await response.clone().json()));};
 // Fixture business clocks stand still: move past each new version's wall-clock effective time.
 const settle=async()=>{const clock=await readFixtureClock('test',f.namespace),[wall]=await f.identity.sql`select clock_timestamp() now`;
  await advanceFixtureClock('test',f.namespace,Math.max(1,Math.ceil((new Date(wall.now).getTime()-Date.parse(clock.now))/1000)+5),clock.version);};
 const original=(await read()).current?.values??{cod_fee_bps:0,manual_bank_accounts:[]};
 await write({cod_fee_bps:0,manual_bank_accounts:[],...values},'SYNTHETIC S92 payment terms');await settle();
 return {set:async(more:Record<string,unknown>)=>{await write({cod_fee_bps:0,manual_bank_accounts:[],...more},'SYNTHETIC S92 payment terms change');await settle();},restore:()=>write(original,'SYNTHETIC S92 restore previous payment terms')};
}
async function run(f:Fixture,jobId:string){assert.equal(await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},jobId),true);const [job]=await f.identity.sql`select status,last_error from app.outbox_job where id=${jobId}`;assert.equal(job.status,'completed',job.last_error??'');}

test('COD fee: frozen 333 bps per parcel, ceiling rounding, collected by the courier, separate receipt component, merchandise-only Purchase, refund basis conserves payment',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql;let terms:Awaited<ReturnType<typeof withCommercialTerms>>|undefined;
 try{
  terms=await withCommercialTerms(f,{cod_fee_bps:333});
  const {order}=await f.order(4,'cod');
  const [stored]=await sql`select cod_fee_bps,payment_charge_amount,payment_channel,buyer_total from app.commerce_order where id=${order.id}`;
  assert.equal(stored.cod_fee_bps,333);assert.equal(stored.payment_channel,'cod');
  const parcels=await sql`select id,merchandise_amount,buyer_shipping,payment_charge,cod_due from app.order_shipment where order_id=${order.id} order by id`;assert.equal(parcels.length,2);
  let total=0;
  for(const p of parcels){
   const base=Number(p.merchandise_amount)+Number(p.buyer_shipping),fee=Math.ceil(base*333/10000);
   assert.equal(Number(p.payment_charge),fee);assert.equal(Number(p.cod_due),base+fee);total+=fee;
   const [units]=await sql`select sum(payment_charge)::int charge from app.fulfillment_item where shipment_id=${p.id}`;assert.equal(units.charge,fee,'unit shares conserve the parcel fee');
  }
  assert.equal(Number(stored.payment_charge_amount),total);
  const projected=await sql.begin(tx=>projectOrder(tx,order.id));
  assert.equal(projected.payment_charge_total,total);assert.equal(projected.amount_due,Number(stored.buyer_total)+total);
  assert.ok(projected.shipments.every(s=>'cod_fee_amount' in s&&(s as {cod_fee_amount:number}).cod_fee_amount>0));
  // A later rate change affects only new quotes; this order keeps its frozen fee.
  await terms.set({cod_fee_bps:500});
  const later=await f.order(1,'cod');const [laterRow]=await sql`select cod_fee_bps from app.commerce_order where id=${later.order.id}`;assert.equal(laterRow.cod_fee_bps,500);
  assert.equal(Number((await sql`select payment_charge_amount from app.commerce_order where id=${order.id}`)[0].payment_charge_amount),total);
  // Ship manually, then the courier collects merchandise + shipping + fee.
  const fulfillments=await sql`select f.id,f.revision,s.id shipment_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${order.id} order by s.id`;
  for(const [index,row] of fulfillments.entries()){
   const req=f.owner.browser.request(`/api/v1/admin/fulfillments/${row.id}/manual-shipment`,{expected_version:row.revision,courier:'jne',tracking_number:`CF${String(Date.now()).slice(-8)}${index}0`});req.headers.set('idempotency-key',randomUUID());
   assert.equal((await handleManualFulfillment(req,f.identity)).status,201);
   const event=await simulateCodCollection(sql,'test',String(row.shipment_id));assert.equal(await runOneJob(sql,{},await ingestCodEvent(sql,event)),true);
  }
  const receipts=await sql`select r.amount,r.merchandise_amount,r.buyer_shipping,r.payment_charge,s.cod_due,s.payment_charge parcel_charge from app.economic_receipt r join app.order_shipment s on s.id=r.shipment_id where r.order_id=${order.id} order by s.id`;
  assert.equal(receipts.length,2);
  for(const r of receipts){assert.equal(Number(r.amount),Number(r.cod_due));assert.equal(Number(r.payment_charge),Number(r.parcel_charge));assert.equal(Number(r.amount),Number(r.merchandise_amount)+Number(r.buyer_shipping)+Number(r.payment_charge));}
  const [purchase]=await sql`select sum(merchandise_amount)::int value from app.commerce_event where order_id=${order.id} and name='Purchase'`;assert.equal(purchase.value,4*99000,'Purchase stays merchandise-only');
  // Refund basis: each unit returns its frozen fee share; all units together return everything paid.
  const units=await sql`select f.id from app.fulfillment_item f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${order.id} order by f.id`;
  const basis=await sql.begin(tx=>lockRefundCollectionBasis(tx,order.id,units.map(u=>String(u.id))));
  assert.ok(basis.units.every(u=>u.payment_charge>0&&u.amount===u.merchandise_amount+u.buyer_shipping+u.payment_charge));
  assert.equal(basis.amount,receipts.reduce((n,r)=>n+Number(r.amount),0),'a full refund conserves the original buyer payment including the COD fee');
 }finally{try{await terms?.restore();}finally{await f.close();}}
});

test('manual bank: unique code added to the total, 24 hour window, instructions, finance confirmation posts the receipt; a wrong amount becomes recovery; expiry releases the hold',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql;let terms:Awaited<ReturnType<typeof withCommercialTerms>>|undefined;const users:Awaited<ReturnType<typeof actor>>[]=[];
 try{
  // Without configured accounts the channel is unavailable.
  const unavailable=await f.order(1,'prepaid','manual-bank').then(()=>null,(error:unknown)=>error);assert.ok(unavailable,'manual bank needs owner-configured accounts');
  terms=await withCommercialTerms(f,{manual_bank_accounts:ACCOUNTS});
  const created=[] as {id:string}[];
  for(let n=0;n<3;n++)created.push((await f.order(1,'prepaid','manual-bank')).order);
  const rows=await sql`select id,transfer_code,payment_charge_amount,buyer_total,created_at,expires_at,payment_channel from app.commerce_order where id in ${sql(created.map(o=>o.id))}`;
  assert.equal(new Set(rows.map(r=>r.transfer_code)).size,3,'codes are unique among open manual-bank orders');
  for(const r of rows){assert.ok(r.transfer_code>=1&&r.transfer_code<=999);assert.equal(Number(r.payment_charge_amount),r.transfer_code);assert.equal(new Date(r.expires_at).getTime()-new Date(r.created_at).getTime(),86400000);}
  const [paid,short,lapsed]=created;
  const finance=await actor(f.identity,'finance',[]);users.push(finance);await enroll(finance.browser,finance.password);
  await sql`update app.role_grant set permissions=${['finance.reconciliation.read','finance.reconciliation.write']} where user_id=${finance.id}`;
  const attemptFor=async(orderId:string)=>{assert.equal((await sql.begin(tx=>createAttempt(tx,orderId,randomUUID(),{method_id:'local-prepaid'})).then(()=>null,(e:{code?:string})=>e.code)),'PAYMENT_METHOD_UNAVAILABLE');
   const attempt=await sql.begin(tx=>createAttempt(tx,orderId,randomUUID(),{method_id:'manual-bank'}));const [stored]=await sql`select creation_job_id from app.payment_attempt where id=${attempt.id}`;await run(f,stored.creation_job_id);return attempt;};
  const confirm=async(attemptId:string,amount:number)=>{const [clock]=await sql`select app.reservation_clock(o.clock_namespace) now from app.payment_attempt a join app.commerce_order o on o.id=a.order_id where a.id=${attemptId}`;
   const req=finance.browser.request(`/api/v1/admin/manual-transfers/${attemptId}/confirmations`,{amount,bank_reference:`BCA-${randomUUID().slice(0,8)}`,account_number:'1234567890',transferred_at:new Date(clock.now).toISOString(),late_transfer:false,evidence:'Mutasi rekening tanggal ini',reason:'Cocok dengan mutasi',reauthentication_proof:await issue(f,finance,'finance.reconcile',attemptId)});
   req.headers.set('idempotency-key',randomUUID());const response=await handleManualTransfers(req,f.identity);return {status:response.status,payload:await response.json()};};
  const runCallbacks=async(attemptId:string)=>{for(const job of await sql`select callback_job_id from app.payment_provider_event where attempt_id=${attemptId}`){const [state]=await sql`select status from app.outbox_job where id=${job.callback_job_id}`;if(state.status==='pending')assert.equal(await runOneJob(sql,{},job.callback_job_id),true);}};
  const a=await attemptFor(paid.id),row=rows.find(r=>r.id===paid.id) as {buyer_total:string;transfer_code:number};
  const shown=await sql.begin(tx=>projectAttempt(tx,paid.id,a.id));
  assert.equal(shown.action.kind,'bank_transfer');assert.equal(shown.expected_amount,Number(row.buyer_total)+row.transfer_code);
  assert.ok('accounts' in shown.action&&shown.action.accounts[0].account_number==='1234567890');
  const queue=await handleManualTransfers(finance.browser.request('/api/v1/admin/manual-transfers?state=open'),f.identity);assert.equal(queue.status,200);
  assert.ok((await queue.json()).data.some((t:{id:string})=>t.id===a.id));
  const ok=await confirm(a.id,shown.expected_amount);assert.equal(ok.status,201,JSON.stringify(ok.payload));await runCallbacks(a.id);
  const [order]=await sql`select payment_status from app.commerce_order where id=${paid.id}`;assert.equal(order.payment_status,'confirmed');
  const [receipt]=await sql`select amount,payment_charge,merchandise_amount from app.economic_receipt where order_id=${paid.id}`;
  assert.equal(Number(receipt.amount),shown.expected_amount);assert.equal(Number(receipt.payment_charge),row.transfer_code);assert.equal(Number(receipt.merchandise_amount),99000);
  assert.equal((await confirm(a.id,shown.expected_amount)).payload.code,'TRANSFER_ALREADY_CONFIRMED');
  // A wrong amount is recorded and flagged as recovery money, never a paid order.
  const b=await attemptFor(short.id),expected=(await sql.begin(tx=>projectAttempt(tx,short.id,b.id))).expected_amount;
  const wrong=await confirm(b.id,expected-1);assert.equal(wrong.status,201);assert.equal(wrong.payload.confirmation.mismatch,true);await runCallbacks(b.id);
  assert.equal((await sql`select payment_status from app.commerce_order where id=${short.id}`)[0].payment_status,'pending');
  assert.equal((await sql`select count(*)::int n from app.economic_receipt where order_id=${short.id}`)[0].n,0);
  assert.equal((await sql`select status from app.payment_attempt where id=${b.id}`)[0].status,'unknown');
  // Operator path: the received money is an S33 collection exception (refund/allocate), never a paid order.
  assert.equal((await sql`select count(*)::int n from app.commerce_exception where order_id=${short.id}`)[0].n,1);
  // Unpaid manual-bank orders expire after 24 hours and release their stock hold.
  const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,86400+60,clock.version);
  const [job]=await sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${lapsed.id}`;
  await sql.begin(tx=>expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload}));
  const [expired]=await sql`select o.status,o.payment_status,r.status hold from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id where o.id=${lapsed.id}`;
  assert.deepEqual({...expired},{status:'cancelled',payment_status:'expired',hold:'expired'});
  // S104: the lapsed order's code stays out of selection for 72 hours past its deadline, then frees up.
  const [lapsedRow]=await sql`select transfer_code,expires_at from app.commerce_order where id=${lapsed.id}`;
  const deadline=new Date(lapsedRow.expires_at).getTime(),code=Number(lapsedRow.transfer_code);
  const reservedAt=(at:number)=>sql.begin(tx=>reservedTransferCodes(tx,new Date(at)));
  assert.ok((await reservedAt(deadline+71*3600000)).has(code),'an expired order keeps its code reserved within 72 h');
  const [other]=await sql`select count(*)::int n from app.commerce_order where id<>${lapsed.id} and payment_channel='manual-bank' and transfer_code=${code}
   and ((status='pending' and payment_status='pending') or expires_at>${new Date(deadline+73*3600000-72*3600000).toISOString()}::timestamptz)`;
  if(other.n===0)assert.ok(!(await reservedAt(deadline+73*3600000)).has(code),'after 72 h the code is free again');
  const [paidRow]=await sql`select transfer_code,expires_at,payment_status from app.commerce_order where id=${paid.id}`;assert.equal(paidRow.payment_status,'confirmed');
  assert.ok((await reservedAt(new Date(paidRow.expires_at).getTime()+3600000)).has(Number(paidRow.transfer_code)),'a paid order keeps its code reserved too (late duplicate transfer)');
 }finally{for(const user of users)await closeFulfillmentActor(f.identity,user).catch(()=>{});try{await terms?.restore();}finally{await f.close();}}
});

// ---- R4 review (S92): bank reference uniqueness, authority/proof/evidence, refund shares of the code,
// transfer-time deadline rule, per-buyer and rate limits.
const SECOND={bank_name:'Bank SINTETIS DUA',account_number:'9876543210',account_holder:'PT SINTETIS 99RIBU'};
async function financeUser(f:Fixture,users:Awaited<ReturnType<typeof actor>>[]){
 const user=await actor(f.identity,'finance',[]);users.push(user);await enroll(user.browser,user.password);
 await f.identity.sql`update app.role_grant set permissions=${['finance.reconciliation.read','finance.reconciliation.write']} where user_id=${user.id}`;return user;
}
async function manualAttempt(f:Fixture,orderId:string){
 const attempt=await f.identity.sql.begin(tx=>createAttempt(tx,orderId,randomUUID(),{method_id:'manual-bank'}));
 const [stored]=await f.identity.sql`select creation_job_id,created_at,expires_at,expected_amount from app.payment_attempt where id=${attempt.id}`;await run(f,stored.creation_job_id);
 return {id:attempt.id,created_at:new Date(stored.created_at),expires_at:new Date(stored.expires_at),expected:Number(stored.expected_amount)};
}
async function confirmTransfer(f:Fixture,user:Awaited<ReturnType<typeof actor>>,attemptId:string,body:Record<string,unknown>,proof?:string){
 const req=user.browser.request(`/api/v1/admin/manual-transfers/${attemptId}/confirmations`,{evidence:'Mutasi rekening',reason:'Cocok dengan mutasi',account_number:'1234567890',late_transfer:false,...body,reauthentication_proof:proof??'x'.repeat(43)});
 req.headers.set('idempotency-key',randomUUID());const response=await handleManualTransfers(req,f.identity);return {status:response.status,payload:await response.json()};
}
async function runCallbacks(f:Fixture,attemptId:string){for(const job of await f.identity.sql`select callback_job_id from app.payment_provider_event where attempt_id=${attemptId}`){const [state]=await f.identity.sql`select status from app.outbox_job where id=${job.callback_job_id}`;if(state.status==='pending')assert.equal(await runOneJob(f.identity.sql,{},job.callback_job_id),true);}}
const businessNow=async(f:Fixture)=>new Date((await f.identity.sql`select app.reservation_clock(${f.namespace}) now`)[0].now);

test('manual bank: one bank reference confirms one order (normalised, per receiving account, concurrent single winner); authority, fresh proof and evidence are required; the code refunds by unit share',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql,users:Awaited<ReturnType<typeof actor>>[]=[];let terms:Awaited<ReturnType<typeof withCommercialTerms>>|undefined;
 try{
  terms=await withCommercialTerms(f,{manual_bank_accounts:[...ACCOUNTS,SECOND]});
  const orders:{id:string}[]=[];for(const quantity of [2,1,1,1])orders.push((await f.order(quantity,'prepaid','manual-bank')).order);
  const attempts=[];for(const o of orders)attempts.push(await manualAttempt(f,o.id));
  const [a1,a2,a3,a4]=attempts,fin1=await financeUser(f,users),fin2=await financeUser(f,users);
  const at=async()=>(await businessNow(f)).toISOString();
  // Denials: authority, evidence, fresh reauthentication proof, receiving account, late acknowledgement.
  const outsider=await actor(f.identity,'ecommerce_admin',[]);users.push(outsider);await enroll(outsider.browser,outsider.password);
  assert.equal((await confirmTransfer(f,outsider,a2.id,{amount:a2.expected,bank_reference:'BCA-DENY-1',transferred_at:await at()})).status,403,'finance authority required');
  const noEvidence=fin1.browser.request(`/api/v1/admin/manual-transfers/${a2.id}/confirmations`,{amount:a2.expected,bank_reference:'BCA-DENY-2',account_number:'1234567890',transferred_at:await at(),late_transfer:false,reason:'x',reauthentication_proof:'x'.repeat(43)});
  noEvidence.headers.set('idempotency-key',randomUUID());assert.equal((await handleManualTransfers(noEvidence,f.identity)).status,400,'evidence required');
  assert.equal((await confirmTransfer(f,fin1,a2.id,{amount:a2.expected,bank_reference:'BCA-DENY-3',transferred_at:await at()})).payload.code,'REAUTHENTICATION_REQUIRED','a fresh proof is required');
  assert.equal((await confirmTransfer(f,fin1,a2.id,{amount:a2.expected,bank_reference:'BCA-DENY-4',account_number:'1111111111',transferred_at:await at()})).payload.code,'INVALID_RECEIVING_ACCOUNT');
  assert.equal((await confirmTransfer(f,fin1,a2.id,{amount:a2.expected,bank_reference:'BCA-DENY-5',late_transfer:true,transferred_at:await at()})).payload.code,'LATE_TRANSFER_ACKNOWLEDGEMENT_REQUIRED');
  assert.equal((await confirmTransfer(f,fin1,a2.id,{amount:a2.expected,bank_reference:'BCA-DENY-6',transferred_at:new Date(a2.created_at.getTime()-1000).toISOString()})).payload.code,'INVALID_TRANSFER_TIME','no backdating before the instructions');
  assert.equal((await sql`select count(*)::int n from app.manual_bank_confirmation where attempt_id=${a2.id}`)[0].n,0);
  const reference=`bca-${randomUUID().slice(0,8)}`;
  const first=await confirmTransfer(f,fin1,a1.id,{amount:a1.expected,bank_reference:reference,transferred_at:await at()},await issue(f,fin1,'finance.reconcile',a1.id));
  assert.equal(first.status,201,JSON.stringify(first.payload));assert.equal(first.payload.confirmation.received_account_number,'1234567890');
  // The same statement line (trimmed, any case) cannot confirm a second order on that account.
  const reused=await confirmTransfer(f,fin1,a2.id,{amount:a2.expected,bank_reference:` ${reference.toUpperCase()} `,transferred_at:await at()});
  assert.equal(reused.status,409);assert.equal(reused.payload.code,'BANK_REFERENCE_ALREADY_USED');
  // Scoped per receiving account: the same reference text on the other company account is a different line.
  assert.equal((await confirmTransfer(f,fin1,a2.id,{amount:a2.expected,bank_reference:reference,account_number:SECOND.account_number,transferred_at:await at()},await issue(f,fin1,'finance.reconcile',a2.id))).status,201);
  // Concurrent confirmations of two orders with one new reference: exactly one wins.
  const shared=`BCA-${randomUUID().slice(0,8)}`,[p3,p4]=[await issue(f,fin1,'finance.reconcile',a3.id),await issue(f,fin2,'finance.reconcile',a4.id)];const when=await at();
  const race=await Promise.all([confirmTransfer(f,fin1,a3.id,{amount:a3.expected,bank_reference:shared,transferred_at:when},p3),confirmTransfer(f,fin2,a4.id,{amount:a4.expected,bank_reference:shared,transferred_at:when},p4)]);
  assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);assert.equal(race.find(r=>r.status===409)?.payload.code,'BANK_REFERENCE_ALREADY_USED');
  assert.equal((await sql`select count(*)::int n from app.manual_bank_reference where account_number='1234567890' and reference_key=${shared.toUpperCase()}`)[0].n,1);
  // DB level: a duplicate key is refused even without the app check, and a confirmation must claim its reference.
  const loser=race[0].status===409?a3:a4,[op]=await sql`select id from app.local_payment_operation where attempt_id=${loser.id}`;
  await assert.rejects(sql.begin(async tx=>{
   await tx`insert into app.manual_bank_confirmation (attempt_id,operation_id,amount,bank_reference,transferred_at,evidence,actor_id,reason) values (${loser.id},${op.id},${loser.expected},${reference},${when},'db test',${fin1.id},'db test')`;
   await tx`insert into app.manual_bank_reference (account_number,reference_key,attempt_id) values ('1234567890','ignored-normalised-by-guard',${loser.id})`;}),{code:'23505'});
  await assert.rejects(sql.begin(async tx=>{
   await tx`insert into app.manual_bank_confirmation (attempt_id,operation_id,amount,bank_reference,transferred_at,evidence,actor_id,reason) values (${loser.id},${op.id},${loser.expected},'BCA-NO-CLAIM',${when},'db test',${fin1.id},'db test')`;
   await tx`set constraints all immediate`;}),{code:'23514'});
  await assert.rejects(sql`delete from app.manual_bank_reference where attempt_id=${a1.id}`,{code:'23514'});
  // Refund basis: each unit returns its frozen share of the unique code; all units return the whole code.
  await runCallbacks(f,a1.id);assert.equal((await sql`select payment_status from app.commerce_order where id=${orders[0].id}`)[0].payment_status,'confirmed');
  const [order]=await sql`select transfer_code from app.commerce_order where id=${orders[0].id}`;
  const units=await sql`select f.id from app.fulfillment_item f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${orders[0].id} order by f.id`;assert.equal(units.length,2);
  const one=await sql.begin(tx=>lockRefundCollectionBasis(tx,orders[0].id,[String(units[0].id)]));
  const all=await sql.begin(tx=>lockRefundCollectionBasis(tx,orders[0].id,units.map(u=>String(u.id))));
  assert.ok(one.units[0].payment_charge>0&&one.units[0].payment_charge<order.transfer_code,'one unit refunds only its share of the code');
  assert.equal(all.units.reduce((n,u)=>n+u.payment_charge,0),order.transfer_code,'a full refund returns the whole code');
  assert.equal(all.amount,a1.expected,'a full refund returns everything the buyer transferred');
  // Order page: per-parcel shipping-and-fees carry the frozen code shares, so the rows sum to the amount transferred.
  const page=await sql.begin(tx=>projectOrderReceipt(tx,orders[0].id));
  assert.equal(page.receipt.collections.reduce((n,c)=>n+c.merchandise_amount+c.shipping_and_fees_amount,0),a1.expected);
 }finally{for(const user of users)await closeFulfillmentActor(f.identity,user).catch(()=>{});try{await terms?.restore();}finally{await f.close();}}
});

test('manual bank deadline: the transfer time decides; an on-time transfer confirmed after the deadline still pays, a late transfer is recovery, and the grace bounds the hold',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql,users:Awaited<ReturnType<typeof actor>>[]=[];let terms:Awaited<ReturnType<typeof withCommercialTerms>>|undefined;
 try{
  terms=await withCommercialTerms(f,{manual_bank_accounts:ACCOUNTS});
  const orders:{id:string}[]=[];for(let n=0;n<3;n++)orders.push((await f.order(1,'prepaid','manual-bank')).order);
  const [onTime,late,lapsed]=await Promise.all(orders.map(o=>manualAttempt(f,o.id)));
  const fin=await financeUser(f,users);
  const expire=async(orderId:string)=>{const [job]=await sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${orderId}`;return sql.begin(tx=>expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload}));};
  let clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,86400+60,clock.version);
  // Past the buyer deadline but inside the finance grace: open attempts keep the order and its hold.
  for(const o of orders){const result=await expire(o.id);assert.equal(result?.status,'payment_reconciliation');}
  assert.equal((await sql`select count(*)::int n from app.commerce_order where id in ${sql(orders.map(o=>o.id))} and status='pending'`)[0].n,3);
  // On-time transfer, confirmed late: still a paid order.
  const ok=await confirmTransfer(f,fin,onTime.id,{amount:onTime.expected,bank_reference:`BCA-${randomUUID().slice(0,8)}`,transferred_at:new Date(onTime.created_at.getTime()+60000).toISOString()},await issue(f,fin,'finance.reconcile',onTime.id));
  assert.equal(ok.status,201,JSON.stringify(ok.payload));assert.equal(ok.payload.confirmation.late_transfer,false);await runCallbacks(f,onTime.id);
  assert.equal((await sql`select payment_status from app.commerce_order where id=${orders[0].id}`)[0].payment_status,'confirmed');
  // A transfer after the deadline must be acknowledged as late and becomes recovery, never a paid order.
  const after=(await businessNow(f)).toISOString(),ref=`BCA-${randomUUID().slice(0,8)}`;
  assert.equal((await confirmTransfer(f,fin,late.id,{amount:late.expected,bank_reference:ref,transferred_at:after})).payload.code,'LATE_TRANSFER_ACKNOWLEDGEMENT_REQUIRED');
  const recorded=await confirmTransfer(f,fin,late.id,{amount:late.expected,bank_reference:ref,transferred_at:after,late_transfer:true,reason:'Transfer setelah batas waktu; masuk pemulihan'},await issue(f,fin,'finance.reconcile',late.id));
  assert.equal(recorded.status,201);await runCallbacks(f,late.id);
  const [lateOrder]=await sql`select status,payment_status from app.commerce_order where id=${orders[1].id}`;assert.deepEqual({...lateOrder},{status:'cancelled',payment_status:'expired'});
  assert.equal((await sql`select status from app.payment_attempt where id=${late.id}`)[0].status,'unknown');
  // Operator path for recovery money (wrong amount or late): an S33 collection exception is opened.
  assert.equal((await sql`select count(*)::int n from app.commerce_exception where order_id=${orders[1].id}`)[0].n,1);
  // After the grace an unconfirmed order is cancelled and its hold released once.
  clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,12*3600,clock.version);
  assert.equal((await expire(orders[2].id))?.status,'cancelled');
  const [gone]=await sql`select o.status,r.status hold from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id where o.id=${orders[2].id}`;assert.deepEqual({...gone},{status:'cancelled',hold:'expired'});
  assert.ok(lapsed);
 }finally{for(const user of users)await closeFulfillmentActor(f.identity,user).catch(()=>{});try{await terms?.restore();}finally{await f.close();}}
});

test('manual bank holds are capped per buyer and checkout creation is rate limited per actor',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql;let terms:Awaited<ReturnType<typeof withCommercialTerms>>|undefined;
 try{
  terms=await withCommercialTerms(f,{manual_bank_accounts:ACCOUNTS});
  const first=await f.order(1,'prepaid','manual-bank');await f.order(1,'prepaid','manual-bank',first.client);
  const third=await f.order(1,'prepaid','manual-bank',first.client);assert.equal(third.status,409);assert.equal(third.code,'MANUAL_BANK_OPEN_LIMIT');
  assert.equal((await f.order(1,'prepaid','local-prepaid',first.client)).status,201,'other channels stay available to the same buyer');
  // Rate limit on order creation for this actor (bucket pre-filled to its budget).
  const [guest]=await sql`select owner_guest_id from app.commerce_order where id=${first.order.id}`;
  await sql`insert into app.auth_rate_limit (id,key,count,last_request) values (${randomUUID()},${`rl:checkout.order:guest:${guest.owner_guest_id}`},10,${Date.now()})
   on conflict (key) do update set count=10,last_request=${Date.now()}`;
  const limited=await f.order(1,'prepaid','local-prepaid',first.client);assert.equal(limited.status,429);assert.equal(limited.code,'RATE_LIMITED');
 }finally{try{await terms?.restore();}finally{await f.close();}}
});

// R4 delta: the carrier-simulator COD path with a PINNED payment policy. The waybill cod_due, the
// order page's shipping-and-fees figure and the collection receipt agree, with and without a fee.
// Bookings retain their AccessOperation, so a separate staff owner books and is closed like fulfillment fixtures do.
async function codThroughCarrier(f:Fixture,expectedBps:number,staff:Awaited<ReturnType<typeof actor>>){
 const sql=f.identity.sql;await installFulfillmentCalendars(f.identity,f.owner,f.namespace);
 const [now]=await sql`select app.reservation_clock(${f.namespace}) now`,terms=await sql.begin(tx=>paymentTerms(tx,new Date(now.now)));
 assert.equal(terms.cod_fee_bps,expectedBps,'the pinned payment policy is the one in force for this namespace');
 const {order}=await f.order(1,'cod');
 const [parcel]=await sql`select s.id shipment_id,s.merchandise_amount,s.buyer_shipping,s.payment_charge,s.cod_due,f.id fulfillment_id from app.order_shipment s join app.fulfillment f on f.shipment_id=s.id where s.order_id=${order.id}`;
 const base=Number(parcel.merchandise_amount)+Number(parcel.buyer_shipping),fee=codFee(base,expectedBps);
 assert.equal(Number(parcel.payment_charge),fee);assert.equal(Number(parcel.cod_due),base+fee);
 const call=async(path:string,body:Record<string,unknown>)=>{const request=staff.browser.request(path,body);request.headers.set('idempotency-key',randomUUID());const response=await handleFulfillment(request,f.identity);return {status:response.status,payload:await response.json()};};
 const version=async()=>Number((await sql`select revision from app.fulfillment where id=${parcel.fulfillment_id}`)[0].revision);
 assert.equal((await call(`/api/v1/admin/fulfillments/${parcel.fulfillment_id}/preparations`,{expected_version:await version()})).status,201);
 const booked=await call('/api/v1/admin/shipments',{fulfillment_id:parcel.fulfillment_id,expected_version:await version()});assert.equal(booked.status,202,JSON.stringify(booked.payload));
 const [booking]=await sql`select id,creation_job_id from app.shipment_booking where id=${booked.payload.operation_id}`;
 assert.equal(await runOneJob(sql,{'shipping.create':shippingAdapter(sql,'test')},booking.creation_job_id),true);
 assert.equal((await sql`select status from app.outbox_job where id=${booking.creation_job_id}`)[0].status,'completed','the carrier simulator accepted the booking');
 const [operation]=await sql`select request_basis from app.local_waybill_operation where booking_id=${booking.id}`;
 assert.equal(Number(operation.request_basis.cod_due),base+fee,'waybill cod_due includes the frozen fee');
 assert.equal(await runOneJob(sql,{},await ingestWaybillEvent(sql,await simulateWaybillIssue(sql,'test',booking.id))),true);
 assert.equal((await call(`/api/v1/admin/fulfillments/${parcel.fulfillment_id}/packing`,{expected_version:await version()})).status,201);
 assert.equal((await call(`/api/v1/admin/fulfillments/${parcel.fulfillment_id}/handover`,{expected_version:await version(),shipment_id:parcel.shipment_id,handover_reference:'SYNTHETIC carrier handover'})).status,201);
 const before=await sql.begin(tx=>projectOrderReceipt(tx,order.id)),due=before.receipt.collections[0];
 assert.equal(rupiah(due.merchandise_amount+due.shipping_and_fees_amount),rupiah(base+fee),'order page shows the same amount the courier collects');
 assert.equal(due.shipping_and_fees_amount,Number(parcel.buyer_shipping)+fee);
 assert.equal(await runOneJob(sql,{},await ingestCodEvent(sql,await simulateCodCollection(sql,'test',String(parcel.shipment_id)))),true);
 const [receipt]=await sql`select amount,payment_charge from app.economic_receipt where shipment_id=${parcel.shipment_id}`;
 assert.equal(Number(receipt.amount),base+fee);assert.equal(Number(receipt.payment_charge),fee);
 const after=(await sql.begin(tx=>projectOrderReceipt(tx,order.id))).receipt.collections[0];
 assert.equal(after.status,'verified');assert.equal(after.merchandise_amount+after.shipping_and_fees_amount,Number(receipt.amount));
}
test('carrier-simulator COD with a pinned 333 bps payment policy: waybill, order page and receipt agree on the fee',async()=>{
 const f=await paymentFixture();let terms:Awaited<ReturnType<typeof withCommercialTerms>>|undefined;const staff=await actor(f.identity,'owner',[]);
 try{await enroll(staff.browser,staff.password);terms=await withCommercialTerms(f,{cod_fee_bps:333});await codThroughCarrier(f,333,staff);}
 finally{await closeFulfillmentActor(f.identity,staff).catch(()=>{});try{await terms?.restore();}finally{await f.close();}}
});
test('carrier-simulator COD with no payment policy in force: fee-less waybill, order page and receipt',async()=>{
 const f=await paymentFixture(),staff=await actor(f.identity,'owner',[]);
 try{
  await enroll(staff.browser,staff.password);
  // A fresh fixture namespace starts before any payment-policy version takes effect.
  const [now]=await f.identity.sql`select app.reservation_clock(${f.namespace}) now`;
  assert.equal((await f.identity.sql.begin(tx=>paymentTerms(tx,new Date(now.now)))).version_id,null,'no payment policy is in force at this business instant');
  await codThroughCarrier(f,0,staff);
 }finally{await closeFulfillmentActor(f.identity,staff).catch(()=>{});await f.close();}
});
