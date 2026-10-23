import Link from 'next/link';
import type {CatalogQuery,PublicProduct} from '../../modules/storefront/catalog';
import {ProductGrid} from './products';
import {FilterPanel} from './filter-panel';
import {Icon} from './shell';
type Category={id:string;name:string;slug:string;parent_id:string|null};
type Facet={key:string;label:string;values:string[]};
const kinds:Record<string,string>={unit:'Satuan',multipack:'Paket barang yang sama',bundle:'Paket campuran'};
export function Listing({input,products,next,categories,categoryName,facets,pinned}:{input:CatalogQuery;products:PublicProduct[];next:string|null;categories:Category[];categoryName?:string;facets:Facet[];pinned?:{id:string;path:string}}){
 // On a category page, links that keep its category (pagination, filter removal) stay on /category/<slug>.
 const url=(override:Partial<CatalogQuery>={})=>{const value={...input,cursor:null,...override},onPage=pinned&&value.category_id===pinned.id,params=new URLSearchParams();
  for(const key of ['q','category_id','offer_kind','availability','sort','limit','cursor'] as const) if(value[key]&&!(onPage&&key==='category_id')) params.set(key,String(value[key]));
  if(Object.keys(value.attributes).length) params.set('attributes',JSON.stringify(value.attributes));return onPage?`${pinned.path}?${params}`:`/cari?${params}`;
 };
 const resetParams=new URLSearchParams();if(input.q) resetParams.set('q',input.q);if(input.category_id) resetParams.set('category_id',input.category_id);
 const resetHref=pinned?(input.q?`${pinned.path}?${new URLSearchParams({q:input.q})}`:pinned.path):resetParams.toString()?`/cari?${resetParams}`:'/cari';
 const categoryControl=<><label htmlFor="category-filter">Kategori</label><select id="category-filter" name="category_id" defaultValue={input.category_id??''}><option value="">Semua kategori</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></>;
 const separateCategory=facets.some(f=>f.values.length>0)||Object.keys(input.attributes).length>0;
 const active:{key:string;label:string;href:string}[]=[];
 // On /kategori/<slug> the route is the category filter; no removable chip repeats it.
 if(input.category_id&&input.category_id!==pinned?.id) active.push({key:'category',label:`Kategori: ${categoryName??'Dipilih'}`,href:url({category_id:null,attributes:{}})});
 if(input.offer_kind) active.push({key:'kind',label:`Isi pilihan: ${kinds[input.offer_kind]}`,href:url({offer_kind:null})});
 if(input.availability) active.push({key:'availability',label:`Stok: ${input.availability==='available'?'Tersedia':'Belum tersedia'}`,href:url({availability:null})});
 if(input.sort==='newest') active.push({key:'sort',label:'Urutan: Publikasi terbaru',href:url({sort:'relevance'})});
 for(const [key,values] of Object.entries(input.attributes)){const attributes={...input.attributes};delete attributes[key];active.push({key:`attribute-${key}`,label:`${facets.find(f=>f.key===key)?.label??key}: ${values.join(', ')}`,href:url({attributes})});}
 return <main id="main" className="wrap listing-main"><h1>{input.q?`Hasil untuk “${input.q}”`:categoryName??'Semua produk'}</h1>{products.length>0&&<p className="listing-note">{products.length} produk pada halaman ini. Rp99.000 per pilihan lengkap.</p>}
  {active.length>0&&<ul className="active-filters" aria-label="Filter aktif">{active.map(filter=>{const lastSpace=filter.label.lastIndexOf(' ');return <li key={filter.key}><Link href={filter.href} aria-label={`Hapus filter ${filter.label}`}><span>{filter.label.slice(0,lastSpace+1)}<span className="filter-tail"><span>{filter.label.slice(lastSpace+1)}</span>{'\u00a0'}<Icon name="close"/></span></span></Link></li>;})}</ul>}
  <div className="listing-layout"><FilterPanel>{separateCategory&&<form action="/cari" aria-label="Ganti kategori">
   {input.q&&<input type="hidden" name="q" value={input.q}/>}
   {(['offer_kind','availability','sort','limit'] as const).map(key=>input[key]&&<input key={key} type="hidden" name={key} value={input[key]}/>)}
   <div className="filter-field">{categoryControl}</div>
   <button className="button secondary" type="submit">Lihat kategori</button>
  </form>}<form action="/cari" aria-label="Filter produk">
   {input.q&&<input type="hidden" name="q" value={input.q}/>}
   {separateCategory?input.category_id&&<input type="hidden" name="category_id" value={input.category_id}/>:<div className="filter-field">{categoryControl}</div>}
   <input type="hidden" name="limit" value={input.limit}/>
   <div className="filter-field"><label htmlFor="kind-filter">Isi pilihan</label><select id="kind-filter" name="offer_kind" defaultValue={input.offer_kind??''}><option value="">Semua pilihan</option><option value="unit">Satuan</option><option value="multipack">Paket barang yang sama</option><option value="bundle">Paket campuran</option></select></div>
   <div className="filter-field"><label htmlFor="stock-filter">Ketersediaan</label><select id="stock-filter" name="availability" defaultValue={input.availability??''}><option value="">Semua stok</option><option value="available">Tersedia</option><option value="unavailable">Belum tersedia</option></select></div>
   <div className="filter-field"><label htmlFor="sort-filter">Urutan</label><select id="sort-filter" name="sort" defaultValue={input.sort}><option value="relevance">Paling sesuai</option><option value="newest">Publikasi terbaru</option></select></div>
   {facets.filter(f=>f.values.length).map(f=><fieldset className="facet" key={f.key}><legend>{f.label}</legend>{f.values.map(value=><label className="facet-option" key={value}><input type="checkbox" name={`filter.${f.key}`} value={value} defaultChecked={input.attributes[f.key]?.includes(value)??false}/>{value}</label>)}</fieldset>)}
   <div className="filter-actions"><button className="button" type="submit">Terapkan filter</button><Link className="reset-link" href={resetHref}>Hapus filter</Link></div>
  </form></FilterPanel><section aria-label="Hasil produk">
   {products.length?<><h2 className="sr-only">Daftar produk</h2><ProductGrid products={products} input={input}/></>:<div className="empty-state"><h2>{next?'Belum ada kecocokan di halaman ini':'Belum ada produk yang sesuai'}</h2><p>{next?'Lanjutkan pencarian pada halaman berikutnya dengan filter yang sama.':'Coba kata lain atau hapus filter untuk melihat pilihan lain.'}</p><Link className="button" href={next?url({cursor:next}):'/cari'}>{next?'Halaman berikutnya':'Lihat semua produk'}</Link></div>}
   {next&&products.length>0&&<div className="pagination"><Link className="button secondary" href={url({cursor:next})}>Halaman berikutnya</Link><p>Stok dan publikasi diperiksa lagi pada setiap halaman.</p></div>}
  </section></div>
 </main>;
}
