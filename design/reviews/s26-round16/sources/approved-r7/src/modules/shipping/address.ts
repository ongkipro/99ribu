import shippingLocal from '../../../docs/spec/fixtures/shipping-local.json' with {type:'json'};
import {readLocalConfig} from '../../config/local.ts';
import {AccessError} from '../access/policy.ts';
import {array,integer,invalid,object,text} from '../catalog/validation.ts';

export function shippingFixture(){
  readLocalConfig(process.env);
  const raw=shippingLocal;
  if(raw.version!=='local-shipping-v1'||raw.source!=='TEST-ONLY') throw invalid();
  const destinations=array(raw.destinations,(value)=>{
    const v=object(value,['id','label','province','city','district','subdistrict','postal_code']);
    const result=Object.fromEntries(Object.entries(v).map(([key,value])=>[key,text(value,200)])) as Record<'id'|'label'|'province'|'city'|'district'|'subdistrict'|'postal_code',string>;
    if(!/^[a-z0-9-]{1,100}$/.test(result.id)||!/^\d{5}$/.test(result.postal_code)||!result.label.startsWith('SYNTHETIC ')) throw invalid();return result;
  },1);
  if(new Set(destinations.map((d)=>d.id)).size!==destinations.length) throw invalid();
  const packagePolicy=object(raw.package_policy,['kind','maximum_weight_grams','maximum_dimension_mm','volumetric_divisor_mm3_per_gram']);
  if(packagePolicy.kind!=='upright-stack-v1') throw invalid();
  const policy={kind:'upright-stack-v1',maximum_weight_grams:integer(packagePolicy.maximum_weight_grams,1,1000000),maximum_dimension_mm:integer(packagePolicy.maximum_dimension_mm,1,10000),volumetric_divisor_mm3_per_gram:integer(packagePolicy.volumetric_divisor_mm3_per_gram,1,1000000)};
  const services=array(raw.services,(value)=>{const v=object(value,['id','name','supports_cod','local_base_idr','cross_base_idr','step_idr']);if(typeof v.supports_cod!=='boolean') throw invalid();return {id:text(v.id,100),name:text(v.name,200),supports_cod:v.supports_cod,local_base_idr:integer(v.local_base_idr,0),cross_base_idr:integer(v.cross_base_idr,0),step_idr:integer(v.step_idr,0)};},1);
  if(new Set(services.map((s)=>s.id)).size!==services.length) throw invalid();
  return {version:String(raw.version),source:'TEST-ONLY',destinations,policy,services};
}
export const clean=(value:unknown,max:number)=>{const v=text(value,max).normalize('NFC');if([...v].some((c)=>c.charCodeAt(0)<32||(c.charCodeAt(0)>=127&&c.charCodeAt(0)<=159)||/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(c))) throw invalid();return v;};
export function normalizePhone(value:unknown){
  const phoneInput=clean(value,30);
  if(!/^[+\d ().-]+$/.test(phoneInput)) throw invalid();let phone=phoneInput.replace(/[ ().-]/g,'');
  if(phone.startsWith('0')) phone=`+62${phone.slice(1)}`;else if(phone.startsWith('62')) phone=`+${phone}`;else if(phone.startsWith('8')) phone=`+62${phone}`;
  if(!/^\+62[1-9]\d{7,12}$/.test(phone)) throw new AccessError(422,'INVALID_INDONESIAN_PHONE');
  return phone;
}
export function normalizeAddress(value:unknown){
  const body=object(value,['recipient_name','phone','address_line','destination_id','postal_code']);
  const recipient=clean(body.recipient_name,200);const street=clean(body.address_line,500);const phone=normalizePhone(body.phone);
  const fixture=shippingFixture();const destination=fixture.destinations.find((d)=>d.id===body.destination_id);
  if(!destination) throw new AccessError(422,'DESTINATION_UNAVAILABLE');
  if(body.postal_code!==destination.postal_code) throw new AccessError(422,'DESTINATION_POSTCODE_MISMATCH');
  return {recipient_name:recipient,phone,address_line:street,destination_id:destination.id,postal_code:destination.postal_code,
    province:destination.province,city:destination.city,district:destination.district,subdistrict:destination.subdistrict,destination_version:fixture.version,source:fixture.source};
}
export function findDestinations(query:string,limit=20){
  const search=clean(query,100).toLocaleLowerCase('id-ID');integer(limit,1,100);
  return shippingFixture().destinations.filter((d)=>`${d.label} ${d.province} ${d.city} ${d.district} ${d.subdistrict} ${d.postal_code}`.toLocaleLowerCase('id-ID').includes(search)).slice(0,limit);
}
