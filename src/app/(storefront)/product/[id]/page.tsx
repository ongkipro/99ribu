import type {Metadata} from 'next';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {cache} from 'react';
import {Shell} from '../../../../components/storefront/shell';
import {Media,rupiah,contentName,isSampleProduct} from '../../../../components/storefront/products';
import {Icon} from '../../../../components/storefront/icon';
import {OfferPicker} from '../../../../components/storefront/offer-picker';
import {CartForm,CartMutations} from '../../../../components/storefront/cart-forms';
import {getLocalAuth} from '../../../../modules/access/auth';
import {matchingVariant,publicProduct,publicCategory} from '../../../../modules/storefront/catalog';
import {initialCartIntent,initialCartMutation} from '../../../../modules/storefront/cart';
import {currentBrowserCart} from '../../../../modules/storefront/browser';
import {productHref,publicReturnPath} from '../../../../modules/storefront/navigation';
import {feedItem} from '../../../../modules/catalog/feed';
import {readLocalConfig} from '../../../../config/local';

type Props={params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const load=cache((id:string)=>getLocalAuth().sql.begin(async tx=>{const product=await publicProduct(tx,id);return {product,category:product?await publicCategory(tx,product.category_id):null};}));
export const dynamic='force-dynamic';
// Page metadata reuses the local feed item so title, canonical offer link and media
// match the export exactly; root noindex stays until a live indexing gate exists.
export async function generateMetadata({params,searchParams}:Props):Promise<Metadata>{
 const {id}=await params;if(!uuid.test(id))return {};const {product}=await load(id);if(!product)return {};
 const requested=(await searchParams).offer,offer=product.variants.find(v=>v.id===requested)??matchingVariant(product);if(!offer)return {title:product.name};
 const {item}=feedItem(readLocalConfig(process.env).origin,product,offer);
 return {title:item.title,description:item.description,alternates:{canonical:item.link},openGraph:{type:'website',url:item.link,title:item.title,description:item.description,...(item.image_link?{images:[item.image_link]}:{})}};
}
export default async function Product({params,searchParams}:Props){
 const {id}=await params;
 if(!uuid.test(id))redirect('/404');
 const {product,category}=await load(id);if(!product)redirect('/404');
 const query=await searchParams,requested=query.offer,from=publicReturnPath(query.from);
 const invalid=requested!==undefined&&(typeof requested!=='string'||!product.variants.some(v=>v.id===requested));
 const offer=invalid?null:requested?product.variants.find(v=>v.id===requested):matchingVariant(product);
 const current=await currentBrowserCart(),open=current.kind==='ready'&&current.cart.state==='open'&&Date.parse(current.cart.expires_at)>Date.parse(current.now);
 const intent=initialCartIntent({product:product.id,variant:offer?.id??'',publication:product.publication_id,...(current.kind==='ready'?open?{cart:current.cart.id,version:String(current.cart.version)}:{generation:current.cart.id}:{})});
 const denied=current.kind==='denied'||current.kind==='unavailable',sample=isSampleProduct(product),description=sample?product.description.replace(/^Data contoh\. /,''):product.description;
 const facts=[...(offer?.attributes??[]),...product.facts.filter(f=>!offer?.attributes.some(a=>a.key===f.key))],alternative=product.variants.find(v=>v.availability==='available'&&v.id!==offer?.id);
 return <Shell active="none" task backTo={from}><main id="main" className="wrap product-detail"><nav className="product-category" aria-label="Kategori produk"><Link href="/search">Semua produk</Link>{category&&<><span aria-hidden="true">/</span><Link href={`/category/${category.slug}`}>{category.name}</Link></>}</nav><div className="detail-layout"><Media product={product} offer={offer??undefined} caption/><section><h1>{product.name}</h1>
  {offer&&<p className="detail-price">{rupiah(offer.price)} <small>/ pilihan lengkap</small></p>}
  {invalid&&<section className="cart-warning" role="alert"><h2>Pilihan belum ditemukan</h2><p>Pilih kembali opsi produk ini sebelum menambahkannya.</p></section>}
  <OfferPicker from={from} selected={offer?.id??''} choices={product.variants.map(v=>({id:v.id,label:v.label,available:v.availability==='available'}))}/>
  {offer?<section className="offer-detail" aria-label="Rincian pilihan"><h2>Isi yang diterima</h2><ul>{offer.contents.map(c=><li key={c.name}>{c.quantity} × {contentName(product,c.name)}</li>)}</ul>
   <div className="purchase-region"><p className="stock-status"><Icon name={offer.availability==='available'?'check':'alert'}/>{offer.availability==='available'?'Stok pilihan tersedia':'Stok pilihan belum tersedia'}</p>
   {offer.availability!=='available'&&<p className="cart-advisory">Pilihan ini belum dapat ditambahkan. {alternative?<Link href={productHref(product.id,alternative.id,from)}>Lihat pilihan tersedia</Link>:<Link href={category?`/category/${category.slug}?availability=available`:'/search?availability=available'}>Cari produk tersedia</Link>}</p>}
   {current.kind==='ready'&&!open&&<p className="cart-warning">Keranjang sebelumnya {current.cart.state==='submitted'?'sudah menjadi pesanan':'kedaluwarsa'}. Penambahan berikutnya memulai keranjang baru.</p>}
   {denied?<p className="cart-warning">{current.kind==='denied'?'Sesi belanja perlu diperiksa.':'Keranjang belum dapat dimuat.'} <Link href="/cart">Periksa keranjang</Link></p>:<CartMutations initial={initialCartMutation(intent)} permalink={productHref(product.id,offer.id,from)} showCartLink><CartForm intent={intent} label="Tambah ke keranjang" disabled={offer.availability!=='available'}/></CartMutations>}
   <p className="cart-advisory">Stok diperiksa kembali saat ditambahkan. Isi keranjang belum memesan stok.</p></div>
  </section>:<p className="cart-advisory">Belum ada pilihan yang dapat ditambahkan.</p>}
  <section className="product-facts"><h2>Spesifikasi</h2>{facts.length?<dl>{facts.map(f=><div key={f.key}><dt>{f.label}</dt><dd>{f.values.join(', ')}</dd></div>)}</dl>:<p className="cart-advisory">Spesifikasi tambahan belum tersedia.</p>}</section>
  {/* Description follows the purchase action (shop.com order); a short one stays open, a long catalog text starts collapsed. */}
  {description&&!(sample&&description==='Harga berlaku untuk satu pilihan lengkap sesuai rincian isi.')&&<details className="product-policy" open={description.length<=160}><summary>Deskripsi<Icon name="chevron"/></summary><p className="detail-description">{description}</p></details>}
  <details className="product-policy"><summary>Ongkir dan pengiriman<Icon name="chevron"/></summary><p>Ongkir dihitung dari alamat dan paket, lalu ditampilkan sebelum konfirmasi. Hari libur tidak dihitung sebagai hari proses pengiriman.</p></details>
  <details className="product-policy"><summary>Pengembalian<Icon name="chevron"/></summary><p>Ketentuan pengembalian belum diterbitkan.</p><Link className="detail-help" href="/help#returns">Ketentuan pengembalian</Link></details>
 </section></div></main></Shell>;
}
