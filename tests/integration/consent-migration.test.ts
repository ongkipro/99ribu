import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {bootstrapVisitor,readVisitor,visitorCookieName,visitorToken} from '../../src/modules/consent/context.ts';
import {recordConsent} from '../../src/modules/consent/receipts.ts';
import {parseChoices} from '../../src/modules/consent/choices.ts';

test('unapplied signal candidate parses and enforces actual visitor nonce/consent revision without committing authority',async()=>{
 const identity=createLocalAuth('test'),owner=connectDatabase('test','owner'),rollback=new Error('Expected consent candidate rollback');let stage='ddl',statementIndex=0;
 try{await assert.rejects(owner.sql.begin(async tx=>{
  const [installed]=await tx`select to_regclass('app.visitor_session') is not null installed`;
  if(!installed.installed) for(const statement of readFileSync('migrations/0017_canonical_signals.sql','utf8').split('--> statement-breakpoint')) if(statement.trim()){statementIndex++;await tx.unsafe(statement);}
  stage='visitor bootstrap';
  const [tables]=await tx`select count(*)::int n from pg_tables where schemaname='app' and tablename in ('visitor_session','consent_receipt','order_ad_attribution','commerce_event','purchase_allocation','ad_event_outbox','ad_delivery_attempt','local_ad_sink','funnel_intake','visitor_bootstrap_request')`;assert.equal(tables.n,10);
  const name=await visitorCookieName(identity),request=new Request('http://127.0.0.1:3099/api/v1/visitor-sessions'),key=randomUUID(),body={client_request_id:randomUUID()};
  const first=await bootstrapVisitor(tx,request,identity,null,key,body);assert.equal(first.bootstrap,true);assert.equal(first.visitor.status,'preparing');
  const token=await visitorToken(identity,first.visitor),owned=new Request(request.url,{headers:{cookie:`${name}=${first.visitor.id}.${token}`}});
  await assert.rejects(readVisitor(tx,owned,identity,null),{code:'VISITOR_CONTEXT_REQUIRED'});
  stage='visitor activation';const active=await bootstrapVisitor(tx,owned,identity,null,key,body);assert.equal(active.bootstrap,false);assert.equal(active.visitor.id,first.visitor.id);assert.equal(active.visitor.status,'active');
  assert.equal((await readVisitor(tx,owned,identity,null))?.id,active.visitor.id);
  const additionalKey=randomUUID(),additionalBody={client_request_id:randomUUID()},recovered=await bootstrapVisitor(tx,owned,identity,null,additionalKey,additionalBody);assert.equal(recovered.visitor.id,active.visitor.id);assert.equal(new Date(recovered.visitor.expires_at).toISOString(),new Date(active.visitor.expires_at).toISOString());
  await assert.rejects(bootstrapVisitor(tx,owned,identity,null,additionalKey,{client_request_id:randomUUID()}),{code:'IDEMPOTENCY_CONFLICT'});
  const choices=parseChoices({analytics:'granted',advertising_measurement:'granted',marketing:'denied',meta:'granted',google:'denied',tiktok:'denied',google_signals:{ad_storage:'denied',analytics_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'}});
  stage='consent grant';const granted=await recordConsent(tx,active.visitor,randomUUID(),{expected_version:0,policy_version:'local-privacy-v1',choices});assert.equal(granted.version,1);
  const current=await readVisitor(tx,owned,identity,null);assert.ok(current);
  const denied=await recordConsent(tx,current,randomUUID(),{expected_version:1,policy_version:'local-privacy-v1',choices:{...choices,advertising_measurement:'denied'}});assert.equal(denied.version,2);
  await assert.rejects(tx.savepoint(t=>t`update app.consent_receipt set choices='{}'::jsonb where id=${granted.id}`),{code:'23514'});
  await assert.rejects(tx.savepoint(t=>t`update app.visitor_session set principal_scope='user:forged:forged' where id=${active.visitor.id}`),{code:'23514'});
  await assert.rejects(tx.savepoint(t=>t`insert into app.consent_receipt (visitor_id,revision,key,request_hash,policy_version,choices,effective_at,expires_at) values (${active.visitor.id},3,${randomUUID()},repeat('a',64),'local-privacy-v1','{}'::jsonb,clock_timestamp(),clock_timestamp()+interval '1 hour')`),{code:'23514'});
  stage='deferred seals';await tx`set constraints all immediate`;throw rollback;
 }),error=>{if(error===rollback)return true;const safe=error as {code?:unknown;constraint_name?:unknown;position?:unknown};assert.fail(`Candidate consent probe failed at ${stage}/${statementIndex} (${String(safe.code??'domain')}/${String(safe.constraint_name??'constraint')}/${String(safe.position??'position')})`);});
 }finally{await owner.sql.end();await identity.sql.end();}
});
