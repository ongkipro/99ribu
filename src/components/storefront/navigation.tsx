'use client';

import {useEffect,useRef} from 'react';
import Link from 'next/link';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {productHref,productSlug,publicReturnPath} from '../../modules/storefront/navigation';
import {Icon} from './ui/icon';

let pending:{path:string;from:string}|null=null;

export function ProductLink({product,name,offer,className,children}:{product:string;name?:string|null;offer:string;className?:string;children:React.ReactNode}){
 const path=usePathname(),query=useSearchParams().toString();
 const from=publicReturnPath(`${path}${query?`?${query}`:''}${path==='/keranjang'?'':`#product-${product}`}`)??'/cari';
 return <Link className={className} prefetch={false} href={productHref(product,offer,from,name)} onNavigate={()=>{pending={path:`/produk/${productSlug(product,name)}`,from};}}>{children}</Link>;
}

export function TaskBack({from}:{from:string|null}){
 const path=usePathname(),router=useRouter(),own=useRef<typeof pending>(null);
 useEffect(()=>{
  const existing=window.history.state?.productReturn;
  if(from&&pending?.path===path&&pending.from===from){own.current=pending;pending=null;}
  if(from&&existing?.path===path&&existing.from===from)own.current={path,from};
  // Server Action revalidation can replace custom history state; retain only
  // our recorded same-tab entry, including across a later document reload.
  if(from&&own.current?.path===path&&own.current.from===from&&(existing?.path!==path||existing.from!==from))window.history.replaceState({...window.history.state,productReturn:{path,from}},'');
 });
 return <Link href={from??'/cari'} className="task-back" onNavigate={event=>{
  const entry=window.history.state?.productReturn;
  if(from&&entry?.path===path&&entry.from===from){event.preventDefault();router.back();}
 }}><Icon name="chevron"/><span>{from?'Kembali':'Katalog'}</span></Link>;
}
