import Link from 'next/link';

// The compact "99rb." wordmark inside a .brand element (task, checkout and footer chrome).
export function Wordmark(){
 return <>99<span>rb</span><i aria-hidden="true">.</i></>;
}

// Skip link that opens every storefront and checkout page (the local-simulation notice was removed 2026-10-25,
// owner: local and deployed pages render the same).
export function SiteNotice(){
 return <a className="skip" href="#main">Lewati ke konten</a>;
}

// The header's home link (round 37): "99rb." that grows into "Serba 99ribu" on a fine-pointer hover or keyboard focus
// (CSS in 09-home-footer.css). Owner 2026-10-30: the same link heads the sign-in and sign-up forms. The animated
// letters are hidden from assistive tech (Chrome would read them as "99 r i b u") and one sr-only text gives the name
// "Serba 99ribu, beranda"; no aria-label, so the name never mismatches the visible "99rb." (Lighthouse 2026-11-04).
export function BrandLink({className}:{className?:string}){
 return <Link href="/" className={className?`brand brand-reveal ${className}`:'brand brand-reveal'} ><BrandName/></Link>;
}
// The contents of a .brand.brand-reveal home control; checkout puts it in a draft-saving button (checkout-exit.tsx).
export function BrandName(){
 return <><span className="grow" aria-hidden="true"><span>Serba&nbsp;</span></span><span className="brand-num" aria-hidden="true">99</span><span aria-hidden="true">r<span className="grow"><span>i</span></span>b<span className="grow"><span>u</span></span></span><i aria-hidden="true">.</i><span className="sr-only">Serba 99ribu, beranda</span></>;
}
