import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem,readBody} from '../access/http.ts';
import {AccessError,getPrincipal} from '../access/policy.ts';
import {invalid} from '../catalog/validation.ts';
import {commerceActor} from '../checkout/access.ts';
import {createReturn,decideReturn} from './cases.ts';
import {inspectReturn} from './inspection.ts';
import {readAdminRefund,readAdminReturns,readBuyerEligibility,readBuyerRefund,readBuyerReturns} from './reads.ts';
import {recoverRefund} from './refund-recovery.ts';
import {acceptRefundDestination,queueRefund} from './refunds.ts';

export async function handleReturns(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);
  if(['authorization','x-cart-token','x-order-token'].some(name=>request.headers.has(name)))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  const url=new URL(request.url);if(request.method!=='GET'&&url.search)throw invalid();
  const buyerCases=/^\/api\/v1\/orders\/([^/]+)\/returns(?:\/([^/]+))?$/.exec(url.pathname);
  const buyerRefund=/^\/api\/v1\/orders\/([^/]+)\/refunds\/([^/]+)(?:\/(destinations))?$/.exec(url.pathname);
  if(buyerCases||buyerRefund){
   const actor=await commerceActor(request,identity);
   if(buyerCases){
    if(request.method==='GET')return privateJson(buyerCases[2]==='eligibility'
     ?await readBuyerEligibility(request,identity,actor,buyerCases[1],url)
     :await readBuyerReturns(request,identity,actor,buyerCases[1],url,buyerCases[2]));
    if(request.method==='POST'&&!buyerCases[2])return privateJson(await createReturn(request,identity,actor,buyerCases[1],await readBody(request,32768)),201);
   }
   if(buyerRefund){
    if(request.method==='GET'&&!buyerRefund[3]){if(url.search)throw invalid();return privateJson(await readBuyerRefund(request,identity,actor,buyerRefund[1],buyerRefund[2]));}
    if(request.method==='POST'&&buyerRefund[3])return privateJson(await acceptRefundDestination(request,identity,actor,buyerRefund[1],buyerRefund[2],await readBody(request)),201);
   }
   throw new AccessError(404,'NOT_FOUND');
  }
  const cases=/^\/api\/v1\/admin\/returns(?:\/([^/]+)(?:\/(decisions|inspections))?)?$/.exec(url.pathname);
  const refunds=/^\/api\/v1\/admin\/refunds(?:\/([^/]+)(?:\/(reconciliations))?)?$/.exec(url.pathname);
  if(!cases&&!refunds)throw new AccessError(404,'NOT_FOUND');
  const principal=await getPrincipal(request,identity);
  if(cases){
   if(request.method==='GET'&&!cases[2])return privateJson(await readAdminReturns(identity,principal,url,cases[1]));
   if(request.method==='POST'&&cases[1]&&cases[2]==='decisions')return privateJson(await decideReturn(request,identity,principal,cases[1],await readBody(request)),201);
   if(request.method==='POST'&&cases[1]&&cases[2]==='inspections')return privateJson(await inspectReturn(request,identity,principal,cases[1],await readBody(request,32768)),201);
  }
  if(refunds){
   if(request.method==='GET'&&refunds[1]&&!refunds[2]){if(url.search)throw invalid();return privateJson(await readAdminRefund(identity,principal,refunds[1]));}
   if(request.method==='POST'&&!refunds[1])return privateJson(await queueRefund(request,identity,principal,await readBody(request)),202);
   if(request.method==='POST'&&refunds[1]&&refunds[2]==='reconciliations')return privateJson(await recoverRefund(request,identity,principal,refunds[1],await readBody(request)),202);
  }
  throw new AccessError(404,'NOT_FOUND');
 }catch(error){
  if(error&&typeof error==='object'&&'code' in error&&['23505','23514','40001','40P01'].includes(String(error.code)))return problem(new AccessError(409,'RETURN_CONFLICT'));
  return problem(error);
 }
}
