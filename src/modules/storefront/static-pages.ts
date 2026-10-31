import {createHash} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {assertCurrentOwner} from '../access/grants.ts';
import {assertOrigin,privateJson,problem,readBody} from '../access/http.ts';
import {AccessError,getPrincipal,type Principal} from '../access/policy.ts';
import {integer,invalid,object,text} from '../catalog/validation.ts';

// S-C1 static store pages. Owner and ecommerce_admin (cookie session with MFA) write a page as an append-only version;
// the storefront shows the latest version of each slug, or the "sedang disiapkan" placeholder (noindex) while a slug
// has none. The body is plain text with a small fixed markup (blank line = paragraph, "## " heading, "- " list item),
// rendered as React elements, never as HTML.
export const STATIC_PAGES={tentang:'Tentang kami',kontak:'Hubungi kami',syarat:'Syarat dan ketentuan',privasi:'Kebijakan privasi'} as const;
export type StaticSlug=keyof typeof STATIC_PAGES;
const EDITORS=['owner','ecommerce_admin'],OPERATION='static_page.write';
const isSlug=(value:string):value is StaticSlug=>Object.hasOwn(STATIC_PAGES,value);

export type StaticPage={slug:StaticSlug;version:number;title:string;body:string;updated_at:string};
export async function readStaticPage(sql:Sql|TransactionSql,slug:StaticSlug):Promise<StaticPage|null>{
 const [row]=await sql`select slug,revision,title,body,created_at from app.static_page_version where slug=${slug} order by revision desc limit 1`;
 return row?{slug,version:row.revision,title:row.title,body:row.body,updated_at:new Date(row.created_at).toISOString()}:null;
}

// `key`: stable position key for rendering (content is static per version).
export type Block={key:string;kind:'heading'|'paragraph';text:string}|{key:string;kind:'list';items:{key:string;text:string}[]};
export function pageBlocks(body:string):Block[]{
 const blocks:Block[]=[];
 for(const chunk of body.replace(/\r\n?/g,'\n').split(/\n{2,}/)){
  const lines=chunk.split('\n').map((l)=>l.trim()).filter(Boolean);
  for(let i=0;i<lines.length;){
   if(lines[i].startsWith('## ')){blocks.push({key:`b${blocks.length}`,kind:'heading',text:lines[i].slice(3).trim()});i++;continue;}
   if(lines[i].startsWith('- ')){const items:{key:string;text:string}[]=[];while(i<lines.length&&lines[i].startsWith('- ')){items.push({key:`b${blocks.length}-${items.length}`,text:lines[i].slice(2).trim()});i++;}blocks.push({key:`b${blocks.length}`,kind:'list',items});continue;}
   const text:string[]=[];while(i<lines.length&&!lines[i].startsWith('## ')&&!lines[i].startsWith('- ')){text.push(lines[i]);i++;}
   blocks.push({key:`b${blocks.length}`,kind:'paragraph',text:text.join(' ')});
  }
 }
 return blocks.filter((b)=>b.kind==='list'||b.text);
}

const line=(value:unknown,maximum:number)=>{const result=text(value,maximum);if(result!==value||/[\p{Cc}\p{Cf}]/u.test(result)) throw invalid();return result;};
// Body: any text except control characters other than newline and tab. lazy: 20,000 characters inside the 32 KB
// request limit holds for plain Indonesian text; mostly multi-byte text near the cap answers 413.
const bodyText=(value:unknown)=>{const result=text(value,20000);if(result!==value||/\p{Cf}|(?![\n\t])\p{Cc}/u.test(result)) throw invalid();return result;};

async function editor(tx:TransactionSql,principal:Principal){await assertCurrentOwner(tx,principal,false,EDITORS);}

async function list(identity:LocalAuth,principal:Principal){
 return identity.sql.begin(async(tx)=>{
  await editor(tx,principal);
  const rows=await tx`select distinct on (v.slug) v.slug,v.revision,v.title,v.created_at,u.name as actor_name from app.static_page_version v
   left join app.auth_user u on u.id::text=v.actor_id order by v.slug,v.revision desc`;
  const latest=new Map(rows.map((r)=>[r.slug as string,r]));
  return {data:(Object.keys(STATIC_PAGES) as StaticSlug[]).map((slug)=>{const r=latest.get(slug);
   return {slug,path:`/${slug}`,default_title:STATIC_PAGES[slug],version:r?Number(r.revision):0,title:r?.title??null,updated_at:r?new Date(r.created_at).toISOString():null,actor_name:r?.actor_name??null};})};
 });
}

async function history(identity:LocalAuth,principal:Principal,slug:StaticSlug){
 return identity.sql.begin(async(tx)=>{
  await editor(tx,principal);
  const rows=await tx`select v.revision,v.title,v.body,v.reason,v.created_at,u.name as actor_name from app.static_page_version v
   left join app.auth_user u on u.id::text=v.actor_id where v.slug=${slug} order by v.revision desc limit 20`;
  const versions=rows.map((r)=>({version:Number(r.revision),title:r.title as string,reason:r.reason as string,updated_at:new Date(r.created_at).toISOString(),actor_name:(r.actor_name as string|null)??null}));
  return {slug,path:`/${slug}`,default_title:STATIC_PAGES[slug],current:rows[0]?{version:Number(rows[0].revision),title:rows[0].title as string,body:rows[0].body as string}:null,versions};
 });
}

async function save(request:Request,identity:LocalAuth,principal:Principal,slug:StaticSlug,value:unknown){
 const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');
 const data=object(value,['expected_version','title','body','reason']);
 const input={slug,expected_version:integer(data.expected_version,0),title:line(data.title,80),body:bodyText(data.body),reason:line(data.reason,500)};
 if(!input.body.trim()) throw invalid();
 const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 return identity.sql.begin(async(tx)=>{
  await editor(tx,principal);
  // Lock first so a concurrent request with the same key waits and then replays instead of colliding.
  await tx`select pg_advisory_xact_lock(hashtextextended(${`static-page:${slug}`},0))`;
  const [prior]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action=${OPERATION} and key=${key}`;
  if(prior){if(prior.request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return prior.response;}
  const [last]=await tx`select coalesce(max(revision),0)::int as revision from app.static_page_version where slug=${slug}`;
  if(last.revision!==input.expected_version) throw new AccessError(409,'VERSION_CONFLICT');
  const [row]=await tx`insert into app.static_page_version (slug,revision,title,body,actor_id,reason) values (${slug},${input.expected_version+1},${input.title},${input.body},${principal.id},${input.reason})
   returning revision,created_at`;
  const response={slug,path:`/${slug}`,version:Number(row.revision),title:input.title,updated_at:new Date(row.created_at).toISOString()};
  await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
   values (${principal.id},${OPERATION},${`static-page:${slug}`},'allowed',${input.reason},${JSON.stringify({version:response.version,title:input.title,body_length:input.body.length})}::jsonb)`;
  await tx`insert into app.access_operation (actor_id,action,key,request_hash,response) values (${principal.id},${OPERATION},${key},${hash},${JSON.stringify(response)}::jsonb)`;
  return response;
 });
}

export async function handleStaticPages(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);
  if(['authorization','x-cart-token','x-order-token'].some((name)=>request.headers.has(name))) throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
  const url=new URL(request.url);
  const match=/^\/api\/v1\/admin\/static-pages(?:\/([a-z]+)(\/versions)?)?$/.exec(url.pathname);
  if(!match) throw new AccessError(404,'NOT_FOUND');
  if(url.search) throw invalid();
  const principal=await getPrincipal(request,identity);
  if(!principal.roles.some((role)=>EDITORS.includes(role))) throw new AccessError(403,'FORBIDDEN');
  const [,slug,versions]=match;
  if(slug!==undefined&&!isSlug(slug)) throw new AccessError(404,'NOT_FOUND');
  if(request.method==='GET'&&!slug) return privateJson(await list(identity,principal));
  if(request.method==='GET'&&slug&&!versions) return privateJson(await history(identity,principal,slug as StaticSlug));
  if(request.method==='POST'&&slug&&versions) return privateJson(await save(request,identity,principal,slug as StaticSlug,await readBody(request,32768)),201);
  throw new AccessError(404,'NOT_FOUND');
 }catch(error){
  if(error&&typeof error==='object'&&'code' in error&&error.code==='23505'&&'constraint_name' in error){
   if(error.constraint_name==='static_page_version_unique') return problem(new AccessError(409,'VERSION_CONFLICT'));
   // The same key used at once on two slugs (different locks).
   if(error.constraint_name==='access_operation_identity_idx') return problem(new AccessError(409,'IDEMPOTENCY_CONFLICT'));
  }
  return problem(error);
 }
}
