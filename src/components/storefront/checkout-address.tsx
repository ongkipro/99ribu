// Rendered only inside the client CheckoutForm (checkout-forms.tsx), so it is not a client entry of its own.
import {useEffect,useMemo,useRef,useState} from 'react';
import type {CheckoutDraft,CheckoutState,Destination} from '../../modules/storefront/checkout';
import type {DestinationDistrict} from '../../modules/shipping/destinations';
import {compactArea} from '../../modules/shipping/area-search';
import {Icon} from './ui/icon';

// Phones: the on-screen keyboard covers the lower half, so a focused combobox scrolls to the top of the visible area
// (scroll-margin-top in CSS) once the keyboard has opened; its suggestions then open below it, above the keyboard.
// Cancelled if focus leaves before it runs.
function liftAboveKeyboard(input:HTMLInputElement){
 if(!window.matchMedia('(max-width: 700px) and (pointer: coarse)').matches)return;
 const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 const timer=window.setTimeout(()=>input.scrollIntoView({block:'start',behavior:reduce?'auto':'smooth'}),250);
 input.addEventListener('blur',()=>window.clearTimeout(timer),{once:true});
}

type Errors=CheckoutState['errors'];
type Option={id:string;primary:string;secondary?:string};
const districtOf=(d:Destination)=>`${d.district}, ${d.city}, ${d.province}`;

// One APG combobox (input + listbox popup, aria-activedescendant; Up/Down/Enter/Escape) for both the kecamatan
// search and the kelurahan filter. Options never take focus; Enter never submits the form from here.
function Combobox({id,label,listLabel,value,options,disabled=false,invalid,describedBy,autoFocus,name,icon,onText,onPick,inputRef}:{
 id:string;label:string;listLabel:string;value:string;options:Option[];disabled?:boolean;invalid?:boolean;describedBy?:string;autoFocus?:boolean;name?:string;icon?:boolean;
 onText:(value:string)=>void;onPick:(option:Option)=>void;inputRef?:React.Ref<HTMLInputElement>;
}){
 const list=`${id}-list`,[open,setOpen]=useState(false),[active,setActive]=useState(-1);
 // New options while the buyer is in the field (a search answer, a filter) open the list; none close it. Focus is read
 // from the document, so text typed before hydration still opens its answer.
 useEffect(()=>{setActive(-1);setOpen(document.activeElement?.id===id&&options.length>0);},[options,id]);
 const pick=(option:Option)=>{setOpen(false);setActive(-1);onPick(option);};
 function keyDown(event:React.KeyboardEvent<HTMLInputElement>){
  const n=options.length;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   if(!n)return;event.preventDefault();
   if(!open){setOpen(true);setActive(event.key==='ArrowDown'?0:n-1);return;}
   setActive(i=>event.key==='ArrowDown'?(i+1)%n:(i<=0?n-1:i-1));
  }else if(event.key==='Enter'){
   event.preventDefault();
   if(open&&active>=0)pick(options[active]);else if(n)setOpen(true);
  }else if(event.key==='Escape'&&open){event.preventDefault();setOpen(false);setActive(-1);}
 }
 return <div className={`checkout-float checkout-combobox-control${icon?'':' checkout-combobox-plain'}`}>{/* biome-ignore lint/a11y/noAutofocus: native POST validation focuses only the first invalid field. */}
  <input ref={inputRef} autoFocus={autoFocus} id={id} name={name} value={value} type="text" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={list}
   aria-activedescendant={open&&active>=0?`${list}-${active}`:undefined} autoComplete="off" spellCheck={false} maxLength={100} placeholder=" " disabled={disabled}
   aria-invalid={invalid||undefined} aria-describedby={describedBy}
   onChange={event=>onText(event.currentTarget.value)} onKeyDown={keyDown}
   onFocus={event=>{if(options.length&&!icon)setOpen(true);liftAboveKeyboard(event.currentTarget);}} onBlur={()=>{setOpen(false);setActive(-1);}}/>
  <label htmlFor={id}>{label}</label>{icon?<Icon name="search" size={20}/>:<Icon name="down" size={16}/>}
  <div id={list} role="listbox" aria-label={listLabel} className="checkout-suggestions" hidden={!open}>
   {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection lives on the combobox input (aria-activedescendant); options never take focus. */}
   {options.map((o,index)=><div key={o.id} id={`${list}-${index}`} role="option" tabIndex={-1} aria-selected={index===active} onMouseDown={event=>event.preventDefault()} onClick={()=>pick(o)} onMouseMove={()=>setActive(index)}>
    <strong>{o.primary}</strong>{o.secondary&&<span>{o.secondary}</span>}</div>)}
  </div>
 </div>;
}

// Kecamatan type-ahead, then a kelurahan filter limited to that kecamatan, then the postal code derived from the chosen
// kelurahan (owner 2026-11-05). The kelurahan field stays disabled until a kecamatan is chosen and never lists kelurahan
// of several kecamatan. Submitted: `destination_id` (the kelurahan's catalogue area id) and the typed `query`; names and
// postal code are always re-derived on the server.
// Without JavaScript: "Cari kecamatan" asks the server for the best matching kecamatan, whose kelurahan then come back
// as a native select (one kecamatan only); the comboboxes replace it once the page is interactive.
export function CheckoutAddress({draft,query,destinations,errors,firstError,lookupMessage,setQuery,setField,onPicked,enhanced}:{
 draft:CheckoutDraft;query:string;destinations:readonly Destination[];errors:Errors;firstError?:string;lookupMessage:string;
 setQuery:(value:string)=>void;setField:(name:keyof CheckoutDraft,value:string)=>void;onPicked:()=>void;enhanced:boolean;
}){
 const [districts,setDistricts]=useState<DestinationDistrict[]>([]),[status,setStatus]=useState({text:'',visible:false});
 const [picked,setPicked]=useState<Destination[]|null>(null),[loading,setLoading]=useState(false),[filter,setFilter]=useState<string|null>(null);
 const searched=useRef(query),kelurahan=useRef<HTMLInputElement>(null),focusKelurahan=useRef(false),pick=useRef<AbortController|null>(null);
 // The server lists one kecamatan's kelurahan (the chosen area's, or the no-JavaScript lookup's best match); never several.
 const serverAreas=new Set(destinations.map(districtOf)).size===1?destinations:[];
 // biome-ignore lint/correctness/useExhaustiveDependencies: serverAreas is derived from destinations.
 const areas=useMemo(()=>picked??serverAreas,[picked,destinations]),destination=areas.find(d=>d.id===draft.destination_id);
 const postalCodes=new Set(areas.map(d=>d.postal_code));

 // Kecamatan suggestions follow typing only (a pick or a restored value never searches); one request at a time.
 useEffect(()=>{
  // Search only text the buyer typed: not the label of a pick or of a restored area (text typed before hydration counts).
  if(query===searched.current)return;
  const q=query.trim();
  if(q.replace(/[^\p{L}\p{N}]/gu,'').length<2){setDistricts([]);setStatus({text:'',visible:false});return;}
  const controller=new AbortController(),timer=setTimeout(async()=>{
   setStatus({text:'Mencari kecamatan…',visible:false});
   try{
    const response=await fetch(`/api/v1/destinations?q=${encodeURIComponent(q)}&group=district&limit=8`,{signal:controller.signal,headers:{accept:'application/json'}});
    if(!response.ok)throw new Error(String(response.status));
    const items=(await response.json() as {items:DestinationDistrict[]}).items;if(controller.signal.aborted)return;
    setDistricts(items);
    setStatus(items.length?{text:`${items.length} kecamatan ditemukan. Gunakan panah atas dan bawah untuk memilih.`,visible:false}:{text:'Kecamatan tidak ditemukan. Periksa ejaan atau coba nama kecamatan lain.',visible:true});
   }catch{if(!controller.signal.aborted){setDistricts([]);setStatus({text:'Daftar kecamatan belum dapat dimuat. Coba ketik lagi.',visible:true});}}
  },250);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[query]);
 useEffect(()=>{if(focusKelurahan.current&&!loading){focusKelurahan.current=false;kelurahan.current?.focus();}},[loading]);
 useEffect(()=>()=>pick.current?.abort(),[]);

 async function chooseDistrict(id:string){
  const district=districts.find(d=>d.id===id);if(!district)return;
  searched.current=district.label;setQuery(district.label);setDistricts([]);setFilter(null);setStatus({text:'',visible:false});
  pick.current?.abort();const controller=new AbortController();pick.current=controller;setLoading(true);
  try{
   const response=await fetch(`/api/v1/destinations?district=${encodeURIComponent(district.id)}`,{signal:controller.signal,headers:{accept:'application/json'}});
   if(!response.ok)throw new Error(String(response.status));
   const found=(await response.json() as {items:Destination[]}).items;if(controller.signal.aborted)return;
   setPicked(found);
   // One kelurahan, or the kelurahan the search matched (a name, or a postal code no other kelurahan here shares): chosen
   // for the buyer. A new kecamatan always clears the earlier kelurahan.
   const matched=district.match?.single&&found.some(a=>a.id===district.match?.area_id)?district.match.area_id:'';
   const keep=found.length===1?found[0].id:matched;
   setField('destination_id',keep);focusKelurahan.current=!keep&&found.length>1;
   setStatus({text:keep?`Kelurahan ${found.find(a=>a.id===keep)?.subdistrict} dipilih, kode pos ${found.find(a=>a.id===keep)?.postal_code}.`:`${found.length} kelurahan. Pilih kelurahan atau desa.`,visible:false});
   onPicked();
  }catch{if(!controller.signal.aborted){setPicked(null);setField('destination_id','');setStatus({text:'Daftar kelurahan belum dapat dimuat. Pilih kecamatan lagi.',visible:true});}}
  finally{if(!controller.signal.aborted)setLoading(false);}
 }

 // No kecamatan chosen yet: the kelurahan field is disabled, so its error belongs to (and focuses) the kecamatan field.
 const areaErrorOnQuery=Boolean(errors.destination_id)&&!areas.length,areaError=areaErrorOnQuery?undefined:errors.destination_id;
 const queryDescribed=[errors.query?'checkout-query-error':'',areaErrorOnQuery?'checkout-destination-error':'','checkout-query-hint'].filter(Boolean).join(' ');
 const note=postalCodes.size>1&&!destination;
 const areaDescribed=areaError?'checkout-destination-error':[!areas.length?'checkout-destination-hint':'',note?'checkout-postal-note':'',destination?'checkout-destination-selected':''].filter(Boolean).join(' ')||undefined;
 const kelurahanText=filter??destination?.subdistrict??'';
 const areaOptions=useMemo(()=>{const needle=compactArea(filter??'');return areas.filter(a=>!needle||compactArea(`${a.subdistrict}${a.postal_code}`).includes(needle)).map(a=>({id:a.id,primary:a.subdistrict,secondary:a.postal_code}));},[areas,filter]);
 // Found by a kelurahan name or postal code: the full kecamatan label, then the kelurahan that matched.
 const districtOptions=useMemo(()=>districts.map(d=>d.match?{id:d.id,primary:d.label,secondary:`Kelurahan ${d.match.subdistrict} · ${d.match.postal_code}`}:{id:d.id,primary:d.district,secondary:`${d.city}, ${d.province}`}),[districts]);
 const street=draft.address_line.replace(/\s*\n\s*/g,', ').trim();
 return <>
  <div className="checkout-field checkout-combobox">
   <Combobox id="checkout-query" name="query" label="Kecamatan tujuan" listLabel="Kecamatan" icon value={query} autoFocus={firstError==='query'||firstError==='destination_id'&&areaErrorOnQuery} invalid={Boolean(errors.query||areaErrorOnQuery)} describedBy={queryDescribed}
    options={districtOptions}
    onText={value=>{setQuery(value);if(picked||draft.destination_id||serverAreas.length){setPicked([]);setFilter(null);setField('destination_id','');}}}
    onPick={option=>void chooseDistrict(option.id)}/>
   <noscript><button className="button secondary checkout-lookup" type="submit" name="navigate" value="lookup">Cari kecamatan</button></noscript>
   <p id="checkout-query-hint" className="checkout-hint">Ketik kecamatan, kelurahan, atau kode pos.</p>
   <p className={status.visible?'checkout-hint':'sr-only'} role="status">{status.text}</p>
   {lookupMessage&&<p className="checkout-hint" role="status">{lookupMessage}</p>}
   {errors.query&&<p id="checkout-query-error" className="checkout-field-error"><Icon name="alert"/>{errors.query}</p>}
   {areaErrorOnQuery&&<p id="checkout-destination-error" className="checkout-field-error"><Icon name="alert"/>{errors.destination_id}</p>}
  </div>
  <div className="checkout-pair checkout-pair-postal">
   <div className="checkout-field checkout-combobox">
    {enhanced?<>
     <Combobox inputRef={kelurahan} id="checkout-destination_id" label="Kelurahan / desa" listLabel="Kelurahan atau desa" value={kelurahanText} options={areaOptions} disabled={!areas.length||loading}
      autoFocus={firstError==='destination_id'&&!areaErrorOnQuery} invalid={Boolean(areaError)} describedBy={areaDescribed}
      onText={value=>{setFilter(value);if(draft.destination_id)setField('destination_id','');}}
      onPick={option=>{setFilter(null);setField('destination_id',option.id);onPicked();}}/>
     <input type="hidden" name="destination_id" value={destination?draft.destination_id:''}/>
    </>:areas.length?<div className="checkout-float checkout-float-select">{/* biome-ignore lint/a11y/noAutofocus: native POST validation focuses only the first invalid field. */}
     <select autoFocus={firstError==='destination_id'&&!areaErrorOnQuery} id="checkout-destination_id" name="destination_id" defaultValue={destination?draft.destination_id:''} required
      aria-invalid={Boolean(areaError)||undefined} aria-describedby={areaDescribed}>
      <option value="">Pilih kelurahan</option>{areas.map(d=><option key={d.id} value={d.id}>{d.subdistrict} · {d.postal_code}</option>)}
     </select><label htmlFor="checkout-destination_id">Kelurahan / desa</label></div>
    :<div className="checkout-float"><input id="checkout-destination_id" type="text" disabled value="" placeholder=" " aria-describedby={areaDescribed}/><label htmlFor="checkout-destination_id">Kelurahan / desa</label><input type="hidden" name="destination_id" value=""/></div>}
    {!areas.length&&<p id="checkout-destination-hint" className="checkout-hint">{loading?'Memuat kelurahan…':'Pilih kecamatan dulu.'}</p>}
    {areaError&&<p id="checkout-destination-error" className="checkout-field-error"><Icon name="alert"/>{areaError}</p>}
   </div>
   <div className="checkout-field"><div className="checkout-float">
    <input id="checkout-postal_code" type="text" readOnly disabled={!destination} tabIndex={-1} value={destination?.postal_code??''} placeholder=" " aria-describedby="checkout-postal-hint"/><label htmlFor="checkout-postal_code">Kode pos</label></div>
    <span id="checkout-postal-hint" className="sr-only">Terisi otomatis dari kelurahan yang dipilih.</span>
   </div>
  </div>
  {note&&<p id="checkout-postal-note" className="checkout-postal-note"><Icon name="info" size={20}/>Kecamatan ini punya beberapa kode pos. Pilih kelurahan agar kode posnya benar.</p>}
  {destination&&<div id="checkout-destination-selected" className="checkout-destination-card"><Icon name="pin"/><div><small>Kirim ke</small>{street&&<p className="checkout-destination-street">{street}</p>}
   <p className="checkout-destination-area">{destination.subdistrict}, {destination.district}, {destination.city}, {destination.province} {destination.postal_code}</p></div></div>}
 </>;
}
