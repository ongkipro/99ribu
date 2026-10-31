import {createHash,randomUUID} from 'node:crypto';
import {closeSync,constants,existsSync,lstatSync,mkdirSync,openSync,readdirSync,readFileSync,realpathSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import type {TransactionSql} from 'postgres';
import {connectDatabase} from '../../db/client.ts';
import {readLocalConfig} from '../../config/local.ts';
import type {LocalAuth} from '../access/auth.ts';
import {assertCurrentOwner} from '../access/grants.ts';
import {assertOrigin} from '../access/http.ts';
import {getPrincipal,type Principal} from '../access/policy.ts';
import {createCategory,createProduct,createStockItem,patchProduct,readCatalogRevision} from '../catalog/catalog.ts';
import {publishProduct,readPublicationState} from '../catalog/publication.ts';
import {array,integer,invalid,text} from '../catalog/validation.ts';
import {appendCostVersion} from '../finance/costs.ts';
import {ensurePosition,postMovement} from '../inventory/state.ts';
import {webpSize} from '../../storage/media-sniff.ts';
import {seedLocal} from './fixtures.ts';
import {variantKey} from './berlapak-identities.ts';
import {SINGLES_FILE,singleRows} from './berlapak-singles.ts';

// Host-only importer for the local Berlapak supplier snapshot. Supplier names, HPP and
// supplier/warehouse IDs stay in private stock/cost/warehouse rows; public names,
// descriptions and image alt text are generated from product facts only.
type Target='local'|'test';
const PRICE=99000,ON_HAND_CAP=500,MAX_PARCEL_GRAMS=20000,FALLBACK_UNIT_GRAMS=250,NAME_LIMIT=70,JSON_LIMIT=32*1024*1024,IMAGE_LIMIT=5_000_000;
export const defaultBerlapakDir='/data/99ribu-berlapak-data';
const ARCHIVE='_archive_old_bundling';
// S69 per-offer variable-cost defaults (IDR); also applied to DEC-005 catalog offers that have none.
export const DEFAULT_OFFER_ASSUMPTIONS={packaging_idr:1000,provider_fee_idr:1000,subsidy_idr:5000,returns_reserve_idr:1000} as const;
export const defaultCatalogPublicDir=fileURLToPath(new URL('../../../public/catalog-local/',import.meta.url));

type Rec=Record<string,unknown>;
const rec=(value:unknown)=>{if(!value||typeof value!=='object'||Array.isArray(value)) throw invalid();return value as Rec;};
const optionalText=(value:unknown,maximum:number)=>value===null||value===undefined||value===''?null:text(value,maximum);
// Input boundary: resolve symlinks first, require the real file inside the real root,
// cap size before reading, and return the bytes read once (callers never re-open by path).
const inside=(root:string,path:string)=>{const real=realpathSync(path);if(!real.startsWith(root+sep)) throw invalid();return real;};
export function readContained(root:string,path:string,limit:number){
  const real=inside(root,path);const stat=statSync(real);if(!stat.isFile()||stat.size>limit) throw invalid();
  const bytes=readFileSync(real);if(bytes.length>limit) throw invalid();return bytes;
}

export {webpSize};

const SPAM=/(?<![\p{L}\p{N}])(?:bisa cod|cod|viral|original|ori|termurah|murah|promo|best[ -]?seller|terlaris|laris|ready stock|ready|grosir|ampuh|hits|kekinian|gratis ongkir|free ongkir|gratis|free|bpom|premium|100%|serba rp ?99[.,]?000)(?![\p{L}\p{N}])/giu;
const CONNECTOR=/^(?:dan|atau|untuk|dengan|plus|&|\+|-|\/|,|\|)$/i;
const escapeRegex=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Supplier names are removed as whole phrases, also without generic trade suffixes/prefixes.
export function supplierPatterns(names:readonly string[]){
  const generic=/^(?:pt\.?|cv\.?|toko|gudang|store|shop|indonesia|official|product|mart|group|skincare)$/i;
  const phrases=new Set<string>();
  for(const name of names){const words=name.trim().split(/\s+/).filter(Boolean);if(!words.length) continue;phrases.add(words.join(' '));
    const core=words.filter((w)=>!generic.test(w));if(core.length&&core.join(' ').length>=3) phrases.add(core.join(' '));}
  return [...phrases].sort((a,b)=>b.length-a.length).map((p)=>new RegExp(`(?<![\\p{L}\\p{N}])${p.split(' ').map(escapeRegex).join('\\s+')}(?![\\p{L}\\p{N}])`,'giu'));
}
const wordCount=(value:string)=>value.replace(SPAM,' ').split(/\s+/).filter((w)=>/[\p{L}\p{N}]/u.test(w)).length;
// Marketplace titles put the product after the first '|' when the first segment is only a
// brand: segments are added until the name has two words. `fallback` (a product fact such as
// the subcategory) is appended only when every segment still leaves a single word.
// `models`: keep repeated model codes and numbers ("KLX 150 / DT 150", "CRF 150 model CRF 250"); used for
// the uncut card-title source only, so stock item names (immutable rows) stay unchanged.
export function publicName(raw:string,suppliers:readonly RegExp[],limit=NAME_LIMIT,fallback?:string,models=false){
  const segments=raw.split('|');let result='';
  for(let i=1;i<=segments.length&&(wordCount(result)<2||result.length<8);i++) result=cleanName(segments.slice(0,i).join(' '),suppliers,limit,models);
  if(fallback&&wordCount(result)===1) result=cleanName(`${result} ${fallback}`,suppliers,limit,models);
  if(!result) throw invalid();return result;
}
// Supplier names are often brand or common words too: strip one only when two words remain.
// A name that is nothing but a supplier name is unusable ('').
function cleanName(raw:string,suppliers:readonly RegExp[],limit:number,models=false){
  let value=raw.replace(/\[[^\]]*\]|【[^】]*】/g,' ');
  for(const pattern of suppliers){const stripped=value.replace(pattern,' ');if(stripped===value) continue;
    const left=wordCount(stripped);if(!left) return '';if(left>=2) value=stripped;}
  value=value.replace(SPAM,' ').replace(/\(\s*\)/g,' ');
  const seen=new Set<string>();const words:string[]=[];
  const tokens=value.split(/\s+/).filter(Boolean);
  for(const [i,word] of tokens.entries()){
    const plain=word.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
    if(!plain&&!/^[&+/-]$/.test(word)) continue;
    const model=models&&(/^\d+$/.test(plain)||/^\p{Lu}{2,5}$/u.test(word)&&/^\d+$/.test(tokens[i+1]??''));
    if(plain.length>=3&&seen.has(plain)&&!model) continue;seen.add(plain);
    const shouting=/^[\p{Lu}]{4,}$/u.test(word.replace(/[^\p{L}]/gu,''))&&!/\d/.test(word);
    words.push(shouting?word.charAt(0)+word.slice(1).toLowerCase():word);
  }
  const cut:string[]=[];for(const word of words){if([...cut,word].join(' ').length>limit) break;cut.push(word);}
  while(cut.length&&CONNECTOR.test(cut[cut.length-1])) cut.pop();
  while(cut.length&&CONNECTOR.test(cut[0])) cut.shift();
  let result=cut.join(' ');if((result.match(/\(/g)?.length??0)!==(result.match(/\)/g)?.length??0)) result=result.replace(/[()]/g,' ');
  return result.replace(/\s+/g,' ').replace(/\s+([,.)])/g,'$1').replace(/[-/,:&+\s]+$/,'').trim();
}
const titleCase=(value:string)=>value.toLowerCase().replace(/(^|[\s-])(\p{L})/gu,(_,a:string,b:string)=>a+b.toUpperCase());
// Kecamatan/city/province as public place names (DEC-006); DKI/DI stay acronyms.
const placeName=(value:unknown)=>titleCase(text(value,100)).replace(/(?<![\p{L}])(Dki|Di)(?![\p{L}])/gu,(m)=>m.toUpperCase());
const slugify=(value:string)=>value.normalize('NFKD').toLowerCase().replace(/&/g,' dan ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
// lazy: no carton dimensions in the snapshot; a cube whose volumetric weight equals actual weight.
// Upgrade path: replace with measured carton dimensions per SKU when the operator records them.
export const cube=(grams:number)=>Math.min(1000,Math.max(50,Math.ceil(Math.cbrt(grams*6000))));

// The buyer-facing variant choice keeps the seller's own words ("Plus 2", "XXXL", "CRF 150 / Paking Head"):
// whitespace is tidied and a shouted word is capitalised; model codes, sizes and words with digits stay.
const variantLabel=(value:string)=>value.normalize('NFC').replace(/\s+/g,' ').trim().split(' ').map((word)=>{
  const letters=word.replace(/[^\p{L}]/gu,'');
  return letters.length>3&&/^\p{Lu}+$/u.test(letters)&&!/\d/.test(word)&&!/^X+L$/.test(letters)?word.charAt(0)+word.slice(1).toLowerCase():word;}).join(' ');
type Image={file:string;source:string;width:number;height:number};
type StockSource={rank:number;key:string;name:string;title:string;variant:string|null;choice:string|null;details:string;hpp:number;stock:number;unitGrams:number;weightDefaulted:boolean;unstocked:boolean;warehouse:{id:string;name:string;province:string;city:string;district:string};category:string;images:Image[];image:Image|null;qty:number};
type OfferSource={key:string;productKey:string;name:string;description:string;category:string;kind:'unit'|'multipack'|'bundle';label:string;choice:string|null;parts:{rank:number;stock:string;quantity:number}[];warehouse:string;grams:number;images:{rank:number;file:string;alt:string}[];image:{rank:number;file:string}|null};

export function readBerlapakSource(directory:string){
  if(!existsSync(join(directory,'data-json'))||!existsSync(join(directory,'images'))) throw new Error(`Berlapak data directory not found or incomplete: ${directory}`);
  const root=realpathSync(directory),jsonRoot=inside(root,join(directory,'data-json')),imagesRoot=inside(root,join(directory,'images'));
  const parse=(base:string,name:string)=>rec(JSON.parse(readContained(base,join(base,name),JSON_LIMIT).toString('utf8')));
  const json=(name:string)=>parse(jsonRoot,name);
  // The legacy lists moved to _archive_old_bundling/ when the single-product list arrived (2026-10-31).
  const legacy=(name:string)=>existsSync(join(jsonRoot,name))?json(name):parse(root,join(ARCHIVE,name));
  const mapping=json('google-catalog-category-mapping.json');const curated=legacy('curated-99ribu-packages.json');const ready=legacy('products-up-to-49k-ready-stock.json');
  const singles=existsSync(join(root,SINGLES_FILE))
    ?singleRows(parse(root,SINGLES_FILE),array(legacy('products-up-to-49k-full.json').products,rec,1,10000),(folder)=>/^[\w-]+$/.test(folder)&&existsSync(join(imagesRoot,folder))):null;
  const categories=array(mapping.storefront_categories,(value)=>{const v=rec(value);const code=text(v.code,20);if(!/^CAT-\d{2}$/.test(code)) throw invalid();
    const name=text(v.name,200);const slug=slugify(text(v.slug,100).replace(/^\d+-/,''));if(!slug||slug.length>60) throw invalid();return {code,name,slug};},1,50);
  if(new Set(categories.map((c)=>c.code)).size!==categories.length||new Set(categories.map((c)=>c.slug)).size!==categories.length) throw invalid();
  // A single-product record replaces the legacy record of the same rank (same Berlapak product).
  // A legacy row the list replaces is kept as a fallback after the singles: it is read only when its single was
  // skipped, so a single that fails validation leaves the live product as it was instead of dropping it.
  const replaced=new Set(singles?.rows.map((r)=>r.rank));
  const snapshot=singles?.snapshot??text(ready.updated_at,40);
  const legacyRows=array(ready.products,rec,1,5000);
  const rows:Rec[]=[...legacyRows.filter((r)=>!replaced.has(r.rank)),...singles?.rows??[],...legacyRows.filter((r)=>replaced.has(r.rank)).map((r)=>({...r,fallback:true}))];
  const skipped:Record<string,number>={};const skip=(reason:string)=>{skipped[reason]=(skipped[reason]??0)+1;};
  const supplierNames=new Set<string>();for(const row of rows){try{const name=optionalText(rec(row.supplier).name,200);if(name) supplierNames.add(name);}catch{/* validated per row below */}}
  const suppliers=supplierPatterns([...supplierNames]);
  const stocks=new Map<string,StockSource>(),ranks=new Set<number>();
  for(const row of rows){
    let rank:number;
    try{rank=integer(row.rank,1,99999);}catch{skip('invalid-record');continue;}
    if(row.fallback===true){if([...stocks.values()].some((s)=>s.rank===rank)) continue;}
    else if(ranks.has(rank)){skip('invalid-record');continue;}
    ranks.add(rank);
    try{
      const unstocked=row.allow_unstocked===true;
      const inventory=rec(row.inventory);if(inventory.is_ready_stock!==true&&!unstocked){skip('not-ready-stock');continue;}
      const pricing=rec(row.pricing),strategy=rec(row.strategy_99ribu),variants=rec(row.variants_summary),assets=rec(row.assets),place=rec(row.warehouse_and_shipping),category=rec(row.category_mapping);
      const options=array(variants.variants,rec,0,200).flatMap((v)=>{try{return [{name:text(v.name,100),hpp:integer(v.hpp_price,1,PRICE*10),stock:integer(v.stock,0),id:text(v._id,40),image:optionalText(v.image_local_path,600)}];}catch{skip('variant-invalid');return [];}});
      if(new Set(options.map((v)=>v.id)).size!==options.length) throw invalid();
      const stocked=options.filter((v)=>v.stock>0);
      const candidates=variants.has_variants===true?(stocked.length||!unstocked?stocked:options):[{
        name:null,hpp:integer(pricing.hpp_price,1,PRICE*10),stock:integer(inventory.total_stock,0),id:null,image:null}];
      if(!candidates.length){skip('hpp-unusable');continue;}
      const qty=integer(strategy.recommended_bundle_qty,1,50);
      const warehouseId=text(place.warehouse_id,40);if(!/^[0-9a-f]{24}$/.test(warehouseId)) throw invalid();
      const folder=text(assets.folder_slug,300);if(!/^\d{3}-[A-Za-z0-9-]+$/.test(folder)||Number(folder.slice(0,3))!==rank%1000) throw invalid();
      const images:Image[]=[];const imageFile=/^(img|var)-(\d+)\.webp$/;let folderFiles:string[]=[];
      try{
        const folderPath=inside(imagesRoot,join(directory,'images',folder));
        folderFiles=readdirSync(folderPath).filter((f)=>imageFile.test(f)).sort((a,b)=>{
          const ma=imageFile.exec(a) as RegExpExecArray,mb=imageFile.exec(b) as RegExpExecArray;
          return (ma[1]===mb[1]?0:ma[1]==='img'?-1:1)||Number(ma[2])-Number(mb[2]);
        });
      }catch{/* outside images/ or unreadable folder: image omitted */}
      const seenHashes=new Map<string,Image>(),aliases=new Map<string,Image>();
      for(const file of folderFiles){
        const source=join(directory,'images',folder,file);if(!existsSync(source)) continue;
        try{
          const bytes=readContained(imagesRoot,source,IMAGE_LIMIT);const size=webpSize(bytes);
          const hash=createHash('sha256').update(bytes).digest('hex');let image=seenHashes.get(hash);
          if(!image){image={file,source,...size};seenHashes.set(hash,image);images.push(image);}aliases.set(file,image);
        }catch{/* outside images/, oversized or unreadable header: image omitted */}
      }
      if(!images.length){skip('image-missing');continue;}
      const grams=Number.isSafeInteger(inventory.weight_gram)&&Number(inventory.weight_gram)>0?Number(inventory.weight_gram)
        :typeof inventory.weight_kg==='number'&&inventory.weight_kg>0?Math.ceil(inventory.weight_kg*1000):null;
      const code=text(category.storefront_category_code,20);if(!categories.some((c)=>c.code===code)){skip('category-unmapped');continue;}
      const fallback=optionalText(category.storefront_subcategory,100)??undefined;
      const base=publicName(text(row.name,500),suppliers,NAME_LIMIT,fallback);
      // A product named only by its supplier (brand = seller) cannot be published without that name.
      if(suppliers.some((p)=>{p.lastIndex=0;return p.test(base);})){skip('supplier-named');continue;}
      // Raw marketplace description: cleaned by the DEC-005 generator before anything is published.
      let details='';try{details=optionalText(row.description,20000)??'';}catch{/* unusable text: no details */}
      for(const candidate of candidates){
        const variant=candidate.name?publicName(candidate.name,suppliers,100):null,key=candidate.id?variantKey(rank,candidate.id):String(rank);
        const choice=candidate.name?variantLabel(candidate.name):null;
        const name=variant?`${base} - ${variant}`:base;
        const prefix=`images/${folder}/`,file=candidate.image?.startsWith(prefix)?candidate.image.slice(prefix.length):null;
        // An explicitly absent variant photo uses the real shared cover; never fabricate
        // variant-specific imagery or omit an otherwise sellable physical variant.
        const image=candidate.id?(file&&/^var-\d+\.webp$/.test(file)?aliases.get(file)??null:candidate.image===null?images[0]:null):null;
        if(candidate.id&&!image){skip('variant-image-missing');continue;}
        stocks.set(key,{rank,key,name:text(name,200),title:publicName(text(row.name,500),suppliers,500,fallback,true),variant,choice,hpp:candidate.hpp,stock:candidate.stock,
          unitGrams:grams??FALLBACK_UNIT_GRAMS,weightDefaulted:grams===null,
          warehouse:{id:warehouseId,name:text(place.warehouse_name,150),province:placeName(place.province),city:placeName(place.city),district:placeName(place.district)},
          category:code,details,images, image,qty,unstocked});
      }
    }catch{skip('invalid-record');}
  }
  const offers:OfferSource[]=[];
  const imageAlt=(name:string,index:number)=>index?`${name}, foto ${index+1}`:name;
  for(const item of [...stocks.values()].sort((a,b)=>a.rank-b.rank||a.key.localeCompare(b.key))){
    if(item.qty*item.hpp>=PRICE){skip('hpp-at-or-above-price');continue;}
    if(item.stock<item.qty&&!item.unstocked){skip('insufficient-stock');continue;}
    const grams=item.qty*item.unitGrams;if(grams>MAX_PARCEL_GRAMS){skip('parcel-too-heavy');continue;}
    const kind=item.qty===1?'unit':'multipack';
    const name=publicName(kind==='unit'?item.name:`Paket ${item.qty} pcs ${item.name}`,[],NAME_LIMIT);
    const gallery=(item.image?[item.image,...item.images.filter((i)=>i!==item.image)]:item.images).slice(0,20);
    offers.push({key:item.key,productKey:String(item.rank),name,kind,choice:item.choice,label:item.choice?kind==='unit'?item.choice:`${item.choice} · Paket ${item.qty} pcs`:kind==='unit'?'Satuan':`Paket ${item.qty} pcs`,
      category:item.category,warehouse:item.warehouse.id,grams,
      description:`Isi paket: ${item.qty} pcs ${item.name}.\nHarga Rp99.000 untuk satu paket lengkap.`,parts:[{rank:item.rank,stock:item.key,quantity:item.qty}],
      images:gallery.map((image,index)=>({rank:item.rank,file:image.file,alt:imageAlt(name,index)})),image:item.image?{rank:item.rank,file:item.image.file}:null});
  }
  const occurrences=new Map<string,number>();
  for(const value of array(curated.curated_cross_sku_bundles,(v)=>v,0,500)){
    try{
      const bundle=rec(value);const code=text(bundle.code,20);if(!/^BND-\d{2,3}$/.test(code)) throw invalid();
      const seen=(occurrences.get(code)??0)+1;occurrences.set(code,seen);const key=seen>1?`${code}-${seen}`:code;
      if(bundle.selling_price!==PRICE) throw invalid();
      const parts=array(bundle.items,(v)=>{const i=rec(v);const rank=integer(i.rank,1,99999);return {rank,stock:String(rank),quantity:integer(i.qty,1,50)};},2,20);
      if(new Set(parts.map((p)=>p.rank)).size!==parts.length) throw invalid();
      // Bundles retain the historically selected physical variant, never whichever has most stock now.
      const components=parts.map((p)=>stocks.get(p.stock));
      if(components.some((c)=>!c)){skip('bundle-rank-unresolved');continue;}
      const resolved=components as StockSource[];
      if(new Set(resolved.map((c)=>c.warehouse.id)).size!==1){skip('bundle-mixed-warehouse');continue;}
      if(parts.reduce((n,p,i)=>n+p.quantity*resolved[i].hpp,0)>=PRICE){skip('bundle-hpp-at-or-above-price');continue;}
      if(parts.some((p,i)=>resolved[i].stock<p.quantity)){skip('bundle-insufficient-stock');continue;}
      const grams=parts.reduce((n,p,i)=>n+p.quantity*resolved[i].unitGrams,0);if(grams>MAX_PARCEL_GRAMS){skip('parcel-too-heavy');continue;}
      const storefront=text(rec(bundle.google_catalog).storefront_category,200);const category=categories.find((c)=>c.name===storefront);
      if(!category){skip('bundle-category-unmapped');continue;}
      const name=publicName(text(bundle.title,300).replace(/\s*\([^)]*\)\s*$/,''),suppliers,NAME_LIMIT);
      offers.push({key,productKey:key,name,kind:'bundle',choice:null,label:`Paket ${parts.reduce((n,p)=>n+p.quantity,0)} barang`,category:category.code,warehouse:resolved[0].warehouse.id,grams,
        description:`Isi paket:\n${parts.map((p,i)=>`- ${p.quantity} pcs ${resolved[i].name}`).join('\n')}\nHarga Rp99.000 untuk satu paket lengkap.`,parts,
        images:resolved.slice(0,4).map((c)=>({rank:c.rank,file:c.images[0].file,alt:c.name.slice(0,500)})),image:null});
    }catch{skip('bundle-invalid');}
  }
  const used=new Set(offers.flatMap((o)=>o.parts.map((p)=>p.stock)));
  const selected=[...stocks.values()].filter((s)=>used.has(s.key));
  return {snapshot,imagesRoot,categories,stocks:selected,offers,skipped,weightDefaulted:selected.filter((s)=>s.weightDefaulted).length,supplierNames:[...supplierNames],singlePhotos:singles?.photos??[]};
}

async function owner(tx:TransactionSql,principal:Principal){await tx`select id from app.auth_user where id=${principal.id} for update`;await assertCurrentOwner(tx,principal);}

export async function importBerlapak(request:Request,identity:LocalAuth,target:Target,namespace:string,options:{sourceDir?:string;publicDir?:string}={},signal?:AbortSignal){
  signal?.throwIfAborted();const config=readLocalConfig(process.env);assertOrigin(request);
  if(!['local','test'].includes(target)||!/^[a-z][a-z0-9-]{0,23}$/.test(namespace)||['authorization','x-cart-token','x-order-token'].some((h)=>request.headers.has(h))) throw invalid();
  const [database]=await identity.sql`select current_database() as name`;if(database.name!==`99ribu_${target}`) throw invalid();
  const principal=await getPrincipal(request,identity);await identity.sql.begin((tx)=>owner(tx,principal));
  const source=readBerlapakSource(options.sourceDir??defaultBerlapakDir);const publicDir=options.publicDir??defaultCatalogPublicDir;
  // seedLocal creates the namespace clock once; its own rerun check rejects the extra
  // snapshot warehouse mappings, so an existing namespace is reused as-is.
  if(!(await identity.sql`select name from app.local_fixture_namespace where name=${namespace}`).length)
    await identity.sql.begin(async(tx)=>{await owner(tx,principal);return seedLocal(target,namespace);});
  const lockDatabase=connectDatabase(target).sql;
  try{return await lockDatabase.begin(async(connection)=>{
    await connection`select set_config('application_name',${`99ribu-berlapak-${namespace}`},true)`;
    await connection`select pg_advisory_xact_lock(hashtextextended(${`99ribu:berlapak-import:${namespace}`},0))`;signal?.throwIfAborted();
    await identity.sql.begin((tx)=>owner(tx,principal));
    const command=(step:string)=>{const req=new Request(`${config.origin}/api/v1/admin/local-fixture-command`,{method:'POST',headers:request.headers});
      req.headers.set('idempotency-key',createHash('sha256').update(`berlapak:${namespace}:${step}`).digest('hex'));return req;};
    const NS=namespace.toUpperCase();
    const categories:Record<string,string>={};
    for(const category of source.categories){
      // Hyphens are legal inside namespaces, so `${namespace}-${slug}` could collide across
      // namespaces; a namespace hash prefix cannot. 'berlapak' keeps its existing `berlapak-<slug>` rows.
      signal?.throwIfAborted();const legacy=`berlapak-${category.slug}`;
      let [row]=namespace==='berlapak'?await identity.sql`select id from app.category where slug=${legacy}`:[];
      const slug=row?legacy:`bl-${createHash('sha256').update(namespace).digest('hex').slice(0,8)}-${category.slug}`;
      if(!row) [row]=await identity.sql`select id from app.category where slug=${slug}`;
      if(!row) row=await createCategory(command(`category:${category.code}`),identity,principal,{name:category.name,slug,parent_id:null,attribute_definitions:[]});
      categories[category.code]=row.id;
    }
    // Same mechanism as seedLocal: one namespaced warehouse mapping per Berlapak warehouse.
    const warehouses:Record<string,string>={};
    for(const place of new Map(source.stocks.map((s)=>[s.warehouse.id,s.warehouse])).values()){
      signal?.throwIfAborted();const fixtureId=`berlapak-${place.id}`;
      warehouses[place.id]=await identity.sql.begin(async(tx)=>{
        await owner(tx,principal);const [prior]=await tx`select warehouse_id from app.local_fixture_warehouse where namespace=${namespace} and fixture_id=${fixtureId}`;
        if(prior) return prior.warehouse_id as string;const warehouseId=randomUUID();
        await tx`insert into app.warehouse (id,name,province,city,district,timezone) values (${warehouseId},${`${place.name} [${namespace}]`},${place.province},${place.city},${place.district},'Asia/Jakarta')`;
        await tx`insert into app.local_fixture_warehouse (namespace,fixture_id,warehouse_id) values (${namespace},${fixtureId},${warehouseId})`;
        await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason) values (${principal.id},'local_fixture.warehouse',${warehouseId},'allowed','Map local supplier-snapshot warehouse into fixture namespace')`;
        return warehouseId;
      });
    }
    const stocks:Record<string,string>={};let received=0;let imagesCopied=0;
    for(const item of source.stocks){
      signal?.throwIfAborted();const sku=`BL_${NS}_${item.key.replaceAll('-','_')}`;let [stored]=await identity.sql`select id,name from app.stock_item where sku=${sku}`;
      if(!stored) stored=await createStockItem(command(`stock:${item.key}`),identity,principal,{sku,name:item.name});
      stocks[item.key]=stored.id;
      if(!(await identity.sql`select id from app.component_cost_version where stock_item_id=${stored.id} limit 1`).length)
        await appendCostVersion(command(`cost:${item.key}`),identity,principal,'component',stored.id,{expected_version:0,unit_cost:item.hpp,effective_from:null,source:`Local supplier snapshot ${source.snapshot}`,reason:'Initialize private component HPP from local snapshot'});
      const warehouseId=warehouses[item.warehouse.id];
      received+=await identity.sql.begin(async(tx)=>{
        await owner(tx,principal);const balanceId=await ensurePosition(tx,warehouseId,stored.id,null);
        const [balance]=await tx`select revision from app.inventory_balance where id=${balanceId} for update`;if(balance.revision!==0) return 0;
        const quantity=Math.min(item.stock,ON_HAND_CAP);if(!quantity) return 0;
        await postMovement(tx,{balanceId,kind:'receive',quantity,onHand:quantity,reserved:0,quarantined:0,sourceRef:`berlapak:${namespace}:${item.key}`,actorId:principal.id,reason:'Initialize local physical supply from snapshot (capped)'});
        await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason) values (${principal.id},'local_fixture.inventory',${balanceId},'allowed','Initialize local snapshot position through actual movement')`;
        return 1;
      });
      const folder=join(publicDir,String(item.rank));mkdirSync(folder,{recursive:true});if(!lstatSync(folder).isDirectory()) throw new Error(`Refusing non-directory image destination: ${folder}`);
      const wantedFiles=new Set(item.images.map((i)=>i.file));
      // Stale copies (earlier selections, the removed AI studio thumbnails) go; only plain files this importer could have written.
      for(const existing of readdirSync(folder,{withFileTypes:true})) if(existing.isFile()&&!wantedFiles.has(existing.name)) unlinkSync(join(folder,existing.name));
      for(const image of item.images){
        // Read once through the same boundary; published dimensions must match the bytes written.
        const bytes=readContained(source.imagesRoot,image.source,IMAGE_LIMIT);const size=webpSize(bytes);
        if(size.width!==image.width||size.height!==image.height) throw new Error(`Berlapak image changed during import: ${item.rank}/${image.file}`);
        const fd=openSync(join(folder,image.file),constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW);try{writeFileSync(fd,bytes);}finally{closeSync(fd);}imagesCopied++;
      }
    }
    const products:Record<string,{product_id:string;offer_id:string;warehouse_id:string;publication_id:string|null;preserved:boolean}>={};const blocked:Record<string,number>={};let published=0;
    const names=new Map(source.stocks.map((s)=>[s.key,s.name]));
    for(const [productKey,offers] of Map.groupBy(source.offers,(o)=>o.productKey)){
      signal?.throwIfAborted();await identity.sql.begin((tx)=>owner(tx,principal));
      const offer=offers[0],stock=source.stocks.find((s)=>s.key===offer.parts[0].stock) as StockSource;
      const name=offer.kind==='bundle'||!stock.variant?offer.name:publicName(offer.kind==='unit'?stock.title:`Paket ${stock.qty} pcs ${stock.title}`,[],NAME_LIMIT);
      const description=offer.kind==='bundle'||!stock.variant?offer.description:
        `Pilihan paket:\n${offers.map((o)=>`- ${o.label}`).join('\n')}\nHarga Rp99.000 untuk satu paket lengkap sesuai pilihan varian.`;
      const refs=[...offers.flatMap((o)=>o.image?[{...o.image,alt:o.label}]:[]),...offers.flatMap((o)=>o.images.filter((i)=>!o.image||i.file.startsWith('img-')))];
      const seen=new Set<string>();
      const images=refs.flatMap((image)=>{
        const key=`${image.rank}/${image.file}`;if(seen.has(key)) return [];seen.add(key);
        const size=source.stocks.filter((s)=>s.rank===image.rank).flatMap((s)=>s.images).find((i)=>i.file===image.file) as Image;
        return [{url:`${config.origin}/catalog-local/${key}`,alt:image.alt,width:size.width,height:size.height}];
      }).slice(0,20);
      const definitions=offers.map((o)=>{const side=cube(o.grams);
        const contents=o.parts.map((p)=>({stock_item_id:stocks[p.stock],name:names.get(p.stock) as string,quantity:p.quantity})).sort((a,b)=>a.stock_item_id.localeCompare(b.stock_item_id));
        return {sku:`BL_${NS}_${o.key}_OFFER`,label:o.label,attributes:[],offer_kind:o.kind,weight_grams:o.grams,length_mm:side,width_mm:side,height_mm:side,
          default_warehouse_id:warehouses[o.warehouse],contents,...(o.image?{image:images.find((i)=>i.url.endsWith(`/${o.image?.rank}/${o.image?.file}`))}:{})};});
      const fields={name,description,category_id:categories[offer.category],images};
      const existing=await identity.sql`select id,product_id from app.offer where sku in ${identity.sql(definitions.map((d)=>d.sku))}`;
      if(new Set(existing.map((o)=>o.product_id)).size>1) throw new Error(`Local snapshot offers for ${productKey} belong to different products.`);
      let productId=existing[0]?.product_id as string|undefined;
      if(!productId){const created=await createProduct(command(`product:${productKey}`),identity,principal,{...fields,variants:definitions});productId=created.id as string;}
      let draft=await readCatalogRevision(identity.sql,productId);
      const owned=(await identity.sql`select 1 from app.product_revision where product_id=${productId} and revision=${draft.version}
        and reason in ('Create inactive product draft','Refresh local snapshot product images','Refresh local snapshot variant offers')`).length>0;
      const current=new Map(draft.variants.filter((v)=>!v.retired).map((v)=>[v.sku,v]));
      const values=(v:typeof draft.variants[number])=>({sku:v.sku,label:v.label,attributes:v.attributes,offer_kind:v.offer_kind,weight_grams:v.weight_grams,length_mm:v.length_mm,
        width_mm:v.width_mm,height_mm:v.height_mm,default_warehouse_id:v.default_warehouse_id,contents:v.contents,image:v.image});
      const changes=definitions.map(({sku,...definition})=>{
        const v=current.get(sku);if(!v) return {operation:'create' as const,create:{sku,...definition}};
        return isDeepStrictEqual(values(v),{sku,...definition,image:definition.image??null})?null:{operation:'update' as const,variant_id:v.id,update:definition};
      }).filter((c)=>c!==null);
      const matches=!changes.length&&draft.name===name&&draft.description===description&&draft.category_id===fields.category_id&&isDeepStrictEqual(draft.images,images);
      const pristine=owned&&!draft.variants.some((v)=>v.retired&&definitions.some((d)=>d.sku===v.sku));
      if(pristine&&!matches){
        await patchProduct(command(`product-variants:${productKey}:${draft.version}`),identity,principal,productId,{...fields,expected_version:draft.version,
          ...(changes.length?{variant_changes:changes}:{}),reason:'Refresh local snapshot variant offers'});
        draft=await readCatalogRevision(identity.sql,productId);
      }
      for(const definition of definitions){
        const v=draft.variants.find((v)=>v.sku===definition.sku);
        if(pristine&&v&&!(await identity.sql`select id from app.offer_cost_assumption_version where offer_id=${v.id} limit 1`).length)
          await appendCostVersion(command(`assumption:${definition.sku}`),identity,principal,'assumption',v.id,{expected_version:0,effective_from:null,...DEFAULT_OFFER_ASSUMPTIONS,source:'TEST-ONLY local import assumptions',reason:'Initialize per-offer variable cost estimates; preserve later edits'});
      }
      let state=await readPublicationState(identity,principal,productId);
      // A withdrawn product (no current publication after an earlier one) stays withdrawn.
      if(pristine&&state.ready&&(state.current||state.latest_version===0)&&state.current?.product_revision!==draft.version){
        await publishProduct(command(`publish:${productKey}:${draft.version}:${state.latest_version}`),identity,principal,productId,{expected_version:draft.version,expected_publication_version:state.latest_version,reason:'Guarded local snapshot publication; no exception'});
        state=await readPublicationState(identity,principal,productId);
      }
      if(state.current) published++;else for(const code of new Set(state.blockers.map((b)=>b.code))) blocked[code]=(blocked[code]??0)+1;
      for(const o of offers){
        const v=draft.variants.find((v)=>v.sku===`BL_${NS}_${o.key}_OFFER`);if(!v) continue;
        products[o.key]={product_id:productId,offer_id:v.id,warehouse_id:warehouses[o.warehouse],publication_id:state.current?.id??null,preserved:!pristine};
      }
    }
    signal?.throwIfAborted();await identity.sql.begin(async(tx)=>{await owner(tx,principal);await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},'local_fixture.berlapak',${namespace},'allowed','Non-destructive local snapshot import through real domain guards',${JSON.stringify({stocks:source.stocks.length,offers:source.offers.length,published})}::jsonb)`;});
    return {namespace,scope:'catalog-stock-cost',summary:{categories:Object.keys(categories).length,warehouses:Object.keys(warehouses).length,stock_items:source.stocks.length,positions_received_now:received,
      offers:source.offers.length,bundles:source.offers.filter((o)=>o.kind==='bundle').length,published,preserved:Object.values(products).filter((p)=>p.preserved).length,blocked,skipped:source.skipped,
      weight_defaulted:source.weightDefaulted,images_copied:imagesCopied},products};
  });}finally{await lockDatabase.end();}
}
