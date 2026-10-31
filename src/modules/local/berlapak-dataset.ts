import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Sql,TransactionSql} from 'postgres';
import {catalogMediaName} from '../../storage/catalog-media.ts';
import {readLocalConfig} from '../../config/local.ts';
import {readRuntimeConfig} from '../../config/runtime.ts';
import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin} from '../access/http.ts';
import {AccessError,getPrincipal} from '../access/policy.ts';
import {CATALOG_FORMAT,type CatalogDocument,defaultCatalogDatasetDir,CatalogDatasetError,ensureOriginWarehouses,IMPORT_ACTION,lockOwner,MANIFEST_FORMAT,type ManifestDocument,type OriginWarehouse,parseCatalog,readCatalogDocument,readOriginWarehouses,stockOrigins} from '../catalog/dataset.ts';
import {appendCostVersion} from '../finance/costs.ts';
import {createMovement} from '../inventory/positions.ts';
import {createTransfer,getTransfer,receiveTransfer,resolveTransfer} from '../inventory/transfers.ts';
import {cube,DEFAULT_OFFER_ASSUMPTIONS,readBerlapakSource,readContained,supplierPatterns} from './berlapak.ts';
import {stockSku} from './berlapak-identities.ts';

// DEC-005 generator (host-only): raw Berlapak snapshot -> committed, sanitized catalog dataset.
// Selection and public naming reuse the S69 reader; only public catalog facts are written (no
// HPP, stock or supplier fields). DEC-006: each offer carries its origin warehouse as an opaque
// key (hash of the supplier warehouse id); warehouses get generic names from kecamatan/city.
// Output is deterministic: stable ordering, no run timestamps, photos named by content hash,
// unchanged files are not rewritten.
export const defaultDatasetDir=defaultCatalogDatasetDir;
const IMAGE_LIMIT=5_000_000,PHOTO=/^[0-9a-f]{64}\.webp$/;
const byKey=(a:string,b:string)=>{const x=/^\d+$/.test(a),y=/^\d+$/.test(b);return x&&y?Number(a)-Number(b):x!==y?(x?-1:1):a<b?-1:a>b?1:0;};
// One-way, stable mapping key: the supplier's warehouse id never leaves the host snapshot.
export const originKey=(sourceWarehouseId:string)=>createHash('sha256').update(`99ribu:berlapak-warehouse:${sourceWarehouseId}`).digest('hex').slice(0,32);

// Marketplace-style departments (owner decision 2026-10-23, supersedes the snapshot departments):
// every product is classified by what it is, not by the supplier's category. Names follow
// Indonesian marketplace conventions (1-2 words), slugs are short kebab-case. `google` is the
// department's default Google product category; GOOGLE_RULES give a more specific node per product.
export const DEPARTMENTS=[
  {slug:'fashion-pria',name:'Fashion Pria',google:166},{slug:'fashion-wanita',name:'Fashion Wanita',google:166},
  {slug:'ibadah',name:'Perlengkapan Ibadah',google:5483},{slug:'kecantikan',name:'Kecantikan',google:2915},
  {slug:'kesehatan',name:'Kesehatan',google:491},{slug:'ibu-anak',name:'Ibu & Anak',google:166},
  {slug:'mainan-hobi',name:'Mainan & Hobi',google:1239},{slug:'rumah-tangga',name:'Rumah Tangga',google:536},
  {slug:'dapur',name:'Dapur',google:638},{slug:'elektronik',name:'Elektronik',google:222},
  {slug:'perkakas',name:'Perkakas',google:632},{slug:'otomotif',name:'Otomotif',google:5613},
  {slug:'hewan-peliharaan',name:'Hewan Peliharaan',google:2},{slug:'makanan-minuman',name:'Makanan & Minuman',google:412},
] as const satisfies readonly {slug:string;name:string;google:number}[];
type Department=(typeof DEPARTMENTS)[number]['slug'];
// A department below this size is merged or dropped by a taxonomy decision, never published thin.
export const MIN_CATEGORY_PRODUCTS=8;
// Classification text: the uncut public name plus the chosen variant, lower case. Each rule names
// product types; the rule matching EARLIEST in the name wins (the head noun leads Indonesian
// marketplace names: "Parfum Mobil ... Pengharum Ruangan" is car perfume, "Pengharum Ruangan &
// Mobil" is a room freshener), ties go to the earlier rule. `unless` vetoes a rule for one name.
// Fashion rules are gendered: a name stating one gender wins, else the supplier's gender
// department, else the rule's default (unisex adult apparel goes to Fashion Pria, as on
// Indonesian marketplaces; shapewear and bras to Fashion Wanita).
type Rule={slug:Department;pattern:RegExp;unless?:RegExp;gendered?:true};
const DEPARTMENT_RULES:readonly Rule[]=[
  {slug:'kesehatan',pattern:/anti mendengkur|kacamata (?:presbiopia|baca)|kaos kaki terapi|ankle support|korektor postur|penyangga bahu|sabuk pinggang terapi|terapi jari|akupuntur|suplemen|madu herbal|deker|terapi pemanas|kapsul|penggemuk|nafsu makan/},
  {slug:'hewan-peliharaan',pattern:/\b(?:lumipet|luminpet|lumino|kucing|anjing|anabul|bau hewan)\b/},
  {slug:'ibadah',pattern:/\b(?:peci|sarung(?! tangan)|al-?quran|surah|syariah|rompi shalat|rompi sholat|ruqyah|iqro)\b/},
  {slug:'otomotif',pattern:/\b(?:parfum mobil|mobil|motor|klx|crf|wr ?155|ktm|srx|trail|autocare|sepeda|cakram|aki|kendaraan|monoshock|kampas|kopling|pentil|foglamp|windshield|demon eye|car charger|baret)\b/},
  {slug:'makanan-minuman',pattern:/\b(?:madu|cuka|kurma|susu kuda|susu kambing|stevia|gula aren|matcha|nasi (?:kebuli|mandhi|biryani)|teh|kopi)\b/},
  // Books outside the Islamic shelf sit with hobbies (no book department yet).
  {slug:'mainan-hobi',pattern:/\bbuku\b/,unless:/\b(?:syariah|al-?quran|surah|iqro|islam\w*|ruqyah|tajwid|doa|sholat|shalat)\b/},
  {slug:'mainan-hobi',pattern:/\b(?:mainan|spinner|pipa lampu|pop tube|papan tulis|essen|umpan (?:pancing|mancing)|mancing|strike)\b/},
  {slug:'ibu-anak',pattern:/\b(?:anak|kids|bayi|nubiko|plush|boneka|tempat pensil|milk powder|tas les)\b/},
  {slug:'fashion-pria',gendered:true,pattern:/\bkaos\b(?! (?:kaki|anak|jersey))|\bbeanie\b|\bdompet\b|\bwallet\b|celana dalam|kacamata/},
  {slug:'fashion-wanita',gendered:true,pattern:/\bkorset\b|\bshapers?\b|\bstagen\b|\bsauna\b|\bbra\b/},
  // Single-product list 2026-10-31: women's dresses and headscarves (children's ones stay in Ibu & Anak), men's shirts and kurta.
  {slug:'fashion-wanita',gendered:true,pattern:/\bgamis\b|\bkaftan\b|\bdaster\b|\bpasmina\b|\bhijab\b|\bkerudung\b/,unless:/\banak\b/},
  {slug:'fashion-pria',gendered:true,pattern:/\bkemeja\b|\bkurta\b/},
  // Men's grooming tools (clipper, beard trimmer, shaver) are Fashion Pria, not Kecantikan (owner note 2026-10-25). Listed before
  // the Kecantikan rule, which also contains cukur/shaver/trimmer, so an equal match position goes to this rule.
  {slug:'fashion-pria',pattern:/\bbarber\b|\balat cukur\b|\bpencukur\b|\bshaver\b|\btrimmer\b/},
  {slug:'kecantikan',pattern:/\b(?:jawline|hidung|nose|bulu ?mata|eyelash|sabun|soap|cream|serum|moisturizer|setrika wajah|wajah|cukur|shaver|trimmer|gigi|catok(?:an)?|pelurus rambut|hair|rambut|shampoo|shampo|deodorant|deodoran|parfum|perfume|body mist|body cream|body wash|body booster|brush wood|kuas|make ?up|pouch|travel bottle|tumit|feminine|mouth ?spray|mouthwash|toothpaste|bekas luka|medinail|ketiak|pantat|kecantikan|kulit|cermin|booster|pemutih|alat pijat|balm|soothing gel)\b/},
  {slug:'elektronik',pattern:/\b(?:phone holder|laptop|antena|antenna|tv|senter|lampu led sensor|kipas angin|pembesar layar|penghemat listrik|mouse|pipa asbak|earphone|headset|tws|cctv|gps|korek api)\b/},
  {slug:'dapur',pattern:/\b(?:pisau|watermelon|pemotong sayuran|saringan|chopper|blender|tatakan kompor|oil pot|lunch ?box|bekal|coaster|tumbler|rak galon|mincer|shaker|timbangan dapur|teko|teapot|mug)\b/},
  {slug:'perkakas',pattern:/\b(?:lem|lakban|tape|waterproof agent|pompa|kunci|tang|gergaji|stapler|sarung tangan|timbangan|kaca pembesar|troli|dongkrak)\b/},
  {slug:'rumah-tangga',pattern:/floor drain|pembersih (?:pipa|lantai|kulkas|noda|toilet|tabung|multifungsi|minyak|sepatu)|gel pembersih|busa pembersih|saluran air|shoes cleaner|dishwash|deterjen|detergent|laundry|stain remover|semprotan air|water canon|spray gun|perangkap|tikus|kecoa|semut|pembasmi|pest reject|alat pel|\bmop\b|kemoceng|vacum|vacuum|polish|pengkilap|pengharum ruangan|reed diffuser|washing machine|gantungan|\bhook\b|sticker|stiker|pengangkat kasur|penghilang bulu pakaian|jam dinding|selang|payung|rak sepatu/},
  // Bags last: a lunch, school or cosmetic bag is classified by its purpose first.
  {slug:'fashion-pria',gendered:true,pattern:/\btas\b|\bbag\b|slingbag/,unless:/\b(?:anak|plush|boneka|bekal|lunch|cooler|make ?up|travel bottle)\b/},
];
// Supplier department as a weak prior: the gender of unisex fashion, and the fallback for a name
// no rule recognises. Mixed supplier departments give no prior (null); an unknown snapshot
// department refuses generation.
const SUPPLIER_PRIOR:Readonly<Record<string,Department|null>>={
  'kecantikan-dan-perawatan-diri':'kecantikan','fashion-dan-aksesoris-wanita':'fashion-wanita','fashion-dan-aksesoris-pria':'fashion-pria',
  'ibu-bayi-anak-dan-mainan':'ibu-anak','rumah-tangga-dan-kebersihan':'rumah-tangga','dapur-bekal-dan-botol-minum':'dapur',
  'otomotif-dan-perawatan-kendaraan':'otomotif','hewan-peliharaan-dan-akuarium':'hewan-peliharaan','hobi-lukis-dan-mancing':'mainan-hobi',
  'perkakas-lem-dan-elektronik-rumah':null,'makanan-minuman-dan-herbal-kesehatan':null,'fashion-muslim-ibadah-dan-buku-islami':null,
};
// Reviewed exceptions by offer key, guarded by the expected name so a changed snapshot refuses.
export const CATEGORY_OVERRIDES:Readonly<Record<string,{expect:string;slug:Department;reason:string}>>={
  'BND-17':{expect:'Paket Keamanan Rumah & Kendaraan',slug:'elektronik',reason:'Glue, hook and CCTV tie one each; the security the title promises is the CCTV camera.'},
};
const gender=(text:string,prior:Department|null,fallback:Department):Department=>{
  const pria=/\b(?:pria|cowok|laki|men)\b/.test(text),wanita=/\b(?:wanita|cewek|perempuan|women)\b/.test(text);
  return pria!==wanita?(pria?'fashion-pria':'fashion-wanita'):prior==='fashion-pria'||prior==='fashion-wanita'?prior:fallback;
};
// The product-type phrase a name is classified by (earliest rule match), e.g. "pengharum ruangan".
export function headTerm(name:string){
  const text=name.toLowerCase();let best:{term:string;at:number}|null=null;
  for(const rule of DEPARTMENT_RULES){if(rule.unless?.test(text)) continue;const m=rule.pattern.exec(text);if(m&&(!best||m.index<best.at)) best={term:m[0],at:m.index};}
  return best?.term??null;
}
// Department of one public name; null when no rule and no prior applies.
export function classifyName(name:string,prior:Department|null=null):{slug:Department;by:'rule'|'prior'}|null{
  const text=name.toLowerCase();let best:{rule:Rule;at:number}|null=null;
  for(const rule of DEPARTMENT_RULES){
    if(rule.unless?.test(text)) continue;const at=text.search(rule.pattern);
    if(at>=0&&(!best||at<best.at)) best={rule,at};
  }
  if(best) return {slug:best.rule.gendered?gender(text,prior,best.rule.slug):best.rule.slug,by:'rule'};
  return prior?{slug:prior,by:'prior'}:null;
}
// More specific Google product categories inside a department (first match wins).
const FASHION_GOOGLE:readonly [number,RegExp][]=[[212,/\bkaos\b/],[173,/beanie/],[2668,/dompet|wallet/],[213,/celana dalam/],[178,/kacamata/],
  [1578,/korset|shapers?\b|stagen|sauna/],[214,/\bbra\b/],[5181,/ocean bag/],[104,/waist bag/],[3032,/\btas\b|\bbag\b|slingbag/]];
const GOOGLE_RULES:Readonly<Record<Department,readonly [number,RegExp][]>>={
  'fashion-pria':[[533,/cukur|shaver|trimmer/],...FASHION_GOOGLE],'fashion-wanita':FASHION_GOOGLE,
  ibadah:[[543543,/\bbuku\b/]],
  kecantikan:[[6189,/mouth ?spray/],[3040,/mouthwash|obat kumur/],[1360,/pasta gigi|toothpaste/],[2527,/gigi palsu/],[484,/deodorant|deodoran/],
    [479,/parfum|perfume|body ?mist/],[5821,/feminine/],[2814,/hair color/],[6919,/travel bottle/],[2441,/shampo/],[3407,/catok|pelurus rambut|straightener/],[533,/cukur|shaver|trimmer/],
    [2780,/eyelash curler/],[2761,/bulu ?mata|eyelash/],[3025,/brush wood|kuas/],[476,/cermin|mirror/],[108,/pouch/],
    [7467,/pencuci wajah/],[471,/pijat|jade roller|massager|setrika wajah/],[3022,/tumit|kapalan/],[478,/medinail|kuku/],[2747,/body wash/],
    [2503,/soap bar|sabun/],[567,/cream|serum|moisturizer|lotion|gel\b|balm|booster|pemutih|bekas luka|pantat/]],
  kesehatan:[[6017,/mendengkur/],[524,/kacamata/],[471,/akupuntur|terapi jari|pijat/],[523,/ankle|korektor postur|penyangga bahu|sabuk pinggang/],
    [515,/kaos kaki terapi/],[525,/suplemen/],[4947,/madu/]],
  'ibu-anak':[[2271,/daster/],[212,/kaos|jersey/],[3062,/tempat pensil/],[5181,/\btas\b|\bbag\b/],[562,/susu anak/],[486,/hair lotion/],[537,/milk powder/]],
  'mainan-hobi':[[3603,/essen|umpan|strike|fishbite/],[3079,/papan tulis/],[4352,/mainan|spinner|pop tube|fidget/]],
  'rumah-tangga':[[3898,/pengharum|reed diffuser/],[504636,/floor drain/],[628,/shoes cleaner|sepatu/],[5705,/bulu pakaian/],[4657,/stain remover|pembersih noda|noda minyak/],[4975,/dishwash/],[2754,/deterjen|detergent|laundry|stain remover|noda|pakaian/],[1749,/pembersih pipa|saluran air/],
    [503773,/\bhook\b|gantungan/],[2631,/perangkap|jebakan/],[2869,/kecoa|semut|pembasmi/],[2865,/pest reject|pengusir/],
    [2713,/\bmop\b|alat pel|kemoceng/],[619,/vacum|vacuum/],[3840,/jam dinding/],[4358,/payung/],[5559,/rak sepatu/],
    [499919,/perhiasan|jewel/],[4201,/semprotan air|nozzle|water canon|spray gun/],[2313,/selang|hose/],[7330,/pembersih|polish|pengkilap|cleaner/]],
  dapur:[[752,/pengasah pisau/],[665,/pisau/],[652,/teko|teapot/],[653,/saringan|oil pot/],[669,/lunch ?box|bekal/],[2363,/coaster/],[2951,/tumbler/],[2169,/\bmug\b/],
    [7149,/rak galon/],[668,/chopper|blender|mincer|pemotong|slicer|tatakan kompor|shaker|timbangan/]],
  elektronik:[[505771,/earphone|headset|tws/],[5566,/phone holder|pembesar layar/],[1718,/antena|antenna/],[304,/mouse/],[6544,/gps/],[362,/cctv/],
    [2454,/senter kepala/],[543689,/senter/],[505826,/lampu led sensor/],[7527,/kipas/],[503774,/korek/],[600,/pipa asbak/],[5489,/laptop/]],
  perkakas:[[503742,/\blem\b|glue|waterproof agent|tape|lakban/],[5591,/sarung tangan/],[1698,/timbangan/],[941,/kaca pembesar/],[1167,/pompa|kunci|tang|gergaji|stapler/]],
  otomotif:[[2789,/parfum mobil|pengharum/],[2647,/windshield/],[3214,/lampu sepeda/],[6083,/gembok cakram/],[3318,/lampu|foglamp|pentil|demon eye/],
    [8231,/charger|\baki\b/],[8316,/tirai|anti panas/],[2643,/baret|penghitam|kompon|coumpond|cleaner|pembersih|autocare|salon/],
    [899,/klx|crf|wr ?155|ktm|srx|trail|kampas|baut|kopling|rantai|cover|monoshock|kabel gas|handle|bosh/]],
  'hewan-peliharaan':[[5002,/snack|cat strips/],[5161,/lumino/],[7319,/gunting kuku/],[6385,/sisir|comb|grooming gloves|slicker/],[6406,/shampo/],
    [503733,/bau hewan/],[7144,/tetes mulut/],[5001,/mainan|rotating ball|laser/],[5086,/obat|antibiotik|tetes|scabies/]],
  'makanan-minuman':[[4947,/madu/],[7528,/cuka/],[418,/susu/],[2073,/\bteh\b|matcha/],[1868,/kopi/],[431,/nasi/],[503734,/stevia|gula/],[6812,/kurma/]],
};
// Google Product Taxonomy (en-US), version 2021-09-21 as published at
// https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt (fetched 2026-10-23,
// sha256 30039729880ec5ac4851de088ad228a6898aa253f0de5d5ebea5bb1437478fce). Pinned: exactly the
// nodes this catalog uses, id -> full path copied from that file. Generation refuses any other id;
// when the snapshot ships the taxonomy file, every pinned pair is also checked against it.
export const GOOGLE_TAXONOMY_VERSION='2021-09-21';
export const GOOGLE_CATEGORIES:Readonly<Record<number,string>>={
  2:'Animals & Pet Supplies > Pet Supplies',
  104:'Luggage & Bags > Fanny Packs',
  108:'Luggage & Bags > Cosmetic & Toiletry Bags',
  166:'Apparel & Accessories',
  173:'Apparel & Accessories > Clothing Accessories > Hats',
  178:'Apparel & Accessories > Clothing Accessories > Sunglasses',
  212:'Apparel & Accessories > Clothing > Shirts & Tops',
  213:'Apparel & Accessories > Clothing > Underwear & Socks',
  214:'Apparel & Accessories > Clothing > Underwear & Socks > Bras',
  222:'Electronics',
  304:'Electronics > Electronics Accessories > Computer Components > Input Devices > Mice & Trackballs',
  362:'Cameras & Optics > Cameras > Surveillance Cameras',
  412:'Food, Beverages & Tobacco',
  418:'Food, Beverages & Tobacco > Beverages > Milk',
  431:'Food, Beverages & Tobacco > Food Items > Grains, Rice & Cereal',
  471:'Health & Beauty > Personal Care > Massage & Relaxation > Massagers',
  476:'Health & Beauty > Personal Care > Cosmetics > Cosmetic Tools > Makeup Tools > Face Mirrors',
  478:'Health & Beauty > Personal Care > Cosmetics > Nail Care',
  479:'Health & Beauty > Personal Care > Cosmetics > Perfume & Cologne',
  484:'Health & Beauty > Personal Care > Deodorant & Anti-Perspirant',
  486:'Health & Beauty > Personal Care > Hair Care',
  491:'Health & Beauty > Health Care',
  515:'Health & Beauty > Personal Care > Foot Care',
  523:'Health & Beauty > Health Care > Supports & Braces',
  524:'Health & Beauty > Personal Care > Vision Care > Eyeglasses',
  525:'Health & Beauty > Health Care > Fitness & Nutrition > Vitamins & Supplements',
  533:'Health & Beauty > Personal Care > Shaving & Grooming > Hair Clippers & Trimmers',
  536:'Home & Garden',
  537:'Baby & Toddler',
  562:'Baby & Toddler > Nursing & Feeding > Baby & Toddler Food',
  567:'Health & Beauty > Personal Care > Cosmetics > Skin Care',
  600:'Home & Garden > Smoking Accessories',
  619:'Home & Garden > Household Appliances > Vacuums',
  628:'Home & Garden > Household Supplies > Shoe Care & Tools',
  632:'Hardware',
  638:'Home & Garden > Kitchen & Dining',
  652:'Home & Garden > Kitchen & Dining > Tableware > Coffee Servers & Tea Pots',
  653:'Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils > Colanders & Strainers',
  665:'Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils > Kitchen Knives',
  668:'Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils',
  669:'Home & Garden > Kitchen & Dining > Food & Beverage Carriers > Lunch Boxes & Totes',
  752:'Home & Garden > Kitchen & Dining > Kitchen Appliances > Knife Sharpeners',
  899:'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts',
  941:'Office Supplies > Office Instruments > Magnifiers',
  1167:'Hardware > Tools',
  1239:'Toys & Games',
  1360:'Health & Beauty > Personal Care > Oral Care > Toothpaste',
  1578:'Apparel & Accessories > Clothing > Underwear & Socks > Shapewear',
  1698:'Hardware > Tools > Measuring Tools & Sensors > Measuring Scales',
  1718:'Electronics > Electronics Accessories > Antennas',
  1749:'Hardware > Building Consumables > Chemicals > Drain Cleaners',
  1868:'Food, Beverages & Tobacco > Beverages > Coffee',
  2073:'Food, Beverages & Tobacco > Beverages > Tea & Infusions',
  2169:'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs',
  2271:'Apparel & Accessories > Clothing > Dresses',
  2313:'Home & Garden > Lawn & Garden > Watering & Irrigation > Garden Hoses',
  2363:'Home & Garden > Kitchen & Dining > Barware > Coasters',
  2441:'Health & Beauty > Personal Care > Hair Care > Shampoo & Conditioner',
  2454:'Hardware > Tools > Flashlights & Headlamps > Headlamps',
  2503:'Health & Beauty > Personal Care > Cosmetics > Bath & Body > Bar Soap',
  2527:'Health & Beauty > Personal Care > Oral Care > Dentures',
  2631:'Home & Garden > Household Supplies > Pest Control > Pest Control Traps',
  2643:'Vehicles & Parts > Vehicle Parts & Accessories > Vehicle Maintenance, Care & Decor > Vehicle Cleaning > Vehicle Waxes, Polishes & Protectants',
  2647:'Vehicles & Parts > Vehicle Parts & Accessories > Vehicle Maintenance, Care & Decor > Vehicle Repair & Specialty Tools > Windshield Repair Kits',
  2668:'Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips',
  2713:'Home & Garden > Household Supplies > Household Cleaning Supplies > Mops',
  2747:'Health & Beauty > Personal Care > Cosmetics > Bath & Body > Body Wash',
  2754:'Home & Garden > Household Supplies > Laundry Supplies > Laundry Detergent',
  2761:'Health & Beauty > Personal Care > Cosmetics > Makeup > Eye Makeup > False Eyelashes',
  2780:'Health & Beauty > Personal Care > Cosmetics > Cosmetic Tools > Makeup Tools > Eyelash Curlers',
  2789:'Vehicles & Parts > Vehicle Parts & Accessories > Vehicle Maintenance, Care & Decor > Vehicle Decor > Vehicle Air Fresheners',
  2814:'Health & Beauty > Personal Care > Hair Care > Hair Color',
  2865:'Home & Garden > Household Supplies > Pest Control > Repellents',
  2869:'Home & Garden > Household Supplies > Pest Control > Pesticides',
  2915:'Health & Beauty > Personal Care',
  2951:'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Tumblers',
  3022:'Health & Beauty > Personal Care > Foot Care > Corn & Callus Care Supplies',
  3025:'Health & Beauty > Personal Care > Cosmetics > Cosmetic Tools > Makeup Tools > Makeup Brushes',
  3032:'Apparel & Accessories > Handbags, Wallets & Cases > Handbags',
  3040:'Health & Beauty > Personal Care > Oral Care > Mouthwash',
  3062:'Office Supplies > Filing & Organization > Pen & Pencil Cases',
  3079:'Toys & Games > Toys > Art & Drawing Toys > Toy Drawing Tablets',
  3214:'Sporting Goods > Outdoor Recreation > Cycling > Bicycle Accessories',
  3318:'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Lighting',
  3407:'Health & Beauty > Personal Care > Hair Care > Hair Styling Tools > Hair Straighteners',
  3603:'Sporting Goods > Outdoor Recreation > Fishing > Fishing Tackle > Fishing Baits & Lures',
  3840:'Home & Garden > Decor > Clocks > Wall Clocks',
  3898:'Home & Garden > Decor > Home Fragrances > Air Fresheners',
  4201:'Home & Garden > Lawn & Garden > Watering & Irrigation > Garden Hose Spray Nozzles',
  4352:'Toys & Games > Toys > Activity Toys',
  4358:'Home & Garden > Parasols & Rain Umbrellas',
  4657:'Home & Garden > Household Supplies > Laundry Supplies > Fabric Stain Removers',
  4947:'Food, Beverages & Tobacco > Food Items > Condiments & Sauces > Honey',
  4975:'Home & Garden > Household Supplies > Household Cleaning Supplies > Household Cleaning Products > Dish Detergent & Soap',
  5001:'Animals & Pet Supplies > Pet Supplies > Cat Supplies > Cat Toys',
  5002:'Animals & Pet Supplies > Pet Supplies > Cat Supplies > Cat Treats',
  5086:'Animals & Pet Supplies > Pet Supplies > Pet Medicine',
  5161:'Animals & Pet Supplies > Pet Supplies > Fish Supplies > Aquarium Water Treatments',
  5181:'Luggage & Bags',
  5483:'Apparel & Accessories > Clothing > Traditional & Ceremonial Clothing > Religious Ceremonial Clothing',
  5489:'Electronics > Electronics Accessories > Computer Accessories > Computer Risers & Stands',
  5559:'Home & Garden > Household Supplies > Storage & Organization > Clothing & Closet Storage > Shoe Racks & Organizers',
  5566:'Electronics > Communications > Telephony > Mobile Phone Accessories > Mobile Phone Stands',
  5591:'Business & Industrial > Work Safety Protective Gear > Safety Gloves',
  5613:'Vehicles & Parts > Vehicle Parts & Accessories',
  5705:'Home & Garden > Household Supplies > Laundry Supplies > Fabric Shavers',
  5821:'Health & Beauty > Personal Care > Feminine Sanitary Supplies > Feminine Douches & Creams',
  6017:'Health & Beauty > Personal Care > Sleeping Aids > Snoring & Sleep Apnea Aids',
  6083:'Vehicles & Parts > Vehicle Parts & Accessories > Vehicle Safety & Security > Vehicle Alarms & Locks > Motorcycle Alarms & Locks',
  6189:'Health & Beauty > Personal Care > Oral Care > Breath Spray',
  6385:'Animals & Pet Supplies > Pet Supplies > Pet Grooming Supplies > Pet Combs & Brushes',
  6406:'Animals & Pet Supplies > Pet Supplies > Pet Grooming Supplies > Pet Shampoo & Conditioner',
  6544:'Electronics > GPS Tracking Devices',
  6812:'Food, Beverages & Tobacco > Food Items > Fruits & Vegetables > Fresh & Frozen Fruits > Dates',
  6919:'Luggage & Bags > Luggage Accessories > Travel Bottles & Containers',
  7144:'Animals & Pet Supplies > Pet Supplies > Pet Oral Care Supplies',
  7149:'Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils > Beverage Dispensers',
  7319:'Animals & Pet Supplies > Pet Supplies > Pet Grooming Supplies > Pet Nail Tools',
  7330:'Home & Garden > Household Supplies > Household Cleaning Supplies > Household Cleaning Products > All-Purpose Cleaners',
  7467:'Health & Beauty > Personal Care > Cosmetics > Skin Care > Facial Cleansing Kits',
  7527:'Home & Garden > Household Appliances > Climate Control Appliances > Fans > Powered Hand Fans & Misters',
  7528:'Food, Beverages & Tobacco > Beverages > Vinegar Drinks',
  8231:'Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts > Motor Vehicle Power & Electrical Systems',
  8316:'Vehicles & Parts > Vehicle Parts & Accessories > Vehicle Maintenance, Care & Decor > Vehicle Covers > Motor Vehicle Windshield Covers',
  499919:'Health & Beauty > Jewelry Cleaning & Care > Jewelry Cleaning Solutions & Polishes',
  503733:'Animals & Pet Supplies > Pet Supplies > Pet Grooming Supplies > Pet Fragrances & Deodorizing Sprays',
  503734:'Food, Beverages & Tobacco > Food Items > Cooking & Baking Ingredients > Sugar & Sweeteners',
  503742:'Hardware > Building Consumables > Hardware Glue & Adhesives',
  503773:'Hardware > Hardware Accessories > Hooks, Buckles & Fasteners',
  503774:'Hardware > Tools > Lighters & Matches',
  504636:'Hardware > Plumbing > Plumbing Fixture Hardware & Parts > Drains',
  505771:'Electronics > Audio > Audio Components > Headphones & Headsets',
  505826:'Home & Garden > Lighting > Night Lights & Ambient Lighting',
  543543:'Media > Books > Print Books',
  543689:'Hardware > Tools > Flashlights & Headlamps > Flashlights',
};
// The snapshot's copy of the official taxonomy file, when present, must be the pinned version
// and agree with every pinned id -> path pair.
function checkGoogleTaxonomy(file:string){
  if(!existsSync(file)) return;
  const lines=readFileSync(file,'utf8').split('\n');
  if(lines[0]?.trim()!==`# Google_Product_Taxonomy_Version: ${GOOGLE_TAXONOMY_VERSION}`) throw new Error(`Snapshot Google taxonomy is not version ${GOOGLE_TAXONOMY_VERSION}; re-validate GOOGLE_CATEGORIES.`);
  const paths=new Map(lines.flatMap((line)=>{const m=/^(\d+) - (.+)$/.exec(line.trim());return m?[[Number(m[1]),m[2]] as const]:[];}));
  for(const [id,path] of Object.entries(GOOGLE_CATEGORIES)) if(paths.get(Number(id))!==path) throw new Error(`Pinned Google product category ${id} does not match the taxonomy file.`);
}
const googleFor=(slug:Department,text:string)=>GOOGLE_RULES[slug].find(([,pattern])=>pattern.test(text.toLowerCase()))?.[0]??null;

// Card titles (owner decision 2026-10-23): product cards show the title on one line, so a title
// keeps the product noun and its distinguishing attribute (variant, size, motif) within
// TITLE_LIMIT characters. Words are only removed, re-cased or moved, never invented (checked
// against the public name); the only addition is the multipack count, which the card would
// otherwise not show. The full public name stays in the stock item name (offer contents) and
// the description.
export const TITLE_LIMIT=40;
// Units: multi-letter ones may follow the number after a space ("450 ml"); single letters only
// attached ("5M"), since "CRF 150 L" is a model.
const UNIT=String.raw`(?:\s?(?:ml|gr|gram|kg|mg|cm|mm|meter|liter|inci|inch|mah|pcs)|[glm])`;
const SIZE=new RegExp(String.raw`(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?${UNIT.replace('|pcs','')}(?![\p{L}\p{N}])`,'giu');
// A list of sizes ("60ml & 20ml", "2 Liter, 5 10 15 20") removed as one unit.
const SIZE_LIST=new RegExp(String.raw`${SIZE.source}(?:\s*(?:&|dan|\+|,|/)?\s*\d+(?:[.,]\d+)?${UNIT.replace('|pcs','')}?(?![\p{L}\p{N}]))*`,'giu');
const UNITS=new RegExp(String.raw`(?<=\d)${UNIT}(?![\p{L}\p{N}])`,'giu');
// Marketplace filler: print/material boilerplate and claims that carry no product fact.
const NOISE=[/\bsablon(?:\s+depan)?(?:\s+belakang)?\b/giu,/\b(?:bahan\s+)?tc\s+combed\b/giu,/\bsize\s+\S+\s+sampai\s+\S+/giu,/\([^)]*\)/gu,/^[A-Z]\.\s+/u,
  /(?<![\p{L}\p{N}])(?:new|random|limited edition|high quality|berkualitas|import|trendy|stylish|ekslusif|eksklusif|authentic|serba ?guna|multifungsi|multifunctional|ukuran|wajib punya!?)(?![\p{L}\p{N}])/giu];
// A unit or multipack title names the item; the package itself is the offer.
const PACKAGE=/(?<![\p{L}\p{N}])(?:paket|bundling)(?![\p{L}\p{N}])/giu;
// Theme words of the slogan T-shirt family: the slogan itself is what tells them apart.
const SLOGAN=/(?<![\p{L}\p{N}])(?:kata|lucu|sindiran|plesetan)(?![\p{L}\p{N}])/giu;
// Indonesian title case keeps prepositions/conjunctions lower case inside a title.
const LOWER=new Set(['dan','atau','di','ke','dari','untuk','dengan','yang','pada','bagi','by','in','x']);
// Short words supplier titles shout, and lower-case acronyms; other capitals stay (KLX, CRF).
const SHOUTED=new Set(['bag','box','tas','rak','air','big','hot','oil','pot','set','isi','bio','dr','one','key','gun','bra','lem','man','up','abu','eye','as','pas','aki']);
const ACRONYM=new Set(['led','usb','lcd','uv','gps','cctv','hd','tv','hp','tws','cob','pu','ph','aha','dna','ac','dc','edp','sd']);
const DANGLING=/^(?:dan|atau|di|ke|dari|untuk|dengan|yang|pada|tanpa|anti|bukan|tapi|tetapi|kalau|kalo|jika|jangan|itu|ini|kamu|ada|alat|dia|tetap|hanya|kita|masih|aja|tidak|cuma|bisa|perlu|sebatas|seorang|mencerahkan|nempel|tempel|alas|&|\+|-|\/|x|in|for|the|with|and|of|to|model|isi|max)$/iu;
function tokenCase(word:string,first:boolean){
  const lower=word.toLowerCase(),plain=word.replace(/[^\p{L}]/gu,'');
  if(/^\d+in\d+$/i.test(word)) return lower;
  if(/^\d+d$/i.test(word)) return word.toUpperCase();
  if(ACRONYM.has(lower)) return word.toUpperCase();
  if(!plain||/\d/.test(word)) return word;
  if(!first&&LOWER.has(lower)) return lower;
  if(/^\p{Lu}+$/u.test(plain)&&!SHOUTED.has(plain.toLowerCase())) return word;
  if(/^\p{Lu}+$/u.test(plain)||/^\p{Ll}/u.test(word)) return word.charAt(0).toUpperCase()+word.slice(1).toLowerCase();
  return word;
}
const words=(value:string)=>value.replace(/\s+/g,' ').trim().split(' ').filter(Boolean);
const squash=(value:string)=>value.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function tidy(value:string,options:{slogan?:boolean;item?:boolean}={}){
  let v=value;for(const pattern of NOISE) v=v.replace(pattern,' ');
  if(options.slogan) v=v.replace(SLOGAN,' ');if(options.item) v=v.replace(PACKAGE,' ');
  v=v.replace(/\s+[-–|/]\s+|\s*\/\s+|\s+\/\s*|,\s+|\.\s+|\||(?<=\p{L})\/(?=\p{L})/gu,' ').replace(/(\d)\s+in\s+(\d)/giu,'$1in$2').replace(/\s+[!.,;:]+(?=\s|$)|[!,;:]+$/g,' ');
  const seen=new Set<string>();const out:string[]=[];
  const list=words(v);
  // Repeated model codes stay ("KLX 150 CRF 150 model CRF 250"); other repeated words go.
  for(const [i,word] of list.entries()){const key=squash(word);const model=/^\p{Lu}{2,5}$/u.test(word)&&/^\d+$/.test(list[i+1]??'');
    if(key.length>=2&&!/^\d+$/.test(key)&&seen.has(key)&&!model) continue;seen.add(key);out.push(tokenCase(word,!out.length));}
  return out.join(' ').replace(UNITS,(u)=>u.toLowerCase().replace(/mah$/,'mAh'));
}
// Whole words up to `limit`; words cut off leave no dangling connector or bare number behind.
function fit(value:string,limit:number){
  const all=words(value);const cut:string[]=[];for(const word of all){if([...cut,word].join(' ').length>limit) break;cut.push(word);}
  // A cut-off bare number counted the next word ("Mini 2 [Warna]") unless it ends a model ("GEN 4", "CRF 150").
  const loose=(i:number)=>/^\d+$/.test(cut[i])&&!/^(?:\p{Lu}{2,}|.*\d.*)$/u.test(cut[i-1]??'')||/^\d+$/.test(cut[i])&&/^\d+$/.test(cut[i-1]??'');
  if(cut.length<all.length) while(cut.length>1&&(DANGLING.test(cut[cut.length-1])||loose(cut.length-1))) cut.pop();
  return cut.join(' ').replace(/[\s,;:&+/-]+$/,'');
}
// Variant words not already named, or else the first size the full name states when the cut
// name lost it (e.g. "Teapot 750ml"). A bare number or "Random" variant says nothing on a card.
function attribute(base:string,variant:string|null){
  const named=new Set(words(base).map(squash));
  if(variant&&new RegExp(`^${SIZE.source}$`,'iu').test(variant.trim())){const size=tidy(variant);return words(base).some((w,i,all)=>squash(w)===squash(size)||squash(`${w}${all[i+1]??''}`)===squash(size))?'':size;}
  if(variant&&!variant.includes('/')){
    const v=words(tidy(variant)).filter((w)=>!named.has(squash(w))).join(' ');
    if(v&&v.length<=12&&/\p{L}/u.test(v)&&!/^(?:random|paket \d+)$/i.test(v)) return v;
  }
  return '';
}
// Appended attributes (variant, size, colour) follow a comma, as marketplaces list a chosen
// variation ("Hijau, L"): "Papan Tulis Tab untuk Anak, Hijau" never reads as part of the phrase.
export function cardTitle(full:string,options:{variant?:string|null;count?:number;item?:boolean;extra?:string;limit?:number;attribute?:false}={}){
  const limit=options.limit??TITLE_LIMIT;
  const slogan=/^kaos\s/i.test(full);let base=tidy(full,{slogan,item:options.item});
  const prefix=options.count&&options.count>1?(/^\d+\s?pcs\b/i.test(base)?`${options.count} × `:`${options.count} pcs `):'';
  const budget=limit-prefix.length,variant=options.variant??null;
  // The offer is one variant: a size variant replaces every size the listing names
  // ("60ml & 20ml" with variant 20ml -> ", 20ml"; "2 Liter, 5 10 15 20" -> ", 5 liter").
  const sizeVariant=!!variant&&new RegExp(`^${SIZE.source}$`,'iu').test(variant.trim());
  if(sizeVariant) base=tidy(base.replace(SIZE_LIST,' '));
  let attr=options.attribute===false?'':sizeVariant?tidy(variant as string):attribute(base,variant);
  const head=fit(base,budget);let floor=16;
  if(!attr&&options.attribute!==false){const lost=[...base.matchAll(SIZE)].map((m)=>m[0]);if(lost.length&&!new RegExp(SIZE.source,'iu').test(head)){attr=tidy(lost[0]);floor=24;}}
  const tail=(a:string)=>`${options.extra?` ${options.extra}`:''}${a?`, ${a}`:''}`;
  // An attribute that would cut the noun phrase too short is left to the offer contents.
  let named=tail(attr)?fit(base,budget-tail(attr).length):head;
  if(attr&&named.length<Math.min(floor,head.length)&&!options.extra){attr='';named=options.extra?fit(base,budget-tail('').length):head;}
  const title=`${prefix}${named}${tail(attr)}`;
  if(!named||title.length>limit) throw new Error(`Card title cannot be shortened: ${full}`);
  return title;
}
// Same-name or badly cut listings the rules cannot fix, by offer key, guarded by the expected
// name so a changed snapshot refuses instead of mislabeling another product. Words come from
// the public name, except where `evidence` cites the snapshot's own product description.
// `limit` (at most TITLE_HARD_LIMIT) is for the few products whose type + brand + variant cannot fit 40.
export const TITLE_HARD_LIMIT=48;
const TITLE_OVERRIDES:Readonly<Record<string,{expect:string;title:string;evidence?:string;limit?:number}>>={
  // The motorcycle models are what the part fits; the cut kept only the part name.
  // Supplier names lead with promotion or health claims; the title keeps the product and its size only.
  '1600':{expect:'Special Summit',title:'Nubiko Hair Lotion Baby Argan Oil, 100ml'},
  '1638':{expect:'SR12 Minyak Bulus',title:'SR12 Minyak Bulus'},
  '1698':{expect:'Supergoat Platinum',title:'Supergoat Platinum Susu Kambing Etawa, 200gr'},
  '1723':{expect:'Undertail stoplamp lazer',title:'Undertail Stoplamp LED CRF 150 / KLX 150'},
  '135':{expect:'Snap On Smile Gigi Palsu',title:'Snap On Smile Gigi Palsu Natural',evidence:'"Warna: Putih natural", worn as is'},
  '136':{expect:'Snap On Smile Gigi Palsu',title:'Snap On Smile Gigi Palsu + Cetakan',evidence:'"2 Cetakan Gigi", "2 Bahan Gigi Silicon"'},
  // The generation number is what separates the jawline trainers; the cut lost it.
  '79':{expect:'Jawline Exerciser Alat Latihan Rahang GEN 2',title:'Jawline Exerciser GEN 2, Biru'},
  '84':{expect:'Alat Pembentuk Rahang Jawline Exerciser GEN 10',title:'Jawline Exerciser GEN 10, Biru'},
  // The motif is what separates the kids' jerseys; the cut lost it.
  '400':{expect:'Harder Kaos Jersey Anak Berkerah Eat Play Repeat',title:'Harder Kaos Jersey Anak Eat Play Repeat'},
  '401':{expect:'Harder Kaos Jersey Anak Berkerah Finding My Path',title:'Harder Kaos Jersey Anak Finding My Path'},
  '402':{expect:'Harder Kaos Jersey Anak Berkerah Super Kids',title:'Harder Kaos Jersey Anak Super Kids, S'},
  // The first segment is a promotion label, not the product.
  '355':{expect:'Special Summit Mengantar - Nubiko Hair Lotion',title:'Nubiko Hair Lotion 100ml'},
  // A day cream + night moisturizer set; the cut showed it as the day cream alone (key 76).
  '191':{expect:'A. Paket Bundling Perfect Glow Protection Day cream & Moisturizer',title:'Perfect Glow Day Cream & Moisturizer',limit:48},
  // Title screening 2026-10-23: the generic cut lost the product type, brand/model or the
  // variant read wrong. Each title is product type + brand/model + the offer's own variant.
  '7':{expect:'Alat Penyok Perbaikan Penyot Mobil',title:'Alat Perbaikan Penyok Mobil'},
  '15':{expect:'Color Easy Spidol Penghilang Baret',title:'Color Easy Spidol Penghilang Baret, Merah',limit:48},
  '16':{expect:'Kacamata Hitam Wanita Frame',title:'Kacamata Hitam Wanita, Frame Putih',limit:48},
  '19':{expect:'Aluminium Foil Butyl Rubber Waterproof Tape',title:'Aluminium Foil Tape, 5 cm x 1 Meter',limit:48},
  '33':{expect:'Fingertip Clip Health Minifinger',title:'Alat Pijat Terapi Jari Mini'},
  // Model-fit variants: the offer is the part for one motorcycle model.
  '55':{expect:'Handle Kopling rem KLX 150 CRF 150',title:'Handle Rem, CRF 150'},
  '56':{expect:'Karet tahanan rantai KLX 150 CRF 150',title:'Karet Tahanan Rantai, KLX 150'},
  '89':{expect:'AS Roda Depan KLX 150 CRF 150',title:'As Roda Depan, KLX 150'},
  '68':{expect:'Parfum Mobil Kopi Bali Spray 30ml Summerspring',title:'Summerspring Parfum Mobil Kopi Bali, 30ml',limit:48},
  '110':{expect:'Parfum Mobil Kopi Bali Goni 35gr Summerspring',title:'Summerspring Parfum Mobil Kopi Bali Goni',limit:48},
  // "Botol Apel" is the bottle shape; the scent is the variant.
  '69':{expect:'Pengharum Ruangan & Mobil Botol Apel Summerspring',title:'Pengharum Ruangan Botol Apel, Black Coffee',limit:48},
  '87':{expect:'Phone Holder Tatakan HP Alas Mobil Dashboard',title:'Phone Holder Dashboard Mobil, Biru'},
  '119':{expect:'Lampu Tembak Laser Led Mini',title:'Lampu Tembak Foglamp Mini D2'},
  '142':{expect:'Jaysuing Invisible Waterproof Agent',title:'Jaysuing Waterproof Agent, 300g'},
  // Each pack holds the "2pcs depan" variant.
  '147':{expect:'Tirai Jaring Anti Nyamuk Pelindung Panas Kaca Mobil',title:'2pcs Tirai Kaca Mobil Depan'},
  '153':{expect:'Hy London Men Series Paper Sheet',title:'Hy London Paper Perfume, Felix'},
  '162':{expect:'GlowHome Semprotan Penghilang Bau Hewan',title:'GlowHome Penghilang Bau Hewan'},
  '169':{expect:'Zhongsanqing Spray Pembersih Minyak Lemak Dapur',title:'Zhongsanqing Pembersih Minyak Dapur'},
  '171':{expect:'GlowHome Cairan Pembersih Saluran Air',title:'GlowHome Pembersih Saluran Air, 500ml',limit:48},
  '178':{expect:'BIO Herbal Meilibahenling',title:'Bio Herbal Meilibahenling Bekas Luka',limit:48},
  '196':{expect:'Foreo Mini Luna 2',title:'Foreo Mini Luna 2 Pencuci Wajah, Biru',limit:48},
  '208':{expect:'Kaos Distro Pria Logo Monogram Huruf R Exoplanet',title:'Kaos Distro Logo R Exoplanet'},
  '257':{expect:'Jewel Magic 100ml',title:'Jewel Magic Pembersih Perhiasan, 100ml',limit:48},
  '270':{expect:'Pembesar Layar HP',title:'Pembesar Layar HP F6, Merah'},
  '302':{expect:'Kavela Flavor Fresh Calmelon Mouth Spray',title:'Kavela Mouth Spray Calmelon, 20 ml'},
  '398':{expect:'Kavela Flavor Fresh Lychee Love Mouth Spray',title:'Kavela Mouth Spray Lychee Love, 20 ml'},
  '363':{expect:'SR12 Gomilku Box',title:'SR12 Gomilku Susu Kambing, Cokelat 200 Gram',limit:48},
  '313':{expect:'Waist Bag Unicorn',title:'Waist Bag Unicorn Anak, Gradasi'},
  // Title screening (manual review): the cut ended on a qualifier or lost the noun's meaning.
  // 11: the variant is the lens power (+2).
  '11':{expect:'Kacamata Presbiopia Baca Super Plus',title:'Kacamata Presbiopia Baca, Plus 2'},
  '20':{expect:'Lem Serbaguna Oily Glue',title:'Lem Oily Glue Cepat Kering, 20ml'},
  '25':{expect:'Windshield Repair Kit Glass Lem Kaca Mobil',title:'Windshield Repair Kit Kaca Mobil'},
  '181':{expect:'Windshield Repair Kit Glass LEM Kaca Mobil',title:'Windshield Repair Kit Kaca Mobil'},
  '29':{expect:'Semprotan AIR Cuci Motor Hose',title:'Semprotan Air Cuci Motor Mobil'},
  '38':{expect:'tutup pentil led',title:'Tutup Pentil Ban LED'},
  '39':{expect:'Ankle Support',title:'Ankle Support Liton Deker 8624'},
  '47':{expect:'Saringan Sudut Wastafel',title:'Saringan Sudut Wastafel, Biru'},
  '61':{expect:'Alat Pel Pembersih Ruangan',title:'Alat Pel Mini Mop Portable'},
  '65':{expect:'Korek Api Elektrik',title:'Korek Api Elektrik USB Touch Sensor'},
  '78':{expect:'Hatch N Grow',title:'Hatch N Grow Mainan Telur Dino'},
  '80':{expect:'Lumipet Natural Scabies Spray',title:'Lumipet Natural Scabies Spray'},
  // 85: unisex; the cut read as men only.
  '85':{expect:'Korset Pelangsing Perut Pria Wanita',title:'Korset Pelangsing Perut Pria Wanita, M',limit:48},
  '90':{expect:'HD Digital Antenna',title:'HD Digital Antenna Dalam Rumah'},
  '91':{expect:'Lumipet Pet Grooming Gloves',title:'Lumipet Pet Grooming Gloves'},
  '104':{expect:'Hyper Strike Essen',title:'Hyper Strike Essen Ikan'},
  '125':{expect:'Kacamata Baca Plus Auto Focus',title:'Kacamata Baca Auto Focus, Oval'},
  '129':{expect:'Alat Cukur Rambut Vintage T9',title:'Alat Cukur Rambut T9 Motif Naga'},
  '141':{expect:'GlowHome Pembersih Tabung Mesin Cuci',title:'GlowHome Pembersih Tabung Mesin Cuci',limit:48},
  '146':{expect:'Sticker Stiker leather',title:'Stiker Kulit Sofa Jok, Beige'},
  '148':{expect:'Pasta Gigi Nasa',title:'Pasta Gigi Nasa'},
  '157':{expect:'Cover rangka KLX 150',title:'Cover Rangka KLX 150, Hijau'},
  '179':{expect:'Kaca Pembesar LED 4B-3',title:'Kaca Pembesar LED 4B-3'},
  '204':{expect:'Small Size Lunch BOX',title:'Lunch Box Tas Bekal Small Size, Abu'},
  '261':{expect:'Fathaha Lunch BOX',title:'Fathaha Lunch Box Tas Bekal, Brown'},
  // 251: the offer is the 5-pcs variant, not the 20-pcs listing.
  '251':{expect:'KBA2 Paket Daster Anak',title:'5 pcs KBA2 Daster Anak Mix'},
  // 253: the offer is the shampoo variant only.
  '253':{expect:'The Caviar Shampoo & Conditioner',title:'The Caviar Shampoo Perawatan Rambut',limit:48},
  '258':{expect:'Tang Dekrustasi Kabel Pengupas',title:'Tang Pengupas Kabel'},
  '274':{expect:'Pelurus rambut lurus portabel',title:'Pelurus Rambut Mini USB, Ungu'},
  '276':{expect:'Tali Penyangga Bahu Korektor Postur',title:'Korektor Postur Penyangga Bahu, M'},
  '281':{expect:'Sling Bag Plush Character',title:'Sling Bag Boneka Plush'},
  '292':{expect:'Mouse Wireless Rechargeable',title:'Mouse Wireless Rechargeable, Silver',limit:48},
  '299':{expect:'RAK Sepatu Zigzag 4 Susun',title:'Rak Sepatu Zigzag 4 Susun'},
  // 325: the stripped supplier name left "Indriana by Make Up".
  '325':{expect:'Pouch Indriana',title:'Pouch Make Up Indriana Kecil, Black'},
  '327':{expect:'Shaker Cocoflim 400ML',title:'Botol Shaker Cocoflim 400ml, Blue'},
  '342':{expect:'Alat Penghalus Tumit Kaki',title:'Alat Penghalus Tumit Kaki Elektrik'},
  '344':{expect:'Buku Menghafalkan Al-Quran',title:'Buku Strategi Menghafalkan Al-Quran'},
  // 350: the tasbih is a free extra, not a product variant.
  '350':{expect:'Kurma 500gr',title:'Kurma 500gr + Tasbih Cendana'},
  '354':{expect:'Lovaboo Hair Color',title:'Lovaboo Hair Color, Brownish Black'},
  '359':{expect:'KDK 3in1 Alat Pijat',title:'KDK 3in1 Alat Pijat Leher Electric'},
  '360':{expect:'Tas Les Anak Waterproof',title:'Tas Les Anak Waterproof, Navy Space'},
  '362':{expect:'Zyno Susu Anak Tinggi Gizi',title:'Zyno Susu Anak Tinggi Gizi'},
  '374':{expect:'Snap On Smile Toothpaste',title:'Snap On Smile Toothpaste, 100 gram'},
  '420':{expect:'Kampas Kopling KLX 150 Kain Klos',title:'Kampas Kopling Kain Klos, KLX 150'},
  '435':{expect:'Bright Glow Body Wash 250ml',title:'Bright Glow Body Wash 250ml'},
  '475':{expect:'Pelacak GPS Mini GF07',title:'Pelacak GPS Mini GF07'},
  '417':{expect:'Reed Diffuser Pengharum Ruangan Aromatherapy Summerspring',title:'Summerspring Reed Diffuser, Coffee Bean'},
  'BND-05':{expect:'Paket Rumah Bebas Bau Pipis Kucing + 20 Pcs Snack Oyisi',title:'Paket Bebas Bau Pipis Kucing + Snack Oyisi',limit:48},
  'BND-23':{expect:'Paket Mobil & Ruangan Wangi Kopi Bali Summerspring',title:'Paket Mobil & Ruangan Kopi Bali Summerspring',limit:48},
  '444':{expect:'Gendes Sweet Aromatic Feminine Care Wash Foam Coco Pandan',title:'Gendes Feminine Wash Coco Pandan, 50 ml'},
  '446':{expect:'Gendes Sweet Aromatic Feminine Care Wash Foam Grape',title:'Gendes Feminine Wash Grape, 50 ml'},
  '455':{expect:'Gendes Sweet Aromatic Feminine Care Wash Foam Vanilla',title:'Gendes Feminine Wash Vanilla, 50 ml'},
  // One word over the limit; the brand goes, the claim stays.
  'BND-21':{expect:'Paket Sabun & Deterjen Organik Ramah Bayi',title:'Paket Sabun & Deterjen Ramah Bayi 4-in-1'},
};
// A product with variant offers is titled without its variant values: the option labels name
// them. Words that differ between the labels (sizes, colours, model codes; not words every label
// shares, nor bare numbers) leave the seller's name, with the joiners between them ("60ml & 20ml")
// and a "Size"/"Ukuran" label before them. Filler goes first, so "Size S sampai 5XL" stays one phrase.
const JOINER=/^(?:&|\/|,|\+|-|x|dan|atau)$/iu,LABEL=/^(?:size|ukuran|warna)$/iu;
export function withoutVariants(full:string,choices:readonly string[]){
  if(choices.length<2) return full;
  const sets=choices.map((c)=>new Set(c.split(/[\s/]+/u).map(squash).filter(Boolean)));
  const varying=new Set(sets.flatMap((set)=>[...set]).filter((t)=>!/^\d+$/.test(t)&&!sets.every((set)=>set.has(t))));
  let v=full;for(const pattern of NOISE) v=v.replace(pattern,' ');
  const list=words(v);
  const gone=list.map((w)=>{const parts=w.split(/[/&,+]/u).map(squash).filter(Boolean);return parts.length>0&&parts.every((t)=>varying.has(t));});
  return list.filter((w,i)=>!gone[i]&&!(JOINER.test(w)&&(gone[i-1]||gone[i+1]))&&!(LABEL.test(w)&&gone[i+1])).join(' ');
}
// Unique words of each same-title listing (first run), so a collision reads e.g. "Grape".
function distinguishing(group:readonly string[]){
  const tokens=group.map((t)=>words(tidy(t)));
  return tokens.map((mine,i)=>{const others=new Set(tokens.filter((_,j)=>j!==i).flat().map(squash));
    const start=mine.findIndex((w)=>!others.has(squash(w)));if(start<0) return '';
    const run:string[]=[];for(const w of mine.slice(start)){if(others.has(squash(w))) break;run.push(w);}return run.join(' ');});
}
// Card title per offer key. Refuses a word the public name does not contain and two equal
// titles in one category (each needs a real distinguishing attribute or a reviewed override).
export function cardTitles(source:Pick<ReturnType<typeof readBerlapakSource>,'stocks'|'offers'>,departmentOf:(key:string)=>string=(key)=>source.offers.find((o)=>o.key===key)?.category??''){
  const stocks=new Map(source.stocks.map((s)=>[s.key,s]));
  const input=source.offers.map((o)=>{const stock=o.kind==='bundle'?undefined:stocks.get(o.parts[0].stock);
    const full=stock?.title??o.name,choices=stock?.image?source.stocks.filter((s)=>s.rank===stock.rank&&s.image).map((s)=>s.choice??s.variant??''):[];
    return {key:o.key,category:departmentOf(o.key),full,name:withoutVariants(full,choices),variant:stock?.variant??null,count:o.kind==='multipack'?o.parts[0].quantity:undefined,item:o.kind!=='bundle',hasVariants:!!stock?.image};});
  type Input=(typeof input)[number];
  // A unit or multipack title keeps the product-type phrase its department was chosen by; the
  // attribute gives way first, and a title that still loses it needs a reviewed override.
  const lost:string[]=[];
  const keeps=(x:Input,title:string)=>{const term=x.item?headTerm(`${x.full} ${x.variant??''}`):null;return !term||squash(title).includes(squash(tidy(term)));};
  const make=(x:Input,extra?:string)=>{const override=TITLE_OVERRIDES[x.key];
    if(!override){
      const title=cardTitle(x.name,{variant:x.variant,count:x.count,item:x.item,extra,...(x.hasVariants?{attribute:false as const}:{})});if(keeps(x,title)) return title;
      const bare=cardTitle(x.full,{count:x.count,item:x.item,extra,attribute:false});if(keeps(x,bare)) return bare;
      lost.push(`${x.key} "${title}" (${headTerm(`${x.full} ${x.variant??''}`)})`);return title;
    }
    if(!x.full.startsWith(override.expect)) throw new Error(`Title override ${x.key} no longer matches its product; review TITLE_OVERRIDES.`);
    // The override's own ", attribute" survives tidying.
    const [name,attr='']=override.title.split(', ');const tail=!x.hasVariants&&attr?`, ${tidy(attr)}`:'';
    const base=x.hasVariants?words(name).filter((w)=>squash(x.full).includes(squash(w))).join(' '):name;
    return `${cardTitle(base,{count:x.count,item:x.item,limit:(override.limit??TITLE_LIMIT)-tail.length,attribute:false})}${tail}`;};
  const titles=new Map(input.map((x)=>[x.key,make(x)]));
  const groupKey=(x:Input)=>`${x.category}\n${(titles.get(x.key) as string).toLowerCase()}`;
  const groups=Map.groupBy(input,groupKey);
  for(const group of groups.values()) if(group.length>1){
    const extras=distinguishing(group.map((x)=>`${x.name} ${x.variant??''}`));
    group.forEach((x,i)=>{if(!TITLE_OVERRIDES[x.key]&&extras[i]) titles.set(x.key,make(x,extras[i]));});
  }
  // Only titles still in use count (a collision re-titles its group).
  const losing=lost.filter((entry)=>[...titles.values()].some((t)=>entry.includes(`"${t}"`)));
  if(losing.length) throw new Error(`Card titles lose their product type; add reviewed TITLE_OVERRIDES entries: ${[...new Set(losing)].join('; ')}`);
  for(const group of Map.groupBy(input,groupKey).values()) if(group.length>1) throw new Error(`Duplicate card title in one category: ${titles.get(group[0].key)}; add a reviewed TITLE_OVERRIDES entry.`);
  for(const x of input){
    const known=squash(`${x.full} ${x.variant??''} ${TITLE_OVERRIDES[x.key]?.evidence?TITLE_OVERRIDES[x.key].title:''}`);
    const title=titles.get(x.key) as string;
    const invented=words(title.replace(/^\d+ (?:pcs|×) /,'')).filter((w)=>squash(w)&&!known.includes(squash(w)));
    if(invented.length) throw new Error(`Card title ${title} adds words not in the product name: ${invented.join(', ')}`);
  }
  return titles;
}

// Product details (owner decision 2026-10-23): the supplier's marketplace description, tidied
// deterministically. Lines are dropped, never rewritten, when they carry no product fact: seller
// promises and policies, contact/links, stock and shipping notes, rating requests, supplier,
// store or manufacturer names, and bare superlatives. Kept lines lose emoji and decoration,
// shouting is re-cased, units and bullets are normalized. Health/efficacy claims are kept as
// written and reported (`claims`) for the owner's content-compliance backlog (DEC-013).
const BOILERPLATE=/https?:|www\.|\.com\b|\.id\b|drive\.google|marketing ?kit|whats ?app|\bwa\b|\bchat\b|hubungi|\badmin\b|\btoko\b|\bstore\b|\bshop\b|\border\b|pesan sekarang|checkout|\bready\b|\bstok\b|\bstock\b|\bcod\b|termurah|\bmurah\b|\bpromo\b|diskon|ongkir|grosir|reseller|dropship|happy shopping|selamat berbelanja|bintang ?5|bintang lima|ulasan|\breview\b|\brating\b|garansi|uang kembali|komplain|complain|unboxing|\bvideo\b|\bpacking\b|packaging aman|bubble ?wrap|dikirim|pengiriman|\bkirim\b|ekspedisi|\bkurir\b|\bresi\b|membeli ?=|mambeli ?=|beli ?=|tanggung jawab|etalase|\biklan\b|katalog|harga (?:bersaing|terbaik|terjangkau|murah|grosir)|kenapa harus|mengapa harus|best ?seller|terlaris|\blaris\b|dijamin asli|produk asli|\bsegel\b|kualitas terbaik|tidak mengecewakan|\bwelcome\b|terima ?ka(?:si|is)h|thank|\bfollow\b|sebelum jam|hari yang sama|keterangan size|tanpa keterangan|\bdeskripsi\b|happy|limited|terbatas|buruan|jangan sampai kehabisan|kehabisan|\bviral\b|\bhits\b|sold ?out|\bpo\b|pre ?order|penggiriman|super cepat|sesuai (?:foto|gambar)|terjangkau/iu;
const PUFFERY=/\b(?:best ?seller|terlaris|super premium|premium)\b/giu;
const MAKER=/diproduksi|produksi oleh|\bdistribut|manufactur|\bimportir\b|imported by|\bpt\.?\s|\bcv\.?\s|\bproduced by\b/iu;
const SUPERLATIVE=/terbaik|terlaris|terpercaya|nomor ?1|\bno\.? ?1\b|kualitas (?:premium|tinggi|super)|berkualitas|\bpremium\b|grade tertinggi|paling (?:laris|dicari|murah)|andalan|mewah|berkelas/iu;
// Words a photo alt never repeats from a title: body-shaping, whitening and efficacy claims.
const ALT_CLAIMS=/(?<![\p{L}\p{N}])(?:pelangsing|pembakar lemak|anti botak|ampuh|tirus|glowing|whitening|pemutih|detox|imun|meniruskan|mencegah|mencerahkan)(?![\p{L}\p{N}])/giu;
// Claim terms (owner compliance backlog): efficacy, cure, body-shaping and guarantee language.
export const CLAIM_TERMS=/menyembuhkan|\bsembuh|mengobati|\bampuh|terbukti|berkhasiat|khasiat|memperbesar|keperkasaan|\bkronis|detoks|\bdetox|membakar lemak|pelangsing|melangsingkan|mengecilkan|meniruskan|permanen|tanpa operasi|anti ?aging|awet muda|penuaan|memutihkan|whitening|glowing|bebas efek samping|before|after|kanker|diabetes|kolesterol|hipertensi|asam urat|\bimun|daya tahan tubuh|kesuburan|hasrat|stamina|mengatasi|meredakan|membunuh (?:kuman|bakteri)|99[.,]9 ?%|100 ?%/giu;
const DECORATION=/\u{FE0F}|\u{200D}|\u{20E3}|[\p{Extended_Pictographic}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}★☆✓✔✗✘●○◆◇■□▪▫►▶◀▲▼•·※♡♥❤]/gu;
const BULLET=/^\s*(?:[-–—*•·~>+]+|[\u{2600}-\u{27BF}\u{1F300}-\u{1FAFF}✓✔☑●○◆◇■□▪▫►▶※♡♥❤]+)\s*/u;
const UNIT_FIX:readonly [RegExp,string][]=[[/(\d)\s*(?:ml|mL|ML|Ml)\b/g,'$1 ml'],[/(\d)\s*(?:gr|GR|Gr|gram|Gram|GRAM|grm)\b/g,'$1 gr'],[/(\d)\s*(?:kg|KG|Kg)\b/g,'$1 kg'],
  [/(\d)\s*(?:cm|CM|Cm)\b/g,'$1 cm'],[/(\d)\s*(?:mm|MM|Mm)\b/g,'$1 mm'],[/(\d)\s*(?:pcs|PCS|Pcs|pc|PC|Pc)\b/g,'$1 pcs']];
// Re-case a shouting word, keeping short acronyms (TC, DTF, LED, POM) and model codes.
const SHORT_CAPS=new Set([...ACRONYM,'dtf','pom','bpom','pvc','mdf','spf','bha','tcm','abs','sni','ce','tc','ab','qd','md','ml']);
const keepCaps=(word:string)=>{const letters=word.replace(/[^\p{L}]/gu,'');return /\d/.test(word)||!/^\p{Lu}+$/u.test(letters)||letters.length<=2||SHORT_CAPS.has(letters.toLowerCase());};
const recase=(word:string)=>{if(keepCaps(word)||word.replace(/[^\p{L}]/gu,'').length<4) return word;const lower=word.toLowerCase();return lower.charAt(0).toUpperCase()+lower.slice(1);};
// Merchant feeds cap descriptions at 5,000 characters; product text stays below that.
export const DETAILS_LIMIT=4500;
export function cleanDetails(raw:string,options:{suppliers:readonly RegExp[];names:readonly string[];warehouses:readonly string[]}){
  const claims=new Set<string>();const out:string[]=[];let skipMaker=false;
  const seen=new Set(options.names.map((n)=>squash(n)));const titleWords=new Set(options.names.flatMap((n)=>words(n).map(squash)));
  for(const original of raw.normalize('NFC').replace(/\r/g,'').split('\n')){
    let line=original.replace(/\t/g,' ');const bullet=BULLET.test(line)||/^\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(line);
    line=line.replace(BULLET,'').replace(DECORATION,' ').replace(PUFFERY,' ').replace(/\s+/g,' ').trim();
    for(const pattern of options.suppliers) line=line.replace(pattern,' ').replace(/\s+/g,' ').trim();
    if(!line||!/[\p{L}\p{N}]/u.test(line)){skipMaker=false;if(out.length&&out[out.length-1]!=='') out.push('');continue;}
    const lower=line.toLowerCase();
    if(MAKER.test(line)){skipMaker=true;continue;}
    if(skipMaker&&line.length<=40&&!/[:\d]/.test(line)) continue;skipMaker=false;
    if(BOILERPLATE.test(line)||options.warehouses.some((w)=>lower.includes(w))) continue;
    if(SUPERLATIVE.test(line)&&!/\d/.test(line)&&line.length<=90) continue;
    if(/[!?]$/.test(line)&&line.length<=80&&!/\d/.test(line)) continue;
    if(/^(?:bahan(?: produk)?:\s*)?(?:100 ?% ?)?(?:original|ori|asli)\.?$/iu.test(line)) continue;
    const own=words(line).map(squash).filter(Boolean);if(own.length>=3&&own.every((w)=>titleWords.has(w))) continue;
    if(seen.has(squash(line))) continue;seen.add(squash(line));
    // Shouting: a mostly upper-case line becomes sentence case; elsewhere single shouted words.
    const letters=line.replace(/[^\p{L}]/gu,''),upper=letters.replace(/[^\p{Lu}]/gu,'').length;
    let tokens=line.split(' ');
    if(letters.length>=6&&upper/letters.length>0.7){const lowered=tokens.map((w)=>keepCaps(w)?w:w.toLowerCase());
      const i=lowered.findIndex((w)=>/\p{L}/u.test(w));if(i>=0) lowered[i]=lowered[i].charAt(0).toUpperCase()+lowered[i].slice(1);tokens=lowered;}
    else tokens=tokens.map(recase);
    line=tokens.join(' ').replace(/\s+([,.;:!?])/g,'$1').replace(/([!?.]){2,}/g,'$1').replace(/\s*\(\s*\)\s*/g,' ').trim();
    for(const [pattern,unit] of UNIT_FIX) line=line.replace(pattern,unit);
    for(const m of line.matchAll(CLAIM_TERMS)) claims.add(m[0].toLowerCase());
    out.push(bullet&&!/:$/.test(line)&&!/^\d+[.)]\s/.test(line)?`- ${line}`:line);
  }
  // Collapse blank runs; drop headings left without a body (a line ending in ':' followed by a blank or nothing).
  // List items separated by blank lines read as one list.
  const lines=out.join('\n').replace(/\n{3,}/g,'\n\n').replace(/^((?:- |\d+[.)] ).*)\n\n(?=(?:- |\d+[.)] ))/gmu,'$1\n').replace(/^((?:- |\d+[.)] ).*)\n\n(?=(?:- |\d+[.)] ))/gmu,'$1\n').trim().split('\n');
  const kept=lines.filter((line,i)=>!(/:$/.test(line)&&(i===lines.length-1||lines[i+1]==='')));
  return {text:kept.join('\n').replace(/\n{3,}/g,'\n\n').trim(),claims:[...claims].sort()};
}

// Department and Google product category of every offer. Units and multipacks are classified
// by their stock item's uncut public name and variant; a bundle by its dominant component purpose
// (component departments weighted by quantity; a tie is broken by the bundle's own name, and an
// unresolved tie refuses so a reviewed CATEGORY_OVERRIDES entry decides). Refuses an unknown
// snapshot department, an override naming no offer or a changed product, and any unclassified offer.
export function classifyOffers(source:Pick<ReturnType<typeof readBerlapakSource>,'categories'|'stocks'|'offers'>,options:{requireOverrides?:boolean}={}){
  const priors=new Map(source.categories.map((c)=>{
    if(!Object.hasOwn(SUPPLIER_PRIOR,c.slug)) throw new Error(`Snapshot category ${c.slug} has no department prior; add it to SUPPLIER_PRIOR.`);
    return [c.code,SUPPLIER_PRIOR[c.slug]];}));
  const keys=new Set(source.offers.map((o)=>o.key));
  if(options.requireOverrides!==false) for(const key of Object.keys(CATEGORY_OVERRIDES)) if(!keys.has(key)) throw new Error(`Category override ${key} names no offer in the snapshot; review CATEGORY_OVERRIDES.`);
  const stocks=new Map(source.stocks.map((s)=>[s.key,s]));
  const named=(key:string)=>{const s=stocks.get(key) as (typeof source.stocks)[number];return {text:`${s.title} ${s.variant??''}`.trim(),found:classifyName(`${s.title} ${s.variant??''}`,priors.get(s.category)??null)};};
  const result=new Map<string,{slug:Department;by:'rule'|'prior'|'bundle'|'override';google:number}>();const unclassified:string[]=[];
  for(const o of source.offers){
    const prior=priors.get(o.category)??null,override=CATEGORY_OVERRIDES[o.key];
    const fallback=(slug:Department)=>DEPARTMENTS.find((d)=>d.slug===slug)?.google as number;
    if(override){
      if(!o.name.startsWith(override.expect)) throw new Error(`Category override ${o.key} no longer matches its product; review CATEGORY_OVERRIDES.`);
      result.set(o.key,{slug:override.slug,by:'override',google:fallback(override.slug)});continue;
    }
    if(o.kind!=='bundle'){
      const {text,found}=named(o.parts[0].stock);if(!found){unclassified.push(`${o.key} ${o.name}`);continue;}
      result.set(o.key,{slug:found.slug,by:found.by,google:googleFor(found.slug,text)??fallback(found.slug)});continue;
    }
    const weight=new Map<Department,number>();
    for(const part of o.parts){const {found}=named(part.stock);if(found) weight.set(found.slug,(weight.get(found.slug)??0)+part.quantity);}
    const top=Math.max(0,...weight.values()),tied=[...weight].filter(([,n])=>n===top).map(([slug])=>slug);
    const own=classifyName(o.name,prior)?.slug;
    const slug=tied.length===1?tied[0]:own&&tied.includes(own)?own:null;
    if(!slug){unclassified.push(`${o.key} ${o.name} (tie: ${tied.join(', ')||'none'})`);continue;}
    result.set(o.key,{slug,by:'bundle',google:fallback(slug)});
  }
  if(unclassified.length) throw new Error(`Unclassified products; extend DEPARTMENT_RULES or CATEGORY_OVERRIDES: ${unclassified.join('; ')}`);
  return result;
}

export type BerlapakDataset={catalog:CatalogDocument;text:string;manifest:ManifestDocument;photos:Map<string,{bytes:Buffer;width:number;height:number}>;skipped:Record<string,number>};
// `minimumPerCategory`/`requireOverrides` exist for small synthetic snapshots in tests only; the
// catalog command always uses the defaults.
// `stockNames`: stock item names already committed (immutable rows once imported); an item keeps its committed name
// when the snapshot renames it.
export function buildBerlapakDataset(sourceDir:string,options:{minimumPerCategory?:number;requireOverrides?:boolean;stockNames?:ReadonlyMap<string,string>}={}):BerlapakDataset{
  const raw=readBerlapakSource(sourceDir);
  const source={...raw,stocks:raw.stocks.map((s)=>{const name=options.stockNames?.get(stockSku(s.key));return name&&name!==s.name?{...s,name}:s;})};
  const groups=Map.groupBy(source.offers,(o)=>o.productKey);
  const products=[...groups].map(([key,offers])=>({...offers[0],key}));
  const productSource={...source,offers:products};
  const departments=classifyOffers(productSource,options);
  const counts=new Map<string,number>();for(const d of departments.values()) counts.set(d.slug,(counts.get(d.slug)??0)+1);
  const thin=[...counts].filter(([,n])=>n<(options.minimumPerCategory??MIN_CATEGORY_PRODUCTS));
  if(thin.length) throw new Error(`Departments below the minimum of ${options.minimumPerCategory??MIN_CATEGORY_PRODUCTS} products: ${thin.map(([slug,n])=>`${slug} (${n})`).join(', ')}; merge or drop them in DEPARTMENTS.`);
  for(const d of departments.values()) if(!Object.hasOwn(GOOGLE_CATEGORIES,d.google)) throw new Error(`Google product category ${d.google} is not in the pinned taxonomy snapshot; add it from the official file.`);
  checkGoogleTaxonomy(join(sourceDir,'data-json','google-product-taxonomy-en-US.txt'));
  for(const d of DEPARTMENTS) if(!Object.hasOwn(GOOGLE_CATEGORIES,d.google)) throw new Error(`Google product category ${d.google} is not in the pinned taxonomy snapshot; add it from the official file.`);
  const slug=(key:string)=>(departments.get(key) as {slug:Department}).slug;
  const titles=cardTitles({...productSource,stocks:source.stocks.map((s)=>s.image?{...s,variant:null}:s)},slug);
  // The pre-shortening public name stays readable on the product page: unit and multipack
  // descriptions already name the stock item; a shortened bundle's description gains its name.
  // Product page text: the offer contents, then the tidied supplier details of the item. A bundle
  // adds each component's details under its name only when all of them fit DETAILS_LIMIT.
  // A supplier warehouse called by a short or everyday word ("SK", "Rumah") names nothing private; matching it would
  // drop ordinary detail lines and refuse ordinary product text, so only distinctive names are screened.
  const warehouseNames=[...new Set(source.stocks.map((s)=>s.warehouse.name.toLowerCase().trim()))].filter((n)=>n.length>=4&&!/^(?:rumah|gudang|toko|kantor)$/.test(n));
  const suppliers=supplierPatterns(source.supplierNames);
  const details=new Map(source.stocks.map((s)=>[s.key,cleanDetails(s.details,{suppliers,names:[s.title,s.name],warehouses:warehouseNames})]));
  const describe=(o:(typeof source.offers)[number])=>{
    const variants=groups.get(o.productKey) as (typeof source.offers);
    const head=o.kind==='bundle'&&titles.get(o.key)!==o.name?`${o.name}\n${o.description}`:o.kind==='bundle'||!variants.some((v)=>v.image)?o.description:
      `Pilihan paket:\n${variants.map((v)=>`- ${v.label}`).join('\n')}\nHarga Rp99.000 untuk satu paket lengkap sesuai pilihan varian.`;
    const parts=o.parts.map((p)=>({name:(source.stocks.find((s)=>s.key===p.stock) as (typeof source.stocks)[number]).name,text:details.get(p.stock)?.text??''})).filter((p)=>p.text);
    const body=o.kind==='bundle'?parts.map((p)=>`${p.name}\n${p.text}`).join('\n\n'):parts[0]?.text??'';
    const full=body?`${head}\n\n${body}`:head;
    return full.length<=DETAILS_LIMIT?full:o.kind==='bundle'?head:(()=>{throw new Error(`Product ${o.key} details exceed ${DETAILS_LIMIT} characters; tighten cleanDetails.`);})();
  };
  // Photo alt text (image SEO, owner decision 2026-10-23): the clean card title, ", foto N" from
  // the second photo; a bundle photo names the component it shows. Claim terms and anything past
  // 125 characters are left out.
  const stockByRank=new Map(source.stocks.map((s)=>[s.rank,s]));
  const componentTitle=(rank:number)=>{const s=source.stocks.find((s)=>s.key===String(rank))??stockByRank.get(rank) as (typeof source.stocks)[number];
    try{return cardTitle(s.title,{variant:s.variant,item:true});}catch{return fit(tidy(s.name,{item:true}),TITLE_LIMIT);}};
  const altText=(o:(typeof source.offers)[number],rank:number,index:number)=>{
    const base=o.kind==='bundle'?componentTitle(rank):titles.get(o.key) as string;
    const clean=base.replace(ALT_CLAIMS,' ').replace(/\s+/g,' ').replace(/\s+,/g,',').replace(/\s+[&+]\s*$/,'').trim();
    const alt=o.kind!=='bundle'&&index?`${clean}, foto ${index+1}`:clean;return alt.length<=125?alt:fit(alt,125);};
  const photos=new Map<string,{bytes:Buffer;width:number;height:number}>();const byFile=new Map<string,string>();
  const photo=(rank:number,file:string)=>{
    const candidates=source.stocks.filter((s)=>s.rank===rank);
    const image=candidates.flatMap((s)=>[...s.images,...(s.image?[s.image]:[])]).find((i)=>i.file===file);
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
    categories:DEPARTMENTS.filter((d)=>counts.has(d.slug)).map((d)=>({slug:d.slug,name:d.name,google_product_category:d.google})).sort((a,b)=>byKey(a.slug,b.slug)),warehouses,
    stock_items:[...source.stocks].sort((a,b)=>a.rank-b.rank||byKey(a.key,b.key)).map((s)=>({sku:stockSku(s.key),name:s.name})),
    products:[...products].sort((a,b)=>byKey(a.key,b.key)).map((o)=>{
      const offers=groups.get(o.key) as (typeof source.offers);
      // Every sold variant photo precedes the shared gallery. Hash deduplication keeps the
      // photo in its first position; each offer points to that same frozen gallery image.
      const candidates:{rank:number;file:string;choice?:string}[]=[...offers.flatMap((v)=>v.image?[{...v.image,...(v.choice?{choice:v.choice}:{})}]:[]),...offers.flatMap((v)=>v.images.filter((i)=>!v.image||i.file.startsWith('img-')))];
      const seen=new Set<string>();
      const gallery=candidates.flatMap((i)=>{const sha256=photo(i.rank,i.file);if(seen.has(sha256)) return [];seen.add(sha256);
        const alt=i.choice?`${titles.get(o.key) as string}, ${i.choice}`.replace(ALT_CLAIMS,' ').replace(/\s+/g,' ').replace(/\s+,/g,',').trim():altText(o,i.rank,seen.size-1);
        return [{sha256,alt:alt.length<=125?alt:fit(alt,125)}];}).slice(0,20);
      // A variant whose photo does not fit the 20-photo gallery (many colour x size variants) shows the shared gallery
      // instead; its own photo is never replaced by another variant's.
      const definitions=offers.map((offer)=>{const side=cube(offer.grams),image=offer.image?photo(offer.image.rank,offer.image.file):null;return {
        sku:`B99_${offer.key}_OFFER`,label:offer.label,kind:offer.kind,image:image&&gallery.some((p)=>p.sha256===image)?image:null,
        warehouse:originKey(offer.warehouse),weight_grams:offer.grams,length_mm:side,width_mm:side,height_mm:side,
        contents:offer.parts.map((p)=>({stock_item:stockSku(p.stock),quantity:p.quantity})).sort((a,b)=>byKey(a.stock_item,b.stock_item))};});
      return {key:o.key,name:titles.get(o.key) as string,description:describe(o),category:slug(o.key),
        ...(()=>{const d=departments.get(o.key) as {slug:Department;google:number};
          return d.google===DEPARTMENTS.find((x)=>x.slug===d.slug)?.google?{}:{google_product_category:d.google};})(),photos:gallery,offers:definitions};})};
  const referenced=new Set(catalog.products.flatMap((p)=>p.photos.map((i)=>i.sha256)));
  for(const hash of photos.keys()) if(!referenced.has(hash)) photos.delete(hash);
  parseCatalog(catalog);
  const text=`${JSON.stringify(catalog,null,2)}\n`;
  // Sanitization gate: refuse output that names a supplier or a supplier warehouse in public
  // product text, or carries a raw supplier warehouse id anywhere. Warehouse entries are built
  // from kecamatan/city/province only (DEC-006).
  const productText=JSON.stringify([catalog.categories,catalog.stock_items,catalog.products]);const lower=productText.toLowerCase();
  if(supplierPatterns(source.supplierNames).some((p)=>p.test(productText))||warehouseNames.some((n)=>lower.includes(n))||source.stocks.some((s)=>text.includes(s.warehouse.id)))
    throw new Error('Refusing dataset: a supplier or supplier-warehouse name would be published.');
  const catalogSha256=createHash('sha256').update(text).digest('hex');
  const manifest:ManifestDocument={format:MANIFEST_FORMAT,catalog_sha256:catalogSha256,
    photos:[...photos].sort(([a],[b])=>a<b?-1:1).map(([sha256,p])=>({sha256,bytes:p.bytes.length,width:p.width,height:p.height}))};
  return {catalog,text,manifest,photos,skipped:source.skipped};
}

export function writeBerlapakDataset(sourceDir:string,outDir=defaultDatasetDir,options:{minimumPerCategory?:number;requireOverrides?:boolean}={}){
  const committed=existsSync(join(outDir,'catalog.json'))?readCatalogDocument(outDir).stock_items:[];
  const built=buildBerlapakDataset(sourceDir,{...options,stockNames:new Map(committed.map((s)=>[s.sku,s.name]))});const photoDir=join(outDir,'photos');mkdirSync(photoDir,{recursive:true});
  const write=(path:string,bytes:Buffer|string)=>{const next=Buffer.from(bytes);if(existsSync(path)&&readFileSync(path).equals(next)) return false;writeFileSync(path,next);return true;};
  let written=0,removed=0;
  for(const [hash,p] of built.photos) if(write(join(photoDir,`${hash}.webp`),p.bytes)) written++;
  // Only generator-owned hash-named photos that the new manifest no longer references.
  for(const name of readdirSync(photoDir)) if(PHOTO.test(name)&&!built.photos.has(name.slice(0,64))){unlinkSync(join(photoDir,name));removed++;}
  const catalogWritten=write(join(outDir,'catalog.json'),built.text),manifestWritten=write(join(outDir,'manifest.json'),`${JSON.stringify(built.manifest,null,2)}\n`);
  return {dir:outDir,catalog_sha256:built.manifest.catalog_sha256,categories:built.catalog.categories.length,warehouses:built.catalog.warehouses.length,stock_items:built.catalog.stock_items.length,
    products:built.catalog.products.length,offers:built.catalog.products.reduce((n,p)=>n+p.offers.length,0),bundles:built.catalog.products.filter((p)=>p.offers[0].kind==='bundle').length,photos:built.photos.size,
    photo_bytes:[...built.photos.values()].reduce((n,p)=>n+p.bytes.length,0),catalog_written:catalogWritten,manifest_written:manifestWritten,photos_written:written,photos_removed:removed,skipped:built.skipped};
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
export async function loadInitialStock(request:Request,identity:LocalAuth,options:{sourceDir:string;datasetDir?:string;signal?:AbortSignal;scope?:(catalog:CatalogDocument)=>CatalogDocument}){
  const {signal}=options;signal?.throwIfAborted();const config=readRuntimeConfig(process.env);assertOrigin(request);
  const catalog=(options.scope??((c:CatalogDocument)=>c))(readCatalogDocument(options.datasetDir??defaultDatasetDir)),source=readBerlapakSource(options.sourceDir);
  if(source.snapshot!==catalog.source_snapshot) throw new CatalogDatasetError(`Raw snapshot ${source.snapshot} is not the committed dataset snapshot ${catalog.source_snapshot}; run catalog:dataset and catalog:import first.`);
  const principal=await getPrincipal(request,identity);await identity.sql.begin((tx)=>lockOwner(tx,principal));
  const reserved=await identity.sql.reserve();
  try{
    const lockKey='99ribu:catalog-initial-stock';
    const [lock]=await reserved`select pg_try_advisory_lock(hashtextextended(${lockKey},0)) as ok`;
    if(!lock.ok) throw new CatalogDatasetError('Another initial stock load is running; retry after it finishes.');
    try{
      // Resolve the opaque per-variant key, never a suffix parsed as a product rank. Test
      // datasets may namespace the B99 prefix, but retain the complete identity suffix.
      const byKey=new Map(source.stocks.map((s)=>[stockSku(s.key).slice(4),s]));
      const items=catalog.stock_items.map((s)=>{const key=s.sku.slice(s.sku.indexOf('_')+1),item=byKey.get(key);
        if(!item) throw new CatalogDatasetError(`Raw snapshot cannot resolve catalog stock item ${s.sku}; regenerate the dataset first.`);
        return {...item,sku:s.sku};});
      const offerSkus=catalog.products.flatMap((p)=>p.offers.map((o)=>o.sku));const origins=stockOrigins(catalog);
      const warehouses=await readOriginWarehouses(identity.sql,catalog.warehouses);
      const stocks=new Map((await identity.sql`select id,sku from app.stock_item where sku in ${identity.sql(items.map((s)=>s.sku))}`).map((r)=>[r.sku as string,r.id as string]));
      const offers=await identity.sql`select id,sku from app.offer where sku in ${identity.sql(offerSkus)}`;
      // A product the import preserved (operator-edited) keeps its existing offers and gets no new
      // variant offers; those are reported, not fatal. A product with no imported offer is not imported.
      const imported=new Set(offers.map((o)=>o.sku as string));
      const notImported=catalog.products.filter((p)=>p.offers.some((o)=>imported.has(o.sku))).flatMap((p)=>p.offers.filter((o)=>!imported.has(o.sku)).map((o)=>o.sku));
      if(warehouses.size!==catalog.warehouses.length||stocks.size!==items.length||offers.length+notImported.length!==offerSkus.length) throw new CatalogDatasetError(`Catalog not imported yet (${warehouses.size}/${catalog.warehouses.length} origin warehouses, ${stocks.size}/${items.length} stock items, ${offers.length}/${offerSkus.length} offers); run catalog:import first.`);
      const command=(step:string)=>{const next=new Request(`${config.origin}/api/v1/admin/catalog-initial-stock`,{method:'POST',headers:request.headers});
        next.headers.set('idempotency-key',createHash('sha256').update(`catalog-initial-stock:${source.snapshot}:${step}`).digest('hex'));return next;};
      const summary={snapshot:source.snapshot,warehouses:warehouses.size,stock_items:items.length,
        receive:{received:0,units:0,zero:0,existing:0,capped:0,differs_from_snapshot:0,outside_origin:0},hpp:{appended:0,existing:0,differs_from_snapshot:0},assumptions:{appended:0,existing:0},offers_not_imported:notImported};
      for(const item of items){
        signal?.throwIfAborted();const stockId=stocks.get(item.sku) as string;const warehouseId=warehouses.get(origins.get(item.sku) as string) as string;
        const [history]=await identity.sql`select count(*) filter (where revision>0)::int as touched,coalesce(sum(on_hand),0)::int as on_hand,
          coalesce(sum(on_hand) filter (where warehouse_id<>${warehouseId}),0)::int as outside from app.inventory_balance where stock_item_id=${stockId}`;
        const quantity=Math.min(item.stock,RECEIVE_LIMIT);
        let received=false;
        // A product without stock is catalogued as a draft: nothing to receive, HPP still recorded.
        if(history.touched===0&&quantity===0) summary.receive.zero++;
        else if(history.touched===0){
          try{await createMovement(command(`receive:${warehouseId}:${item.sku}`),identity,principal,{warehouse_id:warehouseId,stock_item_id:stockId,lot_id:null,kind:'receive',quantity,
            expected_version:0,reason:`Initial stock from supplier snapshot ${source.snapshot}`});received=true;}
          catch(error){if(!(error instanceof AccessError)||error.code!=='VERSION_CONFLICT') throw error;}
        }
        if(received){summary.receive.received++;summary.receive.units+=quantity;if(quantity<item.stock) summary.receive.capped++;}
        else if(history.touched>0||quantity>0){summary.receive.existing++;if(history.on_hand!==item.stock) summary.receive.differs_from_snapshot++;if(history.outside>0) summary.receive.outside_origin++;}
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
    left join app.warehouse w on w.id=v.default_warehouse_id where o.sku in ${sql(catalog.products.flatMap((p)=>p.offers.map((o)=>o.sku)))}`;
  const wanted=new Map(catalog.products.flatMap((p)=>p.offers.map((o)=>[o.sku,o.warehouse] as const)));
  const moved=offers.filter((o)=>o.origin_key!==wanted.get(o.sku));
  return {warehouses:{catalog:catalog.warehouses.length,existing:existing.length,to_create:catalog.warehouses.length-existing.length,conflicts},
    stock_items:stock,units,from,open_transfers:open.length,
    offers:{catalog:wanted.size,imported:offers.length,at_origin:offers.length-moved.length,to_rebind:moved.filter((o)=>o.owned).length,
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
