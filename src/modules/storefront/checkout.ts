import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin} from '../access/http.ts';
import {AccessError} from '../access/policy.ts';
import {id,invalid} from '../catalog/validation.ts';
import {commerceActor,cookie,prefix} from '../checkout/access.ts';
import {expectedCartVersion,mutationKey} from '../checkout/carts.ts';
import type {projectOrder} from '../checkout/orders.ts';
import {voucherCode} from '../promotions/configuration.ts';
import {normalizeContact,ownedQuote,type projectQuote,type QuoteDocument} from '../checkout/quotes.ts';
import {handleCheckout} from '../checkout/routes.ts';
import {channelEnabled,offeredChannels,paymentTerms,type PaymentTerms} from '../payments/methods.ts';
import {clean,normalizePhone} from '../shipping/address.ts';
import {canonicalAddress,districtAreas,findDestination,initialDestinations,type Destination as ShippingDestination,type DestinationDistrict} from '../shipping/destinations.ts';
import {readCartView,type BrowserCart} from './cart.ts';
import {rupiah,sameOrigin} from './format.ts';
import {checkoutDraftFields,checkoutDraftLimits,checkoutDraftsEnabled,readCheckoutDraft,type CheckoutProgress} from './checkout-draft.ts';
import {displayPhone} from './contact.ts';

export type CheckoutDraft={recipient_name:string;phone:string;email:string;destination_id:string;address_line:string;buyer_note:string;payment_method:string};
export type CheckoutQuote=ReturnType<typeof projectQuote>;
export type CheckoutOrder=Awaited<ReturnType<typeof projectOrder>>;
export type Destination=ShippingDestination;
export type CheckoutAllocation={id:string;shipping_total:number;packages:{id:string;origin_city:string;items:{name:string;variant:string;quantity:number;contents:string[]}[];service:string;service_name:string;alternatives:string[];shipping_amount:number}[];equivalent_count:number};
export type CheckoutIntent={kind:'quote'|'shipping'|'order';key:string;cart:string;version:string;quote:string;allocation_id:string;query:string;draft:CheckoutDraft;packages:{package_id:string;shipping_option_id:string}[];navigate:string;draft_writer:string;draft_sequence:string;draft_revision:string;voucher:string};
export type CheckoutView={kind:'ready'|'none'|'denied'|'unavailable';cart:BrowserCart|null;quote:CheckoutQuote|null;allocations:CheckoutAllocation[];quoteCurrent:boolean;draft:CheckoutDraft;progress:CheckoutProgress|null;draftExpired:boolean;destinations:Destination[];methods:string[];drafts:boolean;images:Record<string,{src:string;width:number;height:number}>;now:string|null;issue:'cart'|'expired'|'submitted'|null;code:string|null};
export type CheckoutState={phase:'idle'|'success'|'error'|'unknown';step:'contact'|'shipping'|'review';intent:CheckoutIntent;view:CheckoutView;errors:Partial<Record<keyof CheckoutDraft|'query'|'voucher',string>>;message:string;code:string|null;blocked:boolean;draftConflict:boolean;previousTotal?:number};
const draftFields=checkoutDraftFields;
const scalarFields=['kind','key','cart','version','quote','allocation_id','query','navigate','draft_writer','draft_sequence','draft_revision','voucher','voucher_input','voucher_apply','voucher_remove',...draftFields];
const lengths:Record<string,number>={kind:10,key:200,cart:36,version:10,quote:36,allocation_id:100,query:100,navigate:10,draft_writer:36,draft_sequence:16,draft_revision:16,voucher:40,voucher_input:40,voucher_apply:1,voucher_remove:1,...checkoutDraftLimits};
// Form method → payment channel. Only offered channels are listed or accepted (production: transfer and COD).
const DRAFT_METHODS={prepaid:'local-prepaid',transfer:'manual-bank',va:'autolaris',cod:'cod'} as const;
export const offeredMethods=()=>Object.entries(DRAFT_METHODS).filter(([,channel])=>offeredChannels().includes(channel)).map(([method])=>method);
// What the checkout lists: the runtime's channels the owner's payment policy has switched on (the quote re-checks).
export const enabledMethods=(terms:PaymentTerms)=>Object.entries(DRAFT_METHODS).filter(([,channel])=>channelEnabled(terms,channel)).map(([method])=>method);
// The first offered method is preselected (owner 2026-11-05, like Shopify): couriers then load as soon as the address is
// complete instead of waiting for a payment choice further down. A prepaid channel first; COD (fee, fewer couriers) only
// when it is the sole method. Changing the method recomputes the couriers.
export const defaultPaymentMethod=(methods:readonly string[]=offeredMethods())=>methods.find(m=>m!=='cod')??methods[0]??'';
export const emptyCheckoutDraft=():CheckoutDraft=>({recipient_name:'',phone:'',email:'',destination_id:'',address_line:'',buyer_note:'',payment_method:defaultPaymentMethod()});
export const initialCheckoutIntent=(values:Partial<CheckoutIntent>={}):CheckoutIntent=>({kind:'quote',key:randomUUID(),cart:'',version:'',quote:'',allocation_id:'',query:'',draft:emptyCheckoutDraft(),packages:[],navigate:'',draft_writer:randomUUID(),draft_sequence:'0',draft_revision:'0',voucher:'',...values});
export const checkoutUnavailableView=():CheckoutView=>({kind:'unavailable',cart:null,quote:null,allocations:[],quoteCurrent:false,draft:emptyCheckoutDraft(),progress:null,draftExpired:false,destinations:[],methods:[],drafts:false,images:{},now:null,issue:null,code:'SERVICE_UNAVAILABLE'});

export function checkoutAllocationChoices(document:QuoteDocument,cart:BrowserCart,preferred:string){
 const groups=new Map<string,CheckoutAllocation>();let issuedKey='';
 for(const plan of [document.selected_plan,...document.plans.filter(p=>p.id!==document.selected_plan.id)]){
  const packages=plan.packages.map(parcel=>{
   const service=parcel.options.find(option=>option.id===parcel.selected_option_id);if(!service)throw new AccessError(503,'SERVICE_UNAVAILABLE');
   const items=parcel.lines.map(part=>{const line=cart.lines.find(line=>line.id===part.line_id);if(!line)throw new AccessError(503,'SERVICE_UNAVAILABLE');return {name:line.name,variant:line.variant_label,quantity:part.quantity,contents:line.contents.map(c=>`${c.quantity} × ${c.name}`)};}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
   return {id:parcel.id,origin_city:parcel.origin_city,items,service:`${service.courier_name} · ${service.service_name}`,service_name:service.service_name,alternatives:parcel.options.filter(o=>o.id!==service.id).map(o=>`${o.courier_name} · ${o.service_name} · ${rupiah(o.shipping_amount)}`).sort(),shipping_amount:parcel.shipping_amount};
  });
  const visibleKey=JSON.stringify([plan.shipping_total,packages.map(({id:_id,...visible})=>JSON.stringify(visible)).sort()]);
  if(plan.id===document.selected_plan.id)issuedKey=visibleKey;
  // Only an alias of the issued group needs a separate pending/revert identity.
  const key=JSON.stringify([visibleKey,plan.id===preferred&&preferred!==document.selected_plan.id&&visibleKey===issuedKey?preferred:null]),previous=groups.get(key);
  const choice={id:plan.id,shipping_total:plan.shipping_total,packages,equivalent_count:(previous?.equivalent_count??0)+1};
  if(!previous||plan.id===preferred||previous.id!==preferred&&plan.id===document.selected_plan.id)groups.set(key,choice);
  else previous.equivalent_count=choice.equivalent_count;
 }
 return [...groups.values()];
}
// The kecamatan field shows the chosen area's kecamatan when nothing was typed (profile prefill, older drafts).
const districtLabel=(d:Destination|undefined)=>d?`${d.district}, ${d.city}, ${d.province}`:'';
export function initialCheckoutState(view:CheckoutView):CheckoutState{
 const progress=view.progress,q=view.quote,wire=q?validateCheckoutDraft(view.draft,view.destinations).wire:null;
 const same=Boolean(q&&wire&&isDeepStrictEqual(q.address,wire.canonicalAddress)&&isDeepStrictEqual(q.contact,wire.contact)&&q.payment_method===wire.payment_method&&q.payment_channel===wire.payment_channel&&(!progress||progress.quote===q.id&&progress.cart_version===view.cart?.version));
 // Single-page checkout (owner 2026-10-31, Shopify-like): a current quote opens on the order step, where couriers stay editable.
 const step=view.quoteCurrent&&same&&!view.draftExpired&&progress?.step!=='contact'?'review':'contact';
 const allocation=progress&&q&&progress.quote===q.id&&q.allocation_options.some(p=>p.id===progress.allocation_id)?progress.allocation_id:q?.selected_allocation_id??'';
 const packages=progress&&q&&progress.quote===q.id?progress.packages.filter(p=>q.packages.some(parcel=>parcel.id===p.package_id&&parcel.options.some(o=>o.id===p.shipping_option_id))):[];
 return {phase:'idle',step,intent:initialCheckoutIntent({kind:step==='review'?'order':'quote',cart:view.cart?.id??'',version:String(view.cart?.version??''),quote:q?.id??'',allocation_id:allocation,draft:view.draft.payment_method&&view.methods.includes(view.draft.payment_method)?view.draft:{...view.draft,payment_method:defaultPaymentMethod(view.methods)},query:progress?.query||districtLabel(view.destinations.find(d=>d.id===view.draft.destination_id)),packages,draft_revision:String(progress?.revision??0),voucher:q?.voucher?.status==='applied'?q.voucher.code:''}),view,errors:{},message:view.draftExpired?'Draf sebelumnya sudah berakhir. Periksa isian sebelum melanjutkan.':'',code:null,blocked:view.kind!=='ready',draftConflict:false};
}

const quoteVoucher=(value:string)=>{try{return voucherCode(value||null);}catch{return null;}};
export function checkoutFormInput(data:FormData):CheckoutIntent{
 const packageIds=data.getAll('package_id');
 if(packageIds.length>50||packageIds.some(value=>typeof value!=='string'||value.length>100))throw invalid();
 const serviceFields=new Set(packageIds.map(value=>`shipping_option:${value}`));
 let count=0,bytes=0;
 for(const [name,value] of data){
  if(name.startsWith('$ACTION_'))continue;
  if(!scalarFields.includes(name)&&!['package_id','shipping_option_id'].includes(name)&&!serviceFields.has(name)||typeof value!=='string')throw invalid();
  bytes+=Buffer.byteLength(value);if(++count>120||bytes>32768)throw invalid();
 }
 const scalar=(name:string)=>{const values=data.getAll(name);if(values.length>1||values.length===1&&typeof values[0]!=='string')throw invalid();const value=String(values[0]??'');if(value.length>lengths[name])throw invalid();return value;};
 const values=Object.fromEntries(scalarFields.map(name=>[name,scalar(name)]));
 if(!['quote','shipping','order'].includes(values.kind)||!['','lookup','stay','contact','shipping','review','cart','home'].includes(values.navigate))throw invalid();
 mutationKey(new Request('http://localhost',{headers:{'idempotency-key':values.key}}));
 expectedCartVersion(new Request('http://localhost',{headers:{'if-match':`"${values.version}"`}}));
 const cart=id(values.cart),quote=values.quote?id(values.quote):'';
 const writer=values.draft_writer?id(values.draft_writer):randomUUID();
 for(const name of ['draft_sequence','draft_revision'])if(values[name]&&(!/^(?:0|[1-9]\d{0,15})$/.test(values[name])||!Number.isSafeInteger(Number(values[name]))))throw invalid();
 if(values.kind!=='quote'&&!quote)throw invalid();
 // S177: "Pakai"/remove recomputes the quote with (or without) the typed code; the courier choices are then reissued.
 // The typed text is kept as typed (trimmed, upper-case); the action sends only a well-formed code (`quoteVoucher`).
 const voucherAction=values.voucher_apply?'apply':values.voucher_remove?'remove':null;
 const voucher=voucherAction==='remove'?'':voucherAction==='apply'?values.voucher_input.normalize('NFKC').trim().toUpperCase():values.voucher;
 if(voucherAction)return {kind:'quote',key:randomUUID(),cart,version:values.version,quote,allocation_id:'',query:values.query,navigate:'',draft:Object.fromEntries(draftFields.map(name=>[name,values[name]])) as CheckoutDraft,packages:[],draft_writer:writer,draft_sequence:values.draft_sequence||'0',draft_revision:values.draft_revision||'0',voucher};
 const named=packageIds.some(value=>data.has(`shipping_option:${value}`));
 if(named&&data.has('shipping_option_id'))throw invalid();
 const options=named?packageIds.map(value=>{const choices=data.getAll(`shipping_option:${value}`);if(choices.length!==1)throw invalid();return choices[0];}):data.getAll('shipping_option_id');
 if(packageIds.length!==options.length||packageIds.length>50||values.kind==='quote'&&packageIds.length)throw invalid();
 const packages=packageIds.map((value,index)=>{if(typeof value!=='string'||typeof options[index]!=='string'||value.length>100||String(options[index]).length>100)throw invalid();return {package_id:value,shipping_option_id:String(options[index])};});
 if(new Set(packages.map(p=>p.package_id)).size!==packages.length)throw invalid();
 return {kind:values.kind as CheckoutIntent['kind'],key:values.key,cart,version:values.version,quote,allocation_id:values.allocation_id,query:values.query,navigate:values.navigate,draft:Object.fromEntries(draftFields.map(name=>[name,values[name]])) as CheckoutDraft,packages,draft_writer:writer,draft_sequence:values.draft_sequence||'0',draft_revision:values.draft_revision||'0',voucher};
}

// Line breaks are a form presentation detail; the existing wire accepts a
// single clean address/note string. Other controls/bidi remain rejected there.
const singleLine=(value:string)=>value.replace(/\r\n?/g,'\n').replace(/\n/g,' ');
// destinations: the resolved areas this draft may name (the view's list, or the area just looked up).
export function validateCheckoutDraft(draft:CheckoutDraft,destinations:readonly Destination[]){
 const errors:CheckoutState['errors']={};let recipient='',street='',phone='',note:string|undefined,contact:ReturnType<typeof normalizeContact>|null=null;
 try{recipient=clean(draft.recipient_name,200);}catch{errors.recipient_name='Isi nama lengkap penerima, maksimal 200 karakter.';}
 try{street=clean(singleLine(draft.address_line),500);}catch{errors.address_line='Isi alamat lengkap, maksimal 500 karakter.';}
 try{phone=normalizePhone(draft.phone);}catch{errors.phone='Masukkan nomor WhatsApp Indonesia yang aktif, mis. 0812 3456 7890.';}
 // Checkout asks no email (owner 2026-11-05): the draft field stays for stored drafts but never reaches the quote.
 if(phone)contact=normalizeContact({phone,email:null});
 const destination=destinations.find(d=>d.id===draft.destination_id);
 if(!destination)errors.destination_id='Pilih kecamatan, lalu kelurahan atau desa tujuan.';
 // DEC-008: 'transfer' is the manual bank channel and 'va' the AutoLaris VA/QRIS channel of the prepaid method.
 if(!offeredMethods().includes(draft.payment_method))errors.payment_method='Pilih metode pembayaran yang tersedia.';
 if(draft.buyer_note.trim())try{note=clean(singleLine(draft.buyer_note),500);}catch{errors.buyer_note='Gunakan catatan maksimal 500 karakter tanpa karakter kontrol.';}
 if(Object.keys(errors).length||!destination||!contact)return {errors,wire:null};
 const address={recipient_name:recipient,phone,address_line:street,destination_id:destination.id,postal_code:destination.postal_code};
 return {errors,wire:{address,canonicalAddress:canonicalAddress(address,destination),contact,payment_method:(draft.payment_method==='cod'?'cod':'prepaid') as 'prepaid'|'cod',payment_channel:(draft.payment_method==='cod'?'cod':draft.payment_method==='transfer'?'manual-bank':draft.payment_method==='va'?'autolaris':'local-prepaid') as 'cod'|'manual-bank'|'autolaris'|'local-prepaid',...(note?{buyer_note:note}:{})}};
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
 const p=await prefix(identity);for(const name of ['session_token','commerce_guest','cart_access','order_access','checkout_access','receipt_access'])cookie(request,`${p}.${name}`);return p;
}
// S126/DEC-017: a signed-in buyer starts checkout from the profile's main address and contact; a quote or a
// saved draft always wins, and any failure leaves the empty form (prefill is a convenience, never a gate).
export async function profileDraft(request:Request,identity:LocalAuth):Promise<CheckoutDraft|null>{
 try{
  const actor=await commerceActor(request,identity);if(actor?.kind!=='user')return null;
  const [row]=await identity.sql<{phone:string|null;recipient_name:string|null;address_phone:string|null;street:string|null;destination_code:string|null}[]>`select p.phone,a.recipient_name,a.phone as address_phone,a.street,a.destination_code
   from app.buyer_profile p left join app.buyer_address a on a.id=p.default_address_id and a.user_id=p.user_id and a.deleted_at is null where p.user_id=${actor.id}`;
  if(!row)return null;
  const destination=await findDestination(identity.sql,row.destination_code);
  return {...emptyCheckoutDraft(),recipient_name:row.recipient_name??'',phone:displayPhone(row.address_phone??row.phone),destination_id:destination?.id??'',address_line:row.street??''};
 }catch{return null;}
}
export async function readCheckout(request:Request,identity:LocalAuth,dispatch:typeof handleCheckout=handleCheckout):Promise<CheckoutView>{
 try{await assertCheckoutTransport(request,identity);}
 catch(error){return {...checkoutUnavailableView(),kind:error instanceof AccessError&&error.status<500?'denied':'unavailable',code:error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE'};}
 const current=await readCartView(request,identity);
 if(current.kind!=='ready')return {...checkoutUnavailableView(),kind:current.kind,code:current.code};
 let quote:CheckoutQuote|null=null,document:QuoteDocument|null=null;
 if(current.cart.active_quote_id){try{
  quote=(await callCheckout(request,identity,`/api/v1/checkout/quotes/${current.cart.active_quote_id}`,'GET',undefined,undefined,undefined,dispatch)).data as CheckoutQuote;
  const actor=await commerceActor(request,identity);if(!actor)throw new AccessError(401,'UNAUTHENTICATED');
  document=await identity.sql.begin(async tx=>(await ownedQuote(tx,request,identity,actor,quote?.id??'')).quote.document);
 }catch(error){return {...checkoutUnavailableView(),kind:error instanceof AccessError&&[401,403].includes(error.status)?'denied':'unavailable',code:error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE'};}}
 let draft:CheckoutDraft=quote?{recipient_name:quote.address.recipient_name,phone:displayPhone(quote.contact.phone),email:'',destination_id:quote.address.destination_id,address_line:quote.address.address_line,buyer_note:'',payment_method:quote.payment_channel==='manual-bank'?'transfer':quote.payment_channel==='autolaris'?'va':quote.payment_method}:emptyCheckoutDraft();
 const expired=Date.parse(current.cart.expires_at)<=Date.parse(current.now),issue=current.cart.state==='submitted'?'submitted':expired||current.cart.state!=='open'?'expired':current.lines.some(l=>!l.product||!l.offer||!l.stock||l.publicationChanged)?'cart':null;
 let progress:CheckoutProgress|null=null,draftExpired=false;
 if(current.cart.state==='open'&&!expired)try{const saved=await readCheckoutDraft(request,identity,current.cart.id);progress=saved.progress;draftExpired=saved.kind==='expired';if(progress)draft={...progress.draft,email:''};/* older drafts may hold an email; checkout no longer asks for one */}
 catch(error){return {...checkoutUnavailableView(),kind:error instanceof AccessError&&error.status<500?'denied':'unavailable',code:error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE'};}
 if(!quote&&!progress)draft=await profileDraft(request,identity)??draft;
 let methods:string[];
 try{methods=enabledMethods(await paymentTerms(identity.sql,new Date(current.now)));}
 catch(error){return {...checkoutUnavailableView(),kind:'unavailable',code:error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE'};}
 // S181 step 3a (Argon finding 5): with no payment method open (production before any capability is listed) the form would
 // render an empty payment box and an unactionable error. A closed checkout is its own state instead, with a clear message.
 if(methods.length===0)return {...checkoutUnavailableView(),kind:'unavailable',code:'CHECKOUT_CLOSED'};
 const allocations=document?checkoutAllocationChoices(document,current.cart,progress?.allocation_id??quote?.selected_allocation_id??''):[];
 return {kind:'ready',cart:current.cart,quote,allocations,quoteCurrent:Boolean(quote&&quote.id===current.cart.active_quote_id&&quote.cart_version===current.cart.version&&Date.parse(quote.expires_at)>Date.parse(current.now)&&!issue),draft,progress,draftExpired,destinations:await initialDestinations(identity.sql,draft.destination_id),methods,drafts:checkoutDraftsEnabled(),images:Object.fromEntries(current.lines.flatMap(l=>l.offer?.image?[[l.line.id,{src:sameOrigin(l.offer.image.url),width:l.offer.image.width,height:l.offer.image.height}]]:[])),now:current.now,issue,code:null};
}
// S168: the shipping provider refused or did not answer in time. The quote transaction rolled back, so the outcome
// is known (nothing was created): show a retryable error with the draft kept, not the unknown-outcome recovery.
const KNOWN_PROVIDER_FAILURES=new Set(['SHIPPING_RATE_TIMEOUT','SHIPPING_RATE_UNAVAILABLE','SHIPPING_RATE_INVALID']);
const messages:Record<string,string>={
 INVALID_INPUT:'Periksa isian sebelum melanjutkan.',INVALID_IDEMPOTENCY_KEY:'Muat ulang checkout sebelum mencoba lagi.',
 CART_VERSION_REQUIRED:'Buka kembali keranjang untuk memeriksa isinya.',CART_VERSION_CONFLICT:'Isi keranjang berubah dari halaman lain. Periksa kembali sebelum menghitung pengiriman.',
 CART_EMPTY:'Keranjang masih kosong. Pilih produk sebelum checkout.',CART_EXPIRED:'Keranjang kedaluwarsa. Kembali ke keranjang untuk memulai lagi.',CART_SUBMITTED:'Keranjang ini sudah menjadi pesanan. Periksa pesanan yang tersimpan.',
 QUOTE_EXPIRED:'Ongkir berubah. Periksa pilihan kurir, lalu buat pesanan.',QUOTE_SUPERSEDED:'Ongkir berubah. Periksa pilihan kurir di setiap paket.',
 SHIPPING_RATE_EXPIRED:'Ongkir berubah. Periksa pilihan kurir.',
 SHIPPING_RATE_TIMEOUT:'Pilihan kurir belum bisa dimuat. Isian Anda tersimpan. Coba lagi sebentar lagi.',SHIPPING_RATE_UNAVAILABLE:'Pilihan kurir belum bisa dimuat. Isian Anda tersimpan. Coba lagi sebentar lagi.',SHIPPING_RATE_INVALID:'Pilihan kurir belum bisa dimuat. Isian Anda tersimpan. Coba lagi sebentar lagi.',SHIPPING_OPTION_UNAVAILABLE:'Layanan yang dipilih sudah tidak tersedia. Pilih kembali layanan pengiriman.',
 MANUAL_BANK_UNAVAILABLE:'Transfer bank belum tersedia. Pilih metode pembayaran lain.',MANUAL_BANK_BUSY:'Transfer bank sedang penuh. Pilih metode pembayaran lain atau coba lagi nanti.',MANUAL_BANK_OPEN_LIMIT:'Selesaikan transfer pesanan sebelumnya dulu, atau pilih metode pembayaran lain.',RATE_LIMITED:'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.',
 COD_UNAVAILABLE:'COD belum tersedia untuk tujuan atau paket ini. Ubah preferensi pembayaran atau wilayah pengiriman.',NO_SUPPORTED_ROUTE:'Belum ada pengiriman untuk tujuan dan isi keranjang ini. Pilih wilayah pengiriman lain atau periksa keranjang.',ROUTE_UNCONFIGURED:'Tujuan ini belum memiliki layanan pengiriman. Pilih tujuan lain.',
 DESTINATION_UNAVAILABLE:'Tujuan pengiriman sudah tidak tersedia. Pilih kembali dari daftar.',PAYMENT_CHANNEL_UNAVAILABLE:'Metode pembayaran ini sedang tidak tersedia. Pilih metode lain.',SHIPPING_UNAVAILABLE:'Pengiriman belum dapat dihitung saat ini. Coba lagi nanti.',DESTINATION_POSTCODE_MISMATCH:'Wilayah dan kode pos perlu diperiksa kembali.',
 OFFER_UNAVAILABLE:'Pilihan produk tidak tersedia. Periksa kembali keranjang.',INSUFFICIENT_COMPLETE_STOCK:'Stok pilihan lengkap berubah. Periksa kembali keranjang.',INSUFFICIENT_STOCK:'Stok berubah sebelum pesanan tersimpan. Periksa keranjang.',PUBLICATION_REVIEW_REQUIRED:'Rincian pilihan berubah. Setujui isi terbaru dari keranjang.',
 PROMOTION_REVIEW_REQUIRED:'Promo berubah. Periksa pilihan kurir dan total.',PROMOTION_BUDGET_EXHAUSTED:'Kuota promo berubah. Periksa total sebelum melanjutkan.',FINANCIAL_REVIEW_REQUIRED:'Ongkir berubah. Periksa pilihan kurir dan total.',
 UNAUTHENTICATED:'Sesi belanja perlu diperiksa. Kembali ke keranjang.',UNSUPPORTED_AUTH_TRANSPORT:'Buka checkout melalui sesi belanja situs ini.',INVALID_ORIGIN:'Buka checkout dari situs ini sebelum mencoba lagi.',IDEMPOTENCY_CONFLICT:'Tindakan ini memiliki rincian berbeda. Periksa kembali sebelum mengirim ulang.'
};

export async function mutateCheckout(request:Request,identity:LocalAuth,intent:CheckoutIntent,dispatch:typeof handleCheckout=handleCheckout):Promise<{state:CheckoutState;cookies:string[];order:CheckoutOrder|null}>{
 const cookies:string[]=[];
 const navigate=intent.navigate==='stay'?intent.kind==='quote'?'lookup':intent.kind==='shipping'?'shipping':'review':intent.navigate;
 const call=(path:string,method='GET',body?:unknown,key?:string,version?:string)=>callCheckout(request,identity,path,method,body,key,version,dispatch);
 const fresh=async()=>initialCheckoutState(await readCheckout(request,identity));
 // The best matching kecamatan for typed text and its kelurahan (one rate-limited read): what the no-JavaScript lookup
 // lists and what a failed submit keeps listing. Never kelurahan of several kecamatan.
 const bestDistrict=async(query:string)=>{
  const [district]=(await call(`/api/v1/destinations?q=${encodeURIComponent(query)}&group=district&limit=1`)).data.items as DestinationDistrict[];
  return district?{district,areas:await districtAreas(identity.sql,district.id)}:null;
 };
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
   const picked=await findDestination(identity.sql,intent.draft.destination_id);
   const validation=validateCheckoutDraft(intent.draft,picked?[picked]:[]),wire=validation.wire,q=state.view.quote;
   const unchanged=Boolean(wire&&q&&isDeepStrictEqual(q.address,wire.canonicalAddress)&&isDeepStrictEqual(q.contact,wire.contact)&&q.payment_method===wire.payment_method&&q.payment_channel===wire.payment_channel);
   state.step=['shipping','review'].includes(navigate)&&state.view.quoteCurrent&&unchanged?'review':'contact';
   state.intent.kind=state.step==='review'?'order':'quote';
   if(navigate==='lookup'){
    // A query that is just the chosen kelurahan's own kecamatan (implicit Enter on a filled form) keeps that list.
    const query=intent.query.trim()===districtLabel(picked??undefined)?'':intent.query.trim();
    // Without JavaScript: the kelurahan of the best matching kecamatan only (one rate-limited search); the kecamatan
    // field then names it, so a buyer who meant another one refines the search.
    const best=query?await bestDistrict(query):null,district=best?.district;
    state.view.destinations=best?best.areas:query?[]:await initialDestinations(identity.sql,intent.draft.destination_id);
    if(district){
     state.intent.query=district.label;
     // Found by a kelurahan name (or a postal code only one kelurahan has): that kelurahan is chosen, as with JavaScript.
     const matched=district.match?.single?district.match.area_id:'';
     const keep=state.view.destinations.length===1?state.view.destinations[0].id:state.view.destinations.some(d=>d.id===matched)?matched:state.view.destinations.some(d=>d.id===intent.draft.destination_id)?intent.draft.destination_id:'';
     state.intent.draft={...state.intent.draft,destination_id:keep};
    }
    state.message=!query&&!state.view.destinations.length?'Ketik nama kecamatan tujuan.':!query?'':district?`Pilih kelurahan atau desa di ${district.label}. Bukan kecamatan ini? Tambahkan nama kota pada pencarian.`:'Kecamatan tidak ditemukan. Periksa ejaan atau coba nama kecamatan lain.';
   }
   return {state,cookies,order:null};
  }
  const chosen=await findDestination(identity.sql,intent.draft.destination_id);
  const validation=validateCheckoutDraft(intent.draft,chosen?[chosen]:[]);
  if(!validation.wire){
   const state=await fresh();
   // No kelurahan chosen yet but a kecamatan typed (the no-JavaScript path): keep listing that kecamatan's kelurahan,
   // and name it in the kecamatan field. A failed read keeps the field errors and says the list is missing.
   let query=intent.query,listMessage='';
   if(!state.view.destinations.length&&query.trim()&&state.view.kind==='ready'){
    try{const best=await bestDistrict(query.trim());if(best){state.view.destinations=best.areas;query=best.district.label;}}
    catch(error){if(!(error instanceof AccessError))throw error;listMessage=error.code==='RATE_LIMITED'?' Daftar kelurahan belum dapat dimuat. Tunggu sebentar lalu coba lagi.':' Daftar kelurahan belum dapat dimuat. Coba lagi.';}
   }
   if(state.view.kind==='denied'||state.view.kind==='none'||state.view.cart&&state.view.cart.id!==intent.cart)return {state:{...state,phase:'error',message:'Sesi atau keranjang berubah. Periksa keranjang yang aktif.'},cookies,order:null};
   return {state:{...state,phase:'error',step:'contact',intent:{...intent,query,key:randomUUID(),kind:'quote',packages:[],navigate:''},blocked:false,errors:validation.errors,message:`Periksa isian yang ditandai.${listMessage}`,code:'INVALID_INPUT'},cookies,order:null};
  }
  const wire=validation.wire;
  if(intent.kind==='quote'){
   const reply=await call('/api/v1/checkout/quotes','POST',{cart_id:intent.cart,address:wire.address,contact:wire.contact,payment_method:wire.payment_method,payment_channel:wire.payment_channel,...(quoteVoucher(intent.voucher)?{voucher_code:quoteVoucher(intent.voucher)}:{})},intent.key,intent.version);
   const state=await acceptedQuote(reply.data as CheckoutQuote);return {state:{...state,phase:'success',step:'review',intent:{...state.intent,draft:intent.draft,kind:'order',query:intent.query},errors:intent.voucher&&!quoteVoucher(intent.voucher)?{voucher:'Kode voucher tidak ditemukan.'}:{},message:''},cookies,order:null};
  }
  const quote=(await call(`/api/v1/checkout/quotes/${intent.quote}`)).data as CheckoutQuote;
  if(!isDeepStrictEqual(quote.address,wire.canonicalAddress)||!isDeepStrictEqual(quote.contact,wire.contact)||quote.payment_method!==wire.payment_method||quote.payment_channel!==wire.payment_channel){
   const state=await fresh();return {state:{...state,phase:'error',step:'contact',intent:{...intent,key:randomUUID(),kind:'quote',packages:[]},message:'Alamat atau metode berubah. Periksa pilihan kurir.',code:'INVALID_INPUT'},cookies,order:null};
  }
  // An order submitted with couriers or a package split other than the quote's (e.g. radios changed without JavaScript)
  // first applies that selection and shows the new total; the order itself needs a second, deliberate press.
  const changedSelection=intent.kind==='order'&&(Boolean(intent.allocation_id&&intent.allocation_id!==quote.selected_allocation_id)||intent.packages.some(p=>quote.packages.find(parcel=>parcel.id===p.package_id)?.selected_option_id!==p.shipping_option_id));
  if(intent.kind==='shipping'||changedSelection){
   // No submitted parcels (e.g. the split radios only): keep the quote's own courier choices.
   let packages=intent.packages.length?intent.packages:quote.packages.map(p=>({package_id:p.id,shipping_option_id:p.selected_option_id}));const allocationChanged=Boolean(intent.allocation_id&&intent.allocation_id!==quote.selected_allocation_id);
   if(allocationChanged){
    const actor=await commerceActor(request,identity);if(!actor)throw new AccessError(401,'UNAUTHENTICATED');
    packages=await identity.sql.begin(async tx=>{const {quote:owned}=await ownedQuote(tx,request,identity,actor,intent.quote);const plan=owned.document.plans.find(p=>p.id===intent.allocation_id);if(!plan)throw new AccessError(409,'SHIPPING_OPTION_UNAVAILABLE');return plan.packages.map(p=>({package_id:p.id,shipping_option_id:p.selected_option_id}));});
   }
   // An order press that only applies a changed selection uses its own derived key: the press's key stays free for the
   // order, and a retried press after a lost reply replays this selection (the stale quote id diverts again) instead of ordering.
   const reply=await call(`/api/v1/checkout/quotes/${intent.quote}/selection`,'POST',{...(intent.allocation_id?{allocation_id:intent.allocation_id}:{}),packages},changedSelection?`${intent.key}-sel`:intent.key,intent.version);
   const state=await acceptedQuote(reply.data as CheckoutQuote);return {state:{...state,phase:'success',step:'review',intent:{...state.intent,kind:'order',draft:intent.draft},message:allocationChanged?'Pembagian paket diperbarui. Periksa total lalu buat pesanan.':changedSelection?'Pengiriman diperbarui. Periksa total lalu buat pesanan.':'',...(state.view.quote?.amount_due!==quote.amount_due?{previousTotal:quote.amount_due}:{})},cookies,order:null};
  }
  const reply=await call('/api/v1/orders','POST',{quote_id:intent.quote,...(wire.buyer_note?{buyer_note:wire.buyer_note}:{})},intent.key,intent.version);cookies.push(...reply.cookies);
  const order=reply.data.order as CheckoutOrder;
  let state:CheckoutState;try{state=await fresh();}catch{state=initialCheckoutState(checkoutUnavailableView());}
  if(state.view.kind==='denied'||state.view.kind==='none')return {state:{...state,phase:'error',intent:initialCheckoutIntent(),view:{...checkoutUnavailableView(),kind:'denied',code:'UNAUTHENTICATED'},blocked:true,message:'Sesi berubah setelah tindakan. Akses pesanan perlu diperiksa.',code:'UNAUTHENTICATED'},cookies:[],order:null};
  return {state:{...state,phase:'success',step:'review',intent,message:'Pesanan tersimpan.'},cookies,order};
 }catch(error){
  const code=error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE',blocked=error instanceof AccessError&&[401,403].includes(error.status),unknown=!intent.navigate&&(!(error instanceof AccessError)||error.status>=500&&!KNOWN_PROVIDER_FAILURES.has(error.code));
  let state:CheckoutState;try{state=await fresh();}catch{state=initialCheckoutState(checkoutUnavailableView());}
  const lostScope=blocked||state.view.kind==='denied'||state.view.kind==='none'||!unknown&&Boolean(state.view.cart&&state.view.cart.id!==intent.cart);
  const safeIntent=lostScope?initialCheckoutIntent():unknown?intent:{...intent,key:randomUUID(),kind:'quote' as const,version:state.view.cart?.id===intent.cart?String(state.view.cart.version):intent.version,quote:state.view.quote?.id??'',packages:[],navigate:''};
  const errors:CheckoutState['errors']=lostScope||unknown?{}:navigate==='lookup'&&code==='INVALID_INPUT'?{query:'Periksa nama kecamatan yang dicari.'}:['COD_UNAVAILABLE','MANUAL_BANK_UNAVAILABLE','MANUAL_BANK_BUSY','MANUAL_BANK_OPEN_LIMIT','PAYMENT_CHANNEL_UNAVAILABLE'].includes(code)?{payment_method:messages[code]}:code==='NO_SUPPORTED_ROUTE'?{destination_id:messages[code]}:{};
  return {state:{...state,phase:unknown?'unknown':'error',step:unknown?intent.kind==='quote'?'contact':'review':'contact',intent:safeIntent,view:lostScope?{...checkoutUnavailableView(),kind:'denied',code}:state.view.cart&&state.view.cart.id!==intent.cart?checkoutUnavailableView():state.view,errors,message:lostScope?'Sesi atau keranjang berubah. Hasil tindakan hanya dapat diperiksa melalui akses yang sah.':unknown?'Hasil tindakan belum diketahui. Ulangi tindakan yang sama untuk memeriksa hasilnya.':messages[code]??'Perubahan belum diterapkan. Periksa kembali pilihan dan coba lagi.',code,blocked:lostScope},cookies,order:null};
 }
}
