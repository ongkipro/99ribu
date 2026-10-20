import assert from 'node:assert/strict';
import test from 'node:test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {getPrincipal,type Role} from '../../src/modules/access/policy.ts';
import {assertReturnInspection,assertReturnReview,canReadReturnWarehouse,returnAuthority} from '../../src/modules/returns/authority.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';

const code=(expected:string)=>(error:unknown)=>error instanceof Error&&'code' in error&&error.code===expected;

test('current owner, CS, warehouse and explicitly authorized finance have separate scoped return jobs',async()=>{
 const identity=createLocalAuth('test'),users:Awaited<ReturnType<typeof actor>>[]=[],warehouses:string[]=[];
 try{
  for(const name of ['SYNTHETIC return warehouse A','SYNTHETIC return warehouse B'])warehouses.push(String((await identity.sql`insert into app.warehouse (name,city) values (${name},'Malang') returning id`)[0].id));
  for(const role of ['owner','customer_service','warehouse','finance','ecommerce_admin'] as Role[]){
   const user=await actor(identity,role,[warehouses[0]]);users.push(user);await enroll(user.browser,user.password);
   if(role==='finance')await identity.sql`update app.role_grant set permissions=${['finance.refunds.read']} where user_id=${user.id}`;
   const principal=await getPrincipal(user.browser.request('/api/v1/me'),identity);
   if(role==='ecommerce_admin'){await assert.rejects(identity.sql.begin(tx=>returnAuthority(tx,principal)),{code:'FORBIDDEN'});continue;}
   const access=await identity.sql.begin(tx=>returnAuthority(tx,principal));
   assert.equal(canReadReturnWarehouse(access,warehouses[0]),true);
   assert.equal(canReadReturnWarehouse(access,warehouses[1]),role==='owner'||role==='finance');
   assert.equal(access.finance,role==='owner'||role==='finance');
   if(role==='owner'){assertReturnReview(access,warehouses);assertReturnInspection(access,warehouses);}
   else if(role==='customer_service'){
    assertReturnReview(access,[warehouses[0]]);assert.throws(()=>assertReturnReview(access,warehouses),code('NOT_FOUND'));assert.throws(()=>assertReturnInspection(access,[warehouses[0]]),code('FORBIDDEN'));
   }else if(role==='warehouse'){
    assertReturnInspection(access,[warehouses[0]]);assert.throws(()=>assertReturnInspection(access,warehouses),code('NOT_FOUND'));assert.throws(()=>assertReturnReview(access,[warehouses[0]]),code('FORBIDDEN'));
   }else{
    assert.throws(()=>assertReturnReview(access,[warehouses[0]]),code('FORBIDDEN'));assert.throws(()=>assertReturnInspection(access,[warehouses[0]]),code('FORBIDDEN'));
   }
  }
 }finally{try{await cleanup(identity,users);for(const warehouse of warehouses)await identity.sql`update app.warehouse set active=false where id=${warehouse}`;}finally{await identity.sql.end();}}
});

test('return authority ignores cached roles, memberships and MFA after current revocation',async()=>{
 const identity=createLocalAuth('test'),users:Awaited<ReturnType<typeof actor>>[]=[],warehouses:string[]=[];
 try{
  const [warehouse]=await identity.sql`insert into app.warehouse (name,city) values ('SYNTHETIC revoked return scope','Malang') returning id`;warehouses.push(String(warehouse.id));
  const user=await actor(identity,'warehouse',warehouses);users.push(user);await enroll(user.browser,user.password);
  const principal=await getPrincipal(user.browser.request('/api/v1/me'),identity);
  assertReturnInspection(await identity.sql.begin(tx=>returnAuthority(tx,principal)),warehouses);
  await identity.sql`delete from app.warehouse_membership where user_id=${user.id}`;
  const revoked=await identity.sql.begin(tx=>returnAuthority(tx,principal));assert.equal(canReadReturnWarehouse(revoked,warehouses[0]),false);assert.throws(()=>assertReturnInspection(revoked,warehouses),code('NOT_FOUND'));
  await identity.sql`update app.role_grant set roles=${['finance']},permissions=${[]} where user_id=${user.id}`;
  await assert.rejects(identity.sql.begin(tx=>returnAuthority(tx,principal)),{code:'FORBIDDEN'});
  await identity.sql`update app.role_grant set permissions=${['finance.refunds.read']} where user_id=${user.id}`;
  assert.equal((await identity.sql.begin(tx=>returnAuthority(tx,principal))).finance,true);
  await identity.sql`delete from app.mfa_session where session_id=${principal.sessionId}`;
  await assert.rejects(identity.sql.begin(tx=>returnAuthority(tx,principal)),{code:'FORBIDDEN'});
 }finally{try{await cleanup(identity,users);for(const warehouse of warehouses)await identity.sql`update app.warehouse set active=false where id=${warehouse}`;}finally{await identity.sql.end();}}
});
