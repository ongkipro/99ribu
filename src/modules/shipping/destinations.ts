import type {Sql,TransactionSql} from 'postgres';
import {productionShipping,runtimeTarget} from '../../config/runtime.ts';
import {AccessError} from '../access/policy.ts';
import {integer,object} from '../catalog/validation.ts';
import {clean,normalizePhone,shippingFixture} from './address.ts';

// S95: where checkout destinations come from. Local and test keep the TEST-ONLY fixture; production with
// SHIPPING_ADAPTER=mengantar reads Mengantar's own area catalogue (app.shipping_area, loaded from
// data/shipping/mengantar-areas.json), so the destination id is the area id Mengantar quotes and books with.
// Production with shipping disabled has no destinations: checkout answers SHIPPING_UNAVAILABLE.
export type DestinationSource='TEST-ONLY'|'mengantar';
// version/source travel with the destination so an address can be canonicalised without another read.
export type Destination={id:string;label:string;province:string;city:string;district:string;subdistrict:string;postal_code:string;version:string;source:DestinationSource};
type Db=Sql|TransactionSql;

export function destinationSource():DestinationSource{
 if(runtimeTarget()!=='production') return 'TEST-ONLY';
 if(!productionShipping(process.env)) throw new AccessError(503,'SHIPPING_UNAVAILABLE');
 return 'mengantar';
}
const fixtureDestinations=():Destination[]=>{const f=shippingFixture();return f.destinations.map(d=>({...d,version:f.version,source:'TEST-ONLY' as const}));};
// Mengantar writes names in capitals ("JAKARTA SELATAN", "BOGOR BARAT - KOTA"); buyers read them title-cased.
const title=(value:string)=>value.toLocaleLowerCase('id-ID').replace(/(^|[\s(/-])(\p{L})/gu,(_,lead:string,letter:string)=>lead+letter.toLocaleUpperCase('id-ID'));
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
// What a checkout view lists before any search: the whole fixture locally; in production only the chosen area.
export async function initialDestinations(sql:Db,selected:string):Promise<Destination[]>{
 if(destinationSource()==='TEST-ONLY') return fixtureDestinations();
 const chosen=await findDestination(sql,selected);return chosen?[chosen]:[];
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
