import type {LocalAuth} from "../access/auth.ts";
import {assertOrigin,privateJson,problem,readBody} from "../access/http.ts";
import {AccessError,getPrincipal,hasPermission} from "../access/policy.ts";
import {readContribution} from "./contribution.ts";
import {appendCostVersion,listCostVersions} from "./costs.ts";

export async function handleFinance(request:Request,identity:LocalAuth){
  try{
    assertOrigin(request);
    if(['authorization','x-cart-token','x-order-token'].some((name)=>request.headers.has(name))) throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
    const url=new URL(request.url);if(request.method!=='GET'&&url.search) throw new AccessError(400,'INVALID_INPUT');
    const principal=await getPrincipal(request,identity);
    const permission=request.method==='GET'?'finance.costs.read':'finance.costs.write';
    if(!hasPermission(principal,permission)) throw new AccessError(403,'FORBIDDEN');
    const component=/^\/api\/v1\/admin\/stock-items\/([^/]+)\/cost-versions$/.exec(url.pathname);
    const assumption=/^\/api\/v1\/admin\/offers\/([^/]+)\/cost-assumption-versions$/.exec(url.pathname);
    const review=/^\/api\/v1\/admin\/products\/([^/]+)\/contribution-reviews$/.exec(url.pathname);
    const cost=component??assumption;const kind=component?'component':'assumption';
    if(request.method==='GET'&&cost) return privateJson(await listCostVersions(identity,principal,kind,cost[1],url));
    if(request.method==='POST'&&cost) return privateJson(await appendCostVersion(request,identity,principal,kind,cost[1],await readBody(request)),201);
    if(request.method==='GET'&&review){if(url.search) throw new AccessError(400,'INVALID_INPUT');return privateJson(await readContribution(identity,principal,review[1]));}
    throw new AccessError(404,'NOT_FOUND');
  }catch(error){
    if(error&&typeof error==='object'&&'code' in error&&error.code==='22007') return problem(new AccessError(400,'INVALID_COST_TIME'));
    return problem(error);
  }
}
