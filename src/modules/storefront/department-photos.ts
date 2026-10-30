import {CLAIM_PHOTO_REASONS} from './claim-photos.ts';
import type {LocalAuth} from '../access/auth.ts';

// Curated department imagery (round 26, coordinator decision): one clean photo per department,
// chosen by eye from the Berlapak dataset (data/catalog/berlapak) for a plain/light ground, the
// product clearly visible and no text banners. Keyed by department slug; the dataset product key
// and the content-addressed photo hash identify the pick. Used by the header pills, the home and
// /kategori grids and the home hero. A department without a pick, or whose picked photo is no
// longer on a current publication in that department, shows its tint without a photo.
// 2026-10-28: the seller's original photos replaced the AI studio covers, so every pick below was re-chosen by eye among
// ALL photos of the department's products (cover or not). 2026-10-29: fashion-wanita, hewan-peliharaan and mainan-hobi got
// picks whose only marks are the seller's small corner logo and a colour word; a department without a clean photo shows its tint.
// 2026-10-30 (DEC-022, unit products only): dapur, elektronik, fashion-pria, ibu-anak, kesehatan and perkakas re-picked by eye
// from their single products; hewan-peliharaan and mainan-hobi keep picks that show only while their products are published.
export const DEPARTMENT_PHOTOS:Readonly<Record<string,{product:string;photo:string;reason:string}>>={
 dapur:{product:'296',photo:'a7bc066693637803711f0705f7717b162a97e2526572d6a8a59b5ed8f3c85600',reason:'navy insulated lunch bag on white, seller corner logo only'},
 'fashion-wanita':{product:'461',photo:'36a5290140a7fe233076f89052aece058a0a53da3a9a88deade51908a7327935',reason:'model carrying a black puffy tote, seller corner logo only, no text'},
 'hewan-peliharaan':{product:'198',photo:'fd36b184b36fa451cfd5bbfb1dd08a4dbf07bfcf8c8bd58c705074a75c141a18',reason:'green cat-toy ball with rope on white, colour word only'},
 'mainan-hobi':{product:'14',photo:'c8159b05aacb3c317355b51920f61d9ebc7130ea1eb196d64dbd3626ff1621af',reason:'four colour finger spinners on a plain grey ground, seller corner logo only, no text'},
 elektronik:{product:'316',photo:'a8dafef657837c5e918c97f272ecdc2b4bda6680bb2e6335c3e2dc7258bbca42',reason:'flat antenna and cable on a wooden table, no text'},
 'fashion-pria':{product:'311',photo:'4553fe7c03214be4711035777cb2b7d2bfde7e9f9137dc4780feae86a3af8d30',reason:'dry bag held on a beach, no text'},
 ibadah:{product:'413',photo:'157a77faac08380900c3d9506140cae0e07a7169b8e76fd6a93e8e57ff3b35e7',reason:'model in sarung on a light panelled wall, no logo or claim'},
 'ibu-anak':{product:'326',photo:'b9069d915e745b75782d2ea0ec05470dedaf003b4d37169a90fe9daf39c2c0e0',reason:'blue baby food container on a soft ground, colour word only'},
 kecantikan:{product:'325',photo:'1f90e888a06aae9fc61629fdd92ea6a2277af8598d75031e754e7459378c7054',reason:'makeup pouch with lipstick and perfume, small product mark only'},
 kesehatan:{product:'370',photo:'4f5f02907646297bbf959e0540762e7b0079155fc73a75d9ad551149bd58e62b',reason:'silver massager pen on white, small labels only'},
 'makanan-minuman':{product:'429',photo:'17905bcabc6b7fe18faee8e042badece8f9842bbdb7d669ff290ffe3bca3cd96',reason:'three rice packs with spices, product brand only'},
 otomotif:{product:'297',photo:'de97e4d64be04ef477d5e49bee4978ef8bbf0852ece15bd08b3dcef4ec3f28b6',reason:'spray cleaner and cloth on white, product brand only'},
 perkakas:{product:'348',photo:'be1a39ceba89ea4408b7c5b92b84b3ec3b98231253c242c6dce655d79d23ed79',reason:'socket set in its grey case on white, no text'},
 'rumah-tangga':{product:'417',photo:'bc8102543a0f',reason:'reed diffuser and box on a soft light ground, no text'},
};
// Catalog photo URLs are `/media/catalog/<title-slug>-<first 12 hex>.webp` (legacy `<sha256>.webp`):
// a pick matches either form.
export const photoMatch=(url:string,sha:string)=>url.endsWith(`/${sha}.webp`)||url.endsWith(`-${sha.slice(0,12)}.webp`)||url.endsWith(`/${sha.slice(0,12)}.webp`);
export type DepartmentPhoto={url:string;width:number;height:number};
// The picked photo only while a current (not withdrawn) publication in the department (or one of
// its subcategories) still carries it; otherwise null.
export async function departmentPhotos(identity:LocalAuth,departments:readonly {id:string;slug:string}[]){
 const wanted=departments.flatMap(d=>DEPARTMENT_PHOTOS[d.slug]?[{id:d.id,sha:DEPARTMENT_PHOTOS[d.slug].photo}]:[]);
 const found=new Map<string,DepartmentPhoto>();
 if(!wanted.length) return found;
 const rows=await identity.sql<{department_id:string;image:DepartmentPhoto}[]>`with recursive picks as (
   select * from unnest(${wanted.map(w=>w.id)}::uuid[],${wanted.map(w=>w.sha)}::text[]) as p(department_id,sha)),
  tree as (select p.department_id as id,p.department_id from picks p
   union all select c.id,t.department_id from app.category c join tree t on c.parent_id=t.id)
  select distinct on (t.department_id) t.department_id,i.image
  from app.publication_head h join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision
   join app.product_revision r on r.product_id=v.product_id and r.revision=v.product_revision
   join tree t on t.id=r.category_id join picks p on p.department_id=t.department_id
   cross join lateral jsonb_array_elements(r.images) as i(image)
  where h.revision>0 and not exists (select 1 from app.publication_withdrawal w where w.publication_id=v.id)
   and (i.image->>'url' like '%/'||p.sha||'.webp' or i.image->>'url' like '%-'||left(p.sha,12)||'.webp' or i.image->>'url' like '%/'||left(p.sha,12)||'.webp')
  order by t.department_id`;
 for(const row of rows) found.set(row.department_id,{url:String(row.image.url),width:Number(row.image.width),height:Number(row.image.height)});
 return found;
}

// Hero photos (unit products since 2026-10-30, DEC-022): further clean picks that are not any department's photo, so the hero does not
// repeat the tiles and pills right below it. Shown in this order, only while still published.
export const HERO_PHOTOS:readonly {product:string;photo:string;reason:string}[]=[
 {product:'402',photo:'d30e3febe19c2e4c85eeccf6ec8b7dd05bfef84d9cb281d6caca2182c3fe9445',reason:'kids\' jersey front on white, tiny chest mark only'},
 {product:'335',photo:'67bbbd58fc1edd97f4db2229c0a942b0fd253da59466bdcf4e03f2f5f2fdbea6',reason:'quilted shoulder bag on a plain ground, no text'},
 {product:'337',photo:'2cc000face4e3508d10debd286ebe876b22e1a61246f905d9586e152888aa273',reason:'two models in sarung on a light wall, small product mark only'},
 {product:'416',photo:'f0f4335dd5d3465d1b72b985665fc03ad3e8ccb60e406451893c61369395e2f0',reason:'model with a crossbody bag, no text'},
 {product:'418',photo:'2caee5c67247a64686d2486ae5eac401cb614a18748edea9e663314fc07edfe4',reason:'garden hose in use on a lawn, no text'},
 {product:'428',photo:'42a156cbaeb741d49d4177993f897a3c6d343fab351684eb16086d89b7c0292d',reason:'bowls of spices on a light table, no text'}
];
export const heroPhotos=(identity:LocalAuth)=>photosById(identity,HERO_PHOTOS.map(h=>h.photo));
// Curated photos by content id (full sha256 or its first 12 hex), in the given order, only while a
// current (not withdrawn) publication still carries them.
export async function photosById(identity:LocalAuth,shas:readonly string[]):Promise<DepartmentPhoto[]>{
 const rows=await identity.sql<{sha:string;image:DepartmentPhoto}[]>`select distinct on (p.sha) p.sha,i.image
  from unnest(${[...shas]}::text[]) as p(sha)
  join app.product_revision r on true
  join app.publication_version v on v.product_id=r.product_id and v.product_revision=r.revision
  join app.publication_head h on h.product_id=v.product_id and h.revision=v.revision
  cross join lateral jsonb_array_elements(r.images) as i(image)
  where h.revision>0 and not exists (select 1 from app.publication_withdrawal w where w.publication_id=v.id)
   and (i.image->>'url' like '%/'||p.sha||'.webp' or i.image->>'url' like '%-'||left(p.sha,12)||'.webp' or i.image->>'url' like '%/'||left(p.sha,12)||'.webp')
  order by p.sha`;
 const bySha=new Map(rows.map(row=>[row.sha,{url:String(row.image.url),width:Number(row.image.width),height:Number(row.image.height)}]));
 return shas.flatMap(sha=>bySha.get(sha)??[]);
}

// Home merchandising (the "Terbaru" shelf and the switcher panels) leaves out products whose
// photo or name carries an unsourced claim (before/after, "terbukti ampuh", body-shaping or
// glow promises). They stay published and findable in listings; the owner can supply clean
// photos or names later. Photos are matched by content hash, names by the listed claim words.
// The screened photo list lives in claim-photos.ts, keyed by the first 12 hex of the photo sha256. A catalog photo URL
// ends in `<title-slug>-<12 hex>.webp`, `<12 hex>.webp` or the legacy `<64 hex>.webp`.
const photoId=(url:string)=>{const name=(url.split('/').pop()??'').replace(/\.webp$/,'');return name.length>=64?name.slice(-64):name.slice(-12);};
const claimPhoto=(url:string)=>{const id=photoId(url);return CLAIM_PHOTO_REASONS.has(id)||CLAIM_PHOTO_REASONS.has(id.slice(0,12));};
// Gendes and Bright Glow: whitening/glow efficacy text on their photos (round 31); whitening, detox
// and immunity names (round 34).
const CLAIM_WORDS=/\b(?:pelangsing|anti botak|ampuh|tirus|glowing|gendes|bright glow|whitening|pemutih|detox|imun)\b/i;
export const hasClaimTerm=(name:string)=>CLAIM_WORDS.test(name);
export const homeSafe=(product:{name:string;images:{url:string}[]})=>!CLAIM_WORDS.test(product.name)&&!product.images.some(image=>claimPhoto(image.url));

