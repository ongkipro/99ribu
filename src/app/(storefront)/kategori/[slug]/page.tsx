import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {getLocalAuth} from '../../../../modules/access/auth';
import {publicCategory} from '../../../../modules/storefront/catalog';
import {isListingParam} from '../../../../modules/storefront/navigation';
import {CatalogListing} from '../../../../components/storefront/sections/catalog-listing';
import {JsonLd} from '../../../../components/storefront/json-ld';
import {siteConfig} from '../../../../config/site';
import {breadcrumbJsonLd,categoryDescription,categoryPath,categoryTitle,jsonLdGraph,publicMetadata} from '../../../../modules/storefront/seo';
type Props={params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
const load=async(slug:string)=>/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)&&slug.length<=100?publicCategory(getLocalAuth().sql,slug,'slug'):null;
export const dynamic='force-dynamic';
// The clean category URL is indexable; listing state (filters, sort, cursor) is noindex, follow.
// Tracking parameters (utm_*, gclid, fbclid) are ignored, so such a URL keeps the clean canonical.
export async function generateMetadata({params,searchParams}:Props):Promise<Metadata>{
 const category=await load((await params).slug);if(!category)return {};
 const listing=Object.keys(await searchParams).some(key=>isListingParam(key)||key.startsWith('filter.'));
 return publicMetadata(siteConfig(),{path:categoryPath(category.slug),title:categoryTitle(category.name),description:categoryDescription(category.name),indexable:!listing});
}
export default async function Category({params,searchParams}:Props){
 // Next 16.4 renders an in-page notFound() as an empty error shell that only JavaScript fills, so missing resources redirect to the server-rendered /404 page (status 404).
 const category=await load((await params).slug);if(!category) redirect('/404');
 const config=siteConfig();
 return <><JsonLd data={jsonLdGraph(breadcrumbJsonLd(config,[{name:'Beranda',path:'/'},{name:'Kategori produk',path:'/kategori'},{name:category.name,path:categoryPath(category.slug)}]))}/><CatalogListing raw={await searchParams} category={category}/></>;
}
