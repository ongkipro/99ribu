import {CLAIM_PHOTO_REASONS} from './claim-photos.ts';
import type {LocalAuth} from '../access/auth.ts';

// Curated department imagery (round 26, coordinator decision): one clean photo per department,
// chosen by eye from the Berlapak dataset (data/catalog/berlapak) for a plain/light ground, the
// product clearly visible and no text banners. Keyed by department slug; the dataset product key
// and the content-addressed photo hash identify the pick. Used by the header pills, the home and
// /kategori grids and the home hero. A department without a pick, or whose picked photo is no
// longer on a current publication in that department, shows its tint without a photo.
// 2026-10-28: the seller's original photos replaced the AI studio covers, so every pick below was re-chosen by eye among
// ALL photos of the department's products (cover or not). fashion-wanita, hewan-peliharaan and mainan-hobi have no
// photo without a seller logo or text banner, so they show their tint until clean photos exist.
export const DEPARTMENT_PHOTOS:Readonly<Record<string,{product:string;photo:string;reason:string}>>={
 dapur:{product:'164',photo:'9bff024f9858e2f94be1da678383cace0cf8e273cf44616ba1b02766d004b396',reason:'pastel knife set on a soft pink ground, no text or logo'},
 elektronik:{product:'268',photo:'696ab6951ef61eb5bc4c5aca1640cadf18b198b48caf786a2346f6bda2ecc759',reason:'four colour mini fans on white, no text'},
 'fashion-pria':{product:'207',photo:'35dfdf54f9531805f4d88c20a65acd847912e4e8a1003556767cc90639330944',reason:'two tees laid flat on a plain purple ground, no text'},
 ibadah:{product:'413',photo:'157a77faac08380900c3d9506140cae0e07a7169b8e76fd6a93e8e57ff3b35e7',reason:'model in sarung on a light panelled wall, no logo or claim'},
 'ibu-anak':{product:'251',photo:'5f440796120ba4cb13baa2317a5649f6c990cf0c28ee2aaf30a5fee07126e10d',reason:'five girls\' dresses on white, no marks'},
 kecantikan:{product:'325',photo:'1f90e888a06aae9fc61629fdd92ea6a2277af8598d75031e754e7459378c7054',reason:'makeup pouch with lipstick and perfume, small product mark only'},
 kesehatan:{product:'39',photo:'0f52541d8c2c0bf85e8bcdfc2b47913e9c8df41235061aab2590a3232d9cc53f',reason:'pair of ankle supports on white, no text'},
 'makanan-minuman':{product:'429',photo:'17905bcabc6b7fe18faee8e042badece8f9842bbdb7d669ff290ffe3bca3cd96',reason:'three rice packs with spices, product brand only'},
 otomotif:{product:'297',photo:'de97e4d64be04ef477d5e49bee4978ef8bbf0852ece15bd08b3dcef4ec3f28b6',reason:'spray cleaner and cloth on white, product brand only'},
 perkakas:{product:'83',photo:'6b307cc3e0f4c49ccf09597e4373c4cafa9d52b63a2fcbb622556a1aec1369a8',reason:'three pliers on white, no text'},
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

// Hero photos: further clean picks that are not any department's photo, so the hero does not
// repeat the tiles and pills right below it. Shown in this order, only while still published.
export const HERO_PHOTOS:readonly {product:string;photo:string;reason:string}[]=[
 {product:'180',photo:'6a0cc2b152321cce6a0eb5e32cad0d2b7c89d9f736563e3c1c1122e97b193c3b',reason:'hand-held LED torch on white, no text'},
 {product:'402',photo:'d30e3febe19c2e4c85eeccf6ec8b7dd05bfef84d9cb281d6caca2182c3fe9445',reason:'kids\' jersey front on white, tiny chest mark only'},
 {product:'190',photo:'239df681469c6e98011ed0d40a4219d11e6000b2d78d5279ba6f4801ec0022c1',reason:'stainless oil pot, lid and filter on a light counter, no text'},
 {product:'31',photo:'3c79b7b0d5787fb292cfa617a2f0b8fe2635b518a0c0f33f6e9d5dbfbede5429',reason:'pair of work gloves on white, no text'},
 {product:'150',photo:'c7ecdda78f2a1b4df0fac9fd1cc8e10c191680e5c04c8697c1fae69cf53331e7',reason:'lint remover in use on pink knit, no text'},
 {product:'155',photo:'49af0171cfb9bd28d1525cecfe04ee4bf1cda8b613edec826aec3745d813ef1b',reason:'colourful bed-sheet lifters on white, no text'},
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

