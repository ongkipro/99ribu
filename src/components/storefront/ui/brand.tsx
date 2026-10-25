// The compact "99rb." wordmark inside a .brand element (task, checkout and footer chrome).
export function Wordmark(){
 return <>99<span>rb</span><i aria-hidden="true">.</i></>;
}

// Skip link that opens every storefront and checkout page (the local-simulation notice was removed 2026-10-25,
// owner: local and deployed pages render the same).
export function SiteNotice(){
 return <><a className="skip" href="#main">Lewati ke konten</a></>;
}
