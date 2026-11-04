// Kecamatan (district) type-ahead over the shipping area catalogue. Pure: no database, no runtime config, so the
// fixture path, the catalogue path and the unit test share one matcher.
// Mengantar spells names in capitals with its own punctuation ("SIMEULEU TENGAH", "BOGOR BARAT - KOTA",
// "NANGGROE ACEH DARUSSALAM (NAD)"); buyers type them in any case, with or without spaces or punctuation.
// Mengantar also files the kelurahan of recently split kecamatan under the old parent (Binawidya's kelurahan sit under
// Tampan, Pekanbaru), so a kelurahan name or postal code finds its kecamatan too, with the kelurahan named (2026-11-05).

// Lower case, accents dropped, only letters and digits kept: "Bogor Barat - Kota" -> "bogorbaratkota".
export const compactArea=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'');

// Administrative words buyers often add ("kec. tebet", "kota semarang") that Mengantar's names rarely carry.
// They are ignored as filters but still count for ranking an exact name ("Kota Baru").
const FILLER=new Set(['kec','kecamatan','kel','kelurahan','desa','kab','kabupaten','kota','prov','provinsi','dki']);
export function searchTerms(query:string){
 const words=query.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
 const useful=words.filter(w=>!FILLER.has(w));
 return {whole:compactArea(query),words:(useful.length?useful:words).slice(0,6)};
}

export type AreaMember={id:string;subdistrict:string;postal_code:string};
export type DistrictSource={id:string;province:string;city:string;district:string;postal_codes:string[];areas:number;members:AreaMember[]};
export type DistrictEntry=DistrictSource&{name:string;primary:string;extra:string;compactMembers:string[]};
// The kelurahan (or postal code) a kecamatan was found by; `single` (see memberMatch) means it may be preselected.
export type AreaMatch={id:string;subdistrict:string;postal_code:string;kind:'kelurahan'|'postcode';single:boolean};
// `primary` holds the kecamatan, city and province; `extra` its kelurahan names and postal codes. A '|' separator
// keeps a typed word from matching across two names.
export function districtEntry(source:DistrictSource):DistrictEntry{
 const compactMembers=source.members.map(m=>compactArea(m.subdistrict));
 return {...source,name:compactArea(source.district),primary:[source.district,source.city,source.province].map(compactArea).join('|'),extra:[...compactMembers,...source.postal_codes].join('|'),compactMembers};
}
// Rows (one per kelurahan) into kecamatan entries; the smallest area id names the kecamatan.
export function groupDistricts(rows:readonly {id:string;province:string;city:string;district:string;subdistrict:string;postal_code:string}[]){
 const groups=new Map<string,DistrictSource>();
 for(const row of rows){
  const key=JSON.stringify([row.province,row.city,row.district]),group=groups.get(key),member={id:row.id,subdistrict:row.subdistrict,postal_code:row.postal_code};
  if(!group){groups.set(key,{id:row.id,province:row.province,city:row.city,district:row.district,postal_codes:[row.postal_code],areas:1,members:[member]});continue;}
  if(row.id<group.id)group.id=row.id;
  if(!group.postal_codes.includes(row.postal_code))group.postal_codes.push(row.postal_code);
  group.areas++;group.members.push(member);
 }
 return [...groups.values()].map(g=>districtEntry({...g,postal_codes:g.postal_codes.sort()}));
}

// The kelurahan behind a match: a postal code typed as digits (exact first, then its prefix), else the kelurahan whose
// name equals, then contains, the query; else one that holds every word the kecamatan, city and province do not.
// `single` means safe to preselect: a full postal code no other kelurahan here shares, or a name only one kelurahan
// here matches. A partial code ("128") or a word several kelurahan contain never picks one for the buyer.
function memberMatch(entry:DistrictEntry,whole:string,words:string[]):AreaMatch|null{
 const pick=(index:number,kind:AreaMatch['kind'],single:boolean):AreaMatch=>({...entry.members[index],kind,single});
 const count=(test:(value:string,index:number)=>boolean)=>entry.compactMembers.filter(test).length;
 if(/^\d{3,5}$/.test(whole)){
  const exact=entry.members.findIndex(m=>m.postal_code===whole);
  if(exact>=0)return pick(exact,'postcode',entry.members.filter(m=>m.postal_code===whole).length===1);
  const prefix=entry.members.findIndex(m=>m.postal_code.startsWith(whole));
  return prefix<0?null:pick(prefix,'postcode',false);
 }
 const equal=entry.compactMembers.indexOf(whole);if(equal>=0)return pick(equal,'kelurahan',count(m=>m===whole)===1);
 const within=entry.compactMembers.findIndex(m=>m.includes(whole));if(within>=0)return pick(within,'kelurahan',count(m=>m.includes(whole))===1);
 const rest=words.filter(w=>!entry.primary.includes(w));
 const holds=(m:string)=>rest.every(w=>m.includes(w));
 const any=rest.length?entry.compactMembers.findIndex(holds):-1;
 return any>=0?pick(any,'kelurahan',count(holds)===1):null;
}

// Every word must appear in the kecamatan, city, province, a kelurahan name or a postal code. Rank:
//  0-2 the kecamatan name equals, starts with or contains the query; 3 the city or province contains it ("kota baru"
//  -> Kotabaru); 4 a kelurahan name or postal code equals it; 5 a kelurahan name contains it or a postal code starts
//  with it; 6 every word is somewhere in kecamatan/city/province; 7 the words needed a kelurahan.
// When a kecamatan name matches (0-2), word-scattered matches (6-7) are dropped ("semarang tengah" must not list every
// kecamatan of Semarang in Jawa Tengah); kelurahan and postal-code matches stay, after the names. Word matches that
// needed a kelurahan (7) only show when nothing better matched.
// Ties: shorter kecamatan name, then alphabetical.
export function rankDistricts(entries:readonly DistrictEntry[],query:string,limit:number){
 const {whole,words}=searchTerms(query);
 if(whole.length<2||!words.length)return [];
 const scored:{entry:DistrictEntry;rank:number;match:AreaMatch|null}[]=[];
 const digits=/^\d+$/.test(whole),core=words.join('');
 for(const entry of entries){
  if(!words.every(w=>entry.primary.includes(w)||entry.extra.includes(w)))continue;
  const nameRank=(term:string)=>entry.name===term?0:entry.name.startsWith(term)?1:entry.name.includes(term)?2:entry.primary.includes(term)?3:-1;
  // "kec tebet" is the name Tebet: without the filler words an equal or starting name counts ("kota baru" keeps the
  // city Kotabaru first; "baru" inside "Koto Baru" is not enough).
  const byCore=core===whole?-1:nameRank(core),named=nameRank(whole)>=0?nameRank(whole):byCore>=0&&byCore<=1?byCore:-1;
  if(named>=0){scored.push({entry,rank:named,match:null});continue;}
  const match=memberMatch(entry,whole,words);
  const exact=match&&(digits?match.postal_code===whole:compactArea(match.subdistrict)===whole);
  const within=match&&(digits?match.postal_code.startsWith(whole):compactArea(match.subdistrict).includes(whole));
  const rank=exact?4:within?5:words.every(w=>entry.primary.includes(w))?6:7;
  scored.push({entry,rank,match:rank===6?null:match});
 }
 const best=Math.min(...scored.map(s=>s.rank)),cutoff=best<=2?5:best<=6?6:7;
 return scored.filter(s=>s.rank<=cutoff).sort((a,b)=>a.rank-b.rank||a.entry.name.length-b.entry.name.length||a.entry.district.localeCompare(b.entry.district)||a.entry.city.localeCompare(b.entry.city)||a.entry.id.localeCompare(b.entry.id)).slice(0,limit).map(s=>({...s.entry,match:s.match}));
}
