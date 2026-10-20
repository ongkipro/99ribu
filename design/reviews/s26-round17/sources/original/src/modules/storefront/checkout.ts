import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin} from '../access/http.ts';
import {AccessError} from '../access/policy.ts';
import {id,invalid} from '../catalog/validation.ts';
import {commerceActor,cookie,prefix} from '../checkout/access.ts';
import {expectedCartVersion,mutationKey} from '../checkout/carts.ts';
import type {projectOrder} from '../checkout/orders.ts';
import {normalizeContact,ownedQuote,type projectQuote} from '../checkout/quotes.ts';
import {handleCheckout} from '../checkout/routes.ts';
import {clean,normalizeAddress,normalizePhone,shippingFixture} from '../shipping/address.ts';
import {readCartView,type BrowserCart} from './cart.ts';

export type CheckoutDraft={recipient_name:string;phone:string;email:string;destination_id:string;address_line:string;buyer_note:string;payment_method:string};
export type CheckoutQuote=ReturnType<typeof projectQuote>;
export type CheckoutOrder=Awaited<ReturnType<typeof projectOrder>>;
export type Destination=ReturnType<typeof shippingFixture>['destinations'][number];
export type CheckoutIntent={kind:'quote'|'shipping'|'order';key:string;cart:string;version:string;quote:string;allocation_id:string;query:string;draft:CheckoutDraft;packages:{package_id:string;shipping_option_id:string}[];navigate:string};
export type CheckoutView={kind:'ready'|'none'|'denied'|'unavailable';cart:BrowserCart|null;quote:CheckoutQuote|null;quoteCurrent:boolean;draft:CheckoutDraft;destinations:Destination[];now:string|null;issue:'cart'|'expired'|'submitted'|null;code:string|null};
export type CheckoutState={phase:'idle'|'success'|'error'|'unknown';step:'contact'|'shipping'|'review';intent:CheckoutIntent;view:CheckoutView;errors:Partial<Record<keyof CheckoutDraft|'query',string>>;message:string;code:string|null;blocked:boolean};
const draftFields=['recipient_name','phone','email','destination_id','address_line','buyer_note','payment_method'] as const;
const scalarFields=['kind','key','cart','version','quote','allocation_id','query','navigate',...draftFields];
const lengths:Record<string,number>={kind:10,key:200,cart:36,version:10,quote:36,allocation_id:100,query:100,navigate:10,recipient_name:200,phone:30,email:254,destination_id:100,address_line:500,buyer_note:500,payment_method:10};
export const emptyCheckoutDraft=():CheckoutDraft=>({recipient_name:'',phone:'',email:'',destination_id:'',address_line:'',buyer_note:'',payment_method:'prepaid'});
export const initialCheckoutIntent=(values:Partial<CheckoutIntent>={}):CheckoutIntent=>({kind:'quote',key:randomUUID(),cart:'',version:'',quote:'',allocation_id:'',query:'',draft:emptyCheckoutDraft(),packages:[],navigate:'',...values});
export const checkoutUnavailableView=():CheckoutView=>({kind:'unavailable',cart:null,quote:null,quoteCurrent:false,draft:emptyCheckoutDraft(),destinations:[],now:null,issue:null,code:'SERVICE_UNAVAILABLE'});
export function initialCheckoutState(view:CheckoutView):CheckoutState{
 const step=view.quoteCurrent?'shipping':'contact';
 return {phase:'idle',step,intent:initialCheckoutIntent({kind:step==='shipping'?'shipping':'quote',cart:view.cart?.id??'',version:String(view.cart?.version??''),quote:view.quote?.id??'',allocation_id:view.quote?.selected_allocation_id??'',draft:view.draft}),view,errors:{},message:'',code:null,blocked:view.kind!=='ready'};
}

export function checkoutFormInput(data:FormData):CheckoutIntent{
 let count=0,bytes=0;
 for(const [name,value] of data){
  if(name.startsWith('$ACTION_'))continue;
  if(!scalarFields.includes(name)&&!['package_id','shipping_option_id'].includes(name)||typeof value!=='string')throw invalid();
  bytes+=Buffer.byteLength(value);if(++count>120||bytes>32768)throw invalid();
 }
 const scalar=(name:string)=>{const values=data.getAll(name);if(values.length>1||values.length===1&&typeof values[0]!=='string')throw invalid();const value=String(values[0]??'');if(value.length>lengths[name])throw invalid();return value;};
 const values=Object.fromEntries(scalarFields.map(name=>[name,scalar(name)]));
 if(!['quote','shipping','order'].includes(values.kind)||!['','lookup','contact','shipping','review'].includes(values.navigate))throw invalid();
 mutationKey(new Request('http://localhost',{headers:{'idempotency-key':values.key}}));
 expectedCartVersion(new Request('http://localhost',{headers:{'if-match':`"${values.version}"`}}));
 const cart=id(values.cart),quote=values.quote?id(values.quote):'';
 if(values.kind!=='quote'&&!quote)throw invalid();
 const packageIds=data.getAll('package_id'),options=data.getAll('shipping_option_id');
 if(packageIds.length!==options.length||packageIds.length>50||values.kind!=='shipping'&&packageIds.length)throw invalid();
 const packages=packageIds.map((value,index)=>{if(typeof value!=='string'||typeof options[index]!=='string'||value.length>100||String(options[index]).length>100)throw invalid();return {package_id:value,shipping_option_id:String(options[index])};});
 if(new Set(packages.map(p=>p.package_id)).size!==packages.length)throw invalid();
 return {kind:values.kind as CheckoutIntent['kind'],key:values.key,cart,version:values.version,quote,allocation_id:values.allocation_id,query:values.query,navigate:values.navigate,draft:Object.fromEntries(draftFields.map(name=>[name,values[name]])) as CheckoutDraft,packages};
}

// Line breaks are a form presentation detail; the existing wire accepts a
// single clean address/note string. Other controls/bidi remain rejected there.
const singleLine=(value:string)=>value.replace(/\r\n?/g,'\n').replace(/\n/g,' ');
export function validateCheckoutDraft(draft:CheckoutDraft){
 const errors:CheckoutState['errors']={};let recipient='',street='',phone='',note:string|undefined,contact:ReturnType<typeof normalizeContact>|null=null;
 try{recipient=clean(draft.recipient_name,200);}catch{errors.recipient_name='Isi nama penerima, maksimal 200 karakter.';}
 try{street=clean(singleLine(draft.address_line),500);}catch{errors.address_line='Isi alamat lengkap, maksimal 500 karakter.';}
 try{phone=normalizePhone(draft.phone);}catch{errors.phone='Masukkan nomor HP Indonesia yang dapat dihubungi.';}
 if(phone)try{contact=normalizeContact({phone,email:draft.email.trim()||null});}catch{errors.email='Periksa alamat email atau kosongkan jika tidak digunakan.';}
 const destination=shippingFixture().destinations.find(d=>d.id===draft.destination_id);
 if(!destination)errors.destination_id='Pilih wilayah dari daftar tujuan pengiriman.';
 if(!['prepaid','cod'].includes(draft.payment_method))errors.payment_method='Pilih metode pembayaran yang tersedia.';
 if(draft.buyer_note.trim())try{note=clean(singleLine(draft.buyer_note),500);}catch{errors.buyer_note='Gunakan catatan maksimal 500 karakter tanpa karakter kontrol.';}
 if(Object.keys(errors).length||!destination||!contact)return {errors,wire:null};
 const address={recipient_name:recipient,phone,address_line:street,destination_id:destination.id,postal_code:destination.postal_code};
 return {errors,wire:{address,canonicalAddress:normalizeAddress(address),contact,payment_method:draft.payment_method as 'prepaid'|'cod',...(note?{buyer_note:note}:{})}};
}

export function checkoutApiRequest(request:Request,path:string,method:string,body?:unknown,key?:string,version?:string){
 const headers=new Headers(request.headers);headers.delete('content-length');headers.delete('idempotency-key');headers.delete('if-match');headers.set('content-type','application/json');
 if(key)headers.set('idempotency-key',key);if(version)headers.set('if-match',`"${version}"`);
 return new Request(new URL(path,request.url),{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function callCheckout(request:Request,identity:LocalAuth,path:string,method='GET',body?:unknown,key?:string,version?:string,dispatch:typeof handleCheckout=handleCheckout){
 const response=await dispatch(checkoutApiRequest(request,path,method,body,key,version),identity),data=await response.json();
 if(!response.ok)throw new AccessError(response.status,typeof data.code==='string'?data.code:'SERVICE_UNAVAILABLE');
 return {data,cookies:response.headers.getSetCookie()};
}
export async function assertCheckoutTransport(request:Request,identity:LocalAuth){
 assertOrigin(request);
 if(['authorization','x-cart-token','x-order-token'].some(name=>request.headers.has(name)))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
 const p=await prefix(identity);for(const name of ['session_token','commerce_guest','cart_access','order_access','checkout_access'])cookie(request,`${p}.${name}`);return p;
}
export async function readCheckout(request:Request,identity:LocalAuth,dispatch:typeof handleCheckout=handleCheckout):Promise<CheckoutView>{
 try{await assertCheckoutTransport(request,identity);}
 catch(error){return {...checkoutUnavailableView(),kind:error instanceof AccessError&&error.status<500?'denied':'unavailable',code:error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE'};}
 const current=await readCartView(request,identity);
 if(current.kind!=='ready')return {...checkoutUnavailableView(),kind:current.kind,code:current.code};
 let quote:CheckoutQuote|null=null;
 if(current.cart.active_quote_id){try{quote=(await callCheckout(request,identity,`/api/v1/checkout/quotes/${current.cart.active_quote_id}`,'GET',undefined,undefined,undefined,dispatch)).data as CheckoutQuote;}catch(error){return {...checkoutUnavailableView(),kind:error instanceof AccessError&&[401,403].includes(error.status)?'denied':'unavailable',code:error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE'};}}
 const draft:CheckoutDraft=quote?{recipient_name:quote.address.recipient_name,phone:quote.contact.phone,email:quote.contact.email??'',destination_id:quote.address.destination_id,address_line:quote.address.address_line,buyer_note:'',payment_method:quote.payment_method}:emptyCheckoutDraft();
 const expired=Date.parse(current.cart.expires_at)<=Date.parse(current.now),issue=current.cart.state==='submitted'?'submitted':expired||current.cart.state!=='open'?'expired':current.lines.some(l=>!l.product||!l.offer||!l.stock||l.publicationChanged)?'cart':null;
 return {kind:'ready',cart:current.cart,quote,quoteCurrent:Boolean(quote&&quote.id===current.cart.active_quote_id&&quote.cart_version===current.cart.version&&Date.parse(quote.expires_at)>Date.parse(current.now)&&!issue),draft,destinations:shippingFixture().destinations,now:current.now,issue,code:null};
}
const messages:Record<string,string>={
 INVALID_INPUT:'Periksa isian sebelum melanjutkan.',INVALID_IDEMPOTENCY_KEY:'Muat ulang checkout sebelum mencoba lagi.',
 CART_VERSION_REQUIRED:'Buka kembali keranjang untuk memeriksa isinya.',CART_VERSION_CONFLICT:'Isi keranjang berubah dari halaman lain. Periksa kembali sebelum menghitung pengiriman.',
 CART_EMPTY:'Keranjang masih kosong. Pilih produk sebelum checkout.',CART_EXPIRED:'Keranjang kedaluwarsa. Kembali ke keranjang untuk memulai lagi.',CART_SUBMITTED:'Keranjang ini sudah menjadi pesanan. Periksa pesanan yang tersimpan.',
 QUOTE_EXPIRED:'Perhitungan pengiriman kedaluwarsa. Hitung ulang, lalu periksa total terbaru.',QUOTE_SUPERSEDED:'Perhitungan pengiriman berubah. Hitung ulang dan periksa setiap paket.',
 SHIPPING_RATE_EXPIRED:'Tarif pengiriman kedaluwarsa. Hitung ulang pengiriman.',SHIPPING_OPTION_UNAVAILABLE:'Layanan yang dipilih sudah tidak tersedia. Pilih kembali layanan pengiriman.',
 COD_UNAVAILABLE:'COD belum tersedia untuk tujuan atau paket ini. Pilih pembayaran online atau ubah tujuan.',NO_SUPPORTED_ROUTE:'Belum ada pengiriman untuk tujuan dan isi keranjang ini.',ROUTE_UNCONFIGURED:'Tujuan ini belum memiliki layanan pengiriman. Pilih tujuan lain.',
 DESTINATION_UNAVAILABLE:'Tujuan pengiriman sudah tidak tersedia. Pilih kembali dari daftar.',DESTINATION_POSTCODE_MISMATCH:'Wilayah dan kode pos perlu diperiksa kembali.',
 OFFER_UNAVAILABLE:'Pilihan produk tidak tersedia. Periksa kembali keranjang.',INSUFFICIENT_COMPLETE_STOCK:'Stok pilihan lengkap berubah. Periksa kembali keranjang.',INSUFFICIENT_STOCK:'Stok berubah sebelum pesanan tersimpan. Periksa keranjang.',PUBLICATION_REVIEW_REQUIRED:'Rincian pilihan berubah. Setujui isi terbaru dari keranjang.',
 PROMOTION_REVIEW_REQUIRED:'Perhitungan promo berubah. Hitung ulang pengiriman dan periksa total.',PROMOTION_BUDGET_EXHAUSTED:'Kuota promo berubah. Hitung ulang total sebelum melanjutkan.',FINANCIAL_REVIEW_REQUIRED:'Perhitungan pengiriman perlu diperbarui. Hitung ulang dan periksa total.',
 UNAUTHENTICATED:'Sesi belanja perlu diperiksa. Kembali ke keranjang.',UNSUPPORTED_AUTH_TRANSPORT:'Buka checkout melalui sesi belanja situs ini.',INVALID_ORIGIN:'Buka checkout dari situs ini sebelum mencoba lagi.',IDEMPOTENCY_CONFLICT:'Tindakan ini memiliki rincian berbeda. Periksa kembali sebelum mengirim ulang.'
};

export async function mutateCheckout(request:Request,identity:LocalAuth,intent:CheckoutIntent,dispatch:typeof handleCheckout=handleCheckout):Promise<{state:CheckoutState;cookies:string[];order:CheckoutOrder|null}>{
 const cookies:string[]=[];
 const call=(path:string,method='GET',body?:unknown,key?:string,version?:string)=>callCheckout(request,identity,path,method,body,key,version,dispatch);
 const fresh=async()=>initialCheckoutState(await readCheckout(request,identity));
 const acceptedQuote=async(quote:CheckoutQuote)=>{
  const state=await fresh();if(state.view.kind==='unavailable')throw new AccessError(503,'SERVICE_UNAVAILABLE');
  if(state.view.kind!=='ready')throw new AccessError(401,'UNAUTHENTICATED');
  if(state.view.cart?.id!==intent.cart)throw new AccessError(409,'CART_VERSION_CONFLICT');
  if(state.view.quote?.id!==quote.id)throw new AccessError(409,'QUOTE_SUPERSEDED');
  if(!state.view.quoteCurrent)throw new AccessError(409,state.view.issue==='cart'?'OFFER_UNAVAILABLE':'QUOTE_EXPIRED');return state;
 };
 try{
  if(request.method!=='POST')throw invalid();
  await assertCheckoutTransport(request,identity);
  if(intent.navigate){
   const state=await fresh();
   if(state.view.kind==='denied'||state.view.kind==='none'||state.view.cart&&state.view.cart.id!==intent.cart)return {state:{...state,phase:'error',message:'Sesi atau keranjang berubah. Periksa keranjang yang aktif.'},cookies,order:null};
   if(state.view.kind==='unavailable')return {state:{...state,phase:'error',intent,blocked:false,message:'Data checkout belum tersedia. Isian Anda tetap tersimpan di halaman ini.'},cookies,order:null};
   const sameQuote=state.view.quote?.id===intent.quote;
   state.intent={...intent,key:randomUUID(),navigate:'',version:String(state.view.cart?.version??intent.version),quote:state.view.quote?.id??'',allocation_id:sameQuote?intent.allocation_id:state.view.quote?.selected_allocation_id??'',packages:sameQuote?intent.packages:[]};
   const validation=validateCheckoutDraft(intent.draft),wire=validation.wire,q=state.view.quote;
   const unchanged=Boolean(wire&&q&&isDeepStrictEqual(q.address,wire.canonicalAddress)&&isDeepStrictEqual(q.contact,wire.contact)&&q.payment_method===wire.payment_method);
   state.step=['shipping','review'].includes(intent.navigate)&&state.view.quoteCurrent&&unchanged?intent.navigate==='review'&&sameQuote&&String(state.view.cart?.version)===intent.version?'review':'shipping':'contact';
   state.intent.kind=state.step==='review'?'order':state.step==='shipping'?'shipping':'quote';
   if(intent.navigate==='lookup'){
    if(!intent.query.trim()){state.view.destinations=shippingFixture().destinations;}
    else state.view.destinations=(await call(`/api/v1/destinations?q=${encodeURIComponent(intent.query)}&limit=20`)).data.items as Destination[];
    state.message=state.view.destinations.length?'Pilih tujuan dari hasil pencarian.':'Tujuan tidak ditemukan. Coba nama wilayah lain.';
   }
   return {state,cookies,order:null};
  }
  const validation=validateCheckoutDraft(intent.draft);
  if(!validation.wire){
   const state=await fresh();
   if(state.view.kind==='denied'||state.view.kind==='none'||state.view.cart&&state.view.cart.id!==intent.cart)return {state:{...state,phase:'error',message:'Sesi atau keranjang berubah. Periksa keranjang yang aktif.'},cookies,order:null};
   return {state:{...state,phase:'error',step:'contact',intent:{...intent,key:randomUUID()},blocked:false,errors:validation.errors,message:'Periksa isian yang ditandai.',code:'INVALID_INPUT'},cookies,order:null};
  }
  const wire=validation.wire;
  if(intent.kind==='quote'){
   const reply=await call('/api/v1/checkout/quotes','POST',{cart_id:intent.cart,address:wire.address,contact:wire.contact,payment_method:wire.payment_method},intent.key,intent.version);
   const state=await acceptedQuote(reply.data as CheckoutQuote);return {state:{...state,phase:'success',step:'shipping',intent:{...state.intent,draft:intent.draft,kind:'shipping',query:intent.query},message:'Periksa asal paket, layanan dan ongkos kirim.'},cookies,order:null};
  }
  const quote=(await call(`/api/v1/checkout/quotes/${intent.quote}`)).data as CheckoutQuote;
  if(!isDeepStrictEqual(quote.address,wire.canonicalAddress)||!isDeepStrictEqual(quote.contact,wire.contact)||quote.payment_method!==wire.payment_method){
   const state=await fresh();return {state:{...state,phase:'error',step:'contact',intent:{...intent,key:randomUUID(),kind:'quote',packages:[]},message:'Alamat atau metode berubah. Lanjutkan ke pengiriman untuk menghitung ulang.',code:'INVALID_INPUT'},cookies,order:null};
  }
  if(intent.kind==='shipping'){
   let packages=intent.packages;const allocationChanged=Boolean(intent.allocation_id&&intent.allocation_id!==quote.selected_allocation_id);
   if(allocationChanged){
    const actor=await commerceActor(request,identity);if(!actor)throw new AccessError(401,'UNAUTHENTICATED');
    packages=await identity.sql.begin(async tx=>{const {quote:owned}=await ownedQuote(tx,request,identity,actor,intent.quote);const plan=owned.document.plans.find(p=>p.id===intent.allocation_id);if(!plan)throw new AccessError(409,'SHIPPING_OPTION_UNAVAILABLE');return plan.packages.map(p=>({package_id:p.id,shipping_option_id:p.selected_option_id}));});
   }
   const reply=await call(`/api/v1/checkout/quotes/${intent.quote}/selection`,'POST',{...(intent.allocation_id?{allocation_id:intent.allocation_id}:{}),packages},intent.key,intent.version);
   const state=await acceptedQuote(reply.data as CheckoutQuote);return {state:{...state,phase:'success',step:allocationChanged?'shipping':'review',intent:{...state.intent,kind:allocationChanged?'shipping':'order',draft:intent.draft},message:allocationChanged?'Pembagian paket diperbarui. Periksa layanan setiap paket sebelum meninjau total.':'Periksa seluruh paket dan total sebelum membuat pesanan.'},cookies,order:null};
  }
  const reply=await call('/api/v1/orders','POST',{quote_id:intent.quote,...(wire.buyer_note?{buyer_note:wire.buyer_note}:{})},intent.key,intent.version);cookies.push(...reply.cookies);
  const order=reply.data.order as CheckoutOrder;
  let state:CheckoutState;try{state=await fresh();}catch{state=initialCheckoutState(checkoutUnavailableView());}
  if(state.view.kind==='denied'||state.view.kind==='none')return {state:{...state,phase:'error',intent:initialCheckoutIntent(),view:{...checkoutUnavailableView(),kind:'denied',code:'UNAUTHENTICATED'},blocked:true,message:'Sesi berubah setelah tindakan. Akses pesanan perlu diperiksa.',code:'UNAUTHENTICATED'},cookies:[],order:null};
  return {state:{...state,phase:'success',step:'review',intent,message:'Pesanan tersimpan.'},cookies,order};
 }catch(error){
  const code=error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE',blocked=error instanceof AccessError&&[401,403].includes(error.status),unknown=!intent.navigate&&(!(error instanceof AccessError)||error.status>=500);
  let state:CheckoutState;try{state=await fresh();}catch{state=initialCheckoutState(checkoutUnavailableView());}
  const lostScope=blocked||state.view.kind==='denied'||state.view.kind==='none'||!unknown&&Boolean(state.view.cart&&state.view.cart.id!==intent.cart);
  const safeIntent=lostScope?initialCheckoutIntent():unknown?intent:{...intent,key:randomUUID(),kind:'quote' as const,version:state.view.cart?.id===intent.cart?String(state.view.cart.version):intent.version,quote:state.view.quote?.id??'',packages:[],navigate:''};
  return {state:{...state,phase:unknown?'unknown':'error',step:unknown?intent.kind==='order'?'review':intent.kind==='shipping'?'shipping':'contact':'contact',intent:safeIntent,view:lostScope?{...checkoutUnavailableView(),kind:'denied',code}:state.view.cart&&state.view.cart.id!==intent.cart?checkoutUnavailableView():state.view,errors:intent.navigate==='lookup'&&code==='INVALID_INPUT'?{query:'Periksa kata pencarian wilayah.'}:{},message:lostScope?'Sesi atau keranjang berubah. Hasil tindakan hanya dapat diperiksa melalui akses yang sah.':unknown?'Hasil tindakan belum diketahui. Ulangi tindakan yang sama untuk memeriksa hasilnya.':messages[code]??'Perubahan belum diterapkan. Periksa kembali pilihan dan coba lagi.',code,blocked:lostScope},cookies,order:null};
 }
}
