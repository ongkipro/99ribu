import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem,readBody} from '../access/http.ts';
import {AccessError} from '../access/policy.ts';
import {invalid} from '../catalog/validation.ts';
import {commerceActor} from '../checkout/access.ts';
import {mutationKey} from '../checkout/carts.ts';
import {handleConsent} from '../consent/routes.ts';
import {funnelInput,recordFunnel} from './funnel.ts';

export async function handleSignals(request:Request,identity:LocalAuth){
 const path=new URL(request.url).pathname;
 if(path==='/api/v1/visitor-sessions'||path==='/api/v1/consent/receipt')return handleConsent(request,identity);
 try{
  assertOrigin(request);const url=new URL(request.url);if(url.search)throw invalid();
  const order=/^\/api\/v1\/orders\/([^/]+)\/funnel\/events$/.exec(path);if(request.method!=='POST'||(!order&&path!=='/api/v1/funnel/events'))throw new AccessError(404,'NOT_FOUND');
  const body=funnelInput(await readBody(request),mutationKey(request),order?.[1]),actor=await commerceActor(request,identity);
  return privateJson(await identity.sql.begin(tx=>recordFunnel(tx,request,identity,actor,body)),202);
 }catch(error){return problem(error);}
}
