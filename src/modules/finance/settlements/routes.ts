import type {LocalAuth} from '../../access/auth.ts';
import {assertOrigin,privateJson,problem,readBody} from '../../access/http.ts';
import {AccessError,getPrincipal,hasPermission} from '../../access/policy.ts';
import {reconcileSettlement} from './commands.ts';
import {listReconciliations,readReconciliation,readReconciliationMatch,readSettlementSource} from './reads.ts';

export async function handleSettlements(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);
  if(['authorization','x-cart-token','x-order-token'].some(name=>request.headers.has(name)))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  const url=new URL(request.url),root='/api/v1/admin/reconciliation';
  if(request.method!=='GET'&&url.search)throw new AccessError(400,'INVALID_INPUT');
  const principal=await getPrincipal(request,identity);
  if(!hasPermission(principal,'finance.reconciliation.read')||request.method==='POST'&&!hasPermission(principal,'finance.reconciliation.write'))throw new AccessError(403,'FORBIDDEN');
  const detail=/^\/api\/v1\/admin\/reconciliation\/([^/]+)$/.exec(url.pathname),decision=/^\/api\/v1\/admin\/reconciliation\/([^/]+)\/decisions$/.exec(url.pathname),match=/^\/api\/v1\/admin\/reconciliation\/([^/]+)\/matches\/([^/]+)$/.exec(url.pathname),source=/^\/api\/v1\/admin\/settlements\/([^/]+)$/.exec(url.pathname);
  if(request.method==='GET'){
   if(url.pathname===root)return privateJson(await listReconciliations(identity,principal,url));
   if(detail)return privateJson(await readReconciliation(identity,principal,detail[1],url));
   if(source)return privateJson(await readSettlementSource(identity,principal,source[1],url));
   if(match){if(url.search)throw new AccessError(400,'INVALID_INPUT');return privateJson(await readReconciliationMatch(identity,principal,match[1],match[2]));}
  }
  if(request.method==='POST'&&decision)return privateJson(await reconcileSettlement(request,identity,principal,decision[1],await readBody(request,32768)),201);
  throw new AccessError(404,'NOT_FOUND');
 }catch(error){
  if(error&&typeof error==='object'&&'code' in error&&['23505','23514','40001','40P01'].includes(String(error.code)))return problem(new AccessError(409,'SETTLEMENT_CONFLICT'));
  return problem(error);
 }
}
