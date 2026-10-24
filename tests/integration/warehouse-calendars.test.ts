import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {packingDeadline} from '../../src/modules/fulfillment/calendar.ts';
import {handleWarehouseCalendars} from '../../src/modules/settings/calendars.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor,fulfillmentFixture} from './fulfillment-fixture.ts';

type Row={warehouse_id:string;origin:boolean;state:string;scheduled:boolean;latest_version:number;local_year:number;current:{version:number;values:{year:number;working_weekdays:number[];source:string}}|null};

// S101: owner calendar coverage and the audited bulk default for origin warehouses that have no
// current calendar, so resi deadlines compute. Uses the fixture namespace's own warehouses only.
test('owner applies one default calendar to its uncovered origin warehouses with one proof, all or nothing, audited',{timeout:120000},async()=>{
 const f=await fulfillmentFixture('cod',{calendars:false}),sql=f.identity.sql,users:Awaited<ReturnType<typeof actor>>[]=[];
 try{
  const warehouses=(await sql`select warehouse_id from app.local_fixture_warehouse where namespace=${f.namespace} order by warehouse_id`).map(row=>String(row.warehouse_id));
  assert.ok(warehouses.length>=2);
  const call=async(browser:typeof f.owner.browser,path:string,body?:Record<string,unknown>,key=randomUUID())=>{
   const request=browser.request(path,body);if(body)request.headers.set('idempotency-key',key);
   const response=await handleWarehouseCalendars(request,f.identity);return {status:response.status,payload:await response.json(),headers:response.headers};
  };
  const proof=async(subject='origin-warehouses',action='warehouse_calendar.default_apply')=>{
   const request=f.owner.browser.request('/api/v1/me/reauthentication-proofs',{password:f.owner.password,action,subject_id:subject});request.headers.set('idempotency-key',randomUUID());
   const response=await handleAccess(request,f.identity);assert.equal(response.status,201);return (await response.json()).proof as string;
  };
  const coverage=async()=>{const listed=await call(f.owner.browser,'/api/v1/admin/warehouse-calendars');assert.equal(listed.status,200);assert.equal(listed.headers.get('cache-control'),'no-store');return (listed.payload.data as Row[]).filter(row=>warehouses.includes(row.warehouse_id));};
  const before=await coverage();assert.equal(before.length,warehouses.length);
  const origins=before.filter(row=>row.origin);assert.ok(origins.length>=1,'the fixture publishes offers from its warehouses');
  for(const row of origins){assert.equal(row.state,'missing');assert.equal(row.current,null);}
  const ids=origins.map(row=>row.warehouse_id),values={working_weekdays:[1,2,3,4,5,6],cutoff_local:'15:00',closed_dates:[]};
  const body=(reauthentication_proof:string,extra:Record<string,unknown>={})=>({warehouse_ids:ids,values,reason:'SYNTHETIC default calendar for origin warehouses',reauthentication_proof,...extra});

  // Before: a parcel of this warehouse cannot get a packing deadline.
  await assert.rejects(sql.begin(tx=>packingDeadline(tx,ids[0],new Date().toISOString())),{code:'POLICY_UNCONFIGURED'});

  // Non-owner, bad input and a proof for another purpose are refused without writing versions.
  const finance=await actor(f.identity,'finance',[]);users.push(finance);await enroll(finance.browser,finance.password);
  assert.equal((await call(finance.browser,'/api/v1/admin/warehouse-calendars')).status,403);
  assert.equal((await call(finance.browser,'/api/v1/admin/warehouse-calendars/default-applications',body('x'))).status,403);
  // DEC-018 Q2: owner only, even for the role that manages pickup profiles next to this panel.
  const ecommerce=await actor(f.identity,'ecommerce_admin',[]);users.push(ecommerce);await enroll(ecommerce.browser,ecommerce.password);
  assert.equal((await call(ecommerce.browser,'/api/v1/admin/warehouse-calendars')).status,403);
  assert.equal((await call(ecommerce.browser,'/api/v1/admin/warehouse-calendars/default-applications',body('x'))).status,403);
  assert.equal((await call(f.owner.browser,'/api/v1/admin/warehouse-calendars?x=1')).status,400);
  // Input refusals happen before the proof is consumed, so one proof serves them all (5 proofs/min per user).
  const spare=await proof();
  for(const bad of [{values:{...values,source:'PRODUCTION'}},{values:{...values,timezone:'UTC'}},{warehouse_ids:[]},{warehouse_ids:[ids[0],ids[0]]},{values:{...values,closed_dates:['1999-01-01']}}])
   assert.equal((await call(f.owner.browser,'/api/v1/admin/warehouse-calendars/default-applications',body(spare,bad))).status,400,JSON.stringify(bad));
  const wrongPurpose=await call(f.owner.browser,'/api/v1/admin/warehouse-calendars/default-applications',body(await proof(ids[0],'warehouse_calendar.version')));
  assert.equal(wrongPurpose.status,403);assert.equal(wrongPurpose.payload.code,'REAUTHENTICATION_REQUIRED');
  assert.ok((await sql`select 1 from app.audit_event where actor_id=${f.principal.id} and action='warehouse_calendar.default_apply' and outcome='denied' and reason='REAUTHENTICATION_REQUIRED'`).length);
  assert.equal((await sql`select count(*)::int n from app.policy_head h join app.policy_version v on v.head_id=h.id where h.warehouse_id in ${sql(ids)}`)[0].n,0);
  // The proof subject is fixed: a proof cannot be issued for another subject.
  const badSubject=f.owner.browser.request('/api/v1/me/reauthentication-proofs',{password:f.owner.password,action:'warehouse_calendar.default_apply',subject_id:ids[0]});badSubject.headers.set('idempotency-key',randomUUID());
  assert.equal((await handleAccess(badSubject,f.identity)).status,400);

  const key=randomUUID(),applied=await call(f.owner.browser,'/api/v1/admin/warehouse-calendars/default-applications',body(spare),key);
  assert.equal(applied.status,201,JSON.stringify(applied.payload));assert.equal(applied.payload.applied.length,ids.length);
  // Same normalized intent under the same key (the proof is not part of it) returns the original result;
  // a changed intent under that key is an idempotency conflict.
  const replay=await call(f.owner.browser,'/api/v1/admin/warehouse-calendars/default-applications',body('unused'),key);
  assert.equal(replay.status,201);assert.deepEqual(replay.payload,applied.payload);
  const changed=await call(f.owner.browser,'/api/v1/admin/warehouse-calendars/default-applications',body('unused',{reason:'SYNTHETIC changed'}),key);
  assert.equal(changed.status,409);assert.equal(changed.payload.code,'IDEMPOTENCY_CONFLICT');

  const after=await coverage();
  for(const row of after.filter(r=>ids.includes(r.warehouse_id))){
   assert.equal(row.state,'current');assert.equal(row.current?.values.year,row.local_year);assert.equal(row.current?.values.source,'TEST-ONLY');assert.deepEqual(row.current?.values.working_weekdays,[1,2,3,4,5,6]);
  }
  const audit=await sql`select action,subject_id,details from app.audit_event where actor_id=${f.principal.id} and outcome='allowed' and action in ('warehouse_calendar.version','warehouse_calendar.default_apply') order by created_at`;
  assert.equal(audit.filter(row=>row.action==='warehouse_calendar.version'&&row.details.default_application===true).length,ids.length);
  const summary=audit.filter(row=>row.action==='warehouse_calendar.default_apply');assert.equal(summary.length,1);assert.equal(summary[0].details.warehouses,ids.length);
  const deadline=await sql.begin(tx=>packingDeadline(tx,ids[0],new Date().toISOString()));assert.ok(Date.parse(deadline.packing_due_at)>Date.now());

  // All or nothing: a covered warehouse refuses the whole batch.
  // Coverage and scope refusals come before proof consumption too.
  const again=await call(f.owner.browser,'/api/v1/admin/warehouse-calendars/default-applications',body('not-consumed'));
  assert.equal(again.status,409);assert.equal(again.payload.code,'CALENDAR_ALREADY_CURRENT');
  // A non-origin or unknown warehouse is refused.
  assert.equal((await call(f.owner.browser,'/api/v1/admin/warehouse-calendars/default-applications',body('not-consumed',{warehouse_ids:[randomUUID()]}))).payload.code,'INVALID_WAREHOUSE_SCOPE');
 }finally{for(const user of users)await closeFulfillmentActor(f.identity,user);await f.close();}
});
