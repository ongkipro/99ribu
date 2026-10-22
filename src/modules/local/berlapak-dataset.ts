import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Sql,TransactionSql} from 'postgres';
import {catalogMediaName} from '../../storage/catalog-media.ts';
import {readLocalConfig} from '../../config/local.ts';
import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin} from '../access/http.ts';
import {AccessError,getPrincipal} from '../access/policy.ts';
import {CATALOG_FORMAT,type CatalogDocument,CatalogDatasetError,ensureOriginWarehouses,IMPORT_ACTION,lockOwner,MANIFEST_FORMAT,type ManifestDocument,type OriginWarehouse,parseCatalog,readCatalogDocument,readOriginWarehouses,stockOrigins} from '../catalog/dataset.ts';
import {appendCostVersion} from '../finance/costs.ts';
import {createMovement} from '../inventory/positions.ts';
import {createTransfer,getTransfer,receiveTransfer,resolveTransfer} from '../inventory/transfers.ts';
import {cube,DEFAULT_OFFER_ASSUMPTIONS,readBerlapakSource,readContained,supplierPatterns} from './berlapak.ts';

// DEC-005 generator (host-only): raw Berlapak snapshot -> committed, sanitized catalog dataset.
// Selection and public naming reuse the S69 reader; only public catalog facts are written (no
// HPP, stock or supplier fields). DEC-006: each offer carries its origin warehouse as an opaque
// key (hash of the supplier warehouse id); warehouses get generic names from kecamatan/city.
// Output is deterministic: stable ordering, no run timestamps, photos named by content hash,
// unchanged files are not rewritten.
export const defaultDatasetDir=new URL('../../../data/catalog/berlapak/',import.meta.url).pathname;
const IMAGE_LIMIT=5_000_000,PHOTO=/^[0-9a-f]{64}\.webp$/;
const byKey=(a:string,b:string)=>{const x=/^\d+$/.test(a),y=/^\d+$/.test(b);return x&&y?Number(a)-Number(b):x!==y?(x?-1:1):a<b?-1:a>b?1:0;};
// One-way, stable mapping key: the supplier's warehouse id never leaves the host snapshot.
export const originKey=(sourceWarehouseId:string)=>createHash('sha256').update(`99ribu:berlapak-warehouse:${sourceWarehouseId}`).digest('hex').slice(0,32);

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
  // Generic warehouse names come only from location: "Gudang <Kecamatan>, <Kota>", numbered by key
  // order when two supplier warehouses share a kecamatan. Never the supplier's warehouse name.
  const places=new Map(source.stocks.map((s)=>[s.warehouse.id,{key:originKey(s.warehouse.id),province:s.warehouse.province,city:s.warehouse.city,district:s.warehouse.district}]));
  const ordinal=new Map<string,number>();
  const numbered=[...places.values()].sort((a,b)=>byKey(a.key,b.key)).map((p)=>{
    const place=`${p.district}\n${p.city}`;const n=(ordinal.get(place)??0)+1;ordinal.set(place,n);
    return {place,n,warehouse:{key:p.key,name:`Gudang ${p.district}${n>1?` ${n}`:''}, ${p.city}`,province:p.province,city:p.city,district:p.district}};
  });
  const warehouses:OriginWarehouse[]=numbered.sort((a,b)=>byKey(a.place,b.place)||a.n-b.n).map((w)=>w.warehouse);
  const catalog:CatalogDocument={format:CATALOG_FORMAT,source:'berlapak',source_snapshot:source.snapshot,price_idr:99000,
    categories:source.categories.map((c)=>({slug:c.slug,name:c.name})).sort((a,b)=>byKey(a.slug,b.slug)),warehouses,
    stock_items:[...source.stocks].sort((a,b)=>a.rank-b.rank).map((s)=>({sku:sku(s.rank),name:s.name})),
    products:[...source.offers].sort((a,b)=>byKey(a.key,b.key)).map((o)=>{const side=cube(o.grams);return {key:o.key,name:o.name,description:o.description,
      category:slug.get(o.category) as string,photos:o.images.map((i)=>({sha256:photo(i.rank,i.file),alt:i.alt})),
      offer:{sku:`B99_${o.key}_OFFER`,label:o.label,kind:o.kind,warehouse:originKey(o.warehouse),weight_grams:o.grams,length_mm:side,width_mm:side,height_mm:side,
        contents:o.parts.map((p)=>({stock_item:sku(p.rank),quantity:p.quantity})).sort((a,b)=>byKey(a.stock_item,b.stock_item))}};})};
  parseCatalog(catalog);
  const text=`${JSON.stringify(catalog,null,2)}\n`;
  // Sanitization gate: refuse output that names a supplier or a supplier warehouse in public
  // product text, or carries a raw supplier warehouse id anywhere. Warehouse entries are built
  // from kecamatan/city/province only (DEC-006).
  const productText=JSON.stringify([catalog.categories,catalog.stock_items,catalog.products]);const lower=productText.toLowerCase();
  if(supplierPatterns(source.supplierNames).some((p)=>p.test(productText))||source.stocks.some((s)=>lower.includes(s.warehouse.name.toLowerCase())||text.includes(s.warehouse.id)))
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
  return {dir:outDir,catalog_sha256:built.manifest.catalog_sha256,categories:built.catalog.categories.length,warehouses:built.catalog.warehouses.length,stock_items:built.catalog.stock_items.length,
    products:built.catalog.products.length,bundles:built.catalog.products.filter((p)=>p.offer.kind==='bundle').length,photos:built.photos.size,
    photo_bytes:[...built.photos.values()].reduce((n,p)=>n+p.bytes.length,0),photos_written:written,photos_removed:removed,skipped:built.skipped};
}

// DEC-005 operator step: initial physical stock and component HPP for the imported catalog,
// read from the raw snapshot at run time (never committed). Writes only through the real
// inventory (createMovement receive, expected_version 0) and finance (appendCostVersion,
// expected_version 0) services. DEC-006: each item is received into its own origin warehouse,
// and only while the item has no stock history in any warehouse, so a rerun, a later snapshot
// or stock already received elsewhere (the pre-DEC-006 import warehouse) never receives again or
// overwrites HPP; differences are only reported as drift for normal admin flows (and stock held
// outside the origin for `catalog:rehome`). Offers without assumptions get the S69 defaults.
// Refuses before any write when the raw snapshot is not the one the committed dataset was
// generated from, or the catalog and its origin warehouses are not imported.
const RECEIVE_LIMIT=1000000;
export async function loadInitialStock(request:Request,identity:LocalAuth,options:{sourceDir:string;datasetDir?:string;signal?:AbortSignal}){
  const {signal}=options;signal?.throwIfAborted();const config=readLocalConfig(process.env);assertOrigin(request);
  const catalog=readCatalogDocument(options.datasetDir??defaultDatasetDir),source=readBerlapakSource(options.sourceDir);
  if(source.snapshot!==catalog.source_snapshot) throw new CatalogDatasetError(`Raw snapshot ${source.snapshot} is not the committed dataset snapshot ${catalog.source_snapshot}; run catalog:dataset and catalog:import first.`);
  const principal=await getPrincipal(request,identity);await identity.sql.begin((tx)=>lockOwner(tx,principal));
  const reserved=await identity.sql.reserve();
  try{
    const lockKey='99ribu:catalog-initial-stock';
    const [lock]=await reserved`select pg_try_advisory_lock(hashtextextended(${lockKey},0)) as ok`;
    if(!lock.ok) throw new CatalogDatasetError('Another initial stock load is running; retry after it finishes.');
    try{
      // Generator contract: a dataset stock item SKU ends in `_<snapshot rank>`.
      const byRank=new Map(catalog.stock_items.map((s)=>[Number(s.sku.slice(s.sku.lastIndexOf('_')+1)),s.sku]));
      const items=source.stocks.filter((s)=>byRank.has(s.rank)).map((s)=>({...s,sku:byRank.get(s.rank) as string}));
      if(items.length!==catalog.stock_items.length) throw new CatalogDatasetError(`Raw snapshot resolves ${items.length} of ${catalog.stock_items.length} catalog stock items; regenerate the dataset first.`);
      const offerSkus=catalog.products.map((p)=>p.offer.sku);const origins=stockOrigins(catalog);
      const warehouses=await readOriginWarehouses(identity.sql,catalog.warehouses);
      const stocks=new Map((await identity.sql`select id,sku from app.stock_item where sku in ${identity.sql(items.map((s)=>s.sku))}`).map((r)=>[r.sku as string,r.id as string]));
      const offers=await identity.sql`select id,sku from app.offer where sku in ${identity.sql(offerSkus)}`;
      if(warehouses.size!==catalog.warehouses.length||stocks.size!==items.length||offers.length!==offerSkus.length) throw new CatalogDatasetError(`Catalog not imported yet (${warehouses.size}/${catalog.warehouses.length} origin warehouses, ${stocks.size}/${items.length} stock items, ${offers.length}/${offerSkus.length} offers); run catalog:import first.`);
      const command=(step:string)=>{const next=new Request(`${config.origin}/api/v1/admin/catalog-initial-stock`,{method:'POST',headers:request.headers});
        next.headers.set('idempotency-key',createHash('sha256').update(`catalog-initial-stock:${source.snapshot}:${step}`).digest('hex'));return next;};
      const summary={snapshot:source.snapshot,warehouses:warehouses.size,stock_items:items.length,
        receive:{received:0,units:0,existing:0,capped:0,differs_from_snapshot:0,outside_origin:0},hpp:{appended:0,existing:0,differs_from_snapshot:0},assumptions:{appended:0,existing:0}};
      for(const item of items){
        signal?.throwIfAborted();const stockId=stocks.get(item.sku) as string;const warehouseId=warehouses.get(origins.get(item.sku) as string) as string;
        const [history]=await identity.sql`select count(*) filter (where revision>0)::int as touched,coalesce(sum(on_hand),0)::int as on_hand,
          coalesce(sum(on_hand) filter (where warehouse_id<>${warehouseId}),0)::int as outside from app.inventory_balance where stock_item_id=${stockId}`;
        const quantity=Math.min(item.stock,RECEIVE_LIMIT);
        let received=false;
        if(history.touched===0){
          try{await createMovement(command(`receive:${warehouseId}:${item.sku}`),identity,principal,{warehouse_id:warehouseId,stock_item_id:stockId,lot_id:null,kind:'receive',quantity,
            expected_version:0,reason:`Initial stock from supplier snapshot ${source.snapshot}`});received=true;}
          catch(error){if(!(error instanceof AccessError)||error.code!=='VERSION_CONFLICT') throw error;}
        }
        if(received){summary.receive.received++;summary.receive.units+=quantity;if(quantity<item.stock) summary.receive.capped++;}
        else{summary.receive.existing++;if(history.on_hand!==item.stock) summary.receive.differs_from_snapshot++;if(history.outside>0) summary.receive.outside_origin++;}
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

// DEC-006 transition for a database whose catalog stock sits outside its origin warehouses (the
// pre-DEC-006 single import warehouse). Read-only plan: which origin warehouses exist, which
// available units would move by warehouse transfer, which units stay because they are reserved or
// quarantined, which transfers are still open, and which offers the next `catalog:import` rebinds
// (importer-owned drafts) or preserves (staff-edited drafts). HPP is per stock item, not per
// warehouse, so nothing about cost moves.
type Move={stock_item_id:string;sku:string;from_warehouse_id:string;from:string;to_key:string;quantity:number};
export async function planOriginTransition(sql:Sql|TransactionSql,catalog:CatalogDocument){
  const origins=stockOrigins(catalog);const dataset=new Map(catalog.warehouses.map((w)=>[w.key,w]));
  const existing=await sql<{id:string;origin_key:string;name:string;province:string;city:string;district:string;active:boolean}[]>`
    select id,origin_key,name,province,city,district,active from app.warehouse where origin_key in ${sql(catalog.warehouses.map((w)=>w.key))}`;
  const conflicts=existing.filter((r)=>{const w=dataset.get(r.origin_key) as OriginWarehouse;return !r.active||r.name!==w.name||r.province!==w.province||r.city!==w.city||r.district!==w.district;}).map((r)=>r.name);
  const items=await sql<{id:string;sku:string}[]>`select id,sku from app.stock_item where sku in ${sql(catalog.stock_items.map((s)=>s.sku))}`;
  const ids=items.map((i)=>i.id);
  const positions=ids.length?await sql<{stock_item_id:string;warehouse_id:string;name:string;origin_key:string|null;on_hand:number;reserved:number;quarantined:number}[]>`
    select b.stock_item_id,b.warehouse_id,w.name,w.origin_key,sum(b.on_hand)::int as on_hand,sum(b.reserved)::int as reserved,sum(b.quarantined)::int as quarantined
    from app.inventory_balance b join app.warehouse w on w.id=b.warehouse_id where b.stock_item_id in ${sql(ids)}
    group by b.stock_item_id,b.warehouse_id,w.name,w.origin_key order by b.stock_item_id,b.warehouse_id`:[];
  const open=ids.length?await sql<{id:string;stock_item_id:string;status:string;revision:number}[]>`
    select t.id,t.stock_item_id,t.status,t.revision from app.warehouse_transfer t join app.warehouse w on w.id=t.to_warehouse_id
    where t.stock_item_id in ${sql(ids)} and t.status in ('requested','dispatched','exception') and w.origin_key is not null order by t.id`:[];
  const moves:Move[]=[];const from:Record<string,{stock_items:number;units:number}>={};
  const units={to_move:0,held_reserved:0,held_quarantined:0};const stock={catalog:catalog.stock_items.length,imported:items.length,at_origin_only:0,to_move:0,held_outside:0,without_stock:0};
  for(const item of items){
    const key=origins.get(item.sku) as string;const mine=positions.filter((p)=>p.stock_item_id===item.id&&p.on_hand>0);
    if(!mine.length){stock.without_stock++;continue;}
    const outside=mine.filter((p)=>p.origin_key!==key);if(!outside.length){stock.at_origin_only++;continue;}
    let moving=false;
    for(const p of outside){
      const quantity=p.on_hand-p.reserved-p.quarantined;units.held_reserved+=p.reserved;units.held_quarantined+=p.quarantined;
      if(quantity<1) continue;moving=true;units.to_move+=quantity;
      moves.push({stock_item_id:item.id,sku:item.sku,from_warehouse_id:p.warehouse_id,from:p.name,to_key:key,quantity});
      from[p.name]={stock_items:(from[p.name]?.stock_items??0)+1,units:(from[p.name]?.units??0)+quantity};
    }
    if(moving) stock.to_move++;else stock.held_outside++;
  }
  const offers=await sql<{sku:string;origin_key:string|null;owned:boolean}[]>`select o.sku,w.origin_key,
      exists (select 1 from app.product_revision r where r.product_id=p.id and r.revision=p.revision
        and exists (select 1 from app.audit_event a where a.action=${IMPORT_ACTION} and a.actor_id=r.actor_id)) as owned
    from app.offer o join app.product p on p.id=o.product_id
    join app.offer_revision v on v.product_id=p.id and v.revision=p.revision and v.offer_id=o.id
    left join app.warehouse w on w.id=v.default_warehouse_id where o.sku in ${sql(catalog.products.map((p)=>p.offer.sku))}`;
  const wanted=new Map(catalog.products.map((p)=>[p.offer.sku,p.offer.warehouse]));
  const moved=offers.filter((o)=>o.origin_key!==wanted.get(o.sku));
  return {warehouses:{catalog:catalog.warehouses.length,existing:existing.length,to_create:catalog.warehouses.length-existing.length,conflicts},
    stock_items:stock,units,from,open_transfers:open.length,
    offers:{catalog:catalog.products.length,imported:offers.length,at_origin:offers.length-moved.length,to_rebind:moved.filter((o)=>o.owned).length,
      preserved:moved.filter((o)=>!o.owned).map((o)=>o.sku).sort(byKey)},
    moves,open};
}
export const summarizeTransition=({moves:_moves,open:_open,...summary}:Awaited<ReturnType<typeof planOriginTransition>>)=>summary;

// Applies the plan through the real domain services: creates missing origin warehouses (audited),
// finishes open transfers into origin warehouses, then moves each available position by an
// ordinary warehouse transfer (create -> dispatch -> receive, each audited and idempotent). Reserved
// or quarantined units stay where they are. A rerun recomputes the plan from current state, so it
// converges (nothing left to move) and resumes a transfer interrupted between its steps. Offers are
// rebound afterwards by `catalog:import` (new catalog revision + guarded republish).
export async function applyOriginTransition(request:Request,identity:LocalAuth,catalog:CatalogDocument,signal?:AbortSignal){
  signal?.throwIfAborted();const config=readLocalConfig(process.env);assertOrigin(request);
  const principal=await getPrincipal(request,identity);await identity.sql.begin((tx)=>lockOwner(tx,principal));
  const reserved=await identity.sql.reserve();
  try{
    const lockKey='99ribu:catalog-origin-transition';
    const [lock]=await reserved`select pg_try_advisory_lock(hashtextextended(${lockKey},0)) as ok`;
    if(!lock.ok) throw new CatalogDatasetError('Another origin transition is running; retry after it finishes.');
    try{
      const before=await planOriginTransition(identity.sql,catalog);
      if(before.warehouses.conflicts.length) throw new CatalogDatasetError(`Origin warehouses differ from the dataset: ${before.warehouses.conflicts.join(', ')}.`);
      let audited=false;const audit=async()=>{if(audited) return;audited=true;await identity.sql.begin(async(tx)=>{await lockOwner(tx,principal);
        await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details) values (${principal.id},'catalog.origin_transition','catalog:berlapak','allowed',
          'DEC-006: move catalog stock to its origin warehouses through warehouse transfers',${JSON.stringify(summarizeTransition(before))}::jsonb)`;});};
      const {ids,created}=await ensureOriginWarehouses(identity,principal,catalog.warehouses,audit);
      const command=(step:string)=>{const next=new Request(`${config.origin}/api/v1/admin/inventory/transfers`,{method:'POST',headers:request.headers});
        next.headers.set('idempotency-key',createHash('sha256').update(`catalog-origin-transition:${step}`).digest('hex'));return next;};
      const reason='DEC-006 local transition: catalog stock moves to its origin warehouse';
      type Transfer={id:string;status:string;version:number;allocations:{source_balance_id:string;quantity:number;received_quantity:number}[]};
      const finish=async(transfer:Transfer)=>{
        let current=transfer;
        if(current.status==='requested') current=await resolveTransfer(command(`dispatch:${current.id}`),identity,principal,current.id,'dispatch',{expected_version:current.version,reason}) as Transfer;
        const allocations=current.allocations.map((a)=>({source_balance_id:a.source_balance_id,received_quantity:a.quantity-a.received_quantity,quarantined_quantity:0})).filter((a)=>a.received_quantity>0);
        if(allocations.length) current=await receiveTransfer(command(`receive:${current.id}:${current.version}`),identity,principal,current.id,{expected_version:current.version,reason,allocations}) as Transfer;
        return current;
      };
      const result={warehouses_created:created,transfers:{resumed:0,created:0,units:0}};
      for(const open of before.open){signal?.throwIfAborted();await audit();await finish(await getTransfer(identity,principal,open.id) as Transfer);result.transfers.resumed++;}
      for(const move of before.moves){
        signal?.throwIfAborted();await audit();
        const to=ids.get(move.to_key) as string;
        const transfer=await createTransfer(command(`create:${move.stock_item_id}:${move.from_warehouse_id}:${to}:${move.quantity}`),identity,principal,
          {from_warehouse_id:move.from_warehouse_id,to_warehouse_id:to,stock_item_id:move.stock_item_id,quantity:move.quantity,reason}) as Transfer;
        await finish(transfer);result.transfers.created++;result.transfers.units+=move.quantity;
      }
      return {mode:'apply',...result,after:summarizeTransition(await planOriginTransition(identity.sql,catalog))};
    }finally{await reserved`select pg_advisory_unlock(hashtextextended(${lockKey},0))`;}
  }finally{reserved.release();}
}
