import {createHash} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError} from '../access/policy.ts';
import {salePublication} from '../catalog/publication.ts';
import {id,invalid,object,text} from '../catalog/validation.ts';
import {offerAvailability} from '../inventory/reservations.ts';

type Filters=Record<string,string[]>;
export type PublicCategory={id:string;name:string;slug:string;parent_id:string|null};
export async function publicCategory(sql:Sql|TransactionSql,key:string,by:'id'|'slug'='id'){
 const wanted=by==='id'?id(key):key;if(by!=='id'&&(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)||key.length>100)) throw invalid();
 const [category]=await sql<PublicCategory[]>`with recursive visible as (
  select distinct r.category_id as id from app.publication_head h join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision
   join app.product_revision r on r.product_id=v.product_id and r.revision=v.product_revision
  union select c.parent_id from app.category c join visible p on p.id=c.id where c.parent_id is not null)
  select c.id,c.name,c.slug,c.parent_id from app.category c where c.id in (select id from visible)
   and ((${by}='id' and c.id::text=${wanted}) or (${by}='slug' and c.slug=${wanted}))`;
 return category??null;
}
export async function featuredDepartments(identity:LocalAuth){
 const categories=await Promise.all(['shop-commerce-demo-busana','shop-commerce-demo-perawatan'].map(slug=>publicCategory(identity.sql,slug,'slug')));
 return categories.filter((c):c is PublicCategory=>c!==null);
}
export type CatalogQuery={q:string;category_id:string|null;sort:'relevance'|'newest';offer_kind:string|null;availability:string|null;attributes:Filters;limit:number;cursor:string|null};
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function catalogQuery(params:URLSearchParams):CatalogQuery{
 const keys=['q','category_id','sort','offer_kind','availability','attributes','limit','cursor'];
 for(const key of params.keys()) if(!keys.includes(key)||params.getAll(key).length!==1) throw invalid();
 const q=text(params.get('q')??'',200,true).trim();if(/[\p{Cc}\p{Cf}]/u.test(q)) throw invalid();
 const category=params.get('category_id')||null,sort=params.get('sort')??'relevance',kind=params.get('offer_kind')||null,availability=params.get('availability')||null;
 if(!['relevance','newest'].includes(sort)||kind&&!['unit','multipack','bundle'].includes(kind)||availability&&!['available','unavailable'].includes(availability)) throw invalid();
 const limit=params.get('limit')??'24';if(!/^(?:[1-9]|[1-3][0-9]|40)$/.test(limit)) throw invalid();
 const attributes:Filters={};const raw=params.get('attributes');
 if(raw){if(!category||raw.length>2000) throw invalid();let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw invalid();}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).length>10) throw invalid();
  for(const key of Object.keys(parsed).sort()){if(!/^[a-z][a-z0-9_]{0,49}$/.test(key)) throw invalid();const values=(parsed as Filters)[key];
   if(!Array.isArray(values)||!values.length||values.length>10) throw invalid();attributes[key]=[...new Set(values.map(v=>text(v,200)))].sort();}
 }
 const cursor=params.get('cursor')??null;if(cursor!==null&&!/^[A-Za-z0-9_-]{1,1024}$/.test(cursor)) throw invalid();
 return {q,category_id:category?id(category):null,sort:sort as CatalogQuery['sort'],offer_kind:kind,availability,attributes,limit:Number(limit),cursor};
}
type Position={r:number;t:string;id:string;h:string};
function readCursor(input:CatalogQuery){
 const hash=fingerprint({...input,limit:undefined,cursor:undefined});let position:Position|null=null;
 if(input.cursor){try{const value=object(JSON.parse(Buffer.from(input.cursor,'base64url').toString()),['r','t','id','h']);
  if(value.h!==hash||!Number.isInteger(value.r)||Number(value.r)<0||Number(value.r)>2||typeof value.t!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value.t)||!Number.isFinite(Date.parse(value.t))) throw invalid();
  if(Number(value.t.slice(0,4))<1||new Date(value.t).toISOString()!==`${value.t.slice(0,23)}Z`) throw invalid();
  position={r:Number(value.r),t:value.t,id:id(value.id),h:hash};
 }catch{throw invalid();}}
 return {hash,position};
}
export async function publicProduct(tx:TransactionSql,productId:string){
 const [clock]=await tx`select clock_timestamp()::text as now`;const published=await salePublication(tx,id(productId),clock.now);
 if(!published) return null;const draft=published.draft;
 const variants=[];
 for(const offer of draft.variants.filter(v=>!v.retired)){
  const warehouses=await tx`select distinct b.warehouse_id from app.inventory_balance b join app.warehouse w on w.id=b.warehouse_id
   where w.active and b.stock_item_id in ${tx(offer.contents.map(c=>c.stock_item_id))} order by b.warehouse_id`;
  let available=false;for(const warehouse of warehouses){try{if(await offerAvailability(tx,{product_id:draft.id,product_revision:draft.version,offer_id:offer.id,warehouse_id:warehouse.warehouse_id})>0){available=true;break;}}
   catch(error){if(!(error instanceof AccessError)||error.status!==404) throw error;}}
  variants.push({id:offer.id,catalog_id:offer.catalog_id,label:offer.label,attributes:offer.attributes,price:99000 as const,currency:'IDR' as const,
   availability:available?'available' as const:'unavailable' as const,image:offer.image??draft.images[0],offer_kind:offer.offer_kind,
   contents:offer.contents.map(c=>({name:c.name,quantity:c.quantity}))});
 }
 const [finished]=await tx`select clock_timestamp()::text as now`;
 if(!variants.length||!await salePublication(tx,draft.id,finished.now)) return null;
 return {id:draft.id,catalog_id:draft.catalog_id,slug:draft.slug,version:draft.version,publication_id:published.publication_id,
  name:draft.name,description:draft.description,category_id:draft.category_id,images:draft.images,facts:draft.facts,variants};
}
export type PublicProduct=NonNullable<Awaited<ReturnType<typeof publicProduct>>>;
export function matchingVariant(product:PublicProduct,input?:CatalogQuery){
 const matches=product.variants.filter(offer=>(!input?.offer_kind||offer.offer_kind===input.offer_kind)&&(!input?.availability||offer.availability===input.availability)&&
  Object.entries(input?.attributes??{}).every(([key,values])=>{const attribute=offer.attributes.find(a=>a.key===key)??product.facts.find(a=>a.key===key);return attribute&&values.some(value=>attribute.values.includes(value));}));
 return matches.find(offer=>offer.availability==='available')??matches[0];
}
export async function listProducts(identity:LocalAuth,input:CatalogQuery){
 const {hash,position}=readCursor(input);
 return identity.sql.begin(async tx=>{
  let rules:{key:string;label:string}[]=[];
  if(input.category_id){if(!await publicCategory(tx,input.category_id)) throw new AccessError(404,'NOT_FOUND');const rows=await tx`with recursive parents as (select id,parent_id,attribute_definitions from app.category where id=${input.category_id}
    union all select c.id,c.parent_id,c.attribute_definitions from app.category c join parents p on c.id=p.parent_id) select attribute_definitions from parents`;
   if(!rows.length) throw new AccessError(404,'NOT_FOUND');rules=rows.flatMap(row=>row.attribute_definitions);
   if(Object.keys(input.attributes).some(key=>!rules.some(rule=>rule.key===key))) throw invalid();}
  const escaped=input.q.replace(/[\\%_]/g,'\\$&');
  // lazy: bounded source validation per request. A page may be empty with a next
  // cursor after source invalidation; continue scanning instead of inventing totals.
  const candidates=await tx`with recursive departments as (select id from app.category where id=${input.category_id}
    union all select c.id from app.category c join departments p on c.parent_id=p.id), ranked as (
    select p.id,v.created_at,to_char(v.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as stamp,
     case when ${input.sort}='newest' or ${input.q}='' then 0 when lower(r.name)=lower(${input.q}) then 0
      when r.name ilike ${`${escaped}%`} then 1 else 2 end as rank
    from app.product p join app.publication_head h on h.product_id=p.id join app.publication_version v on v.product_id=p.id and v.revision=h.revision
     join app.product_revision r on r.product_id=p.id and r.revision=v.product_revision
    where (${input.category_id}::uuid is null or r.category_id in (select id from departments))
     and (${input.q}='' or r.name ilike ${`%${escaped}%`} or r.description ilike ${`%${escaped}%`}))
    select * from ranked where ${position===null} or rank>${position?.r??0}
     or (rank=${position?.r??0} and (created_at<${position?.t??'1970-01-01T00:00:00.000000Z'}::timestamptz or (created_at=${position?.t??'1970-01-01T00:00:00.000000Z'}::timestamptz and id>${position?.id??'00000000-0000-0000-0000-000000000000'}::uuid)))
    order by rank,created_at desc,id limit ${input.limit*4+1}`;
  const data:PublicProduct[]=[];let processed=0;let last:Position|null=null;
  for(const candidate of candidates.slice(0,input.limit*4)){
   const product=await publicProduct(tx,candidate.id);processed++;last={r:candidate.rank,t:candidate.stamp,id:candidate.id,h:hash};
   if(product&&matchingVariant(product,input)) data.push(product);if(data.length===input.limit) break;
  }
  const available_filters=rules.map(rule=>({key:rule.key,label:rule.label,values:[...new Set(data.flatMap(p=>p.variants.flatMap(v=>(v.attributes.find(a=>a.key===rule.key)??p.facts.find(a=>a.key===rule.key))?.values??[])))].sort()}));
  return {data,pagination:{next_cursor:processed<candidates.length&&last?Buffer.from(JSON.stringify(last)).toString('base64url'):null},available_filters};
 });
}
export async function listCategories(identity:LocalAuth,params:URLSearchParams){
 for(const key of params.keys()) if(!['cursor','limit'].includes(key)||params.getAll(key).length!==1) throw invalid();
 const cursor=params.has('cursor')?id(params.get('cursor')):null,raw=params.get('limit')??'24';if(!/^(?:[1-9]|[1-9][0-9]|100)$/.test(raw)) throw invalid();
 const limit=Number(raw);const data=await identity.sql`with recursive visible as (
  select distinct r.category_id as id from app.publication_head h join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision
   join app.product_revision r on r.product_id=v.product_id and r.revision=v.product_revision
  union select c.parent_id from app.category c join visible p on p.id=c.id where c.parent_id is not null)
  select c.id,c.name,c.slug,c.parent_id from app.category c where c.id in (select id from visible) and (${cursor}::uuid is null or c.id>${cursor}::uuid) order by c.id limit ${limit+1}`;
 return {data:data.slice(0,limit),pagination:{next_cursor:data.length>limit?data[limit-1].id as string:null}};
}
export async function featuredProducts(identity:LocalAuth){
 // Local home merchandising only; ordinary merchant products remain searchable.
 const rows=await identity.sql`select product_id from app.offer where sku in ('SF_COMMERCE-DEMO_SHIRT','SF_COMMERCE-DEMO_CREAM-PAIR','SF_COMMERCE-DEMO_SHIRT-PAIR','SF_COMMERCE-DEMO_SHIRT-CREAM') order by sku`;
 const products:PublicProduct[]=[];for(const row of rows){const product=await identity.sql.begin(tx=>publicProduct(tx,row.product_id));if(product) products.push(product);}return products;
}
