'use server';

import {cookies} from 'next/headers';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {getLocalAuth} from '../../../modules/access/auth';
import {AccessError} from '../../../modules/access/policy';
import {storefrontRequest} from '../../../modules/storefront/browser';
import {checkoutFormInput,checkoutUnavailableView,initialCheckoutIntent,initialCheckoutState,mutateCheckout,readCheckout,type CheckoutState} from '../../../modules/storefront/checkout';
import {checkoutOrderPath,checkoutPaymentInput,initialCheckoutPayment,prepareCheckoutPayment,recoverCheckoutOrder,type CheckoutPaymentState} from '../../../modules/storefront/checkout-order';
import {allOrderIssuedCookies,orderReceiptPath,prepareOrderReceiptPayment} from '../../../modules/orders/receipt';
import {captureCheckoutMilestones,captureReceiptViewed} from '../../../modules/storefront/checkout-signals';
import {clearCheckoutDraft,writeCheckoutDraft} from '../../../modules/storefront/checkout-draft';

export async function saveCheckoutDraft(data:FormData){
 try{
  const intent=checkoutFormInput(data),result=await writeCheckoutDraft(await storefrontRequest('POST','/checkout'),getLocalAuth(),intent);
  return {...result,message:result.kind==='saved'||result.kind==='stale'?'Draf tersimpan.':result.kind==='conflict'?'Draf berubah di halaman lain. Muat ulang untuk memeriksanya.':'Keranjang ini sudah berakhir. Periksa keranjang.'};
 }catch(error){return {kind:error instanceof AccessError&&error.status<500?'denied' as const:'unavailable' as const,revision:0,message:error instanceof AccessError&&error.status<500?'Draf belum tersimpan. Periksa sesi belanja.':'Draf belum tersimpan. Isian tetap ada di halaman ini.'};}
}

export async function observeCheckoutEntry(cart:string,version:number){
 await captureCheckoutMilestones(await storefrontRequest('POST','/checkout'),getLocalAuth(),{cart,version,stage:'started'});
}

export async function observeReceiptView(orderId:string){
 try{
  const path=orderReceiptPath(orderId);
  await captureReceiptViewed(await storefrontRequest('POST',path),getLocalAuth(),orderId);
 }catch{}
}

async function writeOrderCookies(orderId:string,issued:string[]){
 const values=await allOrderIssuedCookies(getLocalAuth(),orderId,issued),store=await cookies();
 for(const {name,value,...options} of values)store.set(name,value,options);
}

export async function changeCheckout(_previous:CheckoutState,data:FormData):Promise<CheckoutState>{
 const request=await storefrontRequest('POST','/checkout'),identity=getLocalAuth();
 let intent:ReturnType<typeof checkoutFormInput>;try{intent=checkoutFormInput(data);}catch{
  let view:Awaited<ReturnType<typeof readCheckout>>;try{view=await readCheckout(request,identity);}catch{view=checkoutUnavailableView();}
  return {...initialCheckoutState(view),phase:'error',code:'INVALID_INPUT',message:'Periksa isian checkout sebelum melanjutkan.'};
 }
 // Draft persistence never runs in front of an exact financial retry.
 if(intent.kind!=='order'||intent.navigate){
  const saved=await saveCheckoutDraft(data);
  if(saved.kind==='conflict'||saved.kind==='unavailable'||saved.kind==='denied'){
   const view=await readCheckout(request,identity).catch(()=>checkoutUnavailableView());
   return {...initialCheckoutState(view),phase:'error',step:saved.kind==='denied'?'contact':intent.kind==='order'?'review':intent.kind==='shipping'?'shipping':'contact',intent:saved.kind==='denied'?initialCheckoutIntent():intent,blocked:saved.kind==='denied',draftConflict:saved.kind==='conflict',message:saved.message};
  }
  intent={...intent,draft_revision:String(saved.revision)};
  if(intent.navigate==='cart'||intent.navigate==='home')redirect(intent.navigate==='cart'?'/keranjang':'/');
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
  await clearCheckoutDraft(request,identity,intent.cart).catch(()=>{});
  revalidatePath('/','layout');redirect(checkoutOrderPath(reply.order.id));
 }
 if(reply.state.phase!=='unknown'&&!reply.state.blocked&&reply.state.view.cart?.id===intent.cart){
  const next={...reply.state.intent,draft_writer:intent.draft_writer,draft_sequence:intent.draft_sequence,draft_revision:intent.draft_revision};
  try{
   const saved=await writeCheckoutDraft(request,identity,next,{step:reply.state.step,quote:next.quote,allocation_id:next.allocation_id,packages:next.packages});
   reply.state.intent={...next,draft_revision:saved.kind==='conflict'?next.draft_revision:String(saved.revision)};
   if(saved.kind==='conflict'){reply.state.draftConflict=true;reply.state.message='Draf berubah di halaman lain. Muat ulang untuk memeriksanya.';}
  }catch{reply.state.intent=next;reply.state.message+=' Draf belum tersimpan. Isian tetap ada di halaman ini.';}
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

export async function prepareReceiptPayment(_previous:CheckoutPaymentState,data:FormData):Promise<CheckoutPaymentState>{
 let input:ReturnType<typeof checkoutPaymentInput>;try{input=checkoutPaymentInput(data);}catch{return {phase:'error',order:'',key:'',message:'Muat ulang halaman tanda terima sebelum mencoba lagi.',code:'INVALID_INPUT',blocked:true};}
 const path=orderReceiptPath(input.order),state=await prepareOrderReceiptPayment(await storefrontRequest('POST',path),getLocalAuth(),input);
 if(state.phase!=='unknown'||state.blocked)revalidatePath(path);
 if(state.phase==='success')redirect(path);
 return state;
}

export async function recoverReceiptAccess(_previous:CheckoutPaymentState,data:FormData):Promise<CheckoutPaymentState>{
 let input:ReturnType<typeof checkoutPaymentInput>;try{input=checkoutPaymentInput(data);}catch{return {phase:'error',order:'',key:'',message:'Buka kembali halaman melalui sesi belanja Anda.',code:'INVALID_INPUT',blocked:true};}
 const initial=initialCheckoutPayment(input.order);let recovered:Awaited<ReturnType<typeof recoverCheckoutOrder>>;
 try{recovered=await recoverCheckoutOrder(await storefrontRequest('POST',orderReceiptPath(input.order)),getLocalAuth(),input.order);await writeOrderCookies(recovered.order.id,recovered.cookies);}
 catch(error){return {...initial,phase:'error',message:'Akses pesanan belum dapat dipulihkan melalui sesi ini. Periksa sesi belanja yang digunakan saat memesan.',code:error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE',blocked:error instanceof AccessError&&[401,403,404].includes(error.status)};}
 redirect(orderReceiptPath(recovered.order.id));
}
