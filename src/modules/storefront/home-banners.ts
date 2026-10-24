import {createHash,randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {assertCurrentOwner,consumeAccessProof} from '../access/grants.ts';
import {assertOrigin,privateJson,problem,readBody} from '../access/http.ts';
import {AccessError,getPrincipal,type Principal} from '../access/policy.ts';
import {array,id,integer,invalid,object,text} from '../catalog/validation.ts';
import {instant} from '../promotions/configuration.ts';
import {catalogMediaFileName,readCatalogMedia,saveCatalogMedia} from '../../storage/catalog-media.ts';
import {scanImagePayload,sniffImageContentType,webpSize} from '../../storage/media-sniff.ts';
import {BANNER_IMAGE_BYTES,BANNER_IMAGE_MAX,BANNER_IMAGE_MIN,BANNER_LIMIT,BANNER_TINTS,bannerHref,bannerPhase} from './banner-rules.ts';

// S110 admin-managed home promo banners. Owner and ecommerce_admin (current cookie session with MFA) read and
// write; every write also consumes a fresh `home_banner.write` reauthentication proof, appends one immutable
// version per changed banner, writes an audit event and saves an actor-scoped committed retry response, all in
// one transaction. Images are WebP catalog media (DEC-005) uploaded through /admin/home-banner-images.

const PURPOSE='home_banner.write',SUBJECT='home-banners',OPERATION='home_banner.write';
const EDITORS=['owner','ecommerce_admin'];
const DAY=86_400_000;
const FIELDS=['title','subtitle','action_label','href','image_sha256','image_alt','tint','starts_at','ends_at','active'] as const;

const line=(value:unknown,maximum:number)=>{const result=text(value,maximum);if(result!==result.trim()||/[\p{Cc}\p{Cf}]/u.test(result)) throw invalid();return result;};
const proofText=(value:unknown)=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw invalid();return value;};
const sha=(value:unknown)=>{if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value)) throw invalid();return value;};

export type BannerContent={title:string;subtitle:string|null;action_label:string;href:string;image_sha256:string;image_alt:string;tint:string|null;starts_at:string;ends_at:string;active:boolean};
// Closed JSON for create/revise. Window: starts_at < ends_at, ends_at in the future, starts_at at most 366 days ahead.
export function bannerContent(body:Record<string,unknown>,now=Date.now()):BannerContent{
 if(typeof body.active!=='boolean') throw invalid();
 const href=bannerHref(body.href);
 if(href===null||href!==body.href) throw new AccessError(400,'INVALID_BANNER_LINK');
 const tint=body.tint===null?null:BANNER_TINTS.find(t=>t===body.tint);
 if(tint===undefined) throw invalid();
 const content={title:line(body.title,60),subtitle:body.subtitle===null?null:line(body.subtitle,140),action_label:line(body.action_label,24),href,
  image_sha256:sha(body.image_sha256),image_alt:line(body.image_alt,160),tint,starts_at:instant(body.starts_at),ends_at:instant(body.ends_at),active:body.active};
 if(content.starts_at>=content.ends_at) throw new AccessError(400,'BANNER_WINDOW_INVALID');
 if(Date.parse(content.ends_at)<=now) throw new AccessError(400,'BANNER_ALREADY_ENDED');
 if(Date.parse(content.starts_at)>now+366*DAY) throw new AccessError(400,'BANNER_SCHEDULE_TOO_DISTANT');
 return content;
}
export function createInput(value:unknown){const body=object(value,[...FIELDS,'reason','reauthentication_proof']);return {content:bannerContent(body),reason:line(body.reason,500),proof:proofText(body.reauthentication_proof)};}
export function reviseInput(value:unknown){const body=object(value,[...FIELDS,'expected_version','reason','reauthentication_proof']);return {expected_version:integer(body.expected_version,1),content:bannerContent(body),reason:line(body.reason,500),proof:proofText(body.reauthentication_proof)};}
export function retireInput(value:unknown){const body=object(value,['expected_version','reason','reauthentication_proof']);return {expected_version:integer(body.expected_version,1),reason:line(body.reason,500),proof:proofText(body.reauthentication_proof)};}
export function orderInput(value:unknown){
 const body=object(value,['banners','reason','reauthentication_proof']);
 const banners=array(body.banners,(item)=>{const entry=object(item,['id','expected_version']);return {id:id(entry.id).toLowerCase(),expected_version:integer(entry.expected_version,1)};},1,BANNER_LIMIT);
 if(new Set(banners.map(b=>b.id)).size!==banners.length) throw invalid();
 return {banners,reason:line(body.reason,500),proof:proofText(body.reauthentication_proof)};
}

// Stored image facts come from the bytes on disk, never from the client: the hash must name a verified WebP in
// catalog media whose size fits the rail.
function imageFacts(bytes:Uint8Array){
 const {width,height}=webpSize(bytes);
 if(width<BANNER_IMAGE_MIN||height<BANNER_IMAGE_MIN) throw new AccessError(422,'BANNER_IMAGE_TOO_SMALL');
 if(width>BANNER_IMAGE_MAX||height>BANNER_IMAGE_MAX) throw new AccessError(422,'BANNER_IMAGE_TOO_LARGE');
 return {width,height};
}
async function storedImage(hash:string){
 let bytes:Uint8Array;
 try{bytes=await readCatalogMedia(`${hash}.webp`);}catch{throw new AccessError(422,'BANNER_IMAGE_NOT_FOUND');}
 return imageFacts(bytes);
}

type Row=Record<string,unknown>;
const iso=(value:unknown)=>new Date(String(value)).toISOString();
function project(row:Row,now=new Date()){
 const banner={id:String(row.banner_id),version:Number(row.revision),version_id:String(row.id),title:String(row.title),subtitle:row.subtitle===null?null:String(row.subtitle),
  action_label:String(row.action_label),href:String(row.href),tint:row.tint===null?null:String(row.tint),
  image:{sha256:String(row.image_sha256),width:Number(row.image_width),height:Number(row.image_height),alt:String(row.image_alt),url:`/media/catalog/${catalogMediaFileName(String(row.title),String(row.image_sha256))}`},
  starts_at:iso(row.starts_at),ends_at:iso(row.ends_at),position:Number(row.position),active:Boolean(row.active),retired:Boolean(row.retired),
  recorded_by:String(row.actor_id),recorded_by_name:row.actor_name===null||row.actor_name===undefined?null:String(row.actor_name),reason:String(row.reason),recorded_at:iso(row.created_at)};
 return {...banner,phase:bannerPhase(banner,now)};
}
const CURRENT=(tx:TransactionSql)=>tx`select v.*,u.name as actor_name from app.home_banner h join app.home_banner_version v on v.banner_id=h.id and v.revision=h.revision
 left join app.auth_user u on u.id=v.actor_id`;

async function editor(tx:TransactionSql,principal:Principal){await assertCurrentOwner(tx,principal,false,EDITORS);}
function retryKey(request:Request){const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');return key;}

async function readBanner(tx:TransactionSql,bannerId:string){
 const [row]=await tx`${CURRENT(tx)} where h.id=${bannerId}`;
 if(!row) throw new AccessError(404,'NOT_FOUND');return project(row);
}
async function currentList(tx:TransactionSql,retired:boolean){
 const rows=retired
  ?await tx`${CURRENT(tx)} where v.retired order by v.created_at desc,v.banner_id limit 50`
  :await tx`${CURRENT(tx)} where not v.retired order by v.position,h.created_at,h.id`;
 // `configured`: some banner exists (even retired), so the storefront no longer shows its built-in defaults.
 const [head]=await tx`select exists(select 1 from app.home_banner) as configured`;
 const now=new Date();return {configured:Boolean(head.configured),data:rows.map(row=>project(row,now))};
}
async function append(tx:TransactionSql,bannerId:string,revision:number,v:BannerContent&{image_width:number;image_height:number;position:number;retired:boolean},actorId:string,reason:string){
 await tx`insert into app.home_banner_version (banner_id,revision,title,subtitle,action_label,href,image_sha256,image_width,image_height,image_alt,tint,starts_at,ends_at,position,active,retired,actor_id,reason)
  values (${bannerId},${revision},${v.title},${v.subtitle},${v.action_label},${v.href},${v.image_sha256},${v.image_width},${v.image_height},${v.image_alt},${v.tint},${v.starts_at},${v.ends_at},${v.position},${v.active},${v.retired},${actorId},${reason})`;
 await tx`update app.home_banner set revision=revision+1 where id=${bannerId}`;
}
// The head row locked for this write; its expected revision must still be current and not retired.
async function lockCurrent(tx:TransactionSql,bannerId:string,expected:number){
 const [row]=await tx`select v.* from app.home_banner h join app.home_banner_version v on v.banner_id=h.id and v.revision=h.revision where h.id=${bannerId} for update of h`;
 if(!row) throw new AccessError(404,'NOT_FOUND');
 if(row.retired) throw new AccessError(409,'BANNER_RETIRED');
 if(Number(row.revision)!==expected) throw new AccessError(409,'VERSION_CONFLICT');
 return row;
}
const carried=(row:Row)=>({title:String(row.title),subtitle:row.subtitle===null?null:String(row.subtitle),action_label:String(row.action_label),href:String(row.href),
 image_sha256:String(row.image_sha256),image_alt:String(row.image_alt),tint:row.tint===null?null:String(row.tint),starts_at:iso(row.starts_at),ends_at:iso(row.ends_at),
 active:Boolean(row.active),image_width:Number(row.image_width),image_height:Number(row.image_height),position:Number(row.position),retired:false});

// One write: authority, committed retry (the retry hash excludes the single-use proof), proof consumption, the
// change, its audit event and the saved response commit together.
async function write(request:Request,identity:LocalAuth,principal:Principal,kind:string,intent:unknown,proof:string,
 change:(tx:TransactionSql)=>Promise<{subject:string;response:unknown;details:Record<string,unknown>;reason:string}>){
 const key=retryKey(request);const hash=createHash('sha256').update(JSON.stringify([kind,intent])).digest('hex');
 return identity.sql.begin(async(tx)=>{
  await editor(tx,principal);
  const [prior]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action=${OPERATION} and key=${key}`;
  if(prior){if(prior.request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return prior.response;}
  await consumeAccessProof(tx,principal,PURPOSE,SUBJECT,proof);
  const result=await change(tx);
  await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
   values (${principal.id},${`home_banner.${kind}`},${result.subject},'allowed',${result.reason},${JSON.stringify(result.details)}::jsonb)`;
  await tx`insert into app.access_operation (actor_id,action,key,request_hash,response) values (${principal.id},${OPERATION},${key},${hash},${JSON.stringify(result.response)}::jsonb)`;
  return result.response;
 });
}

async function create(request:Request,identity:LocalAuth,principal:Principal,body:unknown){
 const input=createInput(body);const image=await storedImage(input.content.image_sha256);
 return write(request,identity,principal,'create',{content:input.content,reason:input.reason},input.proof,async(tx)=>{
  // Serialize creators so the limit and the appended position hold under concurrency.
  await tx`select pg_advisory_xact_lock(hashtext('99ribu:home_banner:create'))`;
  const [count]=await tx`select count(*)::int as live,coalesce(max(v.position)+1,0)::int as next from app.home_banner h join app.home_banner_version v on v.banner_id=h.id and v.revision=h.revision where not v.retired`;
  if(count.live>=BANNER_LIMIT) throw new AccessError(409,'BANNER_LIMIT_REACHED');
  const bannerId=randomUUID();
  await tx`insert into app.home_banner (id) values (${bannerId})`;
  await append(tx,bannerId,1,{...input.content,image_width:image.width,image_height:image.height,position:Math.min(count.next,999),retired:false},principal.id,input.reason);
  const response=await readBanner(tx,bannerId);
  return {subject:bannerId,response,reason:input.reason,details:{version_id:response.version_id,version:1}};
 });
}
async function revise(request:Request,identity:LocalAuth,principal:Principal,bannerId:string,body:unknown){
 const input=reviseInput(body);const image=await storedImage(input.content.image_sha256);
 return write(request,identity,principal,'revise',{bannerId,expected_version:input.expected_version,content:input.content,reason:input.reason},input.proof,async(tx)=>{
  const current=await lockCurrent(tx,bannerId,input.expected_version);
  await append(tx,bannerId,input.expected_version+1,{...input.content,image_width:image.width,image_height:image.height,position:Number(current.position),retired:false},principal.id,input.reason);
  const response=await readBanner(tx,bannerId);
  return {subject:bannerId,response,reason:input.reason,details:{version_id:response.version_id,version:response.version}};
 });
}
async function retire(request:Request,identity:LocalAuth,principal:Principal,bannerId:string,body:unknown){
 const input=retireInput(body);
 return write(request,identity,principal,'retire',{bannerId,expected_version:input.expected_version,reason:input.reason},input.proof,async(tx)=>{
  const current=await lockCurrent(tx,bannerId,input.expected_version);
  await append(tx,bannerId,input.expected_version+1,{...carried(current),active:false,retired:true},principal.id,input.reason);
  const response=await readBanner(tx,bannerId);
  return {subject:bannerId,response,reason:input.reason,details:{version_id:response.version_id,version:response.version}};
 });
}
// Reorder names every banner that is not retired, in the new order, each with its current version; banners
// whose position changes get one appended version. Anything stale (added, retired or revised since) is 409.
async function reorder(request:Request,identity:LocalAuth,principal:Principal,body:unknown){
 const input=orderInput(body);
 return write(request,identity,principal,'reorder',{banners:input.banners,reason:input.reason},input.proof,async(tx)=>{
  await tx`select pg_advisory_xact_lock(hashtext('99ribu:home_banner:create'))`;
  const rows=await tx`select v.* from app.home_banner h join app.home_banner_version v on v.banner_id=h.id and v.revision=h.revision where not v.retired order by h.id for update of h`;
  const byId=new Map(rows.map(row=>[String(row.banner_id),row]));
  if(rows.length!==input.banners.length||input.banners.some(b=>!byId.has(b.id))) throw new AccessError(409,'BANNER_ORDER_STALE');
  if(input.banners.some(b=>Number(byId.get(b.id)?.revision)!==b.expected_version)) throw new AccessError(409,'VERSION_CONFLICT');
  const moved:string[]=[];
  for(const [position,entry] of input.banners.entries()){
   const row=byId.get(entry.id) as Row;
   if(Number(row.position)===position) continue;
   await append(tx,entry.id,entry.expected_version+1,{...carried(row),position},principal.id,input.reason);moved.push(entry.id);
  }
  return {subject:SUBJECT,response:await currentList(tx,false),reason:input.reason,details:{order:input.banners.map(b=>b.id),moved}};
 });
}

// Raw WebP upload into catalog media. Authority is checked before any byte is read; the declared type, the size
// (Content-Length and the streamed total), magic bytes, the marker scan and the pixel size are all enforced,
// then the content-addressed file is stored (idempotent). A per-actor budget bounds disk use.
async function upload(request:Request,identity:LocalAuth,principal:Principal){
 retryKey(request);
 await identity.sql.begin(tx=>editor(tx,principal));
 const now=Date.now();
 const [rate]=await identity.sql`insert into app.auth_rate_limit (id,key,count,last_request) values (${randomUUID()},${`home-banner-image:${principal.id}`},1,${now})
  on conflict (key) do update set count=case when app.auth_rate_limit.last_request<${now-60000} then 1 else app.auth_rate_limit.count+1 end,
  last_request=case when app.auth_rate_limit.last_request<${now-60000} then ${now} else app.auth_rate_limit.last_request end returning count,last_request`;
 if(rate.count>20) throw new AccessError(429,'RATE_LIMITED',Math.max(1,Math.ceil((Number(rate.last_request)+60000-now)/1000)));
 if(request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='image/webp') throw new AccessError(415,'UNSUPPORTED_IMAGE_TYPE');
 const declared=request.headers.get('content-length');
 if(declared!==null&&(!/^\d{1,9}$/.test(declared)||Number(declared)>BANNER_IMAGE_BYTES)) throw new AccessError(413,'BODY_TOO_LARGE');
 const reader=request.body?.getReader();if(!reader) throw invalid();
 const chunks:Uint8Array[]=[];let size=0;
 while(true){
  const chunk=await reader.read();if(chunk.done) break;
  size+=chunk.value.byteLength;
  if(size>BANNER_IMAGE_BYTES){await reader.cancel();throw new AccessError(413,'BODY_TOO_LARGE');}
  chunks.push(chunk.value);
 }
 const bytes=new Uint8Array(Buffer.concat(chunks));
 if(!bytes.byteLength) throw invalid();
 let type:string;
 try{type=sniffImageContentType(bytes);}catch{throw new AccessError(415,'UPLOAD_TYPE_MISMATCH');}
 if(type!=='image/webp') throw new AccessError(415,'UPLOAD_TYPE_MISMATCH');
 if(scanImagePayload(bytes)!=='ready') throw new AccessError(422,'BANNER_IMAGE_REJECTED');
 const {width,height}=imageFacts(bytes);
 const {name,created}=await saveCatalogMedia(bytes);
 const hash=name.slice(0,64);
 await identity.sql`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
  values (${principal.id},'home_banner.image_upload',${hash},'allowed','Banner image upload',${JSON.stringify({byte_size:bytes.byteLength,width,height,created})}::jsonb)`;
 return {sha256:hash,width,height,byte_size:bytes.byteLength,url:`/media/catalog/${hash.slice(0,12)}.webp`};
}

async function history(identity:LocalAuth,principal:Principal,bannerId:string,url:URL){
 for(const key of url.searchParams.keys()) if(!['cursor','limit'].includes(key)||url.searchParams.getAll(key).length!==1) throw invalid();
 const raw=url.searchParams.get('cursor');const size=url.searchParams.get('limit')??'20';
 if(!/^\d{1,3}$/.test(size)||(raw!==null&&!/^\d{1,10}$/.test(raw))) throw invalid();
 const limit=integer(Number(size),1,100);const cursor=raw===null?null:integer(Number(raw),1);
 return identity.sql.begin(async(tx)=>{
  await editor(tx,principal);
  if(!(await tx`select id from app.home_banner where id=${bannerId}`).length) throw new AccessError(404,'NOT_FOUND');
  const rows=await tx`select v.*,u.name as actor_name from app.home_banner_version v left join app.auth_user u on u.id=v.actor_id
   where v.banner_id=${bannerId} and (${cursor}::int is null or v.revision<${cursor}::int) order by v.revision desc limit ${limit+1}`;
  const now=new Date();const data=rows.slice(0,limit).map(row=>project(row,now));
  return {data,pagination:{next_cursor:rows.length>limit?String(data.at(-1)?.version):null}};
 });
}

export async function handleHomeBanners(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);
  if(['authorization','x-cart-token','x-order-token'].some((name)=>request.headers.has(name))) throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  const url=new URL(request.url);
  const images=url.pathname==='/api/v1/admin/home-banner-images';
  const match=images?null:/^\/api\/v1\/admin\/home-banners(?:\/(order)|\/([^/]+)\/(versions|retirements))?$/.exec(url.pathname);
  if(!images&&!match) throw new AccessError(404,'NOT_FOUND');
  if(request.method!=='GET'&&url.search) throw invalid();
  const principal=await getPrincipal(request,identity);
  if(images){if(request.method!=='POST') throw new AccessError(404,'NOT_FOUND');return privateJson(await upload(request,identity,principal),201);}
  const [,order,scope,sub]=match as RegExpExecArray;
  const bannerId=scope===undefined?null:id(scope).toLowerCase();
  if(request.method==='GET'){
   if(order||sub==='retirements') throw new AccessError(404,'NOT_FOUND');
   if(bannerId) return privateJson(await history(identity,principal,bannerId,url));
   const keys=[...url.searchParams.keys()],state=url.searchParams.get('state')??'current';
   if(keys.some(key=>key!=='state')||url.searchParams.getAll('state').length>1||!['current','retired'].includes(state)) throw invalid();
   return privateJson(await identity.sql.begin(async(tx)=>{await editor(tx,principal);return currentList(tx,state==='retired');}));
  }
  if(request.method!=='POST') throw new AccessError(404,'NOT_FOUND');
  const body=await readBody(request);
  if(order) return privateJson(await reorder(request,identity,principal,body),201);
  if(!bannerId) return privateJson(await create(request,identity,principal,body),201);
  return privateJson(sub==='versions'?await revise(request,identity,principal,bannerId,body):await retire(request,identity,principal,bannerId,body),201);
 }catch(error){return problem(error);}
}
