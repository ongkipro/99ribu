import type {Sql,TransactionSql} from 'postgres';
import {productionShipping,readRuntimeConfig,runtimeTarget} from '../../config/runtime.ts';
import {AccessError} from '../access/policy.ts';
import {integer,object} from '../catalog/validation.ts';
import {clean,normalizePhone,shippingFixture} from './address.ts';
import {districtEntry,groupDistricts,rankDistricts,type AreaMatch,type DistrictEntry} from './area-search.ts';

// S95: where checkout destinations come from. Local and test keep the TEST-ONLY fixture; production with
// SHIPPING_ADAPTER=mengantar reads Mengantar's own area catalogue (app.shipping_area, loaded from
// data/shipping/mengantar-areas.json), so the destination id is the area id Mengantar quotes and books with.
// Production with shipping disabled has no destinations: checkout answers SHIPPING_UNAVAILABLE.
export type DestinationSource='TEST-ONLY'|'mengantar';
// version/source travel with the destination so an address can be canonicalised without another read.
export type Destination={id:string;label:string;province:string;city:string;district:string;subdistrict:string;postal_code:string;version:string;source:DestinationSource};
type Db=Sql|TransactionSql;

// DEC-028 / S164: where Mengantar-shaped rates come from. Production: the official origin and key. Local or test with
// LOCAL_PROVIDER_ORIGIN: the loopback stand-in with the literal key `local` (never a credential). Otherwise null.
export function shippingProvider(env:NodeJS.ProcessEnv=process.env){
 const config=readRuntimeConfig(env);
 if(config.profile==='production') return productionShipping(env);
 return config.providerOrigin?{provider:'mengantar' as const,baseUrl:config.providerOrigin,apiKey:'local',standIn:true as const}:null;
}
export function destinationSource():DestinationSource{
 // Local provider mode reuses production's catalogue path (app.shipping_area) and adapter; unset keeps the fixture.
 if(runtimeTarget()!=='production') return shippingProvider()?'mengantar':'TEST-ONLY';
 if(!productionShipping(process.env)) throw new AccessError(503,'SHIPPING_UNAVAILABLE');
 return 'mengantar';
}
const fixtureDestinations=():Destination[]=>{const f=shippingFixture();return f.destinations.map(d=>({...d,version:f.version,source:'TEST-ONLY' as const}));};
// Mengantar writes names in capitals ("JAKARTA SELATAN", "BOGOR BARAT - KOTA"); buyers read them title-cased.
// "DKI" and "DI" (Daerah Istimewa) and a bracketed short form ("(NAD)", "(NTT)") are initialisms, not words (S176).
export const areaTitle=(value:string)=>value.toLocaleLowerCase('id-ID').replace(/(^|[\s(/-])(\p{L})/gu,(_,lead:string,letter:string)=>lead+letter.toLocaleUpperCase('id-ID')).replace(/^Dki\b/,'DKI').replace(/^Di\b/,'DI').replace(/\((\p{L}{2,4})\)/gu,abbreviation=>abbreviation.toLocaleUpperCase('id-ID'));
const title=areaTitle;
type AreaRow={id:string;province:string;city:string;district:string;subdistrict:string;postal_code:string;dataset_version:string};
function fromArea(row:AreaRow):Destination{
 const [province,city,district,subdistrict]=[row.province,row.city,row.district,row.subdistrict].map(title);
 return {id:row.id,label:[subdistrict,district,city,province].filter(Boolean).join(', ')+(row.postal_code?` ${row.postal_code}`:''),province,city,district,subdistrict,postal_code:row.postal_code,version:row.dataset_version,source:'mengantar'};
}

export async function findDestination(sql:Db,id:unknown):Promise<Destination|null>{
 if(typeof id!=='string') return null;
 if(destinationSource()==='TEST-ONLY') return fixtureDestinations().find(d=>d.id===id)??null;
 if(!/^[0-9a-f]{24}$/.test(id)) return null;
 const [row]=await sql<AreaRow[]>`select id,province,city,district,subdistrict,postal_code,dataset_version from app.shipping_area where id=${id}`;
 return row?fromArea(row):null;
}
// What a checkout view lists before any search: the kelurahan of the chosen area's kecamatan (so the kelurahan picker
// can switch within it), or nothing. Never kelurahan of several kecamatan (owner 2026-11-05), fixture included.
export async function initialDestinations(sql:Db,selected:string):Promise<Destination[]>{
 return selected?districtAreas(sql,selected):[];
}

// A kecamatan as the checkout's type-ahead lists it. `id` is one of its area ids (the smallest), accepted by
// districtAreas; names are title-cased; postal_codes are the distinct codes of its kelurahan. `match`: the kelurahan
// it was found by when the query matched a kelurahan name or postal code rather than the kecamatan (2026-11-05);
// `single` says no other kelurahan of the kecamatan shares that postal code, so picking it can choose the kelurahan.
export type DestinationDistrict={id:string;label:string;province:string;city:string;district:string;postal_codes:string[];areas:number;
 match?:{area_id:string;subdistrict:string;postal_code:string;kind:'kelurahan'|'postcode';single:boolean}};
const toDistrict=(entry:DistrictEntry&{match:AreaMatch|null}):DestinationDistrict=>{
 const [province,city,district]=[entry.province,entry.city,entry.district].map(title);
 return {id:entry.id,label:[district,city,province].join(', '),province,city,district,postal_codes:entry.postal_codes,areas:entry.areas,
  ...(entry.match?{match:{area_id:entry.match.id,subdistrict:title(entry.match.subdistrict),postal_code:entry.match.postal_code,kind:entry.match.kind,single:entry.match.single}}:{})};
};
// lazy: the ~7k catalogue kecamatan, with each kelurahan's id, name and postal code, are matched in memory (one
// grouped read of app.shipping_area every 5 minutes, a few MB)
// because a per-keystroke normalising scan of ~80k rows costs 200-300 ms; rows added meanwhile appear on the next
// refresh. Upgrade path: a generated compact-name column with a trigram index.
let catalogue:{at:number;entries:Promise<DistrictEntry[]>}|null=null,lastGood:DistrictEntry[]|null=null;
const CATALOGUE_TTL=300_000;
// Stale-while-revalidate (2026-11-06): after the first load no buyer waits for the ~1 s grouped read again; an expired
// copy answers while the refresh runs, and a failed refresh keeps the last good copy.
function catalogueDistricts(sql:Db){
 if(catalogue&&Date.now()-catalogue.at<CATALOGUE_TTL) return lastGood?Promise.resolve(lastGood):catalogue.entries;
 const entries=sql<{id:string;province:string;city:string;district:string;postal_codes:string[];areas:number;ids:string[];subdistricts:string[];codes:string[]}[]>`select min(id) as id,province,city,district,
  array_agg(distinct postal_code order by postal_code) as postal_codes,count(*)::int as areas,
  array_agg(id order by subdistrict,id) as ids,array_agg(subdistrict order by subdistrict,id) as subdistricts,array_agg(postal_code order by subdistrict,id) as codes
  from app.shipping_area group by province,city,district`.then(rows=>rows.map(({ids,subdistricts,codes,...row})=>districtEntry({...row,members:ids.map((id,i)=>({id,subdistrict:subdistricts[i],postal_code:codes[i]}))})));
 const current={at:Date.now(),entries};catalogue=current;
 entries.then(value=>{lastGood=value;},()=>{if(catalogue===current)catalogue=null;});
 return lastGood?Promise.resolve(lastGood):entries;
}
export async function searchDistricts(sql:Db,query:string,limit=8):Promise<DestinationDistrict[]>{
 const search=clean(query,100);integer(limit,1,20);
 const entries=destinationSource()==='TEST-ONLY'?groupDistricts(fixtureDestinations()):await catalogueDistricts(sql);
 return rankDistricts(entries,search,limit).map(toDistrict);
}
// Every kelurahan in the kecamatan of area `id` (any of its areas), by name. Unknown ids answer an empty list.
export async function districtAreas(sql:Db,id:string,limit=100):Promise<Destination[]>{
 integer(limit,1,100);
 if(destinationSource()==='TEST-ONLY'){
  const anchor=fixtureDestinations().find(d=>d.id===id);if(!anchor) return [];
  return fixtureDestinations().filter(d=>d.province===anchor.province&&d.city===anchor.city&&d.district===anchor.district).slice(0,limit);
 }
 // One read: an unknown or malformed id joins nothing.
 if(!/^[0-9a-f]{24}$/.test(id)) return [];
 const rows=await sql<AreaRow[]>`select a.id,a.province,a.city,a.district,a.subdistrict,a.postal_code,a.dataset_version from app.shipping_area a
  join app.shipping_area anchor on anchor.id=${id} and a.province=anchor.province and a.city=anchor.city and a.district=anchor.district
  order by a.subdistrict,a.id limit ${limit}`;
 return rows.map(fromArea);
}

// Every word must appear somewhere in kelurahan, kecamatan, city, province or postal code. lazy: an ILIKE scan over
// ~80k rows per lookup (a submitted search, not per keystroke); upgrade path: pg_trgm GIN index if it shows up.
export async function searchDestinations(sql:Db,query:string,limit=20):Promise<Destination[]>{
 const search=clean(query,100).toLocaleLowerCase('id-ID');integer(limit,1,100);
 if(destinationSource()==='TEST-ONLY') return fixtureDestinations().filter(d=>`${d.label} ${d.province} ${d.city} ${d.district} ${d.subdistrict} ${d.postal_code}`.toLocaleLowerCase('id-ID').includes(search)).slice(0,limit);
 const words=search.split(/[\s,]+/).filter(w=>w.length>=2).slice(0,6).map(w=>`%${w.replace(/[\\%_]/g,'\\$&')}%`);
 if(!words.length) return [];
 const rows=await sql<AreaRow[]>`select id,province,city,district,subdistrict,postal_code,dataset_version from app.shipping_area
  where ${words.reduce((where,word)=>sql`${where} and lower(subdistrict||' '||district||' '||city||' '||province||' '||postal_code) like ${word}`,sql`true`)}
  order by district,subdistrict,city,id limit ${limit}`;
 return rows.map(fromArea);
}

// The canonical address stored on a quote: the buyer's fields plus the destination's names, version and source.
export function canonicalAddress(value:unknown,destination:Destination|null|undefined){
 const body=object(value,['recipient_name','phone','address_line','destination_id','postal_code']);
 const recipient=clean(body.recipient_name,200);const street=clean(body.address_line,500);const phone=normalizePhone(body.phone);
 if(!destination||destination.id!==body.destination_id) throw new AccessError(422,'DESTINATION_UNAVAILABLE');
 if(body.postal_code!==destination.postal_code) throw new AccessError(422,'DESTINATION_POSTCODE_MISMATCH');
 return {recipient_name:recipient,phone,address_line:street,destination_id:destination.id,postal_code:destination.postal_code,
  province:destination.province,city:destination.city,district:destination.district,subdistrict:destination.subdistrict,
  destination_version:destination.version,source:destination.source};
}
export async function normalizeAddress(sql:Db,value:unknown){
 const destination=value&&typeof value==='object'?await findDestination(sql,(value as {destination_id?:unknown}).destination_id):null;
 return canonicalAddress(value,destination);
}
export type NormalizedAddress=ReturnType<typeof canonicalAddress>;
