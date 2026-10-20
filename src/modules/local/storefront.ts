import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {connectDatabase} from '../../db/client.ts';
import {readLocalConfig} from '../../config/local.ts';
import type {LocalAuth} from '../access/auth.ts';
import {assertCurrentOwner} from '../access/grants.ts';
import {assertOrigin} from '../access/http.ts';
import {getPrincipal} from '../access/policy.ts';
import {createCategory,createProduct,readCatalogRevision} from '../catalog/catalog.ts';
import {publishProduct,readPublicationState} from '../catalog/publication.ts';
import {invalid} from '../catalog/validation.ts';
import {appendCostVersion} from '../finance/costs.ts';
import type {seedCommerce} from './commerce.ts';

// Host-only local sample curation through actual writers. Original S18 products,
// unknown HPP, costs, stock, clocks and operator edits are never overwritten.
export async function prepareStorefront(request:Request,identity:LocalAuth,target:'local'|'test',namespace:string,seeded:Awaited<ReturnType<typeof seedCommerce>>,signal?:AbortSignal){
 assertOrigin(request);readLocalConfig(process.env);signal?.throwIfAborted();
 if(!['local','test'].includes(target)||seeded.namespace!==namespace||!/^[a-z][a-z0-9-]{0,23}$/.test(namespace)||['authorization','x-cart-token','x-order-token'].some(h=>request.headers.has(h))) throw invalid();
 const [database]=await identity.sql`select current_database() name`;if(database.name!==`99ribu_${target}`) throw invalid();
 const principal=await getPrincipal(request,identity);
 const owner=()=>identity.sql.begin(async tx=>{await tx`select id from app.auth_user where id=${principal.id} for update`;await assertCurrentOwner(tx,principal);});
 await owner();const lock=connectDatabase(target).sql;
 const command=(step:string)=>{const req=new Request(request.url,{method:'POST',headers:request.headers});req.headers.set('idempotency-key',createHash('sha256').update(`storefront:${namespace}:${step}`).digest('hex'));return req;};
 try{return await lock.begin(async tx=>{
  await tx`select set_config('application_name',${`99ribu-curate-${namespace}`},true)`;
  await tx`select pg_advisory_xact_lock(hashtextextended(${`99ribu:storefront-curation:${namespace}`},0))`;signal?.throwIfAborted();await owner();
  const categories:Record<string,string>={};
  for(const [key,name] of [['busana','Busana'],['perawatan','Perawatan'],['paket','Paket']]){
   signal?.throwIfAborted();const slug=`shop-${namespace}-${key}`;let [category]=await identity.sql`select id from app.category where slug=${slug}`;
   if(!category) category=await createCategory(command(`category:${key}`),identity,principal,{name,slug,parent_id:null,attribute_definitions:[]});categories[key]=category.id;
  }
  const warehouse=seeded.positions['fixture-malang:fixture-shirt'];const [position]=await identity.sql`select b.warehouse_id from app.inventory_balance b join app.local_fixture_warehouse f on f.warehouse_id=b.warehouse_id
    where b.id=${warehouse} and f.namespace=${namespace} and f.fixture_id='fixture-malang' and b.stock_item_id=${seeded.stocks['fixture-shirt']}`;
  if(!position) throw invalid();
  const stockNames=new Map<string,string>();for(const stockId of [seeded.stocks['fixture-shirt'],seeded.stocks['fixture-cream']]){
   const [stock]=await identity.sql`select name from app.stock_item where id=${stockId}`;if(!stock) throw invalid();
   stockNames.set(stockId,stock.name);
  }
  const recipes=[
   {key:'shirt',name:'Contoh Kaos',category:'busana',kind:'unit',asset:'shirt',weight:500,height:100,parts:[{id:seeded.stocks['fixture-shirt'],quantity:1}]},
   {key:'cream-pair',name:'Contoh Paket 2 Krim',category:'perawatan',kind:'multipack',asset:'cream',weight:500,height:100,parts:[{id:seeded.stocks['fixture-cream'],quantity:2}]},
   {key:'shirt-pair',name:'Contoh Paket 2 Kaos',category:'busana',kind:'multipack',asset:'shirt',weight:1000,height:200,parts:[{id:seeded.stocks['fixture-shirt'],quantity:2}]},
   {key:'shirt-cream',name:'Contoh Paket Kaos dan Krim',category:'paket',kind:'bundle',asset:'mixed',weight:1000,height:200,parts:[{id:seeded.stocks['fixture-shirt'],quantity:1},{id:seeded.stocks['fixture-cream'],quantity:2}]},
  ];
  const products:Record<string,{id:string;offer_id:string;publication_id:string|null;preserved:boolean;blockers:unknown}>={};
  const {origin}=readLocalConfig(process.env);
  for(const recipe of recipes){
   signal?.throwIfAborted();await owner();const sku=`SF_${namespace}_${recipe.key}`.toUpperCase();
   const contents=recipe.parts.map(p=>({stock_item_id:p.id,name:stockNames.get(p.id) as string,quantity:p.quantity})).sort((a,b)=>a.stock_item_id.localeCompare(b.stock_item_id));
   const description='Data contoh. Harga berlaku untuk satu pilihan lengkap sesuai rincian isi.';
   const images=[{url:`${origin}/fixtures/${recipe.asset}.svg`,alt:'Media contoh; foto produk asli belum disediakan',width:480,height:600}];
   const definition={sku,label:recipe.kind==='unit'?'Satuan':'Paket lengkap',attributes:[],offer_kind:recipe.kind,weight_grams:recipe.weight,length_mm:200,width_mm:150,height_mm:recipe.height,default_warehouse_id:position.warehouse_id,contents};
   let [stored]=await identity.sql`select id,product_id from app.offer where sku=${sku}`;
   if(!stored){const created=await createProduct(command(`product:${recipe.key}`),identity,principal,{name:recipe.name,description,category_id:categories[recipe.category],images,variants:[definition]});stored={id:created.variants[0].id,product_id:created.id};}
   const draft=await readCatalogRevision(identity.sql,stored.product_id);const offer=draft.variants.find(v=>v.id===stored.id);
   const pristine=draft.version===1&&draft.name===recipe.name&&draft.description===description&&draft.category_id===categories[recipe.category]&&isDeepStrictEqual(draft.images,images)&&draft.variants.length===1&&offer!==undefined&&!offer.retired&&
    isDeepStrictEqual({sku:offer.sku,label:offer.label,attributes:offer.attributes,offer_kind:offer.offer_kind,weight_grams:offer.weight_grams,length_mm:offer.length_mm,width_mm:offer.width_mm,height_mm:offer.height_mm,default_warehouse_id:offer.default_warehouse_id,contents:offer.contents},definition);
   if(pristine&&!(await identity.sql`select id from app.offer_cost_assumption_version where offer_id=${stored.id} limit 1`).length)
    await appendCostVersion(command(`assumption:${recipe.key}`),identity,principal,'assumption',stored.id,{expected_version:0,effective_from:null,packaging_idr:1000,provider_fee_idr:1000,subsidy_idr:5000,returns_reserve_idr:1000,source:'TEST-ONLY storefront sample assumptions',reason:'Initialize empty sample assumptions; preserve all later edits'});
   let state=await readPublicationState(identity,principal,stored.product_id);
   if(pristine&&!state.current&&state.blockers.length===0){await publishProduct(command(`publish:${recipe.key}`),identity,principal,stored.product_id,{expected_version:draft.version,expected_publication_version:0,reason:'Guarded TEST-ONLY storefront sample publication'});state=await readPublicationState(identity,principal,stored.product_id);}
   products[recipe.key]={id:stored.product_id,offer_id:stored.id,publication_id:state.current?.id??null,preserved:!pristine,blockers:state.blockers};
  }
  signal?.throwIfAborted();await owner();return {namespace,source:'TEST-ONLY',categories,products};
 });}finally{await lock.end();}
}
