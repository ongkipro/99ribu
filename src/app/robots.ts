import type {MetadataRoute} from 'next';
import {siteConfig} from '../config/site';
import {robotsFile} from '../modules/storefront/seo';

// Request-time: the origin and SITE_INDEXING come from the runtime profile, not the build.
export const dynamic='force-dynamic';
export default function robots():MetadataRoute.Robots{return robotsFile(siteConfig());}
