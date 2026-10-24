import {isListingParam} from './navigation.ts';

// S110 home banner rules shared by the admin form (client), the admin API and the storefront projection.
// Pure functions only: this module is imported by a client component.

export const BANNER_TINTS=['amber','slate','rose','blue','green','violet','teal'] as const;
export type BannerTint=typeof BANNER_TINTS[number];
// Catalog media limits (storage/catalog-media.ts CATALOG_MEDIA_LIMIT) plus a minimum size: a 410x520 rail card
// at DPR 2 wants about 820px wide, so anything under 600px looks soft and is refused.
export const BANNER_IMAGE_BYTES=512*1024;
export const BANNER_IMAGE_MIN=600;
export const BANNER_IMAGE_MAX=4096;
export const BANNER_LIMIT=24;

const origin='https://storefront.invalid';
// Destinations a banner may open: storefront listing pages, a category, search and a product page. Nothing else
// (no external origin, no account, checkout, admin or API path); only listing parameters survive on /cari and
// /kategori/<slug>, never tracking parameters or fragments. Returns the normalized path, or null.
const PATHS=/^\/(?:promo|kategori|kategori\/[a-z0-9-]{1,80}|cari|produk\/[a-z0-9-]{1,160})$/;
export function bannerHref(value:unknown):string|null{
 if(typeof value!=='string'||value.length<1||value.length>400||!value.startsWith('/')||value.startsWith('//')||/[\\\p{Cc}\p{Cf}]/u.test(value))return null;
 let url:URL;
 try{url=new URL(value,origin);}catch{return null;}
 if(url.origin!==origin||url.hash||value.includes('#')||!PATHS.test(url.pathname))return null;
 const listing=url.pathname==='/cari'||url.pathname.startsWith('/kategori/');
 for(const [key,text] of url.searchParams){
  if(!listing||key==='cursor'||!isListingParam(key)||!text||/[\p{Cc}\p{Cf}]/u.test(text))return null;
 }
 const query=url.searchParams.toString();
 if(query.length>300)return null;
 return url.pathname+(query?`?${query}`:'');
}

// Scheduling: a banner shows from starts_at (inclusive) until ends_at (exclusive). The admin types both as
// WIB wall-clock times (storefront/format.ts wibInputToIso); stored values are absolute instants, so the
// window is the same whatever the server or device time zone.
export type BannerWindow={active:boolean;retired:boolean;starts_at:string;ends_at:string};
export function isCurrentBanner(banner:BannerWindow,now:Date){
 const at=now.getTime();
 return banner.active&&!banner.retired&&Date.parse(banner.starts_at)<=at&&at<Date.parse(banner.ends_at);
}
export type BannerPhase='retired'|'paused'|'scheduled'|'live'|'ended';
export function bannerPhase(banner:BannerWindow,now:Date):BannerPhase{
 if(banner.retired)return 'retired';
 if(!banner.active)return 'paused';
 const at=now.getTime();
 return at<Date.parse(banner.starts_at)?'scheduled':at<Date.parse(banner.ends_at)?'live':'ended';
}
