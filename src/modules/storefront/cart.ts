import {randomUUID} from 'node:crypto';
import {applySetCookies} from 'better-auth/cookies';
import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,problem} from '../access/http.ts';
import {AccessError} from '../access/policy.ts';
import {id,integer,invalid,object,text} from '../catalog/validation.ts';
import {actorScope,commerceActor,cookie,mac,prefix} from '../checkout/access.ts';
import {hasCartStock,mutationKey,type projectCart} from '../checkout/carts.ts';
import {handleCheckout} from '../checkout/routes.ts';
import {publicProduct,type PublicProduct} from './catalog.ts';

export type BrowserCart=Awaited<ReturnType<typeof projectCart>>;
export type CartRead={kind:'ready';cart:BrowserCart;code:null;now:string;namespace:string|null}|{kind:'none'|'denied'|'unavailable';cart:null;code:string};
export type CartIntent={key:string;kind:'add'|'update'|'remove';product:string;variant:string;publication:string;quantity:string;cart:string;version:string;line:string;generation:string};
export type CartMutationState={phase:'idle'|'bootstrap'|'success'|'error'|'unknown';intent:CartIntent;message:string;code:string|null;count:number|null;total:number|null;blocked:boolean;acknowledgedKey:string|null};
const fields=['key','kind','product','variant','publication','quantity','cart','version','line','generation'] as const;
export const cartUnits=(cart:BrowserCart)=>cart.lines.reduce((n,line)=>n+line.quantity,0);
export const initialCartIntent=(values:Partial<CartIntent>={}):CartIntent=>({key:randomUUID(),kind:'add',product:'',variant:'',publication:'',quantity:'1',cart:'',version:'',line:'',generation:'',...values});
export const initialCartMutation=(intent:CartIntent):CartMutationState=>({phase:'idle',intent,message:'',code:null,count:null,total:null,blocked:false,acknowledgedKey:null});

export function cartFormInput(data:FormData){
 for(const name of data.keys())if(!fields.includes(name as typeof fields[number])&&!name.startsWith('$ACTION_'))throw invalid();
 return Object.fromEntries(fields.map(name=>{const values=data.getAll(name);if(values.length!==1||typeof values[0]!=='string')throw invalid();return [name,values[0]];}));
}
function cartIntent(value:unknown):CartIntent{
 const b=object(value,fields),key=text(b.key,200);mutationKey(new Request('http://localhost',{headers:{'idempotency-key':key}}));
 if(!['add','update','remove'].includes(b.kind as string))throw invalid();
 const quantity=text(b.quantity,2);if(!/^[1-9]\d?$/.test(quantity))throw invalid();integer(Number(quantity),1,50);
 const optional=(name:'cart'|'line'|'generation')=>b[name]===''?'':id(b[name]);
 const cart=optional('cart'),line=optional('line'),generation=optional('generation'),version=text(b.version,10,true);
 if(cart){if(!/^[1-9]\d{0,9}$/.test(version))throw invalid();integer(Number(version),1);}else if(version||b.kind!=='add')throw invalid();
 if(b.kind==='add'?line!=='':line==='')throw invalid();
 return {key,kind:b.kind as CartIntent['kind'],product:id(b.product),variant:id(b.variant),publication:id(b.publication),quantity,cart,version,line,generation};
}
export function failedCartMutation(value:unknown):CartMutationState{
 const b=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const intent=initialCartIntent();for(const name of fields)if(typeof b[name]==='string'&&name!=='kind')intent[name]=(b[name] as string).slice(0,name==='key'?200:name==='quantity'?2:36);
 if(['add','update','remove'].includes(b.kind as string))intent.kind=b.kind as CartIntent['kind'];
 return {...initialCartMutation(intent),phase:'error',code:'INVALID_INPUT',message:'Periksa pilihan dan jumlahnya sebelum mencoba lagi.'};
}
function apiRequest(request:Request,path:string,method:string,headers:Headers,body?:unknown){
 const forwarded=new Headers(headers);forwarded.delete('content-length');forwarded.set('content-type','application/json');
 return new Request(new URL(path,request.url),{method,headers:forwarded,...(body===undefined?{}:{body:JSON.stringify(body)})});
}
export async function readBrowserCart(request:Request,identity:LocalAuth):Promise<CartRead>{
 try{
  const response=await handleCheckout(apiRequest(request,'/api/v1/carts/current','GET',request.headers),identity);
  const data=await response.json();if(response.status===200){
   const cart=data as BrowserCart;
   const [clock]=await identity.sql<{namespace:string|null;now:string}[]>`select clock_namespace as namespace,app.reservation_clock(clock_namespace)::text as now from app.cart where id=${cart.id}`;
   if(!clock)return {kind:'denied',cart:null,code:'NOT_FOUND'};
   return {kind:'ready',cart,code:null,now:clock.now,namespace:clock.namespace};
  }
  const p=await prefix(identity);
  if(response.status===401&&data.code==='UNAUTHENTICATED'&&!cookie(request,`${p}.commerce_guest`)&&!cookie(request,`${p}.session_token`)&&!cookie(request,`${p}.cart_access`))return {kind:'none',cart:null,code:data.code};
  if(response.status===404&&data.code==='NOT_FOUND'&&!cookie(request,`${p}.cart_access`))return {kind:'none',cart:null,code:data.code};
  return {kind:response.status<500?'denied':'unavailable',cart:null,code:data.code??'SERVICE_UNAVAILABLE'};
 }catch(error){return {kind:error instanceof AccessError&&error.status<500?'denied':'unavailable',cart:null,code:error instanceof AccessError?error.code:'SERVICE_UNAVAILABLE'};}
}
export async function readCartView(request:Request,identity:LocalAuth){
 const state=await readBrowserCart(request,identity);if(state.kind!=='ready')return {...state,lines:[],quote:'none' as const};
 const lines=await identity.sql.begin(async tx=>{
  const products=new Map<string,PublicProduct|null>();const result=[];
  // The product link uses the stored public slug even when the product is no longer sold (its page then answers 404).
  const slugs=new Map((await tx<{id:string;public_slug:string}[]>`select id,public_slug from app.product where id = any(${[...new Set(state.cart.lines.map(l=>l.product_id))]}::uuid[])`).map(p=>[p.id,p.public_slug]));
  for(const line of state.cart.lines){
   if(!products.has(line.product_id))products.set(line.product_id,await publicProduct(tx,line.product_id));
   const product=products.get(line.product_id)??null,offer=product?.variants.find(v=>v.id===line.variant_id)??null;
   const stock=product&&offer?await hasCartStock(tx,{product_id:product.id,product_revision:product.version,offer_id:offer.id,quantity:line.quantity},state.namespace):false;
   result.push({line,slug:slugs.get(line.product_id)??'',product,offer,stock,publicationChanged:product?.publication_id!==line.publication_id});
  }return result;
 });
 let quote:'none'|'current'|'expired'|'unavailable'='none';
 if(state.cart.active_quote_id){
  const response=await handleCheckout(apiRequest(request,`/api/v1/checkout/quotes/${state.cart.active_quote_id}`,'GET',request.headers),identity);
  if(response.status===200){const data=await response.json();quote=Date.parse(data.expires_at)<=Date.parse(state.now)?'expired':'current';}else quote='unavailable';
 }
 return {...state,lines,quote};
}
const messages:Record<string,string>={
 INVALID_INPUT:'Periksa pilihan dan jumlahnya.',INVALID_IDEMPOTENCY_KEY:'Muat ulang halaman sebelum mencoba lagi.',NOT_FOUND:'Pilihan ini tidak ditemukan. Periksa kembali keranjang.',
 OFFER_UNAVAILABLE:'Jumlah itu belum tersedia. Kurangi jumlah atau pilih opsi lain.',PUBLICATION_REVIEW_REQUIRED:'Rincian pilihan berubah. Periksa isi terbaru sebelum melanjutkan.',
 CART_VERSION_CONFLICT:'Keranjang diperbarui dari halaman lain. Periksa kembali pilihan Anda.',CART_VERSION_REQUIRED:'Muat ulang keranjang untuk memeriksa jumlah terbaru.',
 CART_QUANTITY_LIMIT:'Maksimal 50 pilihan per keranjang.',CART_EXPIRED:'Keranjang ini kedaluwarsa. Pilih produk untuk memulai keranjang baru.',CART_SUBMITTED:'Keranjang ini sudah menjadi pesanan. Pilih produk untuk memulai keranjang baru.',
 UNAUTHENTICATED:'Sesi belanja berakhir. Buka keranjang untuk memulai sesi baru.',MFA_REQUIRED:'Verifikasi akun diperlukan sebelum melanjutkan.',FORBIDDEN:'Akun ini belum dapat mengubah keranjang.',
 UNSUPPORTED_AUTH_TRANSPORT:'Buka kembali halaman melalui sesi belanja situs ini.',IDEMPOTENCY_CONFLICT:'Tindakan ini memiliki rincian berbeda. Periksa keranjang sebelum mencoba lagi.',
};

export async function mutateBrowserCart(request:Request,identity:LocalAuth,value:unknown):Promise<{state:CartMutationState;cookies:string[]}>{
 let intent=failedCartMutation(value).intent;const cookies:string[]=[],headers=new Headers(request.headers);
 const call=async(path:string,method:string,body?:unknown,key?:string,version?:string)=>{
  const h=new Headers(headers);if(key)h.set('idempotency-key',key);if(version)h.set('if-match',`"${version}"`);
  const response=await handleCheckout(apiRequest(request,path,method,h,body),identity),issued=response.headers.getSetCookie();cookies.push(...issued);applySetCookies(headers,issued);
  return {response,data:await response.json()};
 };
 const failed=async(status:number,code:string):Promise<{state:CartMutationState;cookies:string[]}>=>{
  const unknown=status>=500;let next=intent,count:number|null=null,total:number|null=null;
  if(!unknown&&![401,403].includes(status)&&code!=='IDEMPOTENCY_CONFLICT'){
   const current=await readBrowserCart(apiRequest(request,'/keranjang','GET',headers),identity);
   if(current.kind==='ready'){count=cartUnits(current.cart);total=current.cart.merchandise_total;next={...intent,cart:current.cart.id,version:String(current.cart.version)};}
  }
  const knownMessage=code==='CART_VERSION_CONFLICT'&&count!==null?`Keranjang diperbarui dari halaman lain. Saat diperiksa, keranjang memuat ${count} pilihan lengkap. Periksa kembali pilihan Anda.`:messages[code]??'Keranjang belum dapat diperbarui. Periksa kembali pilihan Anda.';
  return {state:{phase:unknown?'unknown':'error',intent:next,code,message:unknown?'Hasil tindakan belum diketahui. Ulangi tindakan yang sama atau periksa keranjang.':knownMessage,count,total,acknowledgedKey:unknown?null:intent.key,blocked:[401,403].includes(status)||code==='IDEMPOTENCY_CONFLICT'},cookies};
 };
 try{
  assertOrigin(request);intent=cartIntent(value);const actor=await commerceActor(request,identity);
  if(!actor){const result=await call('/api/v1/carts','POST',{lines:[]},intent.key);
   if(result.response.status===401&&result.data.code==='GUEST_CONTEXT_REQUIRED')return {state:{...initialCartMutation(intent),phase:'bootstrap',message:'Sesi belanja siap. Lanjutkan pilihan yang sama.'},cookies};
   return await failed(result.response.status,result.data.code);
  }
  let cart=intent.cart,version=intent.version;
  if(!cart){
   const key=`sf_init_${await mac(identity,'storefront-cart-init',[actorScope(actor),intent.generation])}`;
   const created=await call('/api/v1/carts','POST',{lines:[],access_transport:'browser'},key);
   if(created.response.status!==201)return await failed(created.response.status,created.data.code);
   cart=created.data.cart.id;version=String(created.data.cart.version);
  }
  const path=`/api/v1/carts/${cart}/lines${intent.kind==='add'?'':`/${intent.line}`}`;
  const body=intent.kind==='add'?{variant_id:intent.variant,quantity:Number(intent.quantity),expected_publication_id:intent.publication}:
   intent.kind==='update'?{quantity:Number(intent.quantity),expected_version:Number(version),expected_publication_id:intent.publication}:undefined;
  const result=await call(path,intent.kind==='add'?'POST':intent.kind==='update'?'PATCH':'DELETE',body,intent.key,version);
  if(!result.response.ok)return await failed(result.response.status,result.data.code);
  const current=await readBrowserCart(apiRequest(request,'/keranjang','GET',headers),identity);
  if(current.kind!=='ready')return await failed(503,'SERVICE_UNAVAILABLE');
  const saved=current.cart,count=cartUnits(saved),committed=result.data as BrowserCart,line=committed.lines.find(l=>l.variant_id===intent.variant);
  let message=intent.kind==='update'?`Jumlah ${line?`${line.name} (${line.variant_label})`:'pilihan'} menjadi ${intent.quantity}.`:`${intent.quantity} pilihan ${line?`${line.name} (${line.variant_label})`:''} ditambahkan ke keranjang.`;
  if(intent.kind==='remove'){
   // Immutable operation snapshots retain the removed identity after acknowledgement loss.
   const [removed]=await identity.sql<{name:string;variant_label:string;quantity:number}[]>`select item->>'name' as name,item->>'variant_label' as variant_label,(item->>'quantity')::int as quantity
    from app.commerce_operation o cross join lateral jsonb_array_elements(o.result->'lines') item
    where o.actor_scope=${actorScope(actor)} and o.resource_id=${cart} and item->>'id'=${intent.line}
    order by (o.result->>'version')::int desc limit 1`;
   message=removed?`${removed.quantity} pilihan ${removed.name} (${removed.variant_label}) dihapus dari keranjang.`:'Pilihan dihapus dari keranjang.';
  }
  return {state:{phase:'success',intent:{...intent,key:randomUUID(),cart:saved.id,version:String(saved.version)},message,code:null,count,total:saved.merchandise_total,blocked:false,acknowledgedKey:intent.key},cookies};
 }catch(error){const response=problem(error);const data=await response.json();return await failed(response.status,data.code);}
}
