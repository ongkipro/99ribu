import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {createServer,type IncomingMessage,type Server} from 'node:http';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {type AutolarisClient,autolarisAdviceAdapter,autolarisClientFor} from '../../src/modules/payments/autolaris.ts';
import {originBoundFetch,readAutolarisStandInConfig} from '../../src/modules/payments/autolaris-live.ts';
import {createAttempt} from '../../src/modules/payments/attempts.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {paymentFixture} from './payment-fixture.ts';

// DEC-028 / S166: the AutoLaris WIRE layer in local provider mode. The real AdsBookCMS stand-in does not serve
// POST /api/h2h/create_payment (S162 A1; S171 is review-only by owner decision 2026-11-04), so this file drives
// 99ribu's real HTTP client against an IN-TEST FAKE built from the official guide (create_payment request/response,
// rc 01/07) plus explicit levers. Its settled advice shape is INVENTED (no settled example is published): it only
// drives the settle path once; S97 is the only closure. Paid-state and money postings stay proven on the simulator
// (--case=autolaris-payments). Passing here does not prove the real stand-in or the real provider.
type Payment={trx_id:string;reff_id:string;amount:number;admin:number;total:number;status:'pending'|'paid'};
type Lever='lose-before'|'lose-after'|'rc07'|'rc01'|'http500'|'malformed';
async function fake(){
 const state={feeMode:'inclusive' as 'inclusive'|'added'|'amount-off',duplicates:'dedupe' as 'dedupe'|'ignore',levers:[] as Lever[],settleShape:'live' as 'live'|'invented'|'generic'};
 const payments=new Map<string,Payment>(),byReff=new Map<string,string>(),requests:{path:string;auth:string|undefined;body:Record<string,unknown>}[]=[];
 const read=async(r:IncomingMessage)=>{const c:Buffer[]=[];for await(const x of r)c.push(x as Buffer);const raw=Buffer.concat(c).toString('utf8');return raw?JSON.parse(raw) as Record<string,unknown>:{};};
 const server:Server=createServer(async(request,response)=>{
  const path=new URL(request.url??'/','http://x').pathname,body=await read(request);requests.push({path,auth:request.headers.authorization,body});
  const send=(status:number,value:unknown)=>{response.writeHead(status,{'content-type':'application/json','x-stand-in':'1'});response.end(typeof value==='string'?value:JSON.stringify(value));};
  if(path==='/api/h2h/list_payment')return send(200,{rc:'00',ket:'SUCCESS',data:['QRIS','VABCA','VAMANDIRI','VABNI','VABRI','VAPERMATA'].map(channel_code=>({channel_code}))});
  if(path==='/api/h2h/create_payment'){
   const lever=state.levers.shift();
   if(lever==='lose-before'){response.destroy();return;}
   if(lever==='rc07')return send(200,{rc:'07',ket:'Channel tidak aktif',data:null});
   if(lever==='rc01')return send(200,{rc:'01',ket:'Invalid request',data:null});
   if(lever==='http500')return send(500,{});
   if(lever==='malformed')return send(200,'not json');
   const reff=String(body.reff_id);let trx=state.duplicates==='dedupe'?byReff.get(reff):undefined;
   if(!trx){const amount=Number(body.amount),admin=4000;trx=String(randomInt(1e8,1e9));
    payments.set(trx,{trx_id:trx,reff_id:reff,amount:state.feeMode==='amount-off'?amount+1:amount,admin,total:state.feeMode==='added'?amount+admin:state.feeMode==='amount-off'?amount+1:amount,status:'pending'});byReff.set(reff,trx);}
   if(lever==='lose-after'){response.destroy();return;}
   const p=payments.get(trx) as Payment;
   return send(200,{rc:'00',ket:'Sukses',data:{trx_id:p.trx_id,virtual_account:`8808${p.trx_id}`,qr:'',payment_code:'',url:'',amount:p.amount,admin:p.admin,total:p.total}});
  }
  if(path==='/api/h2h/advice'){
   const p=payments.get(String(body.transaction_id));
   if(!p)return send(200,{rc:'14',ket:'TRANSAKSI TIDAK DITEMUKAN',data:{}});
   if(p.status!=='paid')return send(200,{rc:'02',ket:'PENDING',data:{awb:''}});
   return send(200,state.settleShape==='generic'?{rc:'00',ket:'SUCCESS',data:{awb:''}}:state.settleShape==='invented'?{rc:'00',ket:'PAID',data:{awb:'',status:'PAID',amount:p.total,paid_at:new Date().toISOString()}}:{rc:'00',ket:'PAID',data:{awb:''}});
  }
  send(404,{error:'not found'});
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {origin:`http://127.0.0.1:${(server.address() as {port:number}).port}`,state,payments,requests,close:()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());})};
}
async function mode<T>(origin:string,run:()=>Promise<T>){const saved=process.env;process.env={...saved,LOCAL_PROVIDER_ORIGIN:origin};try{return await run();}finally{process.env=saved;}}
// Orders are placed with the fixture destinations (mode off); payment jobs then run in provider mode.
async function plain<T>(run:()=>Promise<T>){const saved=process.env;process.env={...saved};delete process.env.LOCAL_PROVIDER_ORIGIN;try{return await run();}finally{process.env=saved;}}
type Fixture=Awaited<ReturnType<typeof paymentFixture>>;
async function attempt(f:Fixture,orderId:string){
 const shown=await f.identity.sql.begin(tx=>createAttempt(tx,orderId,randomUUID(),{method_id:'autolaris',channel_code:'VABCA'}));
 const [row]=await f.identity.sql`select creation_job_id from app.payment_attempt where id=${shown.id}`;return {id:shown.id,job:String(row.creation_job_id)};
}
async function create(f:Fixture,job:string,client:AutolarisClient){
 await f.identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${job}`;
 await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test',new Map(),client)},job);
 const [state]=await f.identity.sql`select status from app.outbox_job where id=${job}`;return String(state.status);
}
// Leave nothing open in the shared test database (the admin open queue pages by expiry): drive an attempt to a
// final state through the normal path, re-create if no answer was recorded, then settle with the observed live shape.
async function ingest(f:Fixture,attemptId:string){
 for(const event of await f.identity.sql`select callback_job_id from app.payment_provider_event where attempt_id=${attemptId}`){
  const [cb]=await f.identity.sql`select status from app.outbox_job where id=${event.callback_job_id}`;if(cb.status==='pending')await runOneJob(f.identity.sql,{},event.callback_job_id);}
}
async function finish(f:Fixture,s:Awaited<ReturnType<typeof fake>>,client:AutolarisClient,a:{id:string;job:string}){
 await ingest(f,a.id);
 const [state]=await f.identity.sql`select status from app.payment_attempt where id=${a.id}`;if(!['preparing','pending','unknown'].includes(state.status))return;
 s.state.levers.length=0;s.state.feeMode='inclusive';
 if(!(await row(f,a.id)).responded_at)await create(f,a.job,client);
 const trx=(await row(f,a.id)).trx_id;const p=trx?s.payments.get(String(trx)):undefined;assert.ok(p,"provider payment for the recorded trx_id");
 p.status='paid';s.state.settleShape='live';
 const [job]=await f.identity.sql`select id from app.outbox_job where kind='payment.autolaris.advice' and payload->>'attemptId'=${a.id} and status='pending' order by (payload->>'poll')::int desc limit 1`;assert.ok(job,"a pending advice poll");
 await f.identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${job.id}`;
 await runOneJob(f.identity.sql,{'payment.autolaris.advice':autolarisAdviceAdapter(f.identity.sql,'test',client)},job.id);
 for(const event of await f.identity.sql`select callback_job_id from app.payment_provider_event where attempt_id=${a.id}`){
  const [cb]=await f.identity.sql`select status from app.outbox_job where id=${event.callback_job_id}`;if(cb.status==='pending')await runOneJob(f.identity.sql,{},event.callback_job_id);}
 const [end]=await f.identity.sql`select status from app.payment_attempt where id=${a.id}`;assert.ok(!['preparing','pending','unknown'].includes(end.status),`attempt left ${end.status}`);
}
const row=async(f:Fixture,id:string)=>(await f.identity.sql`select reff_id,trx_id,responded_at,refusal_code,provider_total from app.autolaris_payment where attempt_id=${id}`)[0];
const operation=async(f:Fixture,id:string)=>(await f.identity.sql`select status from app.local_payment_operation where attempt_id=${id}`)[0]?.status;

test('S166 factory: provider mode builds the HTTP client bound to the loopback origin; unset keeps the simulator and production stays gated',async()=>{
 assert.equal(readAutolarisStandInConfig({...process.env,LOCAL_PROVIDER_ORIGIN:''}),null);
 assert.deepEqual(readAutolarisStandInConfig({...process.env,LOCAL_PROVIDER_ORIGIN:'http://127.0.0.1:8788'}),{baseUrl:'http://127.0.0.1:8788',apiKey:'local'});
 assert.equal(readAutolarisStandInConfig({APP_ENV:'production',LOCAL_PROVIDER_ORIGIN:'http://127.0.0.1:8788'}),null);
 assert.throws(()=>readAutolarisStandInConfig({...process.env,LOCAL_PROVIDER_ORIGIN:'http://localhost:8788'}),/LOCAL_PROVIDER_ORIGIN must be/);
 for(const target of ['production','live'])await mode('http://127.0.0.1:8788',async()=>assert.throws(()=>autolarisClientFor(target),{code:'AUTOLARIS_LIVE_GATED'}));
 await plain(async()=>assert.throws(()=>autolarisClientFor('local'),{code:'AUTOLARIS_LIVE_GATED'},'mode off without a database keeps the old refusal'));
 // Egress: the bound fetch refuses every other origin before any request.
 let called=0;const bound=originBoundFetch('http://127.0.0.1:8788',(async()=>{called++;return Response.json({});}) as typeof fetch);
 for(const url of ['https://api-h2h.autolaris.com/api/h2h/list_payment','http://127.0.0.1:8789/x','http://localhost:8788/x'])await assert.rejects(bound(url),/egress refused/);
 assert.equal(called,0);await bound('http://127.0.0.1:8788/api/h2h/list_payment');assert.equal(called,1);
 const s=await fake();
 try{await mode(s.origin,async()=>{
  const client=autolarisClientFor('local');
  assert.equal((await client.listPayment()).rc,'00');
  assert.deepEqual(s.requests.map(r=>[r.path,r.auth]),[['/api/h2h/list_payment','Bearer local']],'literal bearer local, never a key');
 });}finally{await s.close();}
});

test('S166 create_payment over HTTP: documented request, one instruction, same reff_id across lost responses, no second reference',async()=>{
 const f=await paymentFixture(),s=await fake();
 try{
  const {order}=await plain(()=>f.order(1,'prepaid','autolaris'));
  await mode(s.origin,async()=>{
   const client=autolarisClientFor('test',f.identity.sql);
   const a=await attempt(f,order.id);const reff=(await row(f,a.id)).reff_id;
   // Lost before the provider recorded anything, then lost after it did: the job stays unknown and nothing is recorded.
   s.state.levers.push('lose-before');assert.equal(await create(f,a.job,client),'unknown');
   s.state.levers.push('lose-after');assert.equal(await create(f,a.job,client),'unknown');
   assert.equal((await row(f,a.id)).responded_at,null);assert.equal(await operation(f,a.id),'pending');
   assert.equal(await create(f,a.job,client),'completed','reconciliation replays the same create');
   const creates=s.requests.filter(r=>r.path==='/api/h2h/create_payment');
   assert.equal(creates.length,3);assert.ok(creates.every(r=>r.body.reff_id===reff&&r.auth==='Bearer local'),'the same reff_id every time');
   assert.deepEqual(Object.keys(creates[0].body).sort(),['amount','callback_url','channel_code','customer_email','customer_id','customer_name','customer_phone','expired','reff_id'],'documented create_payment fields');
   assert.match(String(creates[0].body.expired),/^\d{14}$/);assert.equal(creates[0].body.amount,String(order.buyer_total));
   assert.equal(s.payments.size,1,'a deduplicating provider holds one payment for the reff_id');
   const recorded=await row(f,a.id);assert.equal(recorded.refusal_code,null);assert.equal(Number(recorded.provider_total),Number(order.buyer_total));
   assert.equal(recorded.trx_id,[...s.payments.keys()][0]);
   await finish(f,s,client,a);
  });
 }finally{await s.close();await f.close();}
});

test('S166 refusals: fee on top (total != amount), rc 07 and rc 01 fail the operation; 5xx and malformed bodies stay unknown',async()=>{
 const f=await paymentFixture(),s=await fake();
 try{
  const orders:{id:string}[]=[];for(let n=0;n<5;n++)orders.push((await plain(()=>f.order(1,'prepaid','autolaris'))).order);
  await mode(s.origin,async()=>{
   const client=autolarisClientFor('test',f.identity.sql);
   s.state.feeMode='added';
   const a=await attempt(f,orders[0].id);
   assert.equal(await create(f,a.job,client),'completed');
   assert.equal((await row(f,a.id)).refusal_code,'AUTOLARIS_TOTAL_MISMATCH','the documented fee-on-top sample is refused (store-borne fee, DEC-008; owner/S97 question)');
   assert.equal(await operation(f,a.id),'failed');await finish(f,s,client,a);
   s.state.feeMode='inclusive';
   for(const [index,lever] of (['rc07','rc01'] as const).entries()){
    const b=await attempt(f,orders[1+index].id);s.state.levers.push(lever);
    assert.equal(await create(f,b.job,client),'completed');assert.equal(await operation(f,b.id),'failed',lever);assert.equal((await row(f,b.id)).trx_id,null);await finish(f,s,client,b);
   }
   for(const [index,lever] of (['http500','malformed'] as const).entries()){
    const b=await attempt(f,orders[3+index].id);s.state.levers.push(lever);
    assert.equal(await create(f,b.job,client),'unknown',lever);assert.equal(await operation(f,b.id),'pending');assert.equal((await row(f,b.id)).responded_at,null);
    await finish(f,s,client,b);
   }
  });
 }finally{await s.close();await f.close();}
});

test('S166/S97 advice over HTTP: pending stays pending, the observed live PAID shape (no amount) settles once, an unknown status never settles',async()=>{
 const f=await paymentFixture(),s=await fake();
 try{
  const {order}=await plain(()=>f.order(1,'prepaid','autolaris'));
  await mode(s.origin,async()=>{
   const client=autolarisClientFor('test',f.identity.sql);
   const a=await attempt(f,order.id);
   assert.equal(await create(f,a.job,client),'completed');
   const poll=async(n:number)=>{const [job]=await f.identity.sql`select id from app.outbox_job where dedup_key=${`autolaris-advice:${a.id}:${n}`}`;assert.ok(job,`poll ${n}`);
    await f.identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${job.id}`;
    assert.equal(await runOneJob(f.identity.sql,{'payment.autolaris.advice':autolarisAdviceAdapter(f.identity.sql,'test',client)},job.id),true);
    // Ingest the provider events the advice registered (internal callback jobs), as autolaris-payments does.
    for(const event of await f.identity.sql`select callback_job_id from app.payment_provider_event where attempt_id=${a.id}`){
     const [state]=await f.identity.sql`select status from app.outbox_job where id=${event.callback_job_id}`;if(state.status==='pending')assert.equal(await runOneJob(f.identity.sql,{},event.callback_job_id),true);}
    return ((await f.identity.sql`select result from app.outbox_job where id=${job.id}`)[0].result as {observed?:string}).observed;};
   assert.equal(await poll(1),'pending');
   // An unrecognised status never pays, even with rc 00 (SUCCESS is generic wording).
   s.state.settleShape='generic';
   for(const p of s.payments.values())p.status='paid';
   assert.equal(await poll(2),'unknown','rc 00 ket SUCCESS is not proof of payment');
   assert.equal((await f.identity.sql`select payment_status from app.commerce_order where id=${order.id}`)[0].payment_status,'pending');
   // S97: the live shape `{rc:'00',ket:'PAID',data:{awb:''}}` (no amount) settles, billed from the verified create_payment total.
   s.state.settleShape='live';
   assert.equal(await poll(3),'settled');
   assert.equal((await f.identity.sql`select payment_status from app.commerce_order where id=${order.id}`)[0].payment_status,'confirmed');
   assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,1,'paid exactly once');
   // A replayed advice after settlement is a no-op.
   await f.identity.sql.begin(async tx=>{const {scheduleAdvice}=await import('../../src/modules/payments/autolaris.ts');await scheduleAdvice(tx,a.id,4,0);});
   const [late]=await f.identity.sql`select id from app.outbox_job where dedup_key=${`autolaris-advice:${a.id}:4`}`;
   assert.equal(await runOneJob(f.identity.sql,{'payment.autolaris.advice':autolarisAdviceAdapter(f.identity.sql,'test',client)},late.id),true);
   assert.equal(((await f.identity.sql`select result from app.outbox_job where id=${late.id}`)[0].result as {stopped?:string}).stopped,'final');
   assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,1,'still paid exactly once');
   // Host commands that act on the database simulator are refused in provider mode (they would change nothing).
   const {simulateAutolarisStatus}=await import('../../src/modules/payments/autolaris.ts');
   await assert.rejects(simulateAutolarisStatus(f.identity.sql,'test',a.id,'paid'),{code:'AUTOLARIS_STAND_IN_MODE'});
   assert.ok(s.requests.filter(r=>r.path==='/api/h2h/advice').every(r=>r.auth==='Bearer local'));
  });
 }finally{await s.close();await f.close();}
});

test('S166 gap shown, not passed: a provider that ignores duplicate reff_id holds two payments after a lost response',async()=>{
 const f=await paymentFixture(),s=await fake();
 try{
  const {order}=await plain(()=>f.order(1,'prepaid','autolaris'));
  await mode(s.origin,async()=>{
   const client=autolarisClientFor('test',f.identity.sql);s.state.duplicates='ignore';
   const a=await attempt(f,order.id);
   s.state.levers.push('lose-after');assert.equal(await create(f,a.job,client),'unknown');
   assert.equal(await create(f,a.job,client),'completed');
   // 99ribu records exactly one reference; the provider-side duplicate is the unpublished reff_id rule (S97 question).
   assert.equal(s.payments.size,2);assert.equal((await f.identity.sql`select count(*)::int n from app.autolaris_payment where attempt_id=${a.id} and trx_id is not null`)[0].n,1);
   await finish(f,s,client,a);
  });
 }finally{await s.close();await f.close();}
});

test('S166 a provider amount other than the requested one is refused (AUTOLARIS_AMOUNT_MISMATCH)',async()=>{
 const f=await paymentFixture(),s=await fake();
 try{
  const {order}=await plain(()=>f.order(1,'prepaid','autolaris'));
  await mode(s.origin,async()=>{
   const client=autolarisClientFor('test',f.identity.sql);s.state.feeMode='amount-off';
   const m=await attempt(f,order.id);
   assert.equal(await create(f,m.job,client),'completed');
   assert.equal((await row(f,m.id)).refusal_code,'AUTOLARIS_AMOUNT_MISMATCH');
   assert.equal(await operation(f,m.id),'failed');await finish(f,s,client,m);
  });
 }finally{await s.close();await f.close();}
});
