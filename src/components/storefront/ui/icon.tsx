// Outline icons (Lucide geometry, 2px stroke on a 24px grid); `size` sets the width/height attributes.
export function Icon({name,size=24}:{name:'down'|'home'|'search'|'cart'|'user'|'chevron'|'close'|'category'|'grid'|'check'|'alert'|'arrow'|'forward'|'tag'|'clock'|'info'|'minus';size?:number}){
 const paths={grid:<><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></>,clock:<><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>,info:<><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></>,minus:<><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></>,tag:<><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></>,forward:<path d="m9 18 6-6-6-6"/>,down:<path d="m6 9 6 6 6-6"/>,arrow:<path d="M5 12h14m-7-7 7 7-7 7"/>,check:<path d="m20 6-11 11-5-5"/>,alert:<><path d="m10.3 3.9-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0"/><path d="M12 9v4m0 4h.01"/></>,home:<><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></>,search:<><circle cx="11" cy="11" r="8"/><path d="m21 21-4.34-4.34"/></>,cart:<><path d="m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18"/><path d="M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25"/><circle cx="18" cy="20" r="2"/><circle cx="8" cy="20" r="2"/></>,user:<><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></>,chevron:<path d="m15 18-6-6 6-6"/>,close:<path d="M18 6 6 18m0-12 12 12"/>,category:<><path d="M12 3v18M3 12h18"/><rect x="3" y="3" width="18" height="18" rx="2"/></>};
 // Lucide ISC; attribution and pinned sources: public/prototypes/assets.json.
 return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

// Filled variants for the active dock tab, on the same 24px grid and silhouettes as the outline
// icons above (the door, the grid gaps and the cart wheels stay readable).
export function FilledIcon({name}:{name:'home'|'category'|'cart'|'user'}){
 const paths={
  home:<path fillRule="evenodd" d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM10 21v-7.5h4V21z"/>,
  category:<><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></>,
  cart:<><path d="M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25z"/><path fill="none" d="m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18"/><circle cx="18" cy="20" r="2"/><circle cx="8" cy="20" r="2"/></>,
  user:<><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0z"/></>,
 };
 return <svg aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
