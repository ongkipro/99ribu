// Owner 2026-10-31: the curated single-product list in the raw snapshot (`single-79k-105k/…-full.json`, 216 products
// whose Berlapak recommended price is Rp79.000–Rp105.000) is sold as one unit at Rp99.000. Its records are rewritten
// here into the legacy row shape readBerlapakSource already reads, so naming, cleaning, classification and the
// sanitization gate stay the same code. A product that was already in the legacy snapshot keeps its legacy rank (the
// product key and B99_ SKUs, matched by Berlapak `_id`), so the live product is revised in place, never duplicated.
// A product new to 99ribu gets rank SINGLE_RANK_BASE + its Berlapak catalog number. Products without stock stay in the
// catalog as drafts (the publication guard blocks them); one without a supplier warehouse ships from the
// distributor address until the warehouse profile is completed.
export const SINGLES_FILE='single-79k-105k/01-siap-jual-langsung-99ribu-full.json';
export const SINGLE_RANK_BASE=1000;
const HEX=/^[0-9a-f]{24}$/;
type Rec=Record<string,unknown>;
const rec=(value:unknown)=>(value&&typeof value==='object'&&!Array.isArray(value)?value:{}) as Rec;
const list=(value:unknown)=>(Array.isArray(value)?value:[]) as unknown[];
const pad=(n:number,width:number)=>String(n).padStart(width,'0');
const slugOf=(value:string)=>value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120);

// One photo the reader expects on disk (images/<folder>/<file>) and where `catalog fetch-images` gets it.
export type SinglePhoto={folder:string;file:string;url:string};
export type SingleRows={snapshot:string;rows:Rec[];photos:SinglePhoto[];legacyRanks:number[]};

// `legacy`: every legacy record (full list, not only ready stock) for the `_id` -> rank and variant photo mapping.
// `hasFolder`: whether images/<folder> exists in the snapshot.
export function singleRows(document:unknown,legacy:readonly Rec[],hasFolder:(folder:string)=>boolean):SingleRows{
  const data=rec(document);
  const snapshot=typeof data.generated_at==='string'?data.generated_at:'';
  if(!snapshot||snapshot.length>40) throw new Error('Single-product list has no generated_at.');
  const byId=new Map(legacy.flatMap((row)=>typeof row._id==='string'?[[row._id,row] as const]:[]));
  const rows:Rec[]=[],photos:SinglePhoto[]=[],legacyRanks:number[]=[],ranks=new Set<number>();
  for(const value of list(data.products)){
    const p=rec(value),id=typeof p._id==='string'?p._id:'',old=byId.get(id);
    const catalogNo=Number(p.berlapak_catalog_no);
    const rank=old?Number(old.rank):SINGLE_RANK_BASE+catalogNo;
    // An invalid record is passed on with rank 0 so the reader counts it as `invalid-record`.
    if(!Number.isSafeInteger(rank)||rank<1||ranks.has(rank)){rows.push({rank:0});continue;}
    ranks.add(rank);if(old) legacyRanks.push(rank);
    const assets=rec(p.assets),place=rec(p.warehouse_and_location),seller=rec(p.distributor_and_seller),inventory=rec(p.inventory);
    const pricing=rec(p.pricing_berlapak),variants=rec(p.variants_summary),category=rec(p.category_and_google_catalog);
    // The legacy folder (and its photos) is reused; a new product gets <rank%1000>-<slug> filled by fetch-images.
    const local=typeof assets.folder_slug==='string'&&hasFolder(assets.folder_slug)?assets.folder_slug:null;
    const folder=local??(old?String(rec(old.assets).folder_slug):`${pad(rank%1000,3)}-${slugOf(String(p.slug??p.name??id))}`);
    if(!local) for(const image of list(assets.gallery_images)){
      const g=rec(image),index=Number(g.index);
      if(Number.isSafeInteger(index)&&index>0&&typeof g.remote_url==='string') photos.push({folder,file:`img-${pad(index,2)}.webp`,url:g.remote_url});
    }
    const oldVariants=new Map(list(rec(old?.variants_summary).variants).map((v)=>[String(rec(v)._id),rec(v)]));
    const options=list(variants.variants).map((value,index)=>{
      const v=rec(value),prior=oldVariants.get(String(v._id));
      // A variant known to the legacy snapshot keeps its legacy photo; any other variant photo is fetched next to the
      // folder's own files (var-1NN cannot collide with the legacy var-NN names).
      let image:string|null=typeof prior?.image_local_path==='string'?prior.image_local_path:null;
      if(!image&&typeof v.image_remote_url==='string'){
        const file=`var-${pad((local||old?100:0)+index+1,2)}.webp`;image=`images/${folder}/${file}`;photos.push({folder,file,url:v.image_remote_url});
      }
      return {_id:v._id,name:v.name,hpp_price:v.hpp_price,stock:v.stock,image_local_path:image};
    });
    const warehouseId=typeof place.warehouse_id==='string'&&HEX.test(place.warehouse_id)?place.warehouse_id:null;
    const address=rec(seller.distributor_address);
    rows.push({rank,_id:id,name:p.name,description:p.description,allow_unstocked:true,
      inventory:{is_ready_stock:inventory.is_ready_stock,total_stock:inventory.total_stock,weight_gram:inventory.weight_gram,weight_kg:inventory.weight_kg},
      pricing:{hpp_price:pricing.hpp_price},strategy_99ribu:{recommended_bundle_qty:1},
      variants_summary:{has_variants:variants.has_variants===true&&options.length>0,variants:options},
      assets:{folder_slug:folder},supplier:{name:seller.seller_name},
      warehouse_and_shipping:warehouseId?{warehouse_id:warehouseId,warehouse_name:place.warehouse_name,province:place.province,city:place.city,district:place.district}
        :{warehouse_id:address.address_id,warehouse_name:address.name,province:address.province??place.province,city:address.city??place.city,district:address.district??place.district},
      category_mapping:{storefront_category_code:category.suggested_category_code,storefront_subcategory:category.suggested_subcategory_name}});
  }
  return {snapshot:`singles ${snapshot}`,rows,photos,legacyRanks};
}

// Host-only: downloads the photos the single-product list names but the snapshot does not hold yet (supplier bucket
// only), converted the way the snapshot's own photos were (inside 1080 px, WebP q82, lower quality until the file fits
// the catalog media limit). Existing files are never overwritten; a failed photo is reported and the reader then
// skips that product or variant, so a rerun only fetches what is still missing.
const PHOTO_ORIGIN='https://storage.googleapis.com/productsource-bucket/',DOWNLOAD_LIMIT=15_000_000;
export async function fetchSinglePhotos(imagesRoot:string,photos:readonly SinglePhoto[],limit:number){
  const {default:sharp}=await import('sharp');
  const {closeSync,constants,existsSync,mkdirSync,openSync,writeFileSync}=await import('node:fs');const {join}=await import('node:path');
  const summary={wanted:photos.length,existing:0,fetched:0,failed:[] as string[]};
  const queue=[...photos];
  const work=async()=>{for(let photo=queue.shift();photo;photo=queue.shift()){
    const target=join(imagesRoot,photo.folder,photo.file);
    if(!/^[\w-]+$/.test(photo.folder)||!photo.url.startsWith(PHOTO_ORIGIN)){summary.failed.push(`${photo.folder}/${photo.file}: refused source`);continue;}
    if(existsSync(target)){summary.existing++;continue;}
    try{
      const response=await fetch(photo.url,{signal:AbortSignal.timeout(30_000)});if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw=Buffer.from(await response.arrayBuffer());if(raw.length>DOWNLOAD_LIMIT) throw new Error('too large');
      let bytes:Buffer|null=null;
      for(const quality of [82,72,62,52]){
        bytes=await sharp(raw,{failOn:'none'}).rotate().resize({width:1080,height:1080,fit:'inside',withoutEnlargement:true}).webp({quality,effort:4}).toBuffer();
        if(bytes.length<=limit) break;
      }
      if(!bytes||bytes.length>limit) throw new Error('does not fit the media limit');
      mkdirSync(join(imagesRoot,photo.folder),{recursive:true});
      const fd=openSync(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o644);try{writeFileSync(fd,bytes);}finally{closeSync(fd);}
      summary.fetched++;
    }catch(error){summary.failed.push(`${photo.folder}/${photo.file}: ${error instanceof Error?error.message:'failed'}`);}
  }};
  await Promise.all([work(),work(),work(),work()]);
  return summary;
}
