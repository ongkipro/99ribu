import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {catalogMediaName} from '../../storage/catalog-media.ts';
import {readLocalConfig} from '../../config/local.ts';
import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin} from '../access/http.ts';
import {AccessError,getPrincipal} from '../access/policy.ts';
import {CATALOG_FORMAT,type CatalogDocument,CatalogDatasetError,lockOwner,MANIFEST_FORMAT,type ManifestDocument,parseCatalog,readCatalogDocument} from '../catalog/dataset.ts';
import {id} from '../catalog/validation.ts';
import {appendCostVersion} from '../finance/costs.ts';
import {createMovement} from '../inventory/positions.ts';
import {cube,DEFAULT_OFFER_ASSUMPTIONS,readBerlapakSource,readContained,supplierPatterns} from './berlapak.ts';

// DEC-005 generator (host-only): raw Berlapak snapshot -> committed, sanitized catalog dataset.
// Selection and public naming reuse the S69 reader; only public catalog facts are written (no
// HPP, stock, supplier or warehouse fields). Output is deterministic: stable ordering, no run
// timestamps, photos named by content hash, unchanged files are not rewritten.
export const defaultDatasetDir=new URL('../../../data/catalog/berlapak/',import.meta.url).pathname;
const IMAGE_LIMIT=5_000_000,PHOTO=/^[0-9a-f]{64}\.webp$/;
const byKey=(a:string,b:string)=>{const x=/^\d+$/.test(a),y=/^\d+$/.test(b);return x&&y?Number(a)-Number(b):x!==y?(x?-1:1):a<b?-1:a>b?1:0;};

export function buildBerlapakDataset(sourceDir:string){
  const source=readBerlapakSource(sourceDir);
  const slug=new Map(source.categories.map((c)=>[c.code,c.slug]));
  const sku=(rank:number)=>`B99_${rank}`;
  const photos=new Map<string,{bytes:Buffer;width:number;height:number}>();const byFile=new Map<string,string>();
  const photo=(rank:number,file:string)=>{
    const stock=source.stocks.find((s)=>s.rank===rank);const image=stock?.images.find((i)=>i.file===file);
    if(!image) throw new Error(`Berlapak photo reference missing: ${rank}/${file}`);
    const known=byFile.get(image.source);if(known) return known;
    const bytes=readContained(source.imagesRoot,image.source,IMAGE_LIMIT);let checked:ReturnType<typeof catalogMediaName>;
    try{checked=catalogMediaName(bytes);}catch{throw new Error(`Berlapak photo ${rank}/${file} is not a clean WebP within the catalog size limit.`);}
    if(checked.width!==image.width||checked.height!==image.height) throw new Error(`Berlapak photo changed during generation: ${rank}/${file}`);
    const hash=checked.name.slice(0,64);photos.set(hash,{bytes,width:checked.width,height:checked.height});byFile.set(image.source,hash);return hash;
  };
  const catalog:CatalogDocument={format:CATALOG_FORMAT,source:'berlapak',source_snapshot:source.snapshot,price_idr:99000,
    categories:source.categories.map((c)=>({slug:c.slug,name:c.name})).sort((a,b)=>byKey(a.slug,b.slug)),
    stock_items:[...source.stocks].sort((a,b)=>a.rank-b.rank).map((s)=>({sku:sku(s.rank),name:s.name})),
    products:[...source.offers].sort((a,b)=>byKey(a.key,b.key)).map((o)=>{const side=cube(o.grams);return {key:o.key,name:o.name,description:o.description,
      category:slug.get(o.category) as string,photos:o.images.map((i)=>({sha256:photo(i.rank,i.file),alt:i.alt})),
      offer:{sku:`B99_${o.key}_OFFER`,label:o.label,kind:o.kind,weight_grams:o.grams,length_mm:side,width_mm:side,height_mm:side,
        contents:o.parts.map((p)=>({stock_item:sku(p.rank),quantity:p.quantity})).sort((a,b)=>byKey(a.stock_item,b.stock_item))}};})};
  parseCatalog(catalog);
  const text=`${JSON.stringify(catalog,null,2)}\n`;
  // Sanitization gate: refuse output that names a supplier or a supplier warehouse anywhere.
  const lower=text.toLowerCase();
  if(supplierPatterns(source.supplierNames).some((p)=>p.test(text))||source.stocks.some((s)=>lower.includes(s.warehouse.name.toLowerCase())))
    throw new Error('Refusing dataset: a supplier or supplier-warehouse name would be published.');
  const catalogSha256=createHash('sha256').update(text).digest('hex');
  const manifest:ManifestDocument={format:MANIFEST_FORMAT,catalog_sha256:catalogSha256,
    photos:[...photos].sort(([a],[b])=>a<b?-1:1).map(([sha256,p])=>({sha256,bytes:p.bytes.length,width:p.width,height:p.height}))};
  return {catalog,text,manifest,photos,skipped:source.skipped};
}

export function writeBerlapakDataset(sourceDir:string,outDir=defaultDatasetDir){
  const built=buildBerlapakDataset(sourceDir);const photoDir=join(outDir,'photos');mkdirSync(photoDir,{recursive:true});
  const write=(path:string,bytes:Buffer|string)=>{const next=Buffer.from(bytes);if(existsSync(path)&&readFileSync(path).equals(next)) return false;writeFileSync(path,next);return true;};
  let written=0,removed=0;
  for(const [hash,p] of built.photos) if(write(join(photoDir,`${hash}.webp`),p.bytes)) written++;
  // Only generator-owned hash-named photos that the new manifest no longer references.
  for(const name of readdirSync(photoDir)) if(PHOTO.test(name)&&!built.photos.has(name.slice(0,64))){unlinkSync(join(photoDir,name));removed++;}
  write(join(outDir,'catalog.json'),built.text);write(join(outDir,'manifest.json'),`${JSON.stringify(built.manifest,null,2)}\n`);
  return {dir:outDir,catalog_sha256:built.manifest.catalog_sha256,categories:built.catalog.categories.length,stock_items:built.catalog.stock_items.length,
    products:built.catalog.products.length,bundles:built.catalog.products.filter((p)=>p.offer.kind==='bundle').length,photos:built.photos.size,
    photo_bytes:[...built.photos.values()].reduce((n,p)=>n+p.bytes.length,0),photos_written:written,photos_removed:removed,skipped:built.skipped};
}

// DEC-005 operator step: initial physical stock and component HPP for the imported catalog,
// read from the raw snapshot at run time (never committed). Writes only through the real
// inventory (createMovement receive, expected_version 0) and finance (appendCostVersion,
// expected_version 0) services, so a position or cost that already has history is never
// touched again: a rerun or a later snapshot cannot double-receive or overwrite HPP; changed
// snapshot values are only reported as drift for normal admin receiving/adjustment/cost flows.
// Every supplier warehouse's quantity is received into the one import warehouse the S80 offers
// bind to. Offers without assumptions get the S69 defaults. Refuses before any write when the
// raw snapshot is not the one the committed dataset was generated from.
const RECEIVE_LIMIT=1000000;
export async function loadInitialStock(request:Request,identity:LocalAuth,options:{warehouseId:string;sourceDir:string;datasetDir?:string;signal?:AbortSignal}){
  const {signal}=options;signal?.throwIfAborted();const config=readLocalConfig(process.env);assertOrigin(request);
  let warehouseId:string;try{warehouseId=id(options.warehouseId);}catch{throw new CatalogDatasetError('Invalid catalog dataset: warehouse id');}
  const catalog=readCatalogDocument(options.datasetDir??defaultDatasetDir),source=readBerlapakSource(options.sourceDir);
  if(source.snapshot!==catalog.source_snapshot) throw new CatalogDatasetError(`Raw snapshot ${source.snapshot} is not the committed dataset snapshot ${catalog.source_snapshot}; run catalog:dataset and catalog:import first.`);
  const principal=await getPrincipal(request,identity);await identity.sql.begin((tx)=>lockOwner(tx,principal));
  const reserved=await identity.sql.reserve();
  try{
    const lockKey='99ribu:catalog-initial-stock';
    const [lock]=await reserved`select pg_try_advisory_lock(hashtextextended(${lockKey},0)) as ok`;
    if(!lock.ok) throw new CatalogDatasetError('Another initial stock load is running; retry after it finishes.');
    try{
      const [warehouse]=await identity.sql`select active from app.warehouse where id=${warehouseId}`;
      if(!warehouse?.active) throw new CatalogDatasetError('Target warehouse does not exist or is inactive.');
      // Generator contract: a dataset stock item SKU ends in `_<snapshot rank>`.
      const byRank=new Map(catalog.stock_items.map((s)=>[Number(s.sku.slice(s.sku.lastIndexOf('_')+1)),s.sku]));
      const items=source.stocks.filter((s)=>byRank.has(s.rank)).map((s)=>({...s,sku:byRank.get(s.rank) as string}));
      if(items.length!==catalog.stock_items.length) throw new CatalogDatasetError(`Raw snapshot resolves ${items.length} of ${catalog.stock_items.length} catalog stock items; regenerate the dataset first.`);
      const offerSkus=catalog.products.map((p)=>p.offer.sku);
      const stocks=new Map((await identity.sql`select id,sku from app.stock_item where sku in ${identity.sql(items.map((s)=>s.sku))}`).map((r)=>[r.sku as string,r.id as string]));
      const offers=await identity.sql`select id,sku from app.offer where sku in ${identity.sql(offerSkus)}`;
      if(stocks.size!==items.length||offers.length!==offerSkus.length) throw new CatalogDatasetError(`Catalog not imported yet (${stocks.size}/${items.length} stock items, ${offers.length}/${offerSkus.length} offers); run catalog:import first.`);
      const command=(step:string)=>{const next=new Request(`${config.origin}/api/v1/admin/catalog-initial-stock`,{method:'POST',headers:request.headers});
        next.headers.set('idempotency-key',createHash('sha256').update(`catalog-initial-stock:${source.snapshot}:${warehouseId}:${step}`).digest('hex'));return next;};
      const summary={snapshot:source.snapshot,warehouse_id:warehouseId,stock_items:items.length,
        receive:{received:0,units:0,existing:0,capped:0,differs_from_snapshot:0},hpp:{appended:0,existing:0,differs_from_snapshot:0},assumptions:{appended:0,existing:0}};
      for(const item of items){
        signal?.throwIfAborted();const stockId=stocks.get(item.sku) as string;
        const [position]=await identity.sql`select revision,on_hand from app.inventory_balance where warehouse_id=${warehouseId} and stock_item_id=${stockId} and lot_id is null`;
        const quantity=Math.min(item.stock,RECEIVE_LIMIT);
        let received=false;
        if(!position||position.revision===0){
          try{await createMovement(command(`receive:${item.sku}`),identity,principal,{warehouse_id:warehouseId,stock_item_id:stockId,lot_id:null,kind:'receive',quantity,
            expected_version:0,reason:`Initial stock from supplier snapshot ${source.snapshot}`});received=true;}
          catch(error){if(!(error instanceof AccessError)||error.code!=='VERSION_CONFLICT') throw error;}
        }
        if(received){summary.receive.received++;summary.receive.units+=quantity;if(quantity<item.stock) summary.receive.capped++;}
        else{summary.receive.existing++;if(position&&position.on_hand!==item.stock) summary.receive.differs_from_snapshot++;}
        const [cost]=await identity.sql`select revision,unit_cost from app.component_cost_version where stock_item_id=${stockId} order by revision desc limit 1`;
        if(!cost){
          try{await appendCostVersion(command(`hpp:${item.sku}`),identity,principal,'component',stockId,{expected_version:0,unit_cost:item.hpp,effective_from:null,
            source:`Supplier snapshot ${source.snapshot}`,reason:'Initial component HPP from supplier snapshot'});summary.hpp.appended++;continue;}
          catch(error){if(!(error instanceof AccessError)||error.code!=='VERSION_CONFLICT') throw error;}
        }
        summary.hpp.existing++;if(cost&&cost.unit_cost!==item.hpp) summary.hpp.differs_from_snapshot++;
      }
      for(const offer of offers){
        signal?.throwIfAborted();
        if((await identity.sql`select 1 from app.offer_cost_assumption_version where offer_id=${offer.id} limit 1`).length){summary.assumptions.existing++;continue;}
        try{await appendCostVersion(command(`assumption:${offer.sku}`),identity,principal,'assumption',offer.id,{expected_version:0,effective_from:null,...DEFAULT_OFFER_ASSUMPTIONS,
          source:'S69 default per-offer variable-cost assumptions',reason:'Initialize catalog offer assumptions; later edits are preserved'});summary.assumptions.appended++;}
        catch(error){if(!(error instanceof AccessError)||error.code!=='VERSION_CONFLICT') throw error;summary.assumptions.existing++;}
      }
      return summary;
    }finally{await reserved`select pg_advisory_unlock(hashtextextended(${lockKey},0))`;}
  }finally{reserved.release();}
}
