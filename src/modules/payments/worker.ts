import type {Sql} from 'postgres';
import type {Claim,JobAdapter} from '../../jobs/leases.ts';
import {id,object} from '../catalog/validation.ts';
import {advanceAttempt,lockPaymentOrder,type AttemptRow} from './attempts.ts';
import {type AutolarisClient,autolarisClientFor,dispatchAutolarisPayment} from './autolaris.ts';
import {createLocalOperation,ingestProviderEvent,simulateCollection} from './local.ts';

export function paymentAdapter(sql:Sql,target:'local'|'test',faults:ReadonlyMap<string,'before-commit'|'creation-commit-lost-ack'|'paid-commit-lost-ack'>=new Map(),autolaris?:AutolarisClient):JobAdapter{
 const resolve=async(claim:Claim,reconciliation:boolean,signal?:AbortSignal)=>{
  const body=object(claim.payload,['attemptId']),attemptId=id(body.attemptId);
  const [registered]=await sql`select id,method_id from app.payment_attempt where id=${attemptId} and creation_job_id=${claim.id}`;
  if(!registered) return {status:'failed' as const,code:'INVALID_PAYLOAD' as const};
  // DEC-008 seam: AutoLaris attempts replay the persisted reff_id on reconciliation.
  if(registered.method_id==='autolaris') return dispatchAutolarisPayment(sql,target,attemptId,autolaris??autolarisClientFor(target,sql),signal);
  const created=await createLocalOperation(sql,target,attemptId,reconciliation,!reconciliation&&faults.get(attemptId)==='before-commit');
  if(!reconciliation&&faults.get(attemptId)==='creation-commit-lost-ack') throw new Error('Simulated acknowledgement loss after provider intent creation');
  if(!reconciliation&&faults.get(attemptId)==='paid-commit-lost-ack'){
   await simulateCollection(sql,target,attemptId);throw new Error('Simulated acknowledgement loss after provider collection');
  }
  await sql.begin(async tx=>{
   const [before]=await tx<AttemptRow[]>`select * from app.payment_attempt where id=${attemptId}`;
   await lockPaymentOrder(tx,before.order_id);const [attempt]=await tx<AttemptRow[]>`select * from app.payment_attempt where id=${attemptId} for update`;
   if(!attempt.provider_operation_id&&['pending','unknown'].includes(attempt.status)) await advanceAttempt(tx,attempt,{status:attempt.status,source_type:'provider_link',source_id:created.operation_id,provider_operation_id:created.operation_id,occurred_at:new Date(attempt.created_at).toISOString()});
  });
  for(const event of created.events) await ingestProviderEvent(sql,event);
  return {status:'succeeded' as const,receipt:{operation_id:created.operation_id}};
 };
 return {dispatch:(claim,signal)=>resolve(claim,false,signal),reconcile:(claim,signal)=>resolve(claim,true,signal)};
}
