import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem,readBody} from '../access/http.ts';
import {AccessError,getPrincipal} from '../access/policy.ts';
import {correctTracking,listManualQueue,readPickupProfile,recordPurchaseReference,recordTrackingStatus,shipManually,writePickupProfile} from './manual.ts';

// S91 manual consignment fulfillment (DEC-007) and private warehouse pickup profiles.
export async function handleManualFulfillment(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);if(['authorization','x-cart-token','x-order-token'].some(h=>request.headers.has(h)))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  const url=new URL(request.url);if(url.search&&(request.method!=='GET'||url.pathname!=='/api/v1/admin/manual-shipments'))throw new AccessError(400,'INVALID_INPUT');
  const principal=await getPrincipal(request,identity);
  const profile=/^\/api\/v1\/admin\/warehouses\/([^/]+)\/pickup-profile$/.exec(url.pathname);
  if(profile){
   if(!principal.roles.some(r=>['owner','ecommerce_admin'].includes(r)))throw new AccessError(403,'FORBIDDEN');
   if(request.method==='GET')return privateJson(await readPickupProfile(identity,principal,profile[1]));
   if(request.method==='POST')return privateJson(await writePickupProfile(request,identity,principal,profile[1],await readBody(request)),201);
   throw new AccessError(404,'NOT_FOUND');
  }
  if(!principal.roles.some(r=>['owner','ecommerce_admin','warehouse'].includes(r)))throw new AccessError(403,'FORBIDDEN');
  if(request.method==='GET'&&url.pathname==='/api/v1/admin/manual-shipments')return privateJson(await listManualQueue(identity,principal,url));
  const action=/^\/api\/v1\/admin\/fulfillments\/([^/]+)\/(manual-shipment|tracking-corrections|berlapak-references|tracking-statuses)$/.exec(url.pathname);
  if(request.method==='POST'&&action){
   const body=await readBody(request),write=action[2]==='manual-shipment'?shipManually:action[2]==='tracking-corrections'?correctTracking:action[2]==='berlapak-references'?recordPurchaseReference:recordTrackingStatus;
   return privateJson(await write(request,identity,principal,action[1],body),201);
  }
  throw new AccessError(404,'NOT_FOUND');
 }catch(error){if(error&&typeof error==='object'&&'code' in error&&['23505','23514'].includes(String(error.code)))return problem(new AccessError(409,'FULFILLMENT_CONFLICT'));return problem(error);}
}
