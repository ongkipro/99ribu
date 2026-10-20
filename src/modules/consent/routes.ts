import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem,readBody} from '../access/http.ts';
import {AccessError} from '../access/policy.ts';
import {invalid} from '../catalog/validation.ts';
import {commerceActor,lockActor,setCookie} from '../checkout/access.ts';
import {mutationKey} from '../checkout/carts.ts';
import {bootstrapVisitor,readVisitor,visitorCookieName,visitorRate,visitorToken} from './context.ts';
import {currentConsent,projectConsent,recordConsent,type Consent} from './receipts.ts';

export async function handleConsent(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);const url=new URL(request.url);if(url.search) throw invalid();
  if(request.headers.has('x-cart-token')||request.headers.has('x-order-token')) throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  const bootstrap=url.pathname==='/api/v1/visitor-sessions'&&request.method==='POST';
  if(!bootstrap&&(url.pathname!=='/api/v1/consent/receipt'||!['GET','POST'].includes(request.method))) throw new AccessError(404,'NOT_FOUND');
  const body=request.method==='POST'?await readBody(request):null,key=request.method==='POST'?mutationKey(request):null,actor=await commerceActor(request,identity);
  if(bootstrap){
   const result=await identity.sql.begin(tx=>bootstrapVisitor(tx,request,identity,actor,key as string,body));
   const response=result.bootstrap?problem(new AccessError(401,'VISITOR_BOOTSTRAP_REQUIRED')):privateJson({status:'active',expires_at:new Date(result.visitor.expires_at).toISOString()},201);
   const token=await visitorToken(identity,result.visitor);setCookie(response,await visitorCookieName(identity),`${result.visitor.id}.${token}`,'/',Math.max(0,Math.floor((new Date(result.visitor.expires_at).getTime()-Date.now())/1000)));return response;
  }
  return await identity.sql.begin(async tx=>{
   if(actor)await lockActor(tx,actor);const visitor=await readVisitor(tx,request,identity,actor);if(!visitor)throw new AccessError(401,'VISITOR_CONTEXT_REQUIRED');
   await visitorRate(tx,`visitor-purpose:${visitor.id}`);
   return request.method==='GET'?privateJson(projectConsent(await currentConsent(tx,visitor,true) as Consent)):privateJson(await recordConsent(tx,visitor,key as string,body),201);
  });
 }catch(error){return problem(error);}
}
