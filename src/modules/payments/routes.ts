import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem,readBody} from '../access/http.ts';
import {AccessError} from '../access/policy.ts';
import {invalid} from '../catalog/validation.ts';
import {commerceActor} from '../checkout/access.ts';
import {mutationKey} from '../checkout/carts.ts';
import {authorizeOrder} from '../checkout/orders.ts';
import {createAttempt,projectAttempt} from './attempts.ts';

export async function handlePayments(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);const url=new URL(request.url);if(url.search) throw invalid();
  const path=/^\/api\/v1\/orders\/([^/]+)\/payment-attempts(?:\/([^/]+))?$/.exec(url.pathname);
  if(!path||(!path[2]&&request.method!=='POST')||(path[2]&&request.method!=='GET')) throw new AccessError(404,'NOT_FOUND');
  const actor=await commerceActor(request,identity),body=path[2]?null:await readBody(request),key=path[2]?null:mutationKey(request);
  return await identity.sql.begin(async tx=>{
   const order=await authorizeOrder(tx,request,identity,actor,path[1]);
   return path[2]?privateJson(await projectAttempt(tx,order.id,path[2])):privateJson(await createAttempt(tx,order.id,key as string,body),201);
  });
 }catch(error){return problem(error);}
}
