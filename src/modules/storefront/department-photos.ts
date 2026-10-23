import type {LocalAuth} from '../access/auth.ts';

// Curated department imagery (round 26, coordinator decision): one clean photo per department,
// chosen by eye from the Berlapak dataset (data/catalog/berlapak) for a plain/light ground, the
// product clearly visible and no text banners. Keyed by department slug; the dataset product key
// and the content-addressed photo hash identify the pick. Used by the header pills, the home and
// /kategori grids and the home hero. A department without a pick, or whose picked photo is no
// longer on a current publication in that department, shows its tint without a photo.
export const DEPARTMENT_PHOTOS:Readonly<Record<string,{product:string;photo:string;reason:string}>>={
 dapur:{product:'164',photo:'aea8a6f2a16b68e1ba1a767dd2204e9c92a401d2808187505a9aa7f2acfcf2ab',reason:'pastel knife set with vegetables, white ground, no text'},
 elektronik:{product:'397',photo:'ae7092f68d02216d522b5c53c993d0ba6639b60617ce6afb00ac90d070cae94b',reason:'TWS earbuds in their charging case, white ground, no text'},
 'fashion-pria':{product:'207',photo:'1948d36075a3b911923b9e3e5cd4ccfba294a73fa6300e17a45c88b3ef77b323',reason:'man in a black tee, white ground, small chest print only'},
 'fashion-wanita':{product:'16',photo:'3a1880f6db747d3865f67b1e71e2d9d4c5be23ba8698f03b5bed7569fece2d9b',reason:'women\'s sunglasses spread across the frame, white ground, no text'},
 'hewan-peliharaan':{product:'91',photo:'09474b097b8686a4c16cf4df23adab54d2496f6203d3a2efb93081765c3e7594',reason:'grooming glove with a cat, white ground, no text'},
 ibadah:{product:'413',photo:'e0eb5e02de9c57e447cc051937d2e689faca18cca6ff9a183bd3bfae8a1e9a35',reason:'man in grey koko and white sarung, white ground, no text'},
 'ibu-anak':{product:'251',photo:'894d012ae0e2941729dff8f339f9399dbc5e38c8f60928d0cbccc1cedb2c56c1',reason:'four girls\' dresses on hangers, white ground, no text'},
 kecantikan:{product:'318',photo:'621c1f709993a69535130a06fe525f5512c9a5910a3a2a310deeaf904a855f81',reason:'fanned set of wooden make-up brushes, white ground, no text'},
 kesehatan:{product:'39',photo:'1311beb824a03f26c651903ec051a366b632ec9fecbdb73c2ad902ce20895c28',reason:'two people wearing ankle supports, white ground, no text or claims'},
 'mainan-hobi':{product:'96',photo:'146226e91988c9365502f10735c118d00c7a51b2475fe560bbd479038398f7f2',reason:'bait bottle with fruit, white ground, no banner'},
 'makanan-minuman':{product:'308',photo:'a67d92c9b4a889b1b252f8f11616e8b6110574bf5507117b6565c3632e50e3fa',reason:'bottle of forest honey, white ground, product label only'},
 otomotif:{product:'156',photo:'773e7dbddfd7d4e7fda80bb5f6f85a20c2fd07e1b0528a3836a029384d853045',reason:'chrome disc lock with key, white ground, no text'},
 perkakas:{product:'83',photo:'d3ac5d40b8a376f40ce80f205822d7dbce0df8cdf67d08e0b6eab47e4127fb15',reason:'three pliers, white ground, no text'},
 'rumah-tangga':{product:'8',photo:'94af8d225a8f8b23f54343b444a144278865e03bb980e508293ba687df589665',reason:'stainless floor-drain strainer, white ground, one small quality badge'},
};
// Catalog photo URLs are `/media/catalog/<title-slug>-<first 12 hex>.webp` (legacy `<sha256>.webp`):
// a pick matches either form.
const photoMatch=(url:string,sha:string)=>url.endsWith(`/${sha}.webp`)||url.endsWith(`-${sha.slice(0,12)}.webp`)||url.endsWith(`/${sha.slice(0,12)}.webp`);
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
 {product:'483',photo:'bb29f0eac61811abe3055fb24c70895b421dcf77229d92d7c187cc1a579c0f77',reason:'glass teapot on a tray, white ground, one small size chip'},
 {product:'180',photo:'11920ce81fc5a83eaa9b1fd5c9ea3539f2a1f16cf2dbdc62855bd5f6b64f7a19',reason:'LED torch with cable, white ground, no text'},
 {product:'402',photo:'7dc1a21e11dc3668993a465c4e640885f64003e59305fafd5c9e025c7f35b17d',reason:'striped kids\' jersey, white ground, print only'},
 {product:'190',photo:'ee48e95aa1390f8068ca0541c1a09408cab23dcdcbf79a587cb54ade27c074a3',reason:'stainless oil pot and lid, white ground, no text'},
 {product:'31',photo:'f96ea2e86526c4f6476efa80c8c8d1329d2bab316fbe7ba085cfc421c2a14711',reason:'pair of green work gloves, white ground, no text'},
 {product:'335',photo:'f05857716ec3066fa10690e8a71205dd0720081447d00c866911814e87987d68',reason:'black quilted sling bag, grey ground, one small logo'},
];
export async function heroPhotos(identity:LocalAuth):Promise<DepartmentPhoto[]>{
 const shas=HERO_PHOTOS.map(h=>h.photo);
 const rows=await identity.sql<{sha:string;image:DepartmentPhoto}[]>`select distinct on (p.sha) p.sha,i.image
  from unnest(${shas}::text[]) as p(sha)
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
const CLAIM_PHOTOS=new Set([
 'fc166f85aa6404093b9ff87ee0b52d3688a6a7125f1934dcbd19be0fa842093f', // before/after, "terbukti ampuh"
 'af9edb7025df9da962aaeea835dda889e342682a969f062f6a7a2abe3ff1826c', // face-slimming promise
 'a8c39f094629ac004307829438219cecfbb4ab4a9b2eb95806a11d428b197670', // "pria kuat" health claim
 '24d156b282868a92a5c833bf156baf241afa4da038de4bc4c729088394d4e571', // "lebih ampuh" banner
 '1c7779d3d8ffc89de8df8f079eeacc61c4e7e3aaf760ade99ef8837502ed1772', // "wajah glow up" claims
 '5d195454befc746e37adfb3ab8b039892d9d8494c645f37271d283cebb52553c', // Marlov "whitening" deodorant
 '00f76d0f40bca8137ffcd2b738efcb75ca74ec1e876390919b2968ccae7bb1c9', // Marlov second photo
]);
// Gendes and Bright Glow: whitening/glow efficacy text on their photos (round 31); whitening, detox
// and immunity names (round 34).
const CLAIM_WORDS=/\b(?:pelangsing|anti botak|ampuh|tirus|glowing|gendes|bright glow|whitening|detox|imun)\b/i;
export const hasClaimTerm=(name:string)=>CLAIM_WORDS.test(name);
export const homeSafe=(product:{name:string;images:{url:string}[]})=>!CLAIM_WORDS.test(product.name)&&!product.images.some(image=>[...CLAIM_PHOTOS].some(sha=>photoMatch(image.url,sha)));
