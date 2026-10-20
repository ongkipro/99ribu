import Link from 'next/link';
export type Department={id:string;name:string;slug:string;parent_id:string|null};
export function Departments({categories}:{categories:Department[]}){
 return <ul className="department-tiles">{categories.map(category=><li key={category.id}><Link href={`/category/${category.slug}`}><div className="department-photo" role="img" aria-label={`Slot foto kategori ${category.name}; foto belum tersedia`}><div className="department-shot"><small>Foto belum tersedia</small><p>{category.name==='Busana'?'Foto kaos terlipat dan tampak depan.':category.name==='Perawatan'?'Foto seluruh kemasan, label depan.':`Foto ragam produk ${category.name}.`}</p></div></div><span>{category.name}</span></Link></li>)}</ul>;
}
