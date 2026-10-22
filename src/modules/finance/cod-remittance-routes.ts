import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem,readBody} from '../access/http.ts';
import {AccessError,getPrincipal,hasPermission} from '../access/policy.ts';
import {listCodRemittances,listCollectibleParcels,readCodRemittance,recordCodRemittance} from './cod-remittance.ts';

export async function handleCodRemittances(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);if(['authorization','x-cart-token','x-order-token'].some(name=>request.headers.has(name)))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  const url=new URL(request.url);if(request.method!=='GET'&&url.search)throw new AccessError(400,'INVALID_INPUT');
  const principal=await getPrincipal(request,identity);
  if(!hasPermission(principal,'finance.reconciliation.read')||request.method==='POST'&&!hasPermission(principal,'finance.reconciliation.write'))throw new AccessError(403,'FORBIDDEN');
  const detail=/^\/api\/v1\/admin\/cod-remittances\/([^/]+)$/.exec(url.pathname);
  if(request.method==='GET'){
   if(url.pathname==='/api/v1/admin/cod-remittances')return privateJson(await listCodRemittances(identity,principal,url));
   if(url.pathname==='/api/v1/admin/cod-collectible-parcels')return privateJson(await listCollectibleParcels(identity,principal,url));
   if(detail){if(url.search)throw new AccessError(400,'INVALID_INPUT');return privateJson(await readCodRemittance(identity,principal,detail[1]));}
  }
  if(request.method==='POST'&&url.pathname==='/api/v1/admin/cod-remittances')return privateJson(await recordCodRemittance(request,identity,principal,await readBody(request,32768)),201);
  throw new AccessError(404,'NOT_FOUND');
 }catch(error){
  if(error&&typeof error==='object'&&'code' in error&&['23505','23514','40001','40P01'].includes(String(error.code)))return problem(new AccessError(409,'COD_REMITTANCE_CONFLICT'));
  return problem(error);
 }
}
