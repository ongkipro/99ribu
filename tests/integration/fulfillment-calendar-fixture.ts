import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';

export async function fulfillmentCalendarFixture(selectedYear=new Date().getUTCFullYear()+1){
 const identity=createLocalAuth('test'),warehouseId=randomUUID(),owner=await actor(identity,'owner',[]);
 await enroll(owner.browser,owner.password);
 await identity.sql`insert into app.warehouse (id,name,city) values (${warehouseId},'SYNTHETIC fulfillment calendar','Malang')`;
 const year=selectedYear;
 const start=new Date(Date.UTC(year,1,1));start.setUTCDate(1+(5-start.getUTCDay()+7)%7);
 const localDate=(offset:number)=>new Date(start.getTime()+offset*86400000).toISOString().slice(0,10);
 const at=(offset:number,time='00:00:00.000')=>new Date(`${localDate(offset)}T${time}+07:00`).toISOString();
 const values={timezone:'Asia/Jakarta',year,working_weekdays:[1,2,3,4,5],cutoff_local:'15:00',closed_dates:[localDate(3),localDate(4)],source:'TEST-ONLY',approval:'test_only'};
 const append=async(version:number,config=values,effectiveAt:string|null=null)=>{
  const request=owner.browser.request('/api/v1/me/reauthentication-proofs',{password:owner.password,action:'warehouse_calendar.version',subject_id:warehouseId});request.headers.set('idempotency-key',randomUUID());
  const proof=await handleAccess(request,identity);assert.equal(proof.status,201);
  const write=owner.browser.request('/api/v1/admin/policy-versions',{kind:'warehouse_calendar',warehouse_id:warehouseId,effective_at:effectiveAt,values:config,expected_version:version,reason:'SYNTHETIC explicit fulfillment calendar coverage',reauthentication_proof:(await proof.json()).proof});write.headers.set('idempotency-key',randomUUID());
  const response=await handleAccess(write,identity);assert.equal(response.status,201);return response.json();
 };
 const close=async()=>{await cleanup(identity,[owner]);await identity.sql`update app.warehouse set active=false where id=${warehouseId}`;await identity.sql.end();};
 return {identity,warehouseId,year,localDate,at,values,append,close};
}
