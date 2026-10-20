import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import test from 'node:test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {issueAccessProof} from '../../src/modules/access/grants.ts';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';

const path='/api/v1/me/reauthentication-proofs';
type Actor=Awaited<ReturnType<typeof actor>>;
function request(user:Actor,subjectId:string,key=randomUUID()){
 const req=user.browser.request(path,{password:user.password,action:'affiliate_rate.version',subject_id:subjectId});
 req.headers.set('idempotency-key',key);return req;
}

test('affiliate rate proof is owner-only, canonical-subject-bound and recoverable without extending its lifetime',async()=>{
 const identity=createLocalAuth('test'),users:Actor[]=[];
 try{
  const owner=await actor(identity,'owner',[]);users.push(owner);
  const subject=randomUUID(),key=randomUUID();
  assert.equal((await handleAccess(request(owner,subject),identity)).status,403);
  await enroll(owner.browser,owner.password);
  for(const role of ['finance','ecommerce_admin','warehouse','customer_service','buyer','affiliate']as const){
   const user=await actor(identity,role,[]);users.push(user);
   if(!['buyer','affiliate'].includes(role))await enroll(user.browser,user.password);
   assert.equal((await handleAccess(request(user,subject),identity)).status,403);
  }
  assert.equal((await handleAccess(request(owner,'not-a-uuid'),identity)).status,400);
  const first=await handleAccess(request(owner,subject.toUpperCase(),key),identity);assert.equal(first.status,201);
  assert.equal(first.headers.get('cache-control'),'no-store');
  const saved=await first.json(),replayed=await handleAccess(request(owner,subject,key),identity);assert.equal(replayed.status,201);
  const recovered=await replayed.json();
  assert.ok(typeof saved.proof==='string'&&saved.proof.length>20,'An opaque proof is returned privately');
  assert.ok(saved.proof===recovered.proof&&saved.expires_at===recovered.expires_at,'Same proof and original deadline survive replay');
  assert.deepEqual(Object.keys(saved).sort(),['expires_at','proof']);
  const [stored]=await identity.sql`select subject_id,action from app.access_proof where session_id in
   (select id from app.auth_session where user_id=${owner.id}) and action='affiliate_rate.version'`;
  assert.deepEqual(stored,{subject_id:subject,action:'affiliate_rate.version'});
  assert.equal((await handleAccess(request(owner,randomUUID(),key),identity)).status,409);
 }finally{await cleanup(identity,users);await identity.sql.end();}
});

for(const revoked of ['roles','mfa','verified_email']as const){
 test(`cached owner cannot issue an affiliate rate proof after current ${revoked} authority is revoked`,async()=>{
  const identity=createLocalAuth('test'),users:Actor[]=[];
  try{
   const owner=await actor(identity,'owner',[]);users.push(owner);await enroll(owner.browser,owner.password);
   const principal=await getPrincipal(owner.browser.request('/api/v1/me'),identity),req=request(owner,randomUUID()),body=await req.clone().json();
   if(revoked==='roles')await identity.sql`update app.role_grant set roles='{}'::text[] where user_id=${owner.id}`;
   else if(revoked==='mfa')await identity.sql`update app.mfa_session set verified_at=clock_timestamp()-interval '6 minutes' where session_id=${principal.sessionId}`;
   else await identity.sql`update app.auth_user set email_verified=false where id=${owner.id}`;
   await assert.rejects(issueAccessProof(req,principal,identity,body),{code:'FORBIDDEN'});
   const [stored]=await identity.sql`select count(*)::int n from app.access_proof where session_id=${principal.sessionId} and action='affiliate_rate.version'`;
   assert.equal(stored.n,0);
  }finally{await cleanup(identity,users);await identity.sql.end();}
 });
}

test('proof issuance waits on the real actor row and denies email authority revoked by the blocking transaction',async()=>{
 const identity=createLocalAuth('test'),users:Actor[]=[];
 let release=()=>{},blocker:Promise<unknown>|undefined,pending:Promise<unknown>|undefined;
 try{
  const owner=await actor(identity,'owner',[]);users.push(owner);await enroll(owner.browser,owner.password);
  const principal=await getPrincipal(owner.browser.request('/api/v1/me'),identity),req=request(owner,randomUUID()),body=await req.clone().json();
  let ready=()=>{},blockerPid=0;const locked=new Promise<void>(r=>{ready=r;}),held=new Promise<void>(r=>{release=r;});
  blocker=identity.sql.begin(async tx=>{
   const [backend]=await tx`select pg_backend_pid()::int pid`;blockerPid=backend.pid;
   await tx`update app.auth_user set email_verified=false where id=${owner.id}`;ready();await held;
  });
  await locked;
  const observed=issueAccessProof(req,principal,identity,body).then(()=>({allowed:true,code:null}),error=>({allowed:false,code:error.code}));pending=observed;
  let waiting=0;
  for(let i=0;i<150;i++){
   const [row]=await identity.sql`select count(*)::int n from pg_stat_activity where datname='99ribu_test'
    and usename='99ribu_test_app' and ${blockerPid}=any(pg_blocking_pids(pid)) and wait_event_type='Lock'`;
   waiting=row.n;if(waiting===1)break;await setTimeout(20);
  }
  assert.equal(waiting,1);release();await blocker;
  assert.deepEqual(await observed,{allowed:false,code:'FORBIDDEN'});
  const [stored]=await identity.sql`select count(*)::int n from app.access_proof where session_id=${principal.sessionId}`;assert.equal(stored.n,0);
 }finally{release();await Promise.allSettled([blocker,pending].filter(p=>p!==undefined));await cleanup(identity,users);await identity.sql.end();}
});
