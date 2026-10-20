import assert from 'node:assert/strict';
import test from 'node:test';
import {fulfillmentCalendarFixture} from './fulfillment-calendar-fixture.ts';
import {resolvePolicy} from '../../src/modules/settings/policies.ts';
import {coveredOperationalDeadline,packingDeadline} from '../../src/modules/fulfillment/calendar.ts';



test('real versioned TEST-ONLY shipping calendar skips consecutive closures and explicit weekends without cutting off order intake',async()=>{
 const f=await fulfillmentCalendarFixture();try{
  const policy=await f.append(0);
  const early=await f.identity.sql.begin(tx=>packingDeadline(tx,f.warehouseId,f.at(0,'03:00:00.000')));
  const late=await f.identity.sql.begin(tx=>packingDeadline(tx,f.warehouseId,f.at(0,'23:59:59.999')));
  assert.equal(late.calendar_version_id,policy.id);assert.equal(late.actionable_at,f.at(0,'23:59:59.999'));
  assert.equal(early.packing_due_at,f.at(6,'15:00:00.000'));assert.equal(late.packing_due_at,early.packing_due_at);
  assert.equal(late.packing_local_date,f.localDate(6));
  const policyAtAnchor=await resolvePolicy(f.identity.sql,'warehouse_calendar',f.warehouseId,new Date(late.actionable_at));const h1=await f.identity.sql.begin(tx=>coveredOperationalDeadline(tx,f.warehouseId,policyAtAnchor,late.actionable_at,1));assert.equal(h1.due_at,f.at(5,'15:00:00.000'));
  const holidayOrder=await f.identity.sql.begin(tx=>packingDeadline(tx,f.warehouseId,f.at(3,'12:00:00.000')));assert.equal(holidayOrder.packing_due_at,late.packing_due_at);
 }finally{await f.close();}
});

test('a year-end H+2 freezes both actually published yearly calendars and skips the next-year holiday',async()=>{
 const f=await fulfillmentCalendarFixture(new Date().getUTCFullYear());try{
  const first=await f.append(0),anchor=new Date(`${f.year}-12-31T12:00:00.000+07:00`).toISOString();
  await assert.rejects(f.identity.sql.begin(tx=>packingDeadline(tx,f.warehouseId,anchor)),{code:'CALENDAR_COVERAGE_MISSING'});
  const nextYear=f.year+1,start=new Date(`${nextYear}-01-01T00:00:00.000+07:00`).toISOString(),second=await f.append(1,{...f.values,year:nextYear,closed_dates:[`${nextYear}-01-01`]},start);
  const result=await f.identity.sql.begin(tx=>packingDeadline(tx,f.warehouseId,anchor));assert.equal(result.actionable_at,anchor);assert.deepEqual(result.calendar_coverage.map(c=>c.id),[first.id,second.id]);
  const day=new Date(`${nextYear}-01-02T00:00:00.000Z`);let eligible=0;
  while(eligible<2){if(day.getUTCDay()>0&&day.getUTCDay()<6)eligible++;if(eligible<2)day.setUTCDate(day.getUTCDate()+1);}
  assert.equal(result.packing_due_at,new Date(`${day.toISOString().slice(0,10)}T15:00:00.000+07:00`).toISOString());
 }finally{await f.close();}
});

test('warehouse-local midnight changes the original H+ date precisely and later calendar versions preserve an existing snapshot',async()=>{
 const f=await fulfillmentCalendarFixture();try{
  const first=await f.append(0),midnight=f.at(0),before=new Date(Date.parse(midnight)-1).toISOString();
  const prior=await f.identity.sql.begin(tx=>packingDeadline(tx,f.warehouseId,before));assert.equal(prior.packing_due_at,f.at(5,'15:00:00.000'));
  const original=await f.identity.sql.begin(tx=>packingDeadline(tx,f.warehouseId,midnight));assert.equal(original.packing_due_at,f.at(6,'15:00:00.000'));
  const frozenPolicy=await resolvePolicy(f.identity.sql,'warehouse_calendar',f.warehouseId,new Date(first.effective_at));
  const second=await f.append(1,{...f.values,cutoff_local:'14:00',closed_dates:[...f.values.closed_dates,f.localDate(6)]});assert.notEqual(second.id,first.id);
  const current=await f.identity.sql.begin(tx=>packingDeadline(tx,f.warehouseId,midnight));assert.equal(current.calendar_version_id,second.id);assert.equal(current.packing_due_at,f.at(7,'14:00:00.000'));
  const retained=await f.identity.sql.begin(tx=>coveredOperationalDeadline(tx,f.warehouseId,frozenPolicy,original.actionable_at,2));assert.equal(retained.due_at,original.packing_due_at);assert.equal(original.calendar_version_id,first.id);
 }finally{await f.close();}
});

test('missing calendar coverage never fabricates next-year deadlines and malformed original anchors fail before calculation',async()=>{
 const f=await fulfillmentCalendarFixture();try{
  await assert.rejects(f.identity.sql.begin(tx=>packingDeadline(tx,f.warehouseId,f.at(0))),{code:'POLICY_UNCONFIGURED'});
  await f.append(0);
  const last=new Date(`${f.year}-12-31T23:59:59.999+07:00`).toISOString();await assert.rejects(f.identity.sql.begin(tx=>packingDeadline(tx,f.warehouseId,last)),{code:'CALENDAR_COVERAGE_MISSING'});
  const outside=new Date(`${f.year+1}-02-01T00:00:00.000+07:00`).toISOString();await assert.rejects(f.identity.sql.begin(tx=>packingDeadline(tx,f.warehouseId,outside)),{code:'CALENDAR_COVERAGE_MISSING'});
  await assert.rejects(f.identity.sql.begin(tx=>packingDeadline(tx,f.warehouseId,`${f.year}-02-30T00:00:00.000Z`)),{code:'INVALID_INPUT'});
 }finally{await f.close();}
});
