import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem,readBody} from '../access/http.ts';
import {AccessError,getPrincipal} from '../access/policy.ts';
import {listConfigurations,writeConfiguration} from './configuration.ts';
export async function handlePromotions(request:Request,identity:LocalAuth){
  try{
    assertOrigin(request);
    if(['authorization','x-cart-token','x-order-token'].some((name)=>request.headers.has(name))) throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
    const url=new URL(request.url);if(request.method!=='GET'&&url.search) throw new AccessError(400,'INVALID_INPUT');
    const principal=await getPrincipal(request,identity);
    const match=/^\/api\/v1\/admin\/shipping-promotions(?:\/([^/]+)(\/versions)?)?$/.exec(url.pathname);
    if(!match) throw new AccessError(404,'NOT_FOUND');
    if(request.method==='GET') return privateJson(await listConfigurations(identity,principal,url,match[1]??null,Boolean(match[2])));
    if(request.method==='POST'&&(!match[1]||match[2])) return privateJson(await writeConfiguration(request,identity,principal,match[1]??null,await readBody(request)),201);
    throw new AccessError(404,'NOT_FOUND');
  }catch(error){return problem(error);}
}
