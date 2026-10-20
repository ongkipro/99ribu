import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {issueAccessProof} from '../../src/modules/access/grants.ts';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';

const read='finance.reconciliation.read',write='finance.reconciliation.write';
test('finance proof requires both explicit grants; older owner purposes, strict subject, password, freshness and rate limits remain enforced',async()=>{
 const identity=createLocalAuth('test'),users:Awaited<ReturnType<typeof actor>>[]=[];
 try{
  const finance=await actor(identity,'finance',[]);users.push(finance);await enroll(finance.browser,finance.password);
  const body={password:finance.password,action:'finance.reconcile',subject_id:randomUUID()};
  const request=(value:Record<string,unknown>=body,key=randomUUID())=>{const r=finance.browser.request('/api/v1/me/reauthentication-proofs',value);r.headers.set('idempotency-key',key);return r;};
  for(const permissions of [[],['finance.costs.read','finance.costs.write'],[read],[write]]){
   await identity.sql`update app.role_grant set permissions=${permissions} where user_id=${finance.id}`;
   assert.equal((await handleAccess(request(),identity)).status,403);
  }
  await identity.sql`update app.role_grant set permissions=${[read,write]} where user_id=${finance.id}`;
  for(const action of ['staff_roles.replace','company_policy.version','warehouse_calendar.version','catalog_publication.exception'])assert.equal((await handleAccess(request({...body,action}),identity)).status,403);
  assert.equal((await handleAccess(request({...body,subject_id:'not-a-uuid'}),identity)).status,400);
  const foreign=request();foreign.headers.set('origin','https://foreign.example');assert.equal((await handleAccess(foreign,identity)).status,403);
  const bearer=request();bearer.headers.set('authorization','Bearer SYNTHETIC-UNSUPPORTED');assert.equal((await handleAccess(bearer,identity)).status,401);
  const key=randomUUID(),first=await handleAccess(request(body,key),identity);assert.equal(first.status,201);assert.equal(first.headers.get('cache-control'),'no-store');const initial=await first.json();
  const replay=await handleAccess(request(body,key),identity);assert.equal(replay.status,201);const repeated=await replay.json();assert.ok(initial.proof===repeated.proof);assert.equal(initial.expires_at,repeated.expires_at);
  assert.equal((await handleAccess(request({...body,subject_id:randomUUID()},key),identity)).status,409);
  assert.equal((await handleAccess(request({...body,password:'SYNTHETIC-WRONG-PASSWORD'}),identity)).status,403);
  const principal=await getPrincipal(finance.browser.request('/api/v1/me'),identity);
  await identity.sql`update app.mfa_session set verified_at=clock_timestamp()-interval '6 minutes' where session_id=${principal.sessionId}`;
  const stale=await handleAccess(request(),identity);assert.equal(stale.status,403);assert.equal((await stale.json()).code,'FRESH_MFA_REQUIRED');
  assert.equal((await handleAccess(request(),identity)).status,429);
 }finally{await cleanup(identity,users);await identity.sql.end();}
});
test('current database finance authority is rechecked before recovering a previously issued proof from a stale principal',async()=>{
 const identity=createLocalAuth('test'),users:Awaited<ReturnType<typeof actor>>[]=[];
 try{
  const finance=await actor(identity,'finance',[]);users.push(finance);await enroll(finance.browser,finance.password);
  await identity.sql`update app.role_grant set permissions=${[read,write]} where user_id=${finance.id}`;
  const principal=await getPrincipal(finance.browser.request('/api/v1/me'),identity),body={password:finance.password,action:'finance.reconcile',subject_id:randomUUID()},key=randomUUID();
  const request=()=>{const r=finance.browser.request('/api/v1/me/reauthentication-proofs',body);r.headers.set('idempotency-key',key);return r;};
  const first=await issueAccessProof(request(),principal,identity,body);assert.ok(first.proof.length>0);
  await identity.sql`update app.role_grant set permissions=${[read]},revision=revision+1 where user_id=${finance.id}`;
  await assert.rejects(issueAccessProof(request(),principal,identity,body),{code:'FORBIDDEN'});
  await identity.sql`update app.role_grant set permissions=${[read,write]},revision=revision+1 where user_id=${finance.id}`;
  await identity.sql`update app.mfa_session set verified_at=clock_timestamp()-interval '6 minutes' where session_id=${principal.sessionId}`;
  await assert.rejects(issueAccessProof(request(),principal,identity,body),{code:'FORBIDDEN'});
 }finally{await cleanup(identity,users);await identity.sql.end();}
});
test('owner retains original proof purposes and the new finance purpose without receiving delegated finance grants',async()=>{
 const identity=createLocalAuth('test'),users:Awaited<ReturnType<typeof actor>>[]=[];
 try{
  const owner=await actor(identity,'owner',[]);users.push(owner);await enroll(owner.browser,owner.password);
  for(const [action,subject_id] of [['company_policy.version','company-commercial'],['finance.reconcile',randomUUID()]]){
   const request=owner.browser.request('/api/v1/me/reauthentication-proofs',{password:owner.password,action,subject_id});request.headers.set('idempotency-key',randomUUID());
   assert.equal((await handleAccess(request,identity)).status,201);
  }
 }finally{await cleanup(identity,users);await identity.sql.end();}
});
