import type {MetadataRoute} from 'next';
import {siteConfig} from '../config/site';
import {getLocalAuth} from '../modules/access/auth';
import {sitemapEntries} from '../modules/storefront/seo';

// Request-time from the live publications (withdrawn and unsellable products excluded).
export const dynamic='force-dynamic';
export default function sitemap():Promise<MetadataRoute.Sitemap>{return sitemapEntries(getLocalAuth().sql,siteConfig());}
