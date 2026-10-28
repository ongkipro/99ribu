import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem,readBody} from '../access/http.ts';
import {AccessError,getPrincipal} from '../access/policy.ts';
import {invalid} from '../catalog/validation.ts';
import {appendAffiliateRate} from './rates.ts';
export {handleAdminAffiliates} from './admin.ts';
export async function handleAffiliateRates(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);
  if(['authorization','x-cart-token','x-order-token'].some(name=>request.headers.has(name)))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  const url=new URL(request.url);if(url.search)throw invalid();
  const route=/^\/api\/v1\/admin\/affiliates\/([^/]+)\/rates$/.exec(url.pathname);
  if(!route||request.method!=='POST')throw new AccessError(404,'NOT_FOUND');
  const principal=await getPrincipal(request,identity);
  return privateJson(await appendAffiliateRate(request,identity,principal,route[1],await readBody(request)),201);
 }catch(error){
  if(error&&typeof error==='object'&&'code' in error&&['23505','23514','40001','40P01'].includes(String(error.code)))return problem(new AccessError(409,'AFFILIATE_RATE_CONFLICT'));
  return problem(error);
 }
}
