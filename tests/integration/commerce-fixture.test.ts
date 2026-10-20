import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {handleCatalog} from '../../src/modules/catalog/routes.ts';
import {readPublicationState} from '../../src/modules/catalog/publication.ts';
import {appendCostVersion} from '../../src/modules/finance/costs.ts';
import {handleInventory} from '../../src/modules/inventory/routes.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
const exec=promisify(execFile);
const namespace=()=>`s18-${randomUUID().slice(0,12)}`;
const denied=(code:string)=>(error:unknown)=>error instanceof Error&&'code' in error&&error.code===code;
async function setup(){
 const identity=createLocalAuth('test');const owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);const users=[owner];const ns=namespace();
 const request=()=>owner.browser.request('/api/v1/admin/local-fixture-command');
 const seed=()=>seedCommerce(request(),identity,'test',ns);
 const close=async()=>{await cleanup(identity,users);await identity.sql.end();};return {identity,owner,users,ns,request,seed,close};
}

test('two authenticated seed callers converge on stable catalog/stock/cost identities with real guarded publication',async()=>{
 const f=await setup();try{
  const other=await actor(f.identity,'owner',[]);f.users.push(other);await enroll(other.browser,other.password);
  const [a,b]=await Promise.all([f.seed(),seedCommerce(other.browser.request('/api/v1/admin/local-fixture-command'),f.identity,'test',f.ns)]);
  assert.deepEqual(a.stocks,b.stocks);assert.deepEqual(a.offers,b.offers);assert.deepEqual(a.products,b.products);assert.deepEqual(a.positions,b.positions);assert.deepEqual(a.reservations,b.reservations);
  assert.equal(Object.keys(a.stocks).length,3);assert.equal(Object.keys(a.offers).length,4);assert.equal(Object.keys(a.positions).length,6);
  assert.ok(a.publications['fixture-offer-shirt'].id);assert.ok(a.publications['fixture-offer-cream-pack'].id);
  for(const id of ['fixture-offer-bag','fixture-offer-mixed']){assert.equal(a.publications[id].id,null);assert.ok(a.publications[id].blockers.includes('UNKNOWN_HPP'));}
  const [unknown]=await f.identity.sql`select unit_cost from app.component_cost_version where stock_item_id=${a.stocks['fixture-bag']}`;assert.equal(unknown.unit_cost,null);
  const [count]=await f.identity.sql`select count(*)::int as n from app.component_cost_version where stock_item_id in ${f.identity.sql(Object.values(a.stocks))}`;assert.equal(count.n,3);
  const [balance]=await f.identity.sql`select on_hand,reserved,quarantined from app.inventory_balance where id=${a.positions['fixture-malang:fixture-shirt']}`;assert.deepEqual(balance,{on_hand:5,reserved:1,quarantined:1});
  const [effects]=await f.identity.sql`select count(*)::int as n from app.stock_movement where balance_id=${a.positions['fixture-malang:fixture-shirt']}`;assert.equal(effects.n,3);
  const [head]=await f.identity.sql`select exception_reason from app.publication_version where id=${a.publications['fixture-offer-shirt'].id}`;assert.equal(head.exception_reason,null);
 }finally{await f.close();}
});

test('rerun preserves actual HPP/draft/stock edits, historical publication and an expired initial hold without extending its clock',async()=>{
 const f=await setup();try{
  const first=await f.seed();const principal=await getPrincipal(f.request(),f.identity);
  const costRequest=f.request();costRequest.headers.set('idempotency-key',randomUUID());await appendCostVersion(costRequest,f.identity,principal,'component',first.stocks['fixture-shirt'],{expected_version:1,unit_cost:31000,effective_from:null,source:'Synthetic corrected estimate',reason:'Preserve actual operator costing change'});
  const [balance]=await f.identity.sql`select revision from app.inventory_balance where id=${first.positions['fixture-malang:fixture-shirt']}`;
  const [position]=await f.identity.sql`select warehouse_id from app.inventory_balance where id=${first.positions['fixture-malang:fixture-shirt']}`;
  const movement=f.owner.browser.request('/api/v1/admin/inventory/movements',{warehouse_id:position.warehouse_id,stock_item_id:first.stocks['fixture-shirt'],kind:'receive',quantity:1,expected_version:balance.revision,reason:'Synthetic actual operator supply'});movement.headers.set('idempotency-key',randomUUID());assert.equal((await handleInventory(movement,f.identity)).status,201);
  const patchBody={expected_version:1,name:'Synthetic operator edited title',reason:'Preserve actual operator draft edit'};
  const post=f.owner.browser.request(`/api/v1/admin/products/${first.products['fixture-offer-shirt']}`,patchBody);post.headers.set('idempotency-key',randomUUID());const patch=new Request(post,{method:'PATCH'});assert.equal((await handleCatalog(patch,f.identity)).status,200);
  const before=await readFixtureClock('test',f.ns);await advanceFixtureClock('test',f.ns,3601,before.version);
  const reservationId=first.reservations['fixture-malang:fixture-shirt'];for(let i=0;i<50;i++){const [r]=await f.identity.sql`select status from app.stock_reservation where id=${reservationId}`;if(r.status==='expired') break;await runOneJob(f.identity.sql);}
  const [expired]=await f.identity.sql`select status,expires_at::text from app.stock_reservation where id=${reservationId}`;assert.equal(expired.status,'expired');
  const [counts]=await f.identity.sql`select count(*)::int as n from app.stock_movement where balance_id=${first.positions['fixture-malang:fixture-shirt']}`;
  const currentClock=await readFixtureClock('test',f.ns);const second=await f.seed();assert.deepEqual(second.stocks,first.stocks);assert.deepEqual(second.offers,first.offers);assert.deepEqual(second.reservations,first.reservations);assert.deepEqual(await readFixtureClock('test',f.ns),currentClock);
  const [after]=await f.identity.sql`select on_hand,reserved,quarantined from app.inventory_balance where id=${first.positions['fixture-malang:fixture-shirt']}`;assert.deepEqual(after,{on_hand:6,reserved:0,quarantined:1});
  const [again]=await f.identity.sql`select count(*)::int as n from app.stock_movement where balance_id=${first.positions['fixture-malang:fixture-shirt']}`;assert.equal(again.n,counts.n);
  const [cost]=await f.identity.sql`select unit_cost from app.component_cost_version where stock_item_id=${first.stocks['fixture-shirt']} order by revision desc limit 1`;assert.equal(cost.unit_cost,31000);
  const [draft]=await f.identity.sql`select name,revision from app.product_revision where product_id=${first.products['fixture-offer-shirt']} order by revision desc limit 1`;assert.deepEqual(draft,{name:'Synthetic operator edited title',revision:2});
  const state=await readPublicationState(f.identity,principal,first.products['fixture-offer-shirt']);assert.equal(state.current?.id,first.publications['fixture-offer-shirt'].id);assert.equal(state.current_review_state,'requires_review');
  const [deadline]=await f.identity.sql`select status,expires_at::text from app.stock_reservation where id=${reservationId}`;assert.deepEqual(deadline,expired);
 }finally{await f.close();}
});

test('host commerce seed refuses nonowner, mixed transport, invalid namespace and database target before creating fixture identities',async()=>{
 const f=await setup();try{
  const ecom=await actor(f.identity,'ecommerce_admin',[]);f.users.push(ecom);await enroll(ecom.browser,ecom.password);
  await assert.rejects(seedCommerce(ecom.browser.request('/api/v1/admin/local-fixture-command'),f.identity,'test',f.ns),denied('FORBIDDEN'));
  await assert.rejects(seedCommerce(f.request(),f.identity,'local',f.ns),denied('INVALID_INPUT'));
  await assert.rejects(seedCommerce(f.request(),f.identity,'test','../bad'),denied('INVALID_INPUT'));
  const mixed=f.request();mixed.headers.set('x-order-token','synthetic-unsupported');await assert.rejects(seedCommerce(mixed,f.identity,'test',f.ns),denied('INVALID_INPUT'));
  const [count]=await f.identity.sql`select count(*)::int as n from app.local_fixture_namespace where name=${f.ns}`;assert.equal(count.n,0);
 }finally{await f.close();}
});

test('actual developer CLI reruns with a fresh temporary real MFA operator and prints only nonsecret seed metadata',async()=>{
 const ns=namespace();const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
 const args=['--env-file=.env.example','scripts/seed.ts','commerce','test',ns];
 const first=await exec(process.execPath,args,{env:environment,timeout:20000});const second=await exec(process.execPath,args,{env:environment,timeout:20000});
 const a=JSON.parse(first.stdout);const b=JSON.parse(second.stdout);assert.deepEqual(a,b);
 assert.deepEqual(Object.keys(a).sort(),['namespace','offers','positions','products','publications','reservations','scope','stocks']);assert.equal(a.scope,'catalog-stock-cost');
 for(const output of [first.stdout,second.stdout]) assert.ok(!/(password|session_token|totp|backupCodes|https?:\/\/)/i.test(output));
});

test('six callers waiting on one namespace cannot reserve away the real domain connection pool',async()=>{
 const f=await setup();const {connectDatabase}=await import('../../src/db/client.ts');const blocker=connectDatabase('test').sql;
 let unlock=()=>{};let pending:Promise<Awaited<ReturnType<typeof f.seed>>[]>|undefined;
 try{
  await f.seed();let ready=()=>{};const locked=new Promise<void>((r)=>{ready=r;});const held=new Promise<void>((r)=>{unlock=r;});
  const gate=blocker.begin(async(tx)=>{await tx`select pg_advisory_xact_lock(hashtextextended(${`99ribu:fixture-commerce:${f.ns}`},0))`;ready();await held;});
  try{
   await locked;pending=Promise.all(Array.from({length:6},()=>f.seed()));
   const {setTimeout}=await import('node:timers/promises');let waiting=0;
   for(let i=0;i<100;i++){const [row]=await blocker`select count(*)::int as n from pg_stat_activity where datname='99ribu_test' and wait_event_type='Lock' and query like '%pg_advisory_xact_lock(hashtextextended(%'`;waiting=row.n;if(waiting===6) break;await setTimeout(20);}
   assert.equal(waiting,6,'Every waiter uses a dedicated lock connection, leaving the domain pool available');unlock();await gate;
   const results=await pending;for(const result of results) assert.deepEqual(result,results[0]);
  }finally{unlock();await gate;await pending;}
 }finally{unlock();await blocker.end();await f.close();}
});

test('developer CLI honors an existing loopback sign-in limit and cleans up its failed temporary account without resetting it',async()=>{
 const {connectDatabase}=await import('../../src/db/client.ts');const {sql}=connectDatabase('test');const ns=namespace();const rateId=randomUUID();
 const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
 try{
  await sql`insert into app.auth_rate_limit (id,key,count,last_request) values (${rateId},'127.0.0.1|/sign-in/email',5,${Date.now()}) on conflict (key) do update set id=${rateId},count=5,last_request=${Date.now()}`;
  await assert.rejects(exec(process.execPath,['--env-file=.env.example','scripts/seed.ts','commerce','test',ns],{env:environment,timeout:15000}));
  const [rate]=await sql`select count from app.auth_rate_limit where id=${rateId}`;assert.ok(rate&&rate.count>=5,'CLI must not clear or lower an existing shared limit');
  const [accounts]=await sql`select count(*)::int as n from app.auth_user where email like ${`${ns}.seed-op-%@example.invalid`}`;assert.equal(accounts.n,0);
 }finally{await sql`delete from app.auth_rate_limit where id=${rateId}`;await sql.end();}
});

test('SIGTERM during a namespace lock wait aborts the seed and removes its temporary MFA owner',async()=>{
 const {connectDatabase}=await import('../../src/db/client.ts');const {spawn}=await import('node:child_process');const {setTimeout}=await import('node:timers/promises');
 const {sql}=connectDatabase('test');const ns=namespace();let unlock=()=>{};let child:ReturnType<typeof spawn>|undefined;
 const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
 try{
  let ready=()=>{};const locked=new Promise<void>((r)=>{ready=r;});const held=new Promise<void>((r)=>{unlock=r;});
  const gate=sql.begin(async(tx)=>{await tx`select pg_advisory_xact_lock(hashtextextended(${`99ribu:fixture-commerce:${ns}`},0))`;ready();await held;});
  try{
   await locked;child=spawn(process.execPath,['--env-file=.env.example','scripts/seed.ts','commerce','test',ns],{env:environment,stdio:['ignore','pipe','pipe']});
   let active=0;for(let i=0;i<200;i++){const [row]=await sql`select count(*)::int as n from app.auth_user u join app.role_grant g on g.user_id=u.id join app.auth_session s on s.user_id=u.id join app.mfa_session m on m.session_id=s.id where u.email like ${`${ns}.seed-op-%@example.invalid`} and 'owner'=any(g.roles)`;active=row.n;if(active===1) break;await setTimeout(20);}
   assert.equal(active,1);let waiting=0;
   for(let i=0;i<200;i++){const [row]=await sql`select count(*)::int as n from pg_stat_activity where datname='99ribu_test' and application_name=${`99ribu-seed-${ns}`} and wait_event_type='Lock' and query like '%pg_advisory_xact_lock%'`;waiting=row.n;if(waiting===1) break;await setTimeout(20);}
   assert.equal(waiting,1,'The exact namespace seed connection must be waiting on its advisory lock before SIGTERM');const exited=once(child,'exit');child.kill('SIGTERM');await setTimeout(50);unlock();await gate;
   const [code,signal]=await exited;assert.equal(code,143);assert.equal(signal,null);child=undefined;
   const [accounts]=await sql`select count(*)::int as n from app.auth_user where email like ${`${ns}.seed-op-%@example.invalid`}`;assert.equal(accounts.n,0);
  }finally{unlock();await gate;}
 }finally{if(child){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}unlock();await sql.end();}
});
