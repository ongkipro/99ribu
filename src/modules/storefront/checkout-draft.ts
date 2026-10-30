import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,opendir,rename,unlink,type FileHandle} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import type {TransactionSql} from 'postgres';
import {privateDirectory} from '../../config/local.ts';
import {runtimeTarget} from '../../config/runtime.ts';
import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin} from '../access/http.ts';
import {AccessError} from '../access/policy.ts';
import {id,invalid,object} from '../catalog/validation.ts';
import {actorScope,authorizeCart,commerceActor,lockActor,mac,prefix,type CartRow} from '../checkout/access.ts';
import {cartClock} from '../checkout/carts.ts';
import type {CheckoutDraft,CheckoutIntent,CheckoutState} from './checkout.ts';

export const checkoutDraftFields=['recipient_name','phone','email','destination_id','address_line','buyer_note','payment_method'] as const;
export const checkoutDraftLimits:Record<keyof CheckoutDraft,number>={recipient_name:200,phone:30,email:254,destination_id:100,address_line:500,buyer_note:500,payment_method:10};
type Selection={package_id:string;shipping_option_id:string};
export type CheckoutProgress={revision:number;writer:string;sequence:number;cart_version:number;quote:string;step:CheckoutState['step'];draft:CheckoutDraft;query:string;allocation_id:string;packages:Selection[]};
type StoredProgress=CheckoutProgress&{format:'checkout-draft-v1';scope:string;updated_at:string;expires_at:string};
export type CheckoutDraftRead={kind:'empty'|'expired';progress:null}|{kind:'saved';progress:CheckoutProgress};
export type CheckoutDraftWrite={kind:'saved'|'stale'|'conflict'|'closed';revision:number};
const maxBytes=32768;
const absent=(error:unknown)=>error instanceof Error&&'code'in error&&error.code==='ENOENT';
const count=(v:unknown)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw invalid();return v;};
const string=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max)throw invalid();return v;};
function fields(value:unknown):CheckoutDraft{
 const v=object(value,[...checkoutDraftFields]);return Object.fromEntries(checkoutDraftFields.map(name=>[name,string(v[name],checkoutDraftLimits[name])])) as CheckoutDraft;
}
function selection(value:unknown):Selection[]{
 if(!Array.isArray(value)||value.length>50)throw invalid();
 const result=value.map(item=>{const v=object(item,['package_id','shipping_option_id']);return {package_id:string(v.package_id,100),shipping_option_id:string(v.shipping_option_id,100)};});
 if(new Set(result.map(p=>p.package_id)).size!==result.length)throw invalid();return result;
}
async function directory(create:boolean){
 const path=join(privateDirectory('artifacts'),'checkout-drafts');
 if(create)await mkdir(path,{recursive:true,mode:0o700});
 try{const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o7777)!==0o700||stat.uid!==process.getuid?.())throw new Error('Invalid private draft directory');return path;}
 catch(error){if(!create&&error instanceof Error&&'code'in error&&error.code==='ENOENT')return null;throw error;}
}
function stored(value:unknown,scope:string):StoredProgress{
 const v=object(value,['format','scope','revision','writer','sequence','cart_version','quote','step','draft','query','allocation_id','packages','updated_at','expires_at']);
 if(v.format!=='checkout-draft-v1'||v.scope!==scope||!['contact','shipping','review'].includes(String(v.step))||!Number.isFinite(Date.parse(String(v.updated_at)))||!Number.isFinite(Date.parse(String(v.expires_at))))throw invalid();
 return {format:'checkout-draft-v1',scope,revision:count(v.revision),writer:id(v.writer),sequence:count(v.sequence),cart_version:count(v.cart_version),quote:v.quote?id(v.quote):'',step:v.step as CheckoutState['step'],draft:fields(v.draft),query:string(v.query,100),allocation_id:string(v.allocation_id,100),packages:selection(v.packages),updated_at:String(v.updated_at),expires_at:String(v.expires_at)};
}
async function read(path:string,scope:string){
 let file:FileHandle;try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if(error instanceof Error&&'code'in error&&error.code==='ENOENT')return null;throw error;}
 try{const stat=await file.stat();if(!stat.isFile()||(stat.mode&0o7777)!==0o600||stat.uid!==process.getuid?.()||stat.nlink!==1||stat.size>maxBytes)throw new Error('Invalid private draft file');return stored(JSON.parse(await file.readFile('utf8')),scope);}
 finally{await file.close();}
}
async function write(path:string,data:StoredProgress){
 const bytes=Buffer.from(JSON.stringify(data));if(bytes.length>maxBytes)throw invalid();const temporary=`${path}.${randomUUID()}.tmp`,file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);let installed=false;
 try{await file.writeFile(bytes);await file.sync();await file.close();await rename(temporary,path);installed=true;const parent=await open(dirname(path),constants.O_RDONLY);try{await parent.sync();}finally{await parent.close();}}
 finally{if(!installed){await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});}}
}
type DraftScope={cart:CartRow;key:string;path:string|null;legacy:string|null;root:string|null;realm:string;remaining:number;tx:TransactionSql};
async function remove(path:string){try{await unlink(path);}catch(error){if(!absent(error))throw error;}}
async function scopedRead(context:DraftScope){
 if(!context.path||!context.legacy)return null;
 const current=await read(context.path,context.key);if(current)return current;
 const legacy=await read(context.legacy,context.key);if(!legacy)return null;
 // Preserve the pre-retention draft atomically; new writes never use the old path.
 try{await rename(context.legacy,context.path);return legacy;}catch(error){if(!absent(error))throw error;return read(context.path,context.key);}
}
async function prune(context:DraftScope){
 if(!context.root)return;
 const pattern=new RegExp(`^(?:${context.realm}\\.)?([A-Za-z0-9_-]{43})\\.json(?:\\.[0-9a-f-]{36}\\.tmp)?$`),cutoff=Date.now()-86700000;let removed=0;
 // lazy: stream metadata, remove at most32 per write; S65 can schedule this if measured latency needs it.
 for await(const entry of await opendir(context.root)){
  const match=pattern.exec(entry.name);if(!entry.isFile()||!match)continue;
  const path=join(context.root,entry.name),eligible=async()=>{try{const stat=await lstat(path);return stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o7777)===0o600&&stat.uid===process.getuid?.()&&stat.nlink===1&&stat.size<=maxBytes&&stat.mtimeMs<cutoff;}catch(error){if(absent(error))return false;throw error;}};
  if(!await eligible())continue;
  const [lock]=await context.tx`select pg_try_advisory_xact_lock(hashtextextended(${`checkout-draft:${match[1]}`},0)) acquired`;
  if(!lock.acquired||!await eligible())continue;
  // Prefixes keep local/test writer locks in their own database. Legacy flat files are now immutable.
  await remove(path);if(++removed===32)break;
 }
}
async function scope<T>(request:Request,identity:LocalAuth,cartId:string,run:(context:DraftScope)=>Promise<T>){
 assertOrigin(request);if(['authorization','x-cart-token','x-order-token'].some(name=>request.headers.has(name)))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
 const actor=await commerceActor(request,identity);if(!actor)throw new AccessError(401,'UNAUTHENTICATED');
 return identity.sql.begin(async tx=>{
  await lockActor(tx,actor);const cart=await authorizeCart(tx,request,identity,actor,id(cartId));
  const realm=await prefix(identity);if(!/^99ribu-(?:local|test)$/.test(realm))throw new Error('Invalid private draft namespace');
  const key=await mac(identity,'checkout-draft',[realm,actorScope(actor),actor.kind==='user'?actor.principal.sessionId:actor.id,cart.id]);
  await tx`select pg_advisory_xact_lock(hashtextextended(${`checkout-draft:${key}`},0))`;
  const remaining=new Date(cart.expires_at).getTime()-(await cartClock(tx,cart)).getTime(),root=await directory(request.method==='POST');
  return run({cart,key,path:root?join(root,`${realm}.${key}.json`):null,legacy:root?join(root,`${key}.json`):null,root,realm,remaining,tx});
 });
}
// Drafts are buyer PII in private files under .local; production keeps none (no PII at rest in the storage volume or its
// off-host backups). There checkout carries its state in the form and the quote: nothing is restored after a reload.
export const checkoutDraftsEnabled=()=>runtimeTarget()!=='production';
export async function readCheckoutDraft(request:Request,identity:LocalAuth,cartId:string):Promise<CheckoutDraftRead>{
 if(!checkoutDraftsEnabled())return {kind:'empty',progress:null};
 return scope(request,identity,cartId,async context=>{
  const data=await scopedRead(context);if(!data)return {kind:'empty',progress:null};
  if(context.cart.state!=='open'||context.remaining<=0||Date.parse(data.expires_at)<=Date.now()){
   if(context.path)await remove(context.path);return {kind:'expired',progress:null};
  }
  const {format:_format,scope:_scope,updated_at:_updated,expires_at:_expires,...progress}=data;return {kind:'saved',progress};
 });
}
export async function writeCheckoutDraft(request:Request,identity:LocalAuth,intent:CheckoutIntent,accepted?:{step:CheckoutState['step'];quote:string;allocation_id:string;packages:Selection[]}):Promise<CheckoutDraftWrite>{
 if(request.method!=='POST')throw invalid();
 if(!checkoutDraftsEnabled())return {kind:'stale',revision:Number(intent.draft_revision)||0};
 const writer=id(intent.draft_writer),sequence=count(Number(intent.draft_sequence)),expected=count(Number(intent.draft_revision)),draft=fields(intent.draft),query=string(intent.query,100);
 return scope(request,identity,intent.cart,async context=>{
  if(context.cart.state!=='open'||context.remaining<=0)return {kind:'closed',revision:0};if(!context.path)throw new Error('Draft directory unavailable');
  await prune(context);const prior=await scopedRead(context),current=prior&&Date.parse(prior.expires_at)>Date.now()?prior:null;
  if(current&&current.writer!==writer&&current.revision!==expected)return {kind:'conflict',revision:current.revision};
  if(current?.writer===writer&&sequence<current.sequence)return {kind:'stale',revision:current.revision};
  const significant=checkoutDraftFields.some(name=>name!=='buyer_note'&&current?.draft[name]!==draft[name]);
  const changedSelection=intent.kind==='shipping'&&Boolean(current&&(current.allocation_id!==intent.allocation_id||JSON.stringify(current.packages)!==JSON.stringify(intent.packages)));
  const now=Date.now(),data:StoredProgress={format:'checkout-draft-v1',scope:context.key,revision:(current?.revision??0)+1,writer,sequence,cart_version:context.cart.revision,
   quote:accepted?.quote??current?.quote??'',step:accepted?.step??(significant?'contact':changedSelection?'shipping':current?.step??'contact'),draft,query,
   allocation_id:accepted?.allocation_id??(intent.kind==='shipping'?intent.allocation_id:current?.allocation_id??''),packages:accepted?.packages??(intent.kind==='shipping'?selection(intent.packages):current?.packages??[]),
   updated_at:new Date(now).toISOString(),expires_at:new Date(now+Math.min(86400000,Math.max(0,context.remaining))).toISOString()};
  await write(context.path,data);return {kind:'saved',revision:data.revision};
 });
}
export async function clearCheckoutDraft(request:Request,identity:LocalAuth,cartId:string){
 if(request.method!=='POST')throw invalid();
 if(!checkoutDraftsEnabled())return;
 await scope(request,identity,cartId,async context=>{if(context.path&&await scopedRead(context))await remove(context.path);});
}
