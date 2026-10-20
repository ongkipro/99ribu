import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem,readBody} from '../access/http.ts';
import {AccessError,getPrincipal} from '../access/policy.ts';
import {bookShipment,completePacking,handoverFulfillment,prepareFulfillment,rescheduleFulfillment} from './commands.ts';
import {listFulfillments,readFulfillment} from './reads.ts';

export async function handleFulfillment(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);if(['authorization','x-cart-token','x-order-token'].some(h=>request.headers.has(h)))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  const url=new URL(request.url);if(url.search&&(request.method!=='GET'||url.pathname!=='/api/v1/admin/fulfillments'))throw new AccessError(400,'INVALID_INPUT');
  const principal=await getPrincipal(request,identity);if(!principal.roles.some(r=>['owner','ecommerce_admin','warehouse'].includes(r)))throw new AccessError(403,'FORBIDDEN');
  const fulfillment=/^\/api\/v1\/admin\/fulfillments\/([^/]+)(?:\/(preparations|packing|handover|reschedules))?$/.exec(url.pathname);
  const shipment=/^\/api\/v1\/admin\/shipments\/([^/]+)$/.exec(url.pathname);
  if(request.method==='GET'){
   if(url.pathname==='/api/v1/admin/fulfillments')return privateJson(await listFulfillments(identity,principal,url));
   if(fulfillment&&!fulfillment[2])return privateJson(await readFulfillment(identity,principal,fulfillment[1]));
   if(shipment)return privateJson(await readFulfillment(identity,principal,shipment[1],true));
  }
  if(request.method==='POST'){
   if(url.pathname==='/api/v1/admin/shipments')return privateJson(await bookShipment(request,identity,principal,await readBody(request)),202);
   if(fulfillment?.[2]){
    const body=await readBody(request),write=fulfillment[2]==='preparations'?prepareFulfillment:fulfillment[2]==='packing'?completePacking:fulfillment[2]==='handover'?handoverFulfillment:rescheduleFulfillment;
    return privateJson(await write(request,identity,principal,fulfillment[1],body),201);
   }
  }
  throw new AccessError(404,'NOT_FOUND');
 }catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')return problem(new AccessError(409,'FULFILLMENT_CONFLICT'));return problem(error);}
}
