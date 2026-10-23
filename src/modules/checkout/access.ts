import {createHash,createHmac,randomBytes} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError,getPrincipal,type Principal} from '../access/policy.ts';
import {rateLimit} from '../access/rate-limit.ts';
import {clientIp} from '../access/http.ts';
import {readRuntimeConfig} from '../../config/runtime.ts';

export type CommerceActor={kind:'guest';id:string}|{kind:'user';id:string;principal:Principal};
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
// Better Auth names cookies __Secure-<prefix>.* when useSecureCookies is on (production); app cookies share that prefix.
export async function prefix(identity:LocalAuth){const advanced=(await identity.auth.$context).options.advanced;return `${advanced?.useSecureCookies?'__Secure-':''}${advanced?.cookiePrefix as string}`;}
export function cookie(request:Request,name:string){
 const matches=(request.headers.get('cookie')??'').split(';').map(p=>p.trim()).filter(p=>p.startsWith(`${name}=`));
 if(matches.length>1) throw new AccessError(401,'UNAUTHENTICATED');return matches[0]?.slice(name.length+1)??null;
}
export function setCookie(response:Response,name:string,value:string,path='/',maxAge=604800){
 response.headers.append('Set-Cookie',`${name}=${value}; Path=${path}; HttpOnly;${name.startsWith('__Secure-')?' Secure;':''} SameSite=Lax; Max-Age=${maxAge}`);
}
export async function mac(identity:LocalAuth,purpose:string,values:readonly unknown[]){
 return createHmac('sha256',(await identity.auth.$context).secret).update(JSON.stringify(['99ribu-commerce-v1',purpose,...values])).digest('base64url');
}
export async function capability(identity:LocalAuth,purpose:'cart'|'order',resourceId:string,guestId:string,issuedAt:string){return mac(identity,`${purpose}-access`,[resourceId,guestId,new Date(issuedAt).toISOString()]);}
export async function commerceActor(request:Request,identity:LocalAuth):Promise<CommerceActor|null>{
 const p=await prefix(identity);
 if(request.headers.has('authorization')) throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
 const session=await identity.auth.api.getSession({headers:request.headers,query:{disableCookieCache:true}});
 if(session){
  if(request.headers.has('x-cart-token')||request.headers.has('x-order-token')) throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  const principal=await getPrincipal(request,identity);return {kind:'user',id:principal.id,principal};
 }
 if(cookie(request,`${p}.session_token`)) throw new AccessError(401,'UNAUTHENTICATED');
 const guestToken=cookie(request,`${p}.commerce_guest`);
 if(!guestToken) return null;
 if(!/^[A-Za-z0-9_-]{43}$/.test(guestToken)) throw new AccessError(401,'UNAUTHENTICATED');
 const [guest]=await identity.sql`select id from app.commerce_guest_context where digest=${digest(guestToken)} and revoked_at is null and expires_at>clock_timestamp()`;
 if(!guest) throw new AccessError(401,'UNAUTHENTICATED');return {kind:'guest',id:guest.id};
}
export async function bootstrapGuest(identity:LocalAuth,response:Response,request?:Request){
 // Global ceiling against unbounded anonymous guest rows; generous because loopback has no per-client identity. Expired rows are swept by deleteExpiredGuestContexts.
 // Production adds a per-client bucket on the trusted proxy's client IP, so one client cannot exhaust the global ceiling alone.
 if(request&&readRuntimeConfig(process.env).profile==='production')await rateLimit(identity.sql,`guest-bootstrap-ip:${clientIp(request)}`,[30,60_000]);
 await rateLimit(identity.sql,'guest-bootstrap-global',[600,60_000]);
 const token=randomBytes(32).toString('base64url');
 await identity.sql`insert into app.commerce_guest_context (digest,created_at,expires_at) select ${digest(token)},t,t+interval '7 days' from (select clock_timestamp() t) clock`;
 setCookie(response,`${await prefix(identity)}.commerce_guest`,token);return response;
}
export const actorScope=(actor:CommerceActor)=>`${actor.kind}:${actor.id}`;
export async function lockActor(tx:TransactionSql,actor:CommerceActor){
 if(actor.kind==='guest'){
  const [row]=await tx`select id,expires_at,revoked_at from app.commerce_guest_context where id=${actor.id} for update`;
  const [clock]=await tx`select clock_timestamp() as now`;
  if(!row||row.revoked_at||new Date(row.expires_at)<=new Date(clock.now)) throw new AccessError(401,'UNAUTHENTICATED');return;
 }
 await tx`select id from app.auth_user where id=${actor.id} for update`;
 const [current]=await tx`select u.email_verified,u.two_factor_enabled,coalesce(g.roles,ARRAY['buyer']::text[]) roles,m.verified_at,s.expires_at
  from app.auth_user u join app.auth_session s on s.user_id=u.id left join app.role_grant g on g.user_id=u.id left join app.mfa_session m on m.session_id=s.id
  where u.id=${actor.id} and s.id=${actor.principal.sessionId} for share of u,s`;
 const [clock]=await tx`select clock_timestamp() as now`;
 if(!current?.email_verified||new Date(current.expires_at)<=new Date(clock.now)) throw new AccessError(401,'UNAUTHENTICATED');
 if(current.roles.some((r:string)=>!['buyer','affiliate'].includes(r))&&(!current.two_factor_enabled||!current.verified_at)) throw new AccessError(403,'MFA_REQUIRED');
}
export type CartRow={id:string;owner_user_id:string|null;owner_guest_id:string|null;revision:number;state:'open'|'submitted';transport:'browser'|'header';cap_digest:string|null;cap_issued_at:string|null;cap_expires_at:string|null;clock_namespace:string|null;created_at:string;expires_at:string;active_quote_id:string|null;submitted_order_id:string|null};
export async function authorizeCart(tx:TransactionSql,request:Request,identity:LocalAuth,actor:CommerceActor,cartId:string){
 if(request.headers.has('x-order-token')) throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
 const [cart]=await tx<CartRow[]>`select * from app.cart where id=${cartId} for update`;
 if(!cart) throw new AccessError(404,'NOT_FOUND');
 if(actor.kind==='user'){
  if(cart.owner_user_id!==actor.id) throw new AccessError(404,'NOT_FOUND');return cart;
 }
 if(cart.owner_guest_id!==actor.id) throw new AccessError(404,'NOT_FOUND');
 const pointer=cookie(request,`${await prefix(identity)}.cart_access`);const header=request.headers.get('x-cart-token');
 if(header&&pointer) throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
 const token=cart.transport==='header'?header:pointer?.startsWith(`${cart.id}.`)?pointer.slice(37):null;
 const [clock]=await tx`select clock_timestamp() as now`;
 if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token)||digest(token)!==cart.cap_digest||!cart.cap_expires_at||new Date(cart.cap_expires_at)<=new Date(clock.now)) throw new AccessError(401,'UNAUTHENTICATED');return cart;
}
export async function revokeGuestContext(request:Request,identity:LocalAuth,response:Response){
 const p=await prefix(identity);const token=cookie(request,`${p}.commerce_guest`);
 if(token&&/^[A-Za-z0-9_-]{43}$/.test(token)) await identity.sql`update app.commerce_guest_context set revoked_at=clock_timestamp() where digest=${digest(token)} and revoked_at is null`;
 for(const name of ['commerce_guest','cart_access']) setCookie(response,`${p}.${name}`,'','/',0);
}

// S76/DEC-002: bounded, idempotent removal of expired guest contexts that
// nothing references. The candidate anti-join mirrors 0027
// commerce_guest_context_referenced() term for term (0028 indexes back it);
// the delete guard and RESTRICT FKs re-check each row. Each delete runs in its
// own savepoint, so a reference committed after selection (23514/23503) skips
// only that row instead of failing the batch.
export async function deleteExpiredGuestContexts(sql:Sql,limit=500){return sql.begin(tx=>deleteExpiredGuestContextBatch(tx,limit));}
// Caller owns the transaction (the shared-DB test probes it inside a rolled-back one).
export async function deleteExpiredGuestContextBatch(tx:TransactionSql,limit=500){
 const candidates=await tx<{id:string}[]>`select g.id from app.commerce_guest_context g
  where g.expires_at<=clock_timestamp()
   and not exists(select 1 from app.cart where owner_guest_id=g.id)
   and not exists(select 1 from app.commerce_order where owner_guest_id=g.id)
   and not exists(select 1 from app.order_access where guest_id=g.id)
   and not exists(select 1 from app.return_operation where guest_id=g.id or actor_scope='guest:'||g.id::text)
   and not exists(select 1 from app.exception_operation where guest_id=g.id or actor_scope='guest:'||g.id::text)
   and not exists(select 1 from app.commerce_operation where actor_scope='guest:'||g.id::text)
   and not exists(select 1 from app.guest_support_identity where guest_id=g.id)
   and not exists(select 1 from app.referral_touch where guest_id=g.id)
   and not exists(select 1 from app.support_challenge where actor_scope='guest:'||g.id::text)
  order by g.expires_at,g.id limit ${limit} for update of g skip locked`;
 let deleted=0;
 for(const {id} of candidates){
  try{deleted+=(await tx.savepoint(inner=>inner`delete from app.commerce_guest_context where id=${id} returning id`)).length;}
  catch(error){if(!['23514','23503'].includes(String((error as {code?:unknown})?.code)))throw error;}
 }
 return deleted;
}
