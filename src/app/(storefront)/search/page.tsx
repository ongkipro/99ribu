import Link from 'next/link';
import {Shell} from '../../../components/storefront/shell';
import {Listing} from '../../../components/storefront/listing';
import {getLocalAuth} from '../../../modules/access/auth';
import {AccessError} from '../../../modules/access/policy';
import {catalogQuery,listCategories,listProducts,publicCategory} from '../../../modules/storefront/catalog';
export const dynamic='force-dynamic';
export const metadata={title:'Cari produk'};
export default async function Search({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const raw=await searchParams,params=new URLSearchParams();for(const [key,value] of Object.entries(raw)){if(Array.isArray(value)) for(const v of value) params.append(key,v);else if(value!==undefined) params.set(key,value);}
 const q=typeof raw.q==='string'?raw.q:'';
 try{
  const attributes:Record<string,string[]>={};
  for(const key of new Set(params.keys())) if(key.startsWith('filter.')){if(!/^filter\.[a-z][a-z0-9_]{0,49}$/.test(key)||params.has('attributes')) throw new AccessError(400,'INVALID_INPUT');attributes[key.slice(7)]=params.getAll(key);params.delete(key);}
  if(Object.keys(attributes).length) params.set('attributes',JSON.stringify(attributes));
  const input=catalogQuery(params),identity=getLocalAuth();const [result,categories]=await Promise.all([listProducts(identity,input),listCategories(identity,new URLSearchParams({limit:'100'}))]);
  const category=input.category_id?await publicCategory(identity.sql,input.category_id):null;const current=category?[category]:[];
  const options=[...new Map([...current,...categories.data].map(c=>[c.id,c])).values()];
  return <Shell q={input.q} active={input.category_id&&!input.q?'category':'none'}><Listing input={input} products={result.data} next={result.pagination.next_cursor} categories={options as {id:string;name:string;slug:string;parent_id:string|null}[]} categoryName={current[0]?.name} facets={result.available_filters}/></Shell>;
 }catch(error){if(!(error instanceof AccessError)||![400,404].includes(error.status)) throw error;
  const safeQuery=[...q].slice(0,200).join('');
  const issue=typeof raw.sort==='string'&&!['','relevance','newest'].includes(raw.sort)?'Urutan produk belum dikenal. Pilih Paling sesuai atau Publikasi terbaru.':error.status===404?'Kategori yang dipilih belum tersedia.':'Ada parameter filter yang belum didukung atau nilainya tidak sesuai.';
  return <Shell q={safeQuery} active="none"><main id="main" className="wrap empty-state"><h1>Filter belum bisa digunakan</h1><p>{issue}</p>{safeQuery&&<p>Pencarian: “{safeQuery}”</p>}<Link className="button" href={safeQuery?`/search?q=${encodeURIComponent(safeQuery)}`:'/search'}>Hapus filter</Link></main></Shell>;
 }
}
