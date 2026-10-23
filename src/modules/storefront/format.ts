// The one IDR formatter for storefront and admin: whole rupiah, no space ("Rp99.000").
const idrFormat=new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',minimumFractionDigits:0,maximumFractionDigits:0});
export const rupiah=(amount:number)=>idrFormat.format(amount).replace(/\s+/g,'');

// Business time is WIB (Asia/Jakarta, UTC+07:00, no daylight saving) regardless of the device timezone.
const wibFormat=new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'});
const wibDateFormat=new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeZone:'Asia/Jakarta'});
const WIB_MS=7*3600_000;
export const wibDateTime=(value:string|number|Date)=>`${wibFormat.format(new Date(value))} WIB`;
export const wibDate=(value:string|number|Date)=>wibDateFormat.format(new Date(value));
// `<input type="datetime-local">` (YYYY-MM-DDTHH:mm[:ss]) or `type="date"` (YYYY-MM-DD, midnight) read as a
// WIB wall-clock time; null for malformed or impossible values (e.g. 2026-02-30).
export function wibInputToIso(value:string):string|null{
 const m=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
 if(!m)return null;
 const [,y,mo,d,h='00',mi='00',s='00']=m,ms=Date.UTC(+y,+mo-1,+d,+h,+mi,+s)-WIB_MS;
 // Date.UTC rolls over impossible parts; a round trip refuses them instead of shifting the day.
 return wibInput(ms,true)===`${y}-${mo}-${d}T${h}:${mi}:${s}`?new Date(ms).toISOString():null;
}
// The WIB wall-clock value for a datetime-local input (minutes, or seconds when asked).
export function wibInput(value:string|number|Date,seconds=false){
 return new Date(new Date(value).getTime()+WIB_MS).toISOString().slice(0,seconds?19:16);
}
