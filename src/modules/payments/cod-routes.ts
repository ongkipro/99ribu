import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem} from '../access/http.ts';
import {AccessError} from '../access/policy.ts';
import {invalid} from '../catalog/validation.ts';
import {commerceActor} from '../checkout/access.ts';
import {authorizeOrder} from '../checkout/orders.ts';
import {lockPaymentOrder} from './attempts.ts';
import {projectCodCollections} from './cod.ts';

export async function handleCodCollections(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);const url=new URL(request.url);if(url.search)throw invalid();const match=/^\/api\/v1\/orders\/([^/]+)\/cod-collections$/.exec(url.pathname);
  if(!match||request.method!=='GET')throw new AccessError(404,'NOT_FOUND');const actor=await commerceActor(request,identity);
  return await identity.sql.begin(async tx=>{const order=await authorizeOrder(tx,request,identity,actor,match[1]);await lockPaymentOrder(tx,order.id);return privateJson(await projectCodCollections(tx,order.id));});
 }catch(error){return problem(error);}
}
