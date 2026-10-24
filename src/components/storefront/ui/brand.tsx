// The compact "99rb." wordmark inside a .brand element (task, checkout and footer chrome).
export function Wordmark(){
 return <>99<span>rb</span><i aria-hidden="true">.</i></>;
}

// Skip link plus the local-simulation notice that opens every storefront and checkout page.
export function SiteNotice(){
 return <><a className="skip" href="#main">Lewati ke konten</a><div className="local-notice"><span className="notice-long">Data contoh: pesanan, pembayaran, dan pengiriman masih simulasi lokal.</span><span className="notice-short">Data contoh: simulasi lokal.</span></div></>;
}
