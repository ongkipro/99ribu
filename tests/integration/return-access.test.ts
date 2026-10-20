import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {consumeAccessProof,issueAccessProof} from '../../src/modules/access/grants.ts';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';

const read='finance.refunds.read',write='finance.refunds.write';

test('refund proofs require both refund grants and preserve subject, purpose, once-only recovery, password and rate boundaries',async()=>{
 const identity=createLocalAuth('test'),users:Awaited<ReturnType<typeof actor>>[]=[];
 try{
  const finance=await actor(identity,'finance',[]);users.push(finance);await enroll(finance.browser,finance.password);
  const subject=randomUUID(),body={password:finance.password,action:'finance.refund',subject_id:subject.toUpperCase()},key=randomUUID();
  const request=(value:Record<string,unknown>=body,selectedKey=key)=>{const request=finance.browser.request('/api/v1/me/reauthentication-proofs',value);request.headers.set('idempotency-key',selectedKey);return request;};
  for(const permissions of [[],[read],[write],['finance.reconciliation.read','finance.reconciliation.write']]){
   await identity.sql`update app.role_grant set permissions=${permissions} where user_id=${finance.id}`;
   assert.equal((await handleAccess(request(),identity)).status,403);
  }
  await identity.sql`update app.role_grant set permissions=${[read,write]} where user_id=${finance.id}`;
  for(const action of ['staff_roles.replace','company_policy.version','warehouse_calendar.version','catalog_publication.exception','finance.reconcile'])assert.equal((await handleAccess(request({...body,action}),identity)).status,403);
  assert.equal((await handleAccess(request({...body,subject_id:'not-a-subject'}),identity)).status,400);
  const foreign=request();foreign.headers.set('origin','https://foreign.example');assert.equal((await handleAccess(foreign,identity)).status,403);
  const bearer=request();bearer.headers.set('authorization','Bearer SYNTHETIC-UNSUPPORTED');assert.equal((await handleAccess(bearer,identity)).status,401);
  const first=await handleAccess(request(),identity);assert.equal(first.status,201);assert.equal(first.headers.get('cache-control'),'no-store');const initial=await first.json();
  const retry=await handleAccess(request({...body,subject_id:subject}),identity);assert.equal(retry.status,201);const repeated=await retry.json();assert.ok(initial.proof===repeated.proof);assert.equal(initial.expires_at,repeated.expires_at);
  await identity.sql`update app.role_grant set permissions=${[read,write,'finance.reconciliation.read','finance.reconciliation.write']} where user_id=${finance.id}`;
  assert.equal((await handleAccess(request({...body,action:'finance.reconcile'}),identity)).status,409);
  assert.equal((await handleAccess(request({...body,password:'SYNTHETIC-WRONG-PASSWORD'},randomUUID()),identity)).status,403);
  const principal=await getPrincipal(finance.browser.request('/api/v1/me'),identity);
  await assert.rejects(identity.sql.begin(tx=>consumeAccessProof(tx,principal,'finance.refund',randomUUID(),initial.proof)),{code:'REAUTHENTICATION_REQUIRED'});
  await identity.sql.begin(tx=>consumeAccessProof(tx,principal,'finance.refund',subject,initial.proof));
  const consumed=await handleAccess(request(),identity);assert.equal(consumed.status,409);assert.equal((await consumed.json()).code,'PROOF_NO_LONGER_VALID');
  assert.equal((await handleAccess(request(body,randomUUID()),identity)).status,429);
 }finally{await cleanup(identity,users);await identity.sql.end();}
});

test('refund proof recovery rereads revoked grants and MFA/session state despite a cached original principal',async()=>{
 const identity=createLocalAuth('test'),users:Awaited<ReturnType<typeof actor>>[]=[];
 try{
  const finance=await actor(identity,'finance',[]);users.push(finance);await enroll(finance.browser,finance.password);
  await identity.sql`update app.role_grant set permissions=${[read,write]} where user_id=${finance.id}`;
  const principal=await getPrincipal(finance.browser.request('/api/v1/me'),identity),body={password:finance.password,action:'finance.refund',subject_id:randomUUID()},key=randomUUID();
  const request=()=>{const request=finance.browser.request('/api/v1/me/reauthentication-proofs',body);request.headers.set('idempotency-key',key);return request;};
  const issued=await issueAccessProof(request(),principal,identity,body);assert.ok(issued.proof.length>0);
  await identity.sql`update app.role_grant set permissions=${[read]},revision=revision+1 where user_id=${finance.id}`;
  await assert.rejects(issueAccessProof(request(),principal,identity,body),{code:'FORBIDDEN'});
  await identity.sql`update app.role_grant set permissions=${[read,write]},revision=revision+1 where user_id=${finance.id}`;
  await identity.sql`update app.mfa_session set verified_at=clock_timestamp()-interval '6 minutes' where session_id=${principal.sessionId}`;
  await assert.rejects(issueAccessProof(request(),principal,identity,body),{code:'FORBIDDEN'});
  await identity.sql`update app.mfa_session set verified_at=clock_timestamp() where session_id=${principal.sessionId}`;
  await identity.sql`update app.auth_session set expires_at=clock_timestamp()-interval '1 second' where id=${principal.sessionId}`;
  await assert.rejects(issueAccessProof(request(),principal,identity,body),{code:'REAUTHENTICATION_REQUIRED'});
 }finally{await cleanup(identity,users);await identity.sql.end();}
});

test('owner keeps refund, reconciliation and existing policy proof inheritance without delegated finance grants',async()=>{
 const identity=createLocalAuth('test'),users:Awaited<ReturnType<typeof actor>>[]=[];
 try{
  const owner=await actor(identity,'owner',[]);users.push(owner);await enroll(owner.browser,owner.password);
  for(const [action,subject_id] of [['finance.refund',randomUUID()],['finance.reconcile',randomUUID()],['company_policy.version','company-commercial']]){
   const request=owner.browser.request('/api/v1/me/reauthentication-proofs',{password:owner.password,action,subject_id});request.headers.set('idempotency-key',randomUUID());
   assert.equal((await handleAccess(request,identity)).status,201);
  }
 }finally{await cleanup(identity,users);await identity.sql.end();}
});
