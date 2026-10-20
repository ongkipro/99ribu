'use client';
import {useEffect,useRef} from 'react';
import {Icon} from './icon';
export function FilterPanel({children}:{children:React.ReactNode}){
 const ref=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const wide=matchMedia('(min-width:701px)');if(ref.current) ref.current.open=wide.matches;},[]);
 return <details className="filters" ref={ref}><summary>Filter dan urutan<Icon name="chevron"/></summary>{children}</details>;
}
