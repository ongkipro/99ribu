import 'server-only';
import {cache} from 'react';
import {cookies,headers} from 'next/headers';
import {unstable_rethrow} from 'next/navigation';
import {readLocalConfig} from '../../config/local';
import {getLocalAuth} from '../access/auth';
import {AccessError} from '../access/policy';
import {cookie,prefix} from '../checkout/access';
import {readBrowserCart,readCartView} from './cart';

export async function storefrontRequest(method:'GET'|'POST'='GET',path='/keranjang'){
 const forwarded=new Headers(await headers()),origin=readLocalConfig(process.env).origin,url=new URL(path,origin);
 if(url.origin!==origin||url.search||url.hash)throw new AccessError(403,'INVALID_ORIGIN');
 if(method==='GET'){
  // Next's cookie store includes cookies issued by the current Server Action;
  // headers() still contains the incoming request's older Cookie header.
  const raw=new Request(url,{headers:forwarded}),p=await prefix(getLocalAuth());
  for(const name of ['session_token','commerce_guest','cart_access','order_access','checkout_access'])cookie(raw,`${p}.${name}`);
  forwarded.set('cookie',(await cookies()).toString());
 }
 return new Request(url,{method,headers:forwarded});
}
export const currentBrowserCart=cache(async()=>{
 try{return await readBrowserCart(await storefrontRequest(),getLocalAuth());}
 // Request-time API signals (cookies/headers during prerender) and redirects belong to Next, not to "unavailable".
 catch(error){unstable_rethrow(error);return {kind:error instanceof AccessError?'denied' as const:'unavailable' as const,cart:null,code:error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE'};}
});
export const currentCartView=cache(async()=>{
 try{return await readCartView(await storefrontRequest(),getLocalAuth());}
 catch(error){unstable_rethrow(error);return {kind:error instanceof AccessError?'denied' as const:'unavailable' as const,cart:null,code:error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE',lines:[],quote:'none' as const};}
});
