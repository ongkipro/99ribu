import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem,readBody} from '../access/http.ts';
import {AccessError} from '../access/policy.ts';
import {id,integer,invalid} from '../catalog/validation.ts';
import {findDestinations} from '../shipping/address.ts';
import {authorizeCart,bootstrapGuest,capability,commerceActor,cookie,lockActor,prefix,setCookie,type CartRow} from './access.ts';
import {cartCreationInput,changeLine,createCart,mutationKey,projectCart} from './carts.ts';
import {createQuote,ownedQuote,projectQuote,selectQuote} from './quotes.ts';
import {authorizeOrder,projectOrder,submitOrder} from './orders.ts';

export async function handleCheckout(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);const url=new URL(request.url),path=url.pathname;
  if(path==='/api/v1/destinations'&&request.method==='GET'){
   if([...url.searchParams.keys()].some(k=>!['q','limit'].includes(k)||url.searchParams.getAll(k).length!==1)) throw invalid();
   const query=url.searchParams.get('q');if(!query) throw invalid();const raw=url.searchParams.get('limit')??'20';if(!/^\d{1,3}$/.test(raw)) throw invalid();
   return privateJson({items:findDestinations(query,integer(Number(raw),1,100)),source:'TEST-ONLY'});
  }
  if(url.search) throw invalid();
  const actor=await commerceActor(request,identity);
  if(path==='/api/v1/carts'&&request.method==='POST'){
   if(request.headers.has('x-cart-token')||request.headers.has('x-order-token')) throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
   const body=await readBody(request);cartCreationInput(body);mutationKey(request);
   if(!actor) return await bootstrapGuest(identity,problem(new AccessError(401,'GUEST_CONTEXT_REQUIRED')));
   const result=await identity.sql.begin(tx=>createCart(tx,request,identity,actor,body));const response=privateJson({cart:result.response},201);const p=await prefix(identity);
   if(actor.kind==='guest'){
    const token=await capability(identity,'cart',result.cart.id,actor.id,result.cart.cap_issued_at as string);
    if(result.cart.transport==='header') return privateJson({cart:result.response,cart_access_token:token},201);
    setCookie(response,`${p}.cart_access`,`${result.cart.id}.${token}`,'/',Math.max(0,Math.floor((Date.parse(result.cart.cap_expires_at as string)-Date.now())/1000)));
   }else setCookie(response,`${p}.cart_access`,result.cart.id);
   return response;
  }
  const order=/^\/api\/v1\/orders\/([^/]+)$/.exec(path);
  if(order&&request.method==='GET') return await identity.sql.begin(async tx=>{const owned=await authorizeOrder(tx,request,identity,actor,order[1]);return privateJson(await projectOrder(tx,owned.id));});
  if(!actor) throw new AccessError(401,'UNAUTHENTICATED');
  if(path==='/api/v1/carts/current'&&request.method==='GET') return await identity.sql.begin(async tx=>{
   await lockActor(tx,actor);if(request.headers.has('x-cart-token')||request.headers.has('x-order-token')) throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
   let cartId=cookie(request,`${await prefix(identity)}.cart_access`)?.split('.')[0];
   if(!cartId&&actor.kind==='user'){const [latest]=await tx<CartRow[]>`select * from app.cart where owner_user_id=${actor.id} order by created_at desc,id desc limit 1`;cartId=latest?.id;}
   if(!cartId) throw new AccessError(404,'NOT_FOUND');const cart=await authorizeCart(tx,request,identity,actor,id(cartId));return privateJson(await projectCart(tx,cart));
  });
  const cart=/^\/api\/v1\/carts\/([^/]+)$/.exec(path),lines=/^\/api\/v1\/carts\/([^/]+)\/lines(?:\/([^/]+))?$/.exec(path);
  if(cart&&request.method==='GET') return await identity.sql.begin(async tx=>{await lockActor(tx,actor);return privateJson(await projectCart(tx,await authorizeCart(tx,request,identity,actor,id(cart[1]))));});
  if(lines&&((!lines[2]&&request.method==='POST')||(lines[2]&&['PATCH','DELETE'].includes(request.method)))){
   if(request.method==='DELETE'&&request.body){const reader=request.body.getReader();while(true){const chunk=await reader.read();if(chunk.done) break;if(chunk.value.byteLength){await reader.cancel();throw invalid();}}}
   const body=request.method==='DELETE'?{}:await readBody(request);
   return privateJson(await identity.sql.begin(tx=>changeLine(tx,request,identity,actor,id(lines[1]),lines[2]?id(lines[2]):null,body)),request.method==='POST'?201:200);
  }
  if(path==='/api/v1/checkout/quotes'&&request.method==='POST'){
   const body=await readBody(request);return privateJson(await identity.sql.begin(tx=>createQuote(tx,request,identity,actor,body)),201);
  }
  const quote=/^\/api\/v1\/checkout\/quotes\/([^/]+)$/.exec(path),selection=/^\/api\/v1\/checkout\/quotes\/([^/]+)\/selection$/.exec(path);
  if(quote&&request.method==='GET') return await identity.sql.begin(async tx=>{await lockActor(tx,actor);const {quote:owned}=await ownedQuote(tx,request,identity,actor,quote[1]);return privateJson(projectQuote(owned));});
  if(selection&&request.method==='POST'){const body=await readBody(request);return privateJson(await identity.sql.begin(tx=>selectQuote(tx,request,identity,actor,selection[1],body)),201);}
  if(path==='/api/v1/orders'&&request.method==='POST'){
   const body=await readBody(request);const result=await identity.sql.begin(tx=>submitOrder(tx,request,identity,actor,body));let response=privateJson(result.response,201);
   if(actor.kind==='guest'){
    const [access]=await identity.sql`select issued_at,expires_at,revoked_at from app.order_access where order_id=${result.order.id}`;
    if(!access||access.revoked_at||new Date(access.expires_at)<=new Date()) throw new AccessError(401,'UNAUTHENTICATED');
    const token=await capability(identity,'order',result.order.id,actor.id,access.issued_at);
    if(result.transport==='header') response=privateJson({...result.response,guest_order_access_token:token},201);
    else setCookie(response,`${await prefix(identity)}.order_access`,`${result.order.id}.${token}`,`/api/v1/orders/${result.order.id}`,Math.max(0,Math.floor((Date.parse(access.expires_at)-Date.now())/1000)));
   }return response;
  }
  throw new AccessError(404,'NOT_FOUND');
 }catch(error){return problem(error);}
}
