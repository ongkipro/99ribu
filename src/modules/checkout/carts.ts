import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError} from '../access/policy.ts';
import {readCatalogRevision} from '../catalog/catalog.ts';
import {salePublication} from '../catalog/publication.ts';
import {array,id,integer,invalid,object} from '../catalog/validation.ts';
import {lockPublishedSources} from '../shipping/contribution.ts';
import {actorScope,authorizeCart,capability,digest,lockActor,mac,type CartRow,type CommerceActor} from './access.ts';
import {captureCartMutation} from '../advertising/events.ts';
import {offerAvailability} from '../inventory/reservations.ts';

export type CartLineRow={id:string;cart_id:string;product_id:string;product_revision:number;offer_id:string;publication_id:string;quantity:number;unit_price:number};
export const cartLines=(tx:TransactionSql,cartId:string)=>tx<CartLineRow[]>`select * from app.cart_line where cart_id=${cartId} order by id`;
export function mutationKey(request:Request){const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');return key;}
export function expectedCartVersion(request:Request){const value=request.headers.get('if-match');if(!value||!/^"[1-9]\d{0,9}"$/.test(value)) throw new AccessError(428,'CART_VERSION_REQUIRED');return integer(Number(value.slice(1,-1)),1);}
export async function intentHash(identity:LocalAuth,action:string,input:unknown){return digest(await mac(identity,'operation-intent',[action,input]));}
export async function priorOperation(tx:TransactionSql,actor:CommerceActor,key:string,action:string,hash:string){
 const [prior]=await tx`select id,resource_id,action,request_hash,result from app.commerce_operation where actor_scope=${actorScope(actor)} and key=${key}`;
 if(prior&&(prior.action!==action||prior.request_hash!==hash)) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return prior;
}
export async function recordOperation(tx:TransactionSql,actor:CommerceActor,key:string,action:string,hash:string,resourceId:string,result:unknown,operationId=randomUUID()){
 await tx`insert into app.commerce_operation (id,actor_scope,key,action,request_hash,resource_id,result) values (${operationId},${actorScope(actor)},${key},${action},${hash},${resourceId},${JSON.stringify(result)}::jsonb)`;
 return operationId;
}
export async function cartClock(tx:TransactionSql,cart:CartRow){
 if(cart.clock_namespace) await tx`select name from app.local_fixture_namespace where name=${cart.clock_namespace} for share`;
 const [row]=await tx`select app.reservation_clock(${cart.clock_namespace})::text as now`;return new Date(row.now);
}
export async function assertCartOpen(tx:TransactionSql,cart:CartRow,version:number){
 if(cart.state!=='open') throw new AccessError(409,'CART_SUBMITTED');
 if(cart.revision!==version) throw new AccessError(409,'CART_VERSION_CONFLICT');
 if(new Date(cart.expires_at)<=await cartClock(tx,cart)) throw new AccessError(409,'CART_EXPIRED');
}
function lineInput(value:unknown){const b=object(value,['variant_id','quantity','expected_publication_id']);return {variant_id:id(b.variant_id),quantity:integer(b.quantity,1,50),expected_publication_id:id(b.expected_publication_id)};}
export async function hasCartStock(tx:TransactionSql,line:Pick<CartLineRow,'product_id'|'product_revision'|'offer_id'|'quantity'>,namespace:string|null=null){
 const warehouses=await tx`select distinct b.warehouse_id from app.offer_component c join app.inventory_balance b on b.stock_item_id=c.stock_item_id
  join app.warehouse w on w.id=b.warehouse_id left join app.local_fixture_warehouse f on f.warehouse_id=b.warehouse_id
  where c.product_id=${line.product_id} and c.revision=${line.product_revision} and c.offer_id=${line.offer_id} and w.active
   and (${namespace}::text is null or f.namespace=${namespace}) order by b.warehouse_id`;
 let available=0;
 for(const warehouse of warehouses){try{available+=await offerAvailability(tx,{product_id:line.product_id,product_revision:line.product_revision,offer_id:line.offer_id,warehouse_id:warehouse.warehouse_id,clock_namespace:namespace});}
  catch(error){if(!(error instanceof AccessError)||error.status!==404) throw error;}
  if(available>=line.quantity) return true;
 }
 return false;
}
async function freezeLines(tx:TransactionSql,inputs:ReturnType<typeof lineInput>[],namespace:string|null){
 if(!inputs.length) return [];
 const offers=await tx`select id,product_id from app.offer where id in ${tx(inputs.map(i=>i.variant_id))}`;
 if(offers.length!==inputs.length) throw new AccessError(404,'NOT_FOUND');
 await lockPublishedSources(tx,offers.map(o=>o.product_id));const [clock]=await tx`select clock_timestamp()::text as now`;
 const result=[];
 for(const input of inputs){const productId=offers.find(o=>o.id===input.variant_id)?.product_id;const publication=await salePublication(tx,productId,clock.now);
  if(!publication||publication.publication_id!==input.expected_publication_id) throw new AccessError(409,'PUBLICATION_REVIEW_REQUIRED');
  if(!publication.draft.variants.some(v=>v.id===input.variant_id&&!v.retired)) throw new AccessError(409,'OFFER_UNAVAILABLE');
  if(!await hasCartStock(tx,{product_id:productId,product_revision:publication.product_revision,offer_id:input.variant_id,quantity:input.quantity},namespace)) throw new AccessError(409,'OFFER_UNAVAILABLE');
  result.push({product_id:productId as string,product_revision:publication.product_revision,offer_id:input.variant_id,publication_id:publication.publication_id,quantity:input.quantity});
 }return result;
}
export async function projectCart(tx:TransactionSql,cart:CartRow){
 const lines=[];
 for(const line of await cartLines(tx,cart.id)){
  const revision=await readCatalogRevision(tx,line.product_id,line.product_revision);const offer=revision.variants.find(v=>v.id===line.offer_id);if(!offer) throw new AccessError(503,'CART_INVALID');
  const [head]=await tx`select v.id from app.publication_head h join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision where h.product_id=${line.product_id}`;
  lines.push({id:line.id,product_id:line.product_id,catalog_id:offer.catalog_id,variant_id:line.offer_id,publication_id:line.publication_id,product_revision:line.product_revision,name:revision.name,variant_label:offer.label,offer_kind:offer.offer_kind,contents:offer.contents,quantity:line.quantity,unit_price:99000,line_total:99000*line.quantity,publication_changed:head?.id!==line.publication_id});
 }
 return {id:cart.id,version:cart.revision,state:cart.state,access_transport:cart.transport,active_quote_id:cart.active_quote_id,submitted_order_id:cart.submitted_order_id,currency:'IDR',merchandise_total:lines.reduce((n,l)=>n+l.line_total,0),lines,expires_at:new Date(cart.expires_at).toISOString()};
}
export function cartCreationInput(value:unknown){
 const body=object(value,['lines','access_transport']);const transport=body.access_transport??'browser';if(!['browser','header'].includes(transport as string)||typeof transport!=='string') throw invalid();
 const inputs=body.lines===undefined?[]:array(body.lines,lineInput,0,50).sort((a,b)=>a.variant_id.localeCompare(b.variant_id));
 if(new Set(inputs.map(i=>i.variant_id)).size!==inputs.length||inputs.reduce((n,i)=>n+i.quantity,0)>50) throw invalid();
 return {transport:transport as 'browser'|'header',inputs};
}
export async function createCart(tx:TransactionSql,request:Request,identity:LocalAuth,actor:CommerceActor,value:unknown,context:{clock_namespace?:string|null}={}){
 const {transport,inputs}=cartCreationInput(value);if(actor.kind==='user'&&transport!=='browser') throw invalid();
 const key=mutationKey(request);const hash=await intentHash(identity,'cart.create',{inputs,transport});await lockActor(tx,actor);
 const prior=await priorOperation(tx,actor,key,'cart.create',hash);
 if(prior){const recovered=await authorizeCartCreationReplay(tx,actor,prior.resource_id);return {cart:recovered,response:prior.result};}
 const namespace=context.clock_namespace??null;
 if(namespace){const [clock]=await tx`select name from app.local_fixture_namespace where name=${namespace} for share`;if(!clock) throw invalid();}
 const frozen=await freezeLines(tx,inputs,namespace);
 const [clock]=await tx`select clock_timestamp() as real,app.reservation_clock(${namespace}) as business`;
 const issued=new Date(clock.real).toISOString(),created=new Date(clock.business).toISOString();const cartId=randomUUID();
 const token=actor.kind==='guest'?await capability(identity,'cart',cartId,actor.id,issued):null;
 const [cart]=await tx<CartRow[]>`insert into app.cart (id,owner_user_id,owner_guest_id,transport,cap_digest,cap_issued_at,cap_expires_at,clock_namespace,created_at,expires_at)
  values (${cartId},${actor.kind==='user'?actor.id:null},${actor.kind==='guest'?actor.id:null},${transport},${token?digest(token):null},${token?issued:null},${token?new Date(Date.parse(issued)+604800000).toISOString():null},${namespace},${created},${new Date(Date.parse(created)+604800000).toISOString()}) returning *`;
 for(const l of frozen) await tx`insert into app.cart_line (cart_id,product_id,product_revision,offer_id,publication_id,quantity) values (${cart.id},${l.product_id},${l.product_revision},${l.offer_id},${l.publication_id},${l.quantity})`;
 const response=await projectCart(tx,cart),operation=await recordOperation(tx,actor,key,'cart.create',hash,cart.id,response);await captureCartMutation(tx,request,identity,actor,operation);return {cart,response};
}
async function authorizeCartCreationReplay(tx:TransactionSql,actor:CommerceActor,cartId:string){
 const [cart]=await tx<CartRow[]>`select * from app.cart where id=${cartId} for update`;
 if(!cart||(actor.kind==='guest'?cart.owner_guest_id!==actor.id:cart.owner_user_id!==actor.id)) throw new AccessError(404,'NOT_FOUND');
 const [clock]=await tx`select clock_timestamp() as now`;
 if(cart.cap_expires_at&&new Date(cart.cap_expires_at)<=new Date(clock.now)) throw new AccessError(401,'UNAUTHENTICATED');return cart;
}
export async function changeLine(tx:TransactionSql,request:Request,identity:LocalAuth,actor:CommerceActor,cartId:string,lineId:string|null,value:unknown){
 const action=lineId?(request.method==='DELETE'?'cart.line.remove':'cart.line.update'):'cart.line.add';
 const input:{variant_id?:string;quantity?:number;expected_version?:number;expected_publication_id?:string}=action==='cart.line.add'?lineInput(value):action==='cart.line.remove'?{}:(()=>{const b=object(value,['quantity','expected_version','expected_publication_id']);return {quantity:integer(b.quantity,1,50),expected_version:integer(b.expected_version,1),...(b.expected_publication_id!==undefined?{expected_publication_id:id(b.expected_publication_id)}:{})};})();
 const version=action==='cart.line.update'?input.expected_version as number:expectedCartVersion(request);
 const key=mutationKey(request),hash=await intentHash(identity,action,{cartId,lineId,input,version});await lockActor(tx,actor);const cart=await authorizeCart(tx,request,identity,actor,id(cartId));
 const prior=await priorOperation(tx,actor,key,action,hash);if(prior) return prior.result;
 await assertCartOpen(tx,cart,version);const lines=await cartLines(tx,cart.id);const existing=lineId?lines.find(l=>l.id===id(lineId)):lines.find(l=>l.offer_id===(input.variant_id??null));
 if(lineId&&!existing) throw new AccessError(404,'NOT_FOUND');
 if(action==='cart.line.remove') await tx`delete from app.cart_line where id=${existing?.id as string}`;
 else{
  const offerId=input.variant_id??existing?.offer_id as string;const publicationId=input.expected_publication_id??existing?.publication_id;
  const quantity=integer((input.quantity??0)+(action==='cart.line.add'?(existing?.quantity??0):0),1,50);
  if(lines.reduce((n,l)=>n+(l.id===existing?.id?0:l.quantity),quantity)>50) throw new AccessError(422,'CART_QUANTITY_LIMIT');
  const [frozen]=await freezeLines(tx,[{variant_id:offerId,quantity,expected_publication_id:publicationId as string}],cart.clock_namespace);
  if(action==='cart.line.add'&&existing&&existing.publication_id!==frozen.publication_id) throw new AccessError(409,'PUBLICATION_REVIEW_REQUIRED');
  if(existing) await tx`update app.cart_line set quantity=${quantity},product_revision=${frozen.product_revision},publication_id=${frozen.publication_id} where id=${existing.id}`;
  else await tx`insert into app.cart_line (cart_id,product_id,product_revision,offer_id,publication_id,quantity) values (${cart.id},${frozen.product_id},${frozen.product_revision},${frozen.offer_id},${frozen.publication_id},${quantity})`;
 }
 const [updated]=await tx<CartRow[]>`update app.cart set revision=revision+1,active_quote_id=null where id=${cart.id} returning *`;
 const response=await projectCart(tx,updated),operation=await recordOperation(tx,actor,key,action,hash,cart.id,response);await captureCartMutation(tx,request,identity,actor,operation);return response;
}
