import Link from 'next/link';

// The compact "99rb." wordmark inside a .brand element (task, checkout and footer chrome).
export function Wordmark(){
 return <>99<span>rb</span><i aria-hidden="true">.</i></>;
}

// Skip link that opens every storefront and checkout page (the local-simulation notice was removed 2026-10-25,
// owner: local and deployed pages render the same).
export function SiteNotice(){
 return <><a className="skip" href="#main">Lewati ke konten</a></>;
}

// The header's home link (round 37): "99rb." that grows into "Serba 99ribu" on a fine-pointer hover or keyboard focus
// (CSS in 09-home-footer.css). Owner 2026-10-30: the same link heads the sign-in and sign-up forms.
export function BrandLink({className}:{className?:string}){
 return <Link href="/" className={className?`brand brand-reveal ${className}`:'brand brand-reveal'} aria-label="Serba 99ribu, beranda"><span className="grow" aria-hidden="true"><span>Serba&nbsp;</span></span>99<span>r<span className="grow" aria-hidden="true"><span>i</span></span>b<span className="grow" aria-hidden="true"><span>u</span></span></span><i aria-hidden="true">.</i></Link>;
}
