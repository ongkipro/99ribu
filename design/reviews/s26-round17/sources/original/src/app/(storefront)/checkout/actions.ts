'use server';

import {cookies} from 'next/headers';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {getLocalAuth} from '../../../modules/access/auth';
import {AccessError} from '../../../modules/access/policy';
import {storefrontRequest} from '../../../modules/storefront/browser';
import {checkoutFormInput,checkoutUnavailableView,initialCheckoutState,mutateCheckout,readCheckout,type CheckoutState} from '../../../modules/storefront/checkout';
import {checkoutIssuedCookies,checkoutOrderPath,checkoutPaymentInput,initialCheckoutPayment,prepareCheckoutPayment,recoverCheckoutOrder,type CheckoutPaymentState} from '../../../modules/storefront/checkout-order';
import {captureCheckoutMilestones} from '../../../modules/storefront/checkout-signals';

export async function observeCheckoutEntry(cart:string,version:number){
 await captureCheckoutMilestones(await storefrontRequest('POST','/checkout'),getLocalAuth(),{cart,version,stage:'started'});
}

async function writeOrderCookies(orderId:string,issued:string[]){
 const values=await checkoutIssuedCookies(getLocalAuth(),orderId,issued),store=await cookies();
 for(const {name,value,...options} of values)store.set(name,value,options);
}

export async function changeCheckout(_previous:CheckoutState,data:FormData):Promise<CheckoutState>{
 const request=await storefrontRequest('POST','/checkout'),identity=getLocalAuth();
 let intent:ReturnType<typeof checkoutFormInput>;try{intent=checkoutFormInput(data);}catch{
  let view:Awaited<ReturnType<typeof readCheckout>>;try{view=await readCheckout(request,identity);}catch{view=checkoutUnavailableView();}
  return {...initialCheckoutState(view),phase:'error',code:'INVALID_INPUT',message:'Periksa isian checkout sebelum melanjutkan.'};
 }
 if(!intent.navigate)await captureCheckoutMilestones(request,identity,{cart:intent.cart,version:Number(intent.version),stage:'started'});
 const reply=await mutateCheckout(request,identity,intent);
 if(reply.state.phase==='success'&&!reply.order&&reply.state.view.quoteCurrent&&reply.state.view.quote){
  const quote=reply.state.view.quote;
  if(intent.kind==='quote'||intent.kind==='shipping'&&reply.state.step==='review')await captureCheckoutMilestones(request,identity,{cart:intent.cart,version:quote.cart_version,quote:quote.id,stage:intent.kind==='quote'?'contact':'shipping'});
 }
 if(reply.order){
  try{await writeOrderCookies(reply.order.id,reply.cookies);}catch{
   return {...reply.state,phase:'unknown',intent,message:'Pesanan tersimpan. Ulangi tindakan yang sama untuk membuka pembayaran.'};
  }
  revalidatePath('/','layout');redirect(checkoutOrderPath(reply.order.id));
 }
 if(reply.state.phase!=='unknown'||reply.state.blocked)revalidatePath('/','layout');
 return reply.state;
}

export async function preparePayment(_previous:CheckoutPaymentState,data:FormData):Promise<CheckoutPaymentState>{
 let input:ReturnType<typeof checkoutPaymentInput>;try{input=checkoutPaymentInput(data);}catch{return {phase:'error',order:'',key:'',message:'Muat ulang halaman pembayaran sebelum mencoba lagi.',code:'INVALID_INPUT',blocked:true};}
 const path=checkoutOrderPath(input.order),state=await prepareCheckoutPayment(await storefrontRequest('POST',path),getLocalAuth(),input);
 if(state.phase!=='unknown'||state.blocked)revalidatePath(path);
 if(state.phase==='success')redirect(path);
 return state;
}

export async function recoverPaymentAccess(_previous:CheckoutPaymentState,data:FormData):Promise<CheckoutPaymentState>{
 let input:ReturnType<typeof checkoutPaymentInput>;try{input=checkoutPaymentInput(data);}catch{return {phase:'error',order:'',key:'',message:'Buka kembali halaman melalui sesi belanja Anda.',code:'INVALID_INPUT',blocked:true};}
 const initial=initialCheckoutPayment(input.order);let recovered:Awaited<ReturnType<typeof recoverCheckoutOrder>>;
 try{recovered=await recoverCheckoutOrder(await storefrontRequest('POST',checkoutOrderPath(input.order)),getLocalAuth(),input.order);await writeOrderCookies(recovered.order.id,recovered.cookies);}
 catch(error){return {...initial,phase:'error',message:'Akses pesanan belum dapat dipulihkan melalui sesi ini. Periksa sesi belanja yang digunakan saat memesan.',code:error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE',blocked:error instanceof AccessError&&[401,403,404].includes(error.status)};}
 redirect(checkoutOrderPath(recovered.order.id));
}
