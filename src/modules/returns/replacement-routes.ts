import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem,readBody} from '../access/http.ts';
import {AccessError,getPrincipal} from '../access/policy.ts';
import {invalid} from '../catalog/validation.ts';
import {actOnReplacement,createReplacement,readAdminReplacement} from './replacements.ts';

export async function handleReplacements(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);
  if(['authorization','x-cart-token','x-order-token'].some(name=>request.headers.has(name)))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  const url=new URL(request.url);if(url.search)throw invalid();
  const create=/^\/api\/v1\/admin\/returns\/([^/]+)\/replacements$/.exec(url.pathname);
  const physical=/^\/api\/v1\/admin\/replacements\/([^/]+)(?:\/(reservations|preparations|bookings|handover))?$/.exec(url.pathname);
  if(!create&&!physical)throw new AccessError(404,'NOT_FOUND');
  const principal=await getPrincipal(request,identity);
  if(create&&request.method==='POST')return privateJson(await createReplacement(request,identity,principal,create[1],await readBody(request)),201);
  if(physical){
   if(request.method==='GET'&&!physical[2])return privateJson(await readAdminReplacement(identity,principal,physical[1]));
   const action=physical[2]==='reservations'?'reserve':physical[2]==='preparations'?'prepare':physical[2]==='bookings'?'book':physical[2]==='handover'?'handover':null;
   if(request.method==='POST'&&action)return privateJson(await actOnReplacement(request,identity,principal,physical[1],await readBody(request),action),action==='book'?202:201);
  }
  throw new AccessError(404,'NOT_FOUND');
 }catch(error){
  if(error&&typeof error==='object'&&'code' in error&&['23505','23514','40001','40P01'].includes(String(error.code)))return problem(new AccessError(409,'REPLACEMENT_CONFLICT'));
  return problem(error);
 }
}
