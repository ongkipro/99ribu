import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem} from '../access/http.ts';
import {AccessError,getPrincipal,hasPermission} from '../access/policy.ts';
import {listOrderHistory,readOrderHistory} from './history.ts';

export async function handleOrderHistory(request:Request,identity:LocalAuth){
 try{assertOrigin(request);if(['authorization','x-cart-token','x-order-token'].some(h=>request.headers.has(h))) throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  const principal=await getPrincipal(request,identity);if(!hasPermission(principal,'orders.history.read')) throw new AccessError(403,'FORBIDDEN');
  const url=new URL(request.url);if(request.method!=='GET') throw new AccessError(404,'NOT_FOUND');
  if(url.pathname==='/api/v1/admin/orders') return privateJson(await listOrderHistory(identity,principal,url));
  const match=/^\/api\/v1\/admin\/orders\/([^/]+)$/.exec(url.pathname);if(!match) throw new AccessError(404,'NOT_FOUND');
  return privateJson(await readOrderHistory(identity,principal,match[1],url));
 }catch(error){return problem(error);}
}
