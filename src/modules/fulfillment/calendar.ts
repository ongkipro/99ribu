import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {id,integer} from '../catalog/validation.ts';
import {instant} from '../promotions/configuration.ts';
import {resolvePolicy} from '../settings/policies.ts';

export type ShippingCalendar=Extract<Awaited<ReturnType<typeof resolvePolicy>>['values'],{timezone:string}>;
export type CalendarPolicy=Awaited<ReturnType<typeof resolvePolicy>>;

// Trusted server consumer of the validated, frozen S13 policy values. The
// cutoff is the selected operational deadline time, never an intake cutoff.
export async function coveredOperationalDeadline(tx:TransactionSql,warehouseId:string,policy:CalendarPolicy,anchor:string,days:1|2){
 const original=instant(anchor),needed=integer(days,1,2),selected=id(warehouseId);let current=policy;
 if(current.values.timezone===undefined)throw new AccessError(503,'POLICY_INVALID');
 const timezone=current.values.timezone,[local]=await tx`select (${original}::timestamptz at time zone ${timezone})::date::text date`;
 const anchorYear=Number(local.date.slice(0,4));
 if(current.warehouse_id!==selected||current.values.year!==anchorYear)throw new AccessError(409,'CALENDAR_COVERAGE_MISSING');
 const coverage:{id:string;values:ShippingCalendar}[]=[],dates:{local_date:string;due_at:string}[]=[];
 while(dates.length<needed){
  const calendar:CalendarPolicy['values']=current.values;if(calendar.timezone===undefined||calendar.timezone!==timezone||calendar.source!=='TEST-ONLY'||calendar.approval!=='test_only')throw new AccessError(409,'CALENDAR_COVERAGE_MISSING');
  coverage.push({id:current.id,values:calendar});
  const rows=await tx`with dates as (select make_date(${calendar.year},1,1)+n date from generate_series(0,make_date(${calendar.year+1},1,1)-make_date(${calendar.year},1,1)-1) n)
   select date::text local_date,((date+${calendar.cutoff_local}::time) at time zone ${timezone}) due_at from dates
   where date>${local.date}::date and extract(dow from date)::int=any(${calendar.working_weekdays}::int[]) and not date::text=any(${calendar.closed_dates}::text[])
   order by date limit ${needed-dates.length}`;
  dates.push(...rows.map(r=>({local_date:String(r.local_date),due_at:new Date(r.due_at).toISOString()})));
  if(dates.length===needed)break;
  const year:number=calendar.year+1;if(year>2100)throw new AccessError(409,'CALENDAR_COVERAGE_MISSING');
  const [start]=await tx`select (make_date(${year},1,1)::timestamp at time zone ${timezone}) instant`;
  try{current=await resolvePolicy(tx,'warehouse_calendar',selected,new Date(start.instant));}
  catch(error){if(error instanceof AccessError&&error.code==='POLICY_UNCONFIGURED')throw new AccessError(409,'CALENDAR_COVERAGE_MISSING');throw error;}
  if(current.values.year!==year)throw new AccessError(409,'CALENDAR_COVERAGE_MISSING');
 }
 return {...dates[needed-1],coverage};
}

export async function packingDeadline(tx:TransactionSql,warehouseId:string,actionableAt:string,override?:CalendarPolicy){
 const selected=id(warehouseId),anchor=instant(actionableAt);
 const policy=override??await resolvePolicy(tx,'warehouse_calendar',selected,new Date(anchor));
 if(policy.values.timezone===undefined)throw new AccessError(503,'POLICY_INVALID');
 const deadline=await coveredOperationalDeadline(tx,selected,policy,anchor,2);
 return {warehouse_id:selected,actionable_at:anchor,calendar_version_id:policy.id as string,
  calendar:policy.values,calendar_coverage:deadline.coverage,packing_due_at:deadline.due_at,packing_local_date:deadline.local_date};
}
