import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem,readBody,requestOrigin} from '../access/http.ts';
import {AccessError,getPrincipal,hasPermission} from '../access/policy.ts';
import {LIMITS,rateLimit} from '../access/rate-limit.ts';
import {recordAutolarisCallback} from '../payments/autolaris.ts';
import {confirmAutolarisPayment,listAutolarisPayments} from './autolaris-payments.ts';

// DEC-008 (2) AutoLaris payments queue (finance) and the raw callback receiver.
export async function handleAutolarisPayments(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);if(['authorization','x-cart-token','x-order-token'].some(name=>request.headers.has(name)))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  const url=new URL(request.url);if(request.method!=='GET'&&url.search)throw new AccessError(400,'INVALID_INPUT');
  const principal=await getPrincipal(request,identity);
  if(!hasPermission(principal,'finance.reconciliation.read')||request.method==='POST'&&!hasPermission(principal,'finance.reconciliation.write'))throw new AccessError(403,'FORBIDDEN');
  const confirm=/^\/api\/v1\/admin\/autolaris-payments\/([^/]+)\/confirmations$/.exec(url.pathname);
  if(request.method==='GET'&&url.pathname==='/api/v1/admin/autolaris-payments')return privateJson(await listAutolarisPayments(identity,principal,url));
  if(request.method==='POST'&&confirm)return privateJson(await confirmAutolarisPayment(request,identity,principal,confirm[1],await readBody(request)),201);
  throw new AccessError(404,'NOT_FOUND');
 }catch(error){
  if(error&&typeof error==='object'&&'code' in error&&['23505','23514','40001','40P01'].includes(String(error.code)))return problem(new AccessError(409,'AUTOLARIS_CONFIRMATION_CONFLICT'));
  return problem(error);
 }
}
// Unauthenticated by necessity (provider-originated, contract unpublished): stores
// the raw body for discovery only and never reads or changes payment state.
export async function handleAutolarisCallback(request:Request,identity:LocalAuth){
 try{
  if(request.method!=='POST'||new URL(request.url).search)throw new AccessError(404,'NOT_FOUND');
  if(!requestOrigin(request))throw new AccessError(403,'INVALID_ORIGIN');
  await rateLimit(identity.sql,'autolaris.callback',LIMITS.autolarisCallbackGlobal);
  const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(reader)while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>16384){await reader.cancel();throw new AccessError(413,'BODY_TOO_LARGE');}chunks.push(chunk.value);}
  const body=Buffer.concat(chunks).toString('utf8');if(!body.isWellFormed()||body.includes('\0'))throw new AccessError(400,'INVALID_INPUT');
  await recordAutolarisCallback(identity.sql,request.headers.get('content-type')??'',body);
  return privateJson({received:true},202);
 }catch(error){return problem(error);}
}
