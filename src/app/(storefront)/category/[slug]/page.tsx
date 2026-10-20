import {redirect} from 'next/navigation';
import {getLocalAuth} from '../../../../modules/access/auth';
import Search from '../../search/page';
import {publicCategory} from '../../../../modules/storefront/catalog';
export const dynamic='force-dynamic';
export default async function Category({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {slug}=await params;if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>100) redirect('/404');
 const category=await publicCategory(getLocalAuth().sql,slug,'slug');if(!category) redirect('/404');
 const query=await searchParams;return Search({searchParams:Promise.resolve({...query,category_id:category.id})});
}
