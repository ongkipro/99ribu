import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {handleCodRemittances} from '../../src/modules/finance/cod-remittance-routes.ts';
import {handleManualFulfillment} from '../../src/modules/fulfillment/manual-routes.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor,fulfillmentFixture} from './fulfillment-fixture.ts';

type Fixture=Awaited<ReturnType<typeof fulfillmentFixture>>;
async function shipManually(f:Fixture,parcel:Fixture['parcels'][number],resi:string){
 const request=f.owner.browser.request(`/api/v1/admin/fulfillments/${parcel.id}/manual-shipment`,{expected_version:parcel.revision,courier:'jne',tracking_number:resi});
 request.headers.set('idempotency-key',randomUUID());const response=await handleManualFulfillment(request,f.identity);assert.equal(response.status,201,JSON.stringify(await response.clone().json()));
}
async function financeUser(f:Fixture){
 const user=await actor(f.identity,'finance',[]);await enroll(user.browser,user.password);
 await f.identity.sql`update app.role_grant set permissions=${['finance.reconciliation.read','finance.reconciliation.write']} where user_id=${user.id}`;return user;
}
async function proof(user:Awaited<ReturnType<typeof financeUser>>,f:Fixture,subject:string){
 const request=user.browser.request('/api/v1/me/reauthentication-proofs',{password:user.password,action:'finance.reconcile',subject_id:subject});request.headers.set('idempotency-key',randomUUID());
 const response=await handleAccess(request,f.identity);assert.equal(response.status,201);return (await response.json()).proof as string;
}
async function post(user:{browser:{request:(path:string,body?:Record<string,unknown>)=>Request}},f:Fixture,body:Record<string,unknown>,key=randomUUID()){
 const request=user.browser.request('/api/v1/admin/cod-remittances',body);request.headers.set('idempotency-key',key);
 const response=await handleCodRemittances(request,f.identity);return {status:response.status,payload:await response.json()};
}
async function settle(f:Fixture,remittanceId:string){
 const sql=f.identity.sql;
 for(const job of await sql`select p.callback_job_id id from app.cod_remittance_line l join app.local_cod_event e on e.operation_id=l.cod_operation_id join app.cod_provider_event p on p.id=e.id where l.remittance_id=${remittanceId}`)await f.run(job.id);
 const [remittance]=await sql`select match_job_id,settlement_operation_id from app.cod_remittance where id=${remittanceId}`;await f.run(remittance.match_job_id);
 for(const job of await sql`select callback_job_id id from app.settlement_provider_event where operation_id=${remittance.settlement_operation_id} order by id`){
  const [state]=await sql`select status from app.outbox_job where id=${job.id}`;if(state.status==='pending')await f.run(job.id);
 }
 return remittance.settlement_operation_id as string;
}

test('an exact Mengantar COD statement posts one receipt per parcel and one balanced settlement that matches',async()=>{
 const f=await fulfillmentFixture('cod'),sql=f.identity.sql,users:Awaited<ReturnType<typeof actor>>[]=[];
 try{
  const stamp=String(Date.now()).slice(-8);
  await shipManually(f,f.parcels[0],`JP${stamp}11`);await shipManually(f,f.parcels[1],`JP${stamp}12`);
  const finance=await financeUser(f);users.push(finance);
  const dues=await sql`select id,cod_due from app.order_shipment where order_id=${f.order.id} order by id`;
  const lines=dues.map(d=>({shipment_id:d.id,amount:Number(d.cod_due)})),gross=lines.reduce((n,l)=>n+l.amount,0),id=randomUUID(),reference=`MGT-${stamp}-A`;
  const body={id,reference,statement_at:new Date().toISOString(),lines,shipping_deduction:10000,cod_fee_deduction:2000,other_deduction:0,net_amount:gross-12000,evidence:'Laporan saldo COD dashboard Mengantar',reason:'Penarikan saldo COD'};
  const staff=await actor(f.identity,'warehouse',[f.parcels[0].warehouse_id]);users.push(staff);await enroll(staff.browser,staff.password);
  assert.equal((await post(staff,f,{...body,reauthentication_proof:'x'})).status,403);
  assert.equal((await post(finance,f,{...body,reauthentication_proof:'SYNTHETIC-NOT-A-PROOF'})).payload.code,'REAUTHENTICATION_REQUIRED');
  const key=randomUUID(),recorded=await post(finance,f,{...body,reauthentication_proof:await proof(finance,f,id)},key);
  assert.equal(recorded.status,201,JSON.stringify(recorded.payload));assert.deepEqual(recorded.payload.flags,[]);assert.equal(recorded.payload.expected_net_amount,gross-12000);
  assert.deepEqual((await post(finance,f,{...body,reauthentication_proof:'replayed'},key)).payload,recorded.payload,'the same key replays without consuming another proof');
  assert.equal((await post(finance,f,{...body,evidence:'Laporan lain',reauthentication_proof:'replayed'},key)).payload.code,'IDEMPOTENCY_CONFLICT');
  // Database backstop (no application check): a parcel cannot get a second statement line.
  await assert.rejects(sql`insert into app.cod_remittance_line (remittance_id,shipment_id,ordinal,amount,expected_amount,cod_operation_id) values (${id},${lines[0].shipment_id},99,${lines[0].amount},${lines[0].amount},${randomUUID()})`,
   (error:Error)=>error.message.includes('one Mengantar statement only'));
  const operation=await settle(f,id);
  const receipts=await sql`select kind,amount from app.economic_receipt where order_id=${f.order.id} order by shipment_id`;
  assert.deepEqual(receipts.map(r=>Number(r.amount)),lines.map(l=>l.amount));
  const [settlement]=await sql`select status,problem_code,cash_transaction_id,fee_transaction_id from app.provider_settlement where operation_id=${operation}`;
  assert.equal(settlement.status,'matched',JSON.stringify(settlement));
  const postings=await sql`select account,side,sum(amount)::bigint amount from app.finance_posting where transaction_id in (${settlement.cash_transaction_id},${settlement.fee_transaction_id}) group by account,side order by account,side`;
  const posted=postings.map(p=>`${p.account}:${p.side}:${Number(p.amount)}`);assert.ok(posted.includes('carrier_expense:debit:12000'));assert.ok(posted.includes(`company_cash:debit:${gross-12000}`));
  const [balance]=await sql`select sum(case when p.side='debit' then p.amount else -p.amount end)::bigint net from app.finance_posting p join app.finance_transaction t on t.id=p.transaction_id where t.source='local.settlement' and t.effect_reference like ${`%${operation}%`}`;
  assert.equal(Number(balance.net??0),0);
  const [order]=await sql`select payment_status from app.commerce_order where id=${f.order.id}`;assert.equal(order.payment_status,'confirmed');
  const again=await post(finance,f,{...body,id:randomUUID(),reauthentication_proof:'unused'});assert.equal(again.payload.code,'STATEMENT_ALREADY_RECORDED');
  const audit=await sql`select details from app.audit_event where subject_id=${id} and action='finance.cod_remittance'`;assert.equal(audit.length,1);
 }finally{for(const user of users)await closeFulfillmentActor(f.identity,user).catch(()=>{});await f.close();}
});

test('statements refuse unbalanced totals, future dates, unshipped, simulator-booked, non-COD and already remitted parcels; a short parcel is flagged recovery money',async()=>{
 const f=await fulfillmentFixture('cod'),sql=f.identity.sql,users:Awaited<ReturnType<typeof actor>>[]=[];
 let prepaid:Fixture|undefined;
 try{
  const stamp=String(Date.now()).slice(-8),[shipped,booked]=f.parcels;
  await shipManually(f,shipped,`JP${stamp}21`);
  const finance=await financeUser(f);users.push(finance);
  const [due]=await sql`select cod_due from app.order_shipment where id=${shipped.shipment_id}`,short=Number(due.cod_due)-1000;
  const base=(id:string,lines:{shipment_id:string;amount:number}[],extra:Record<string,unknown>={})=>({id,reference:`MGT-${stamp}-${id.slice(0,6)}`,statement_at:new Date(Date.now()-60000).toISOString(),lines,shipping_deduction:0,cod_fee_deduction:0,other_deduction:0,net_amount:lines.reduce((n,l)=>n+l.amount,0),evidence:'Laporan',reason:'Uji',...extra});
  const refused=async(body:Record<string,unknown>,code:string)=>{const result=await post(finance,f,{...body,reauthentication_proof:'SYNTHETIC-UNUSED-PROOF'});assert.equal(result.payload.code,code);
   assert.equal((await sql`select count(*)::int n from app.local_cod_operation where reference=${`remit:${body.id}`}`)[0].n,0,`${code} writes no collection source`);};
  await refused(base(randomUUID(),[{shipment_id:shipped.shipment_id,amount:short}],{net_amount:short-1,shipping_deduction:0}),'STATEMENT_TOTAL_MISMATCH');
  await refused(base(randomUUID(),[{shipment_id:shipped.shipment_id,amount:short}],{statement_at:new Date(Date.now()+86400000).toISOString()}),'STATEMENT_DATE_IN_FUTURE');
  await refused(base(randomUUID(),[{shipment_id:booked.shipment_id,amount:1000}]),'STATEMENT_PARCEL_NOT_SHIPPED');
  // A simulator-booked (non-manual) parcel is never on a Mengantar statement.
  const booking=await f.book(booked);await f.run(booking.creation_job_id);
  for(const callback of await sql`select callback_job_id from app.waybill_provider_event where booking_id=${booking.id}`)await f.run(callback.callback_job_id);
  const {simulateWaybillIssue,ingestWaybillEvent}=await import('../../src/modules/fulfillment/local.ts');await f.run(await ingestWaybillEvent(sql,await simulateWaybillIssue(sql,'test',booking.id)));
  const packed=await f.fulfillmentCall(`/api/v1/admin/fulfillments/${booked.id}/packing`,{expected_version:4});assert.equal(packed.response.status,201);
  await sql`update app.local_fixture_namespace set clock=clock+interval '31 minutes',revision=revision+1 where name=${f.namespace}`;
  assert.equal((await f.fulfillmentCall(`/api/v1/admin/fulfillments/${booked.id}/handover`,{expected_version:5,shipment_id:booked.shipment_id,handover_reference:'SYNTHETIC handover'})).response.status,201);
  await refused(base(randomUUID(),[{shipment_id:booked.shipment_id,amount:1000}]),'STATEMENT_PARCEL_NOT_MANUAL');
  prepaid=await fulfillmentFixture('prepaid');
  await refused(base(randomUUID(),[{shipment_id:prepaid.parcels[0].shipment_id,amount:1000}]),'STATEMENT_PARCEL_NOT_COD');
  // A balanced statement with a short parcel and another deduction is recorded and flagged.
  const id=randomUUID(),recorded=await post(finance,f,{...base(id,[{shipment_id:shipped.shipment_id,amount:short}],{shipping_deduction:5000,cod_fee_deduction:500,other_deduction:700,net_amount:short-6200}),reauthentication_proof:await proof(finance,f,id)});
  assert.equal(recorded.status,201,JSON.stringify(recorded.payload));
  assert.deepEqual(recorded.payload.flags,['PARCEL_AMOUNT_MISMATCH','OTHER_DEDUCTION_REVIEW']);
  await settle(f,id);
  const [result]=await sql`select r.outcome,r.reason,r.receipt_id from app.cod_remittance_line l join app.local_cod_event e on e.operation_id=l.cod_operation_id join app.cod_event_result r on r.event_id=e.id where l.remittance_id=${id}`;
  assert.deepEqual({...result},{outcome:'recovery',reason:'amount_mismatch',receipt_id:null},'a short collection is recovery money, not a sale');
  assert.equal((await sql`select count(*)::int n from app.economic_receipt where shipment_id=${shipped.shipment_id}`)[0].n,0);
  assert.ok((await sql`select count(*)::int n from app.commerce_exception where order_id=${f.order.id}`)[0].n>=1,'a collection exception is opened for finance');
  // The same parcel can never be remitted on a second statement.
  await refused(base(randomUUID(),[{shipment_id:shipped.shipment_id,amount:short}]),'PARCEL_ALREADY_REMITTED');
  const read=await handleCodRemittances(finance.browser.request(`/api/v1/admin/cod-remittances/${id}`),f.identity);assert.equal(read.status,200);
  assert.equal((await read.json()).lines[0].collection_status,'recovery');
 }finally{for(const user of users)await closeFulfillmentActor(f.identity,user).catch(()=>{});try{await prepaid?.close();}finally{await f.close();}}
});
