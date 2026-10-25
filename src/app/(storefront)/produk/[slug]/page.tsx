import type {Metadata} from 'next';
import Link from 'next/link';
import {permanentRedirect,redirect} from 'next/navigation';
import {cache,Suspense} from 'react';
import {Shell} from '../../../../components/storefront/shell';
import {Media,ProductGrid,rupiah,contentName,isSampleProduct,keepHyphens,sameOrigin} from '../../../../components/storefront/ui/product-card';
import {ProductGallery} from '../../../../components/storefront/sections/product-gallery';
import {Icon} from '../../../../components/storefront/ui/icon';
import {OfferPicker} from '../../../../components/storefront/offer-picker';
import {CartForm,CartMutations} from '../../../../components/storefront/cart-forms';
import {getLocalAuth} from '../../../../modules/access/auth';
import {catalogQuery,listProducts,matchingVariant,publicProduct,publicCategory,type PublicCategory} from '../../../../modules/storefront/catalog';
import {initialCartIntent,initialCartMutation} from '../../../../modules/storefront/cart';
import {currentBrowserCart} from '../../../../modules/storefront/browser';
import {productHref,productIdFromSlug,productSlug,publicReturnPath} from '../../../../modules/storefront/navigation';
import {JsonLd} from '../../../../components/storefront/json-ld';
import {siteConfig} from '../../../../config/site';
import {breadcrumbJsonLd,categoryPath,jsonLdGraph,productDescription,productJsonLd,productPath,productTitle,publicMetadata} from '../../../../modules/storefront/seo';
import './product.css';

type Props={params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
const load=cache((id:string)=>getLocalAuth().sql.begin(async tx=>{const product=await publicProduct(tx,id);return {product,category:product?await publicCategory(tx,product.category_id):null};}));
export const dynamic='force-dynamic';
// Metadata and canonical name the clean product URL: ?offer= and ?from= only select state on
// this page, so they never become separate indexable URLs (seo.ts routePolicy).
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const id=productIdFromSlug((await params).slug);if(!id)return {};const {product,category}=await load(id);if(!product)return {};
 const image=matchingVariant(product)?.image??product.images[0];
 return publicMetadata(siteConfig(),{path:productPath(product.id,product.name),title:productTitle(product,category?.name),description:productDescription(product,category?.name),...(image?{image}:{})});
}

// shop.com "You might also like" grid (5 columns, 32px gaps on desktop), from what 99ribu has: other current
// products of the same category, newest first, through the guarded public reader. Streamed after the
// buy box (its own Suspense boundary), so it never delays the product, price or purchase action.
async function RelatedShelf({product,category}:{product:string;category:PublicCategory}){
 let items:Awaited<ReturnType<typeof listProducts>>['data']=[];
 try{items=(await listProducts(getLocalAuth(),catalogQuery(new URLSearchParams({category_id:category.id,sort:'newest',limit:'21'})))).data.filter(p=>p.id!==product).slice(0,20);}catch{return null;}
 if(items.length<2)return null;
 return <section className="home-shelf related-shelf" aria-labelledby="related-heading"><h2 id="related-heading" className="shelf-heading"><Link href={`/kategori/${category.slug}`}>Lainnya di {category.name}<Icon name="forward"/></Link></h2><ProductGrid products={items}/></section>;
}

export default async function Product({params,searchParams}:Props){
 const {slug}=await params,id=productIdFromSlug(slug);
 // Next 16.4 renders an in-page notFound() as an empty error shell that only JavaScript fills, so missing resources redirect to the server-rendered /404 page (status 404).
 if(!id)redirect('/404');
 const {product,category}=await load(id);if(!product)redirect('/404');
 const query=await searchParams;
 // The id resolves the page; a stale or missing title part answers 308 to the canonical slug, keeping the query.
 if(slug!==productSlug(product.id,product.name)){const keep=new URLSearchParams();for(const [key,value] of Object.entries(query))for(const v of [value].flat())if(typeof v==='string')keep.append(key,v);permanentRedirect(`/produk/${productSlug(product.id,product.name)}${keep.size?`?${keep}`:''}`);}
 const requested=query.offer,from=publicReturnPath(query.from);
 const invalid=requested!==undefined&&(typeof requested!=='string'||!product.variants.some(v=>v.id===requested));
 const offer=invalid?null:requested?product.variants.find(v=>v.id===requested):matchingVariant(product);
 const current=await currentBrowserCart(),open=current.kind==='ready'&&current.cart.state==='open'&&Date.parse(current.cart.expires_at)>Date.parse(current.now);
 const intent=initialCartIntent({product:product.id,variant:offer?.id??'',publication:product.publication_id,...(current.kind==='ready'?open?{cart:current.cart.id,version:String(current.cart.version)}:{generation:current.cart.id}:{})});
 const denied=current.kind==='denied'||current.kind==='unavailable',sample=isSampleProduct(product),description=sample?product.description.replace(/^Data contoh\. /,''):product.description;
 // The selected offer's photo leads, then the product's other photos (bundles: one per item).
 const photos=[...new Map([offer?.image,...product.images].filter(i=>i!==undefined&&i!==null).map(i=>[i.url,{src:sameOrigin(i.url),alt:i.alt,width:i.width,height:i.height}])).values()];
 const facts=[...(offer?.attributes??[]),...product.facts.filter(f=>!offer?.attributes.some(a=>a.key===f.key))],alternative=product.variants.find(v=>v.availability==='available'&&v.id!==offer?.id);
 // Every complete offer has the same fixed price, so the price line stays in place while an offer is chosen.
 const price=(offer??product.variants[0])?.price;
 const showDescription=description&&!(sample&&description==='Harga berlaku untuk satu pilihan lengkap sesuai rincian isi.'),longDescription=description.length>360||description.split('\n').length>8;
 return <Shell active="none"><main id="main" className="wrap product-detail"><JsonLd data={jsonLdGraph(productJsonLd(siteConfig(),product,category),breadcrumbJsonLd(siteConfig(),[{name:'Beranda',path:'/'},...(category?[{name:category.name,path:categoryPath(category.slug)}]:[]),{name:product.name,path:productPath(product.id,product.name)}]))}/><div className="detail-layout">{sample||!photos.length?<Media product={product} offer={offer??undefined} caption/>:<ProductGallery images={photos}/>}<section className="buy-box" aria-labelledby="product-title">
  <div className="buy-head"><nav className="product-category" aria-label="Kategori produk"><Link href="/cari">Semua produk</Link>{category&&<span><span aria-hidden="true">/</span><Link href={`/kategori/${category.slug}`}>{category.name}</Link></span>}</nav><h1 id="product-title">{keepHyphens(product.name)}</h1>
   {price!==undefined&&<p className="detail-price">{rupiah(price)}</p>}</div>
  {invalid&&<section className="cart-warning" role="alert"><h2>Pilihan belum ditemukan</h2><p>Pilih kembali opsi produk ini sebelum menambahkannya.</p></section>}
  {/* One choice: its name moves into the "Isi yang diterima" section below; several: the pills stay in view. */}
  {(product.variants.length>1||!offer)&&<OfferPicker product={product.id} name={product.name} from={from} selected={offer?.id??''} choices={product.variants.map(v=>({id:v.id,label:v.label,available:v.availability==='available'}))}/>}
  {offer?<>
   <div className="purchase-region">{offer.availability!=='available'&&<p className="stock-status"><Icon name="alert"/>Stok pilihan belum tersedia</p>}
   {/* The stock line already says it; the way out is one secondary pill. */}
   {offer.availability!=='available'&&<Link className="button secondary stock-exit" href={alternative?productHref(product.id,alternative.id,from,product.name):category?`/kategori/${category.slug}?availability=available`:'/cari?availability=available'}>{alternative?'Lihat pilihan tersedia':'Cari produk tersedia'}</Link>}
   {current.kind==='ready'&&!open&&<p className="cart-warning">Keranjang sebelumnya {current.cart.state==='submitted'?'sudah menjadi pesanan':'kedaluwarsa'}. Penambahan berikutnya memulai keranjang baru.</p>}
   {denied?<p className="cart-warning">{current.kind==='denied'?'Sesi belanja perlu diperiksa.':'Keranjang belum dapat dimuat.'} <Link href="/keranjang">Periksa keranjang</Link></p>:<CartMutations initial={initialCartMutation(intent)} permalink={productHref(product.id,offer.id,from,product.name)} showCartLink><CartForm intent={intent} label="Tambah ke keranjang" disabled={offer.availability!=='available'} stepper bar={rupiah(offer.price)} buyNow/></CartMutations>}
   <p className="cart-advisory">Stok diperiksa kembali saat ditambahkan. Isi keranjang belum memesan stok.</p></div>
  </>:!invalid&&<p className="cart-advisory">Belum ada pilihan yang dapat ditambahkan.</p>}
  {/* Spesifikasi only when the product has spec data; no empty heading or placeholder. */}
  {facts.length>0&&<section className="product-facts"><h2>Spesifikasi</h2><dl>{facts.map(f=><div key={f.key}><dt>{f.label}</dt><dd>{f.values.join(', ')}</dd></div>)}</dl></section>}
  {/* shop.com opens its sections; a long catalog text shows its first lines with "Baca selengkapnya" (the full text stays in the HTML). */}
  <div className="product-sections">
   {showDescription&&<details className="product-policy" open><summary>Deskripsi<Icon name="chevron"/></summary><div className="description-body"><p className="detail-description">{description}</p>{longDescription&&<details className="read-more"><summary><span className="more-show">Baca selengkapnya</span><span className="more-hide">Tampilkan lebih sedikit</span></summary></details>}</div></details>}
   {/* Owner 2026-10-25: the package contents fold under Deskripsi (closed), keeping the buy box clean. */}
   {offer&&<details className="product-policy"><summary>Isi yang diterima<Icon name="chevron"/></summary><div className="offer-detail">{product.variants.length===1&&<p className="offer-detail-label">{offer.label}</p>}<ul>{offer.contents.map(c=><li key={c.name}>{c.quantity} × {contentName(product,c.name)}</li>)}</ul></div></details>}
   <details className="product-policy" open><summary>Pengiriman dan pembayaran<Icon name="chevron"/></summary><ul className="policy-rows">
    <li><Icon name="truck"/><span>Ongkir dihitung dari alamat dan paket, lalu ditampilkan sebelum konfirmasi.</span></li>
    <li><Icon name="clock"/><span>Hari libur tidak dihitung sebagai hari proses pengiriman.</span></li>
    <li><Icon name="wallet"/><span>Bayar transfer bank, VA/QRIS, atau COD. Ketersediaan COD dicek saat checkout dan ada biaya COD.</span></li>
   </ul></details>
   <details className="product-policy"><summary>Pengembalian<Icon name="chevron"/></summary><p>Ketentuan pengembalian belum diterbitkan.</p><Link className="detail-help" href="/bantuan#returns">Ketentuan pengembalian</Link></details>
  </div>
 </section></div>
 {category&&<Suspense fallback={null}><RelatedShelf product={product.id} category={category}/></Suspense>}
 </main></Shell>;
}
