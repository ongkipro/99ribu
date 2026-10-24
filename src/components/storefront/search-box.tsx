'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {Icon} from './icon';

// shop.com omnibox (observed 2026-10-23): one glass container that grows from the 64px pill into
// "Suggested searches" in ~100-300ms. The form keeps one fixed height and the surface is absolutely
// positioned, so opening never moves the page. The input stays a native GET field (works without
// JS); this island adds the WAI-ARIA combobox list. Suggestions are product phrases computed from
// the published catalog on the server; typing filters them and adds a "Cari …" row.
const normal=(value:string)=>value.toLocaleLowerCase('id').normalize('NFKD').replace(/\p{M}/gu,'');
function Highlight({text,query}:{text:string;query:string}){
 const at=query?normal(text).indexOf(query):-1;
 if(at<0) return <span>{text}</span>;
 return <span>{text.slice(0,at)}<mark>{text.slice(at,at+query.length)}</mark>{text.slice(at+query.length)}</span>;
}
export function SearchBox({q,suggestions}:{q:string;suggestions:string[]}){
 const [value,setValue]=useState(q),[open,setOpen]=useState(false),[active,setActive]=useState(-1);
 const form=useRef<HTMLFormElement>(null),input=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null),id=useId();
 const raw=value.trim(),typed=normal(raw);
 const matches=(typed?suggestions.filter(s=>normal(s).includes(typed)&&normal(s)!==typed):suggestions).slice(0,6);
 // While typing, the last row searches exactly what was typed.
 const options=raw?[...matches,raw]:matches;
 const expanded=open&&options.length>0;
 const close=()=>{setOpen(false);setActive(-1);};
 const choose=(text:string)=>{if(!input.current) return;input.current.value=text;setValue(text);close();form.current?.requestSubmit();};
 useEffect(()=>{if(active>=0) list.current?.querySelectorAll('[role="option"]')[active]?.scrollIntoView({block:'nearest'});},[active]);
 return <form ref={form} action="/cari" className="search-form" data-open={expanded||undefined} onSubmit={close} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)) close();}}>
  <div className="omnibox">
   <div className="omnibox-field">
    <label className="sr-only" htmlFor="site-search">Cari produk</label>
    <Icon name="search"/>
    <input ref={input} type="search" id="site-search" name="q" placeholder="Cari produk" defaultValue={q} maxLength={200} autoComplete="off" enterKeyHint="search"
     role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-list`} aria-activedescendant={expanded&&active>=0?`${id}-${active}`:undefined}
     onFocus={()=>setOpen(true)} onClick={()=>setOpen(true)} onChange={e=>{setValue(e.target.value);setOpen(true);setActive(-1);}}
     onKeyDown={e=>{
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!expanded){setOpen(true);return;}const next=active+(e.key==='ArrowDown'?1:-1);setActive(next>=options.length?-1:next<-1?options.length-1:next);}
      else if(e.key==='Enter'&&expanded&&active>=0&&active<options.length){e.preventDefault();choose(options[active]);}
      else if(e.key==='Escape'&&expanded){e.preventDefault();close();}
     }}/>
    <button type="submit" aria-label="Cari produk"><Icon name="arrow"/></button>
   </div>
   {/* Rendered collapsed and inert on the server, so nothing flashes on load or hydration. */}
   <div className="omnibox-panel">
    <div className="omnibox-body" inert={!expanded}>
     <div className="omnibox-scroll">
      <p className="omnibox-caption" id={`${id}-caption`}>Saran pencarian</p>
      <div ref={list} role="listbox" id={`${id}-list`} aria-labelledby={`${id}-caption`} onMouseDown={e=>e.preventDefault()}>
       {options.map((text,i)=>
        // biome-ignore lint/a11y: combobox options are reached by aria-activedescendant from the input (Up/Down/Enter), so they take no DOM focus or key handlers.
        <div key={i===matches.length?`search:${text}`:text} id={`${id}-${i}`} role="option" aria-selected={i===active} onClick={()=>choose(text)}>{i===matches.length?<span>Cari “{text}”</span>:<Highlight text={text} query={typed}/>}</div>)}
      </div>
     </div>
    </div>
   </div>
  </div>
 </form>;
}
