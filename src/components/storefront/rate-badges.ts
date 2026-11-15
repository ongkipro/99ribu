// Rate badges (owner 2026-11-06): options arrive sorted by price, so the first is the cheapest; the fastest has the
// smallest upper ETA bound in the service name this app writes ("Reguler, 1-2 hari"). Only with a real choice.
export const etaDays=(name:string)=>{const m=/(\d+)(?:-(\d+))? hari$/.exec(name);return m?Number(m[2]??m[1]):Number.POSITIVE_INFINITY;};
export function rateBadges(options:readonly {id:string;service_name:string}[]){
 if(options.length<2)return new Map<string,string[]>();
 const days=options.map(o=>etaDays(o.service_name)),fastest=Math.min(...days),quick=options.filter((_,i)=>days[i]===fastest);
 const badges=new Map<string,string[]>([[options[0].id,['Termurah']]]);
 // "Tercepat" only compares like with like: every option has an ETA and one is strictly the quickest.
 if(days.every(Number.isFinite)&&quick.length===1)badges.set(quick[0].id,[...(badges.get(quick[0].id)??[]),'Tercepat']);
 return badges;
}

// DEC-034: the cheapest SHOWN_COURIERS options (they arrive cheapest first) stay visible, plus the selected one wherever it
// ranks; the rest go behind "Lihat kurir lain". Order is kept, so the radio group reads the same either way.
export const SHOWN_COURIERS=5;
export function splitCouriers<T extends {id:string}>(options:readonly T[],selected:string|undefined,limit=SHOWN_COURIERS){
 const shown=options.filter((o,i)=>i<limit||o.id===selected);
 return {shown,more:options.filter(o=>!shown.includes(o))};
}

// The muted second line of a courier row: the service and its ETA. The Mengantar adapter writes "Reguler, 2-3 hari",
// shown as "Reguler · 2–3 hari"; a name without an ETA stays as it is.
export const serviceLine=(name:string)=>name.replace(/,\s*(\d+)(?:-(\d+))? hari$/,(_match,from:string,to:string|undefined)=>` · ${to?`${from}–${to}`:from} hari`);
