import Link from 'next/link';
import {getLocalAuth} from '../../modules/access/auth';
import {departmentPhoto} from '../../modules/storefront/catalog';
import {isSampleUrl,sameOrigin} from './products';
export type Department={id:string;name:string;slug:string;parent_id:string|null};
export async function Departments({categories,exclude=[]}:{categories:Department[];exclude?:readonly string[]}){
 const identity=getLocalAuth(),photos=await Promise.all(categories.map(category=>departmentPhoto(identity,category.id,exclude)));
 return <ul className="department-tiles">{categories.map((category,index)=>{const photo=photos[index];return <li key={category.id}><Link href={`/category/${category.slug}`}>{photo&&!isSampleUrl(photo.url)
  // biome-ignore lint/performance/noImgElement: same native local media as product cards; no image proxy.
  ?<div className="department-photo has-photo"><img src={sameOrigin(photo.url)} alt={`Contoh produk kategori ${category.name}`} width={photo.width} height={photo.height} loading="lazy" referrerPolicy="no-referrer"/></div>
  :<div className="department-photo" role="img" aria-label={`Slot foto kategori ${category.name}; foto belum tersedia`}><div className="department-shot"><small>Foto belum tersedia</small><p>{`Foto ragam produk ${category.name}.`}</p></div></div>}<span>{category.name}</span></Link></li>;})}</ul>;
}
