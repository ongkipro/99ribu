'use server';

import {parseSetCookieHeader} from 'better-auth/cookies';
import {cookies} from 'next/headers';
import {revalidatePath} from 'next/cache';
import {getLocalAuth} from '../../../modules/access/auth';
import {handleAuth} from '../../../modules/access/handler';
import {cartFormInput,failedCartMutation,mutateBrowserCart,type CartMutationState} from '../../../modules/storefront/cart';
import {storefrontRequest} from '../../../modules/storefront/browser';

async function writeCookies(issued:string[]){
 const store=await cookies();
 for(const raw of issued)for(const [name,attributes] of parseSetCookieHeader(raw)){
  if(attributes.path!=='/'||attributes.httponly!==true||attributes.samesite!=='lax'||typeof attributes['max-age']!=='number')throw new Error('Unexpected storefront cookie attributes');
  store.set(name,attributes.value,{path:'/',httpOnly:true,sameSite:'lax',secure:attributes.secure===true,maxAge:attributes['max-age']});
 }
}
export async function changeCart(_previous:CartMutationState,data:FormData):Promise<CartMutationState>{
 let input:unknown;
 try{input=cartFormInput(data);}catch{return failedCartMutation(Object.fromEntries(data));}
 const reply=await mutateBrowserCart(await storefrontRequest('POST'),getLocalAuth(),input);
 await writeCookies(reply.cookies);
 // The authoritative cart badge appears in every storefront shell.
 if(reply.state.phase==='success'||reply.state.phase==='error')revalidatePath('/','layout');
 return reply.state;
}

export async function restartShopping(_previous:{message:string},_data:FormData){
 try{
  const request=await storefrontRequest('POST'),headers=new Headers(request.headers);headers.delete('content-length');headers.set('content-type','application/json');
  const response=await handleAuth(new Request(new URL('/api/auth/sign-out',request.url),{method:'POST',headers,body:'{}'}),getLocalAuth());
  if(!response.ok)return {message:'Sesi belum dapat diakhiri. Coba lagi.'};
  await writeCookies(response.headers.getSetCookie());revalidatePath('/','layout');
  return {message:'Sesi sebelumnya diakhiri. Pilih produk untuk memulai lagi.'};
 }catch{return {message:'Hasil pengakhiran sesi belum diketahui. Periksa kembali keranjang.'};}
}
