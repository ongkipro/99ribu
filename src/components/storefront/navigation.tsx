'use client';

import Link from 'next/link';
import {usePathname,useSearchParams} from 'next/navigation';
import {productHref,publicReturnPath} from '../../modules/storefront/navigation';

export function ProductLink({product,name,offer,className,children}:{product:string;name?:string|null;offer:string;className?:string;children:React.ReactNode}){
 const path=usePathname(),query=useSearchParams().toString();
 const from=publicReturnPath(`${path}${query?`?${query}`:''}${path==='/keranjang'?'':`#product-${product}`}`)??'/cari';
 return <Link className={className} prefetch={false} href={productHref(product,offer,from,name)}>{children}</Link>;
}

