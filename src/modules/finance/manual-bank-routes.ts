import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem,readBody} from '../access/http.ts';
import {AccessError,getPrincipal,hasPermission} from '../access/policy.ts';
import {confirmManualTransfer,listManualTransfers} from './manual-bank.ts';

// DEC-008 manual bank transfer reconciliation queue (finance).
export async function handleManualTransfers(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);if(['authorization','x-cart-token','x-order-token'].some(name=>request.headers.has(name)))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  const url=new URL(request.url);if(request.method!=='GET'&&url.search)throw new AccessError(400,'INVALID_INPUT');
  const principal=await getPrincipal(request,identity);
  if(!hasPermission(principal,'finance.reconciliation.read')||request.method==='POST'&&!hasPermission(principal,'finance.reconciliation.write'))throw new AccessError(403,'FORBIDDEN');
  const confirm=/^\/api\/v1\/admin\/manual-transfers\/([^/]+)\/confirmations$/.exec(url.pathname);
  if(request.method==='GET'&&url.pathname==='/api/v1/admin/manual-transfers')return privateJson(await listManualTransfers(identity,principal,url));
  if(request.method==='POST'&&confirm)return privateJson(await confirmManualTransfer(request,identity,principal,confirm[1],await readBody(request)),201);
  throw new AccessError(404,'NOT_FOUND');
 }catch(error){
  // A concurrent confirmation that lost the race on the same bank reference gets the specific code.
  if(error&&typeof error==='object'&&'code' in error&&String(error.code)==='23505'&&(error as {constraint_name?:string}).constraint_name==='manual_bank_reference_pk')return problem(new AccessError(409,'BANK_REFERENCE_ALREADY_USED'));
  if(error&&typeof error==='object'&&'code' in error&&['23505','23514','40001','40P01'].includes(String(error.code)))return problem(new AccessError(409,'MANUAL_TRANSFER_CONFLICT'));
  return problem(error);
 }
}
