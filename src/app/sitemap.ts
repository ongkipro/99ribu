import type {MetadataRoute} from 'next';
import {siteConfig} from '../config/site';
import {getLocalAuth} from '../modules/access/auth';
import {catalogTtl,memo} from '../modules/storefront/memo';
import {sitemapEntries} from '../modules/storefront/seo';

// Request-time from the live publications (withdrawn and unsellable products excluded). Building it re-checks every
// publication head serially (about 4-6 s for 470 URLs in production, measured 2026-11-09), so production keeps the result
// for the catalogue TTL and serves the stale one while a refresh runs; local and test read through (TTL 0).
export const dynamic='force-dynamic';
export default function sitemap():Promise<MetadataRoute.Sitemap>{
 const config=siteConfig();
 return memo(`sitemap:${config.origin}:${config.indexing}`,catalogTtl(),()=>sitemapEntries(getLocalAuth().sql,config));
}
