'use client';

import Link from 'next/link';
import {usePathname,useSearchParams} from 'next/navigation';
import {productHref,publicReturnPath} from '../../modules/storefront/navigation';

// `product` is the id (it names the #product-<id> anchor a list returns to), `slug` the clean URL segment; `defaultOffer` is the offer the page selects on its own, so that link stays the bare slug.
export function ProductLink({product,slug,offer,defaultOffer,className,children}:{product:string;slug:string;offer:string;defaultOffer?:string|null;className?:string;children:React.ReactNode}){
 const path=usePathname(),query=useSearchParams().toString();
 const from=publicReturnPath(`${path}${query?`?${query}`:''}${path==='/keranjang'?'':`#product-${product}`}`)??'/cari';
 return <Link className={className} prefetch={false} href={productHref(slug,offer,from,defaultOffer)}>{children}</Link>;
}

