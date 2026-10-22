import {randomUUID} from 'node:crypto';
import {parseSetCookieHeader} from 'better-auth/cookies';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError} from '../access/policy.ts';
import {id,invalid} from '../catalog/validation.ts';
import {cookie,prefix} from '../checkout/access.ts';
import {mutationKey} from '../checkout/carts.ts';
import {handleCheckout} from '../checkout/routes.ts';
import type {projectAttempt} from '../payments/attempts.ts';
import {handlePayments} from '../payments/routes.ts';
import {AUTOLARIS_CHANNELS,autolarisClientFor,enabledChannels} from '../payments/autolaris.ts';
import {readBrowserCart} from './cart.ts';
import {assertCheckoutTransport,checkoutApiRequest,type CheckoutOrder} from './checkout.ts';

export type CheckoutAttempt=Awaited<ReturnType<typeof projectAttempt>>;
export type CheckoutPaymentChannel={channel_code:string;name:string};
export type CheckoutPaymentView={kind:'ready';order:CheckoutOrder;attempt:CheckoutAttempt|null;attemptUnavailable:boolean;now:string;channels:CheckoutPaymentChannel[]}|{kind:'denied'|'unavailable';order:null;attempt:null;attemptUnavailable:true;now:null;code:string;channels:[]};
export type CheckoutPaymentState={phase:'idle'|'success'|'error'|'unknown';order:string;key:string;message:string;code:string|null;blocked:boolean};
export type CheckoutIssuedCookie={name:string;value:string;path:string;httpOnly:true;sameSite:'lax';secure:boolean;maxAge:number};
export const checkoutOrderPath=(orderId:string)=>`/checkout/order/${id(orderId)}`;
export const initialCheckoutPayment=(orderId:string):CheckoutPaymentState=>({phase:'idle',order:id(orderId),key:randomUUID(),message:'',code:null,blocked:false});

// The native issuer owns the grant and its real expiry. This only supplies the
// same capability to one frontend payment path; it is never serialized to UI.
export async function checkoutIssuedCookies(identity:LocalAuth,orderId:string,issued:string[]):Promise<CheckoutIssuedCookie[]>{
 const order=id(orderId),p=await prefix(identity),path=`/api/v1/orders/${order}`,result:CheckoutIssuedCookie[]=[];
 if(issued.length>1)throw new Error('Unexpected checkout cookie count');
 for(const raw of issued){
  const parsed=[...parseSetCookieHeader(raw)];if(parsed.length!==1)throw new Error('Unexpected checkout cookie');
  const [name,a]=parsed[0],age=a['max-age'];
  if(name!==`${p}.order_access`||a.path!==path||a.httponly!==true||a.samesite!=='lax'||a.domain||typeof age!=='number'||!Number.isSafeInteger(age)||age<1||age>604800||!new RegExp(`^${order}\\.[A-Za-z0-9_-]{43}$`).test(a.value))throw new Error('Unexpected checkout cookie attributes');
  const options={value:a.value,path,httpOnly:true as const,sameSite:'lax' as const,secure:a.secure===true,maxAge:age};
  result.push({name,...options},{name:`${p}.checkout_access`,...options,path:checkoutOrderPath(order)});
 }
 return result;
}

export async function checkoutOrderRequest(request:Request,identity:LocalAuth,orderId:string){
 const p=await assertCheckoutTransport(request,identity),order=id(orderId);
 if(new URL(request.url).pathname!==checkoutOrderPath(order))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
 const alias=`${p}.checkout_access`,native=`${p}.order_access`;
 const pointer=cookie(request,alias),original=cookie(request,native);
 if(original!==null&&(pointer===null||original!==pointer))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
 if(pointer!==null&&!new RegExp(`^${order}\\.[A-Za-z0-9_-]{43}$`).test(pointer))throw new AccessError(401,'UNAUTHENTICATED');
 const pairs=(request.headers.get('cookie')??'').split(';').map(v=>v.trim()).filter(v=>v&&!v.startsWith(`${alias}=`)&&!v.startsWith(`${native}=`));
 if(pointer!==null)pairs.push(`${native}=${pointer}`);
 const headers=new Headers(request.headers);headers.set('cookie',pairs.join('; '));headers.delete('content-length');
 return new Request(request.url,{method:request.method,headers});
}

async function autolarisChannels(identity:LocalAuth):Promise<CheckoutPaymentChannel[]>{
 try{const [db]=await identity.sql<{name:string}[]>`select current_database() name`;return enabledChannels(await autolarisClientFor(db.name==='99ribu_test'?'test':'local',identity.sql).listPayment());}
 catch{return [];}
}
export async function readCheckoutPayment(request:Request,identity:LocalAuth,orderId:string):Promise<CheckoutPaymentView>{
 try{
  const scoped=await checkoutOrderRequest(request,identity,orderId),response=await handleCheckout(checkoutApiRequest(scoped,`/api/v1/orders/${id(orderId)}`,'GET'),identity),payload=await response.json();
  if(!response.ok)throw new AccessError(response.status,payload.code);
  const order=payload.order??payload as CheckoutOrder;
  const [clock]=await identity.sql<{now:string;attempt_id:string|null}[]>`select app.reservation_clock(o.clock_namespace)::text now,
   (select a.id from app.payment_attempt a where a.order_id=o.id order by a.created_at desc,a.id desc limit 1) attempt_id from app.commerce_order o where o.id=${order.id}`;
  if(!clock)throw new AccessError(404,'NOT_FOUND');
  let attempt:CheckoutAttempt|null=null,attemptUnavailable=false;
  if(clock.attempt_id){
   const res=await handlePayments(checkoutApiRequest(scoped,`/api/v1/orders/${order.id}/payment-attempts/${clock.attempt_id}`,'GET'),identity),data=await res.json();
   if([401,403,404].includes(res.status))throw new AccessError(res.status,data.code);
   if(!res.ok)attemptUnavailable=true;else attempt=data as CheckoutAttempt;
  }
  // DEC-008: AutoLaris channels come from the account's list_payment (simulated locally), never a fixed list.
  const channels=order.payment_channel==='autolaris'?await autolarisChannels(identity):[];
  return {kind:'ready',order,attempt,attemptUnavailable,now:clock.now,channels};
 }catch(error){return {kind:error instanceof AccessError&&error.status<500?'denied':'unavailable',order:null,attempt:null,attemptUnavailable:true,now:null,code:error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE',channels:[]};}
}

export function checkoutPaymentInput(data:FormData){
 for(const [name,value] of data)if(!name.startsWith('$ACTION_')&&(!['order','key','channel_code'].includes(name)||typeof value!=='string'))throw invalid();
 const order=data.getAll('order'),keys=data.getAll('key'),channels=data.getAll('channel_code');if(order.length!==1||keys.length!==1||typeof keys[0]!=='string'||keys[0].length>200||channels.length>1)throw invalid();
 const channel=channels[0]===undefined?undefined:String(channels[0]);if(channel!==undefined&&!(AUTOLARIS_CHANNELS as readonly string[]).includes(channel))throw invalid();
 const orderId=id(order[0]),key=keys[0];mutationKey(new Request('http://localhost',{headers:{'idempotency-key':key}}));return {order:orderId,key,...(channel?{channel_code:channel}:{})};
}
export async function prepareCheckoutPayment(request:Request,identity:LocalAuth,input:{order:string;key:string;channel_code?:string}):Promise<CheckoutPaymentState>{
 const initial={...initialCheckoutPayment(input.order),key:input.key};
 try{
  if(request.method!=='POST')throw invalid();const scoped=await checkoutOrderRequest(request,identity,input.order);
  // DEC-008: the attempt uses the channel the buyer chose at checkout (frozen on the order).
  const [channel]=await identity.sql`select coalesce(payment_channel,'local-prepaid') method_id from app.commerce_order where id=${id(input.order)}`;
  // A COD order has no prepaid attempt; the native writer answers PAYMENT_NOT_AVAILABLE.
  const method=channel?.method_id==='cod'?'local-prepaid':channel?.method_id??'local-prepaid';
  if(method==='autolaris'&&!input.channel_code)return {...initial,phase:'error',message:'Pilih bank Virtual Account atau QRIS terlebih dahulu.',code:'INVALID_INPUT',blocked:false};
  const response=await handlePayments(checkoutApiRequest(scoped,`/api/v1/orders/${id(input.order)}/payment-attempts`,'POST',method==='autolaris'?{method_id:method,channel_code:input.channel_code}:{method_id:method},input.key),identity),data=await response.json();
  if(!response.ok)throw new AccessError(response.status,data.code);
  return {...initial,phase:'success',message:'Instruksi pembayaran tersimpan. Periksa status dari halaman ini.'};
 }catch(error){
  const blocked=error instanceof AccessError&&[401,403,404].includes(error.status),unknown=!(error instanceof AccessError)||error.status>=500,code=error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE';
  const message=unknown?'Hasil permintaan belum diketahui. Ulangi permintaan yang sama; pesanan tidak dibuat ulang.':code==='PAYMENT_ATTEMPT_ACTIVE'?'Instruksi sebelumnya masih aktif. Perbarui status pembayaran.':code==='PAYMENT_ATTEMPT_LIMIT'?'Batas percobaan pembayaran tercapai. Periksa status pesanan.':code==='PAYMENT_NOT_AVAILABLE'?'Pembayaran ini sudah tidak tersedia. Perbarui status pesanan.':blocked?'Akses pesanan perlu diperiksa. Buka kembali melalui sesi belanja Anda.':'Instruksi belum dapat disiapkan. Periksa status sebelum mencoba lagi.';
  return {...initial,key:unknown?input.key:randomUUID(),phase:unknown?'unknown':'error',message,code,blocked};
 }
}

// A lost acknowledgement does not require another grant. The original guest
// plus cart proof may explicitly recover the original native submit result.
export async function recoverCheckoutOrder(request:Request,identity:LocalAuth,orderId:string){
 if(request.method!=='POST')throw invalid();await assertCheckoutTransport(request,identity);const order=id(orderId);
 const current=await readBrowserCart(request,identity);
 if(current.kind!=='ready'||current.cart.state!=='submitted'||current.cart.submitted_order_id!==order)throw new AccessError(401,'UNAUTHENTICATED');
 const [original]=await identity.sql<{key:string;quote_id:string;buyer_note:string|null;cart_revision:number}[]>`select op.key,o.quote_id,o.buyer_note,q.cart_revision from app.commerce_order o
  join app.commerce_operation op on op.id=o.operation_id and op.resource_id=o.id and op.action='order.create'
  join app.checkout_quote q on q.id=o.quote_id where o.id=${order} and o.cart_id=${current.cart.id}`;
 if(!original)throw new AccessError(401,'UNAUTHENTICATED');
 const response=await handleCheckout(checkoutApiRequest(request,'/api/v1/orders','POST',{quote_id:original.quote_id,...(original.buyer_note===null?{}:{buyer_note:original.buyer_note})},original.key,String(original.cart_revision)),identity),data=await response.json();
 if(!response.ok)throw new AccessError(response.status,data.code);
 if(data.order?.id!==order)throw new Error('Unexpected checkout recovery result');
 return {order:data.order as CheckoutOrder,cookies:response.headers.getSetCookie()};
}
