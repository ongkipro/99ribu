import Link from 'next/link';
import {CatalogImage} from '../ui/media';
export type Department={id:string;name:string;slug:string;parent_id:string|null};
// shop.com home "Categories" grid (observed 2026-10-23): short rounded tiles, 2 columns on phones up
// to 5 on desktop. shop.com's art is a full-bleed photo; ours is the department's own product photo
// clipped into the tile's end on the department tint, so the dark label keeps >=4.5:1 contrast.
export function CategoryGrid({tiles}:{tiles:{department:Department;tint:string;photo:{src:string;width:number;height:number}|null}[]}){
 return <ul className="category-grid">{tiles.map(({department,tint,photo})=><li key={department.id}><Link href={`/kategori/${department.slug}`} data-tint={tint}>
  <span className="category-tile-label">{department.name.replace(/ & /g,' &\u00a0')}</span>
  {photo&&<span className="category-tile-art" aria-hidden="true">
   <CatalogImage src={photo.src} sizes="(max-width: 700px) 25vw, 128px" max={256} min={96} alt="" width={photo.width} height={photo.height} loading="lazy" decoding="async" referrerPolicy="no-referrer"/></span>}
 </Link></li>)}</ul>;
}
