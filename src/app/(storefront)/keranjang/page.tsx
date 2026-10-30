import Link from 'next/link';
import {Shell} from '../../../components/storefront/shell';
import {Icon} from '../../../components/storefront/ui/icon';
import {Media,contentName,rupiah} from '../../../components/storefront/ui/product-card';
import {CartForm,CartMutations,CartProgression,RestartShopping} from '../../../components/storefront/cart-forms';
import {currentCartView} from '../../../modules/storefront/browser';
import {cartUnits,initialCartIntent,initialCartMutation} from '../../../modules/storefront/cart';
import {ProductLink} from '../../../components/storefront/navigation';
import {featuredProducts,matchingVariant,type PublicProduct} from '../../../modules/storefront/catalog';
import {homeSafe} from '../../../modules/storefront/department-photos';
import {getLocalAuth} from '../../../modules/access/auth';
import {CatalogImage} from '../../../components/storefront/ui/media';
import {sameOrigin} from '../../../modules/storefront/format';

import {privateMetadata} from '../../../modules/storefront/seo';
export const dynamic='force-dynamic';
export const metadata=privateMetadata('Keranjang');
export default async function Cart(){
 const view=await currentCartView();
 if(view.kind!=='ready')return <Shell active="cart"><main id="main" className="wrap empty-state"><h1>{view.kind==='none'?'Keranjang masih kosong':view.kind==='denied'?'Sesi belanja perlu diperiksa':'Keranjang belum dapat dimuat'}</h1><p>{view.kind==='none'?'Pilih produk dan periksa isi lengkapnya sebelum menambahkan ke keranjang.':view.kind==='denied'?'Akses keranjang ini berakhir atau tidak sesuai dengan sesi Anda. Isi keranjang tidak ditampilkan.':'Muat ulang halaman untuk mencoba lagi. Isi keranjang tidak dihapus.'}</p><div className="session-actions">{view.kind!=='none'&&<Link className="button" href="/keranjang">Muat ulang keranjang</Link>}<Link className={view.kind==='none'?'button':'button secondary'} href="/cari">Lihat produk</Link>{view.kind==='denied'&&<RestartShopping/>}</div></main></Shell>;
 const {cart}=view,expired=Date.parse(cart.expires_at)<=Date.parse(view.now),closed=expired||cart.state!=='open',checkoutReady=!closed&&cart.lines.length>0&&view.lines.every(line=>line.product&&line.offer&&line.stock&&!line.publicationChanged);
 const initial=initialCartMutation(initialCartIntent());
 // shop.com cart rail ("You might also like"): the newest current products not already in the cart, without claim products.
 const inCart=new Set(cart.lines.map(line=>line.product_id)),picks=closed?[]:(await featuredProducts(getLocalAuth(),16)).filter(p=>!inCart.has(p.id)&&homeSafe(p)&&matchingVariant(p)?.availability==='available').slice(0,5);
 return <Shell active="cart"><main id="main" className="wrap cart-page"><div className="cart-heading"><h1>Keranjang</h1>{cart.lines.length>0&&!closed&&<Link href="/cari">Lanjut belanja</Link>}</div>
  {closed&&<section className="cart-warning" role="alert"><h2>{cart.state==='submitted'?'Keranjang sudah menjadi pesanan':'Keranjang kedaluwarsa'}</h2><p>{cart.lines.length>0&&'Isi berikut adalah catatan keranjang sebelumnya. '}{cart.state==='submitted'?'Periksa pesanan yang tersimpan sebelum memesan kembali.':'Pilih produk untuk memulai keranjang baru.'}</p>{cart.state==='submitted'&&cart.submitted_order_id?<Link className="button" href={`/checkout/order/${cart.submitted_order_id}`}>Periksa pesanan</Link>:cart.lines.length>0&&<Link className="button" href="/cari">Lihat produk</Link>}</section>}
  <CartMutations initial={initial} permalink="/keranjang" activeLines={closed?[]:cart.lines.map(line=>line.id)}>{cart.lines.length?<div className="cart-layout"><section className="cart-card" aria-label="Isi keranjang"><noscript><style>{'.cart-line .quantity-stepper button{display:none}'}</style></noscript>
  <header className="cart-store"><span className="cart-store-mark" aria-hidden="true">99</span><div><p className="cart-store-name">99ribu</p><p className="cart-store-note">{rupiah(99000)} per pilihan lengkap</p></div></header><ul className="cart-lines">{view.lines.map(({line,slug,product,offer,stock,publicationChanged})=>{
   const base={product:line.product_id,variant:line.variant_id,publication:offer&&product?product.publication_id:line.publication_id,quantity:String(line.quantity),cart:cart.id,version:String(cart.version),line:line.id};
   const reviewable=Boolean(product&&offer&&publicationChanged);
   return <li key={line.id} className="cart-line"><div className="cart-line-media">{product&&offer?<Media product={product} offer={offer}/>:<div className="photo-slot" role="img" aria-label="Foto produk belum tersedia">Foto belum tersedia</div>}</div><div className="cart-line-details"><h2><ProductLink product={line.product_id} slug={slug} offer={line.variant_id} defaultOffer={product?matchingVariant(product)?.id:null}>{line.name}</ProductLink></h2><p className="line-variant">{line.variant_label}</p><h3 className="contents-label">Isi saat ditambahkan</h3>{(()=>{const item=(c:typeof line.contents[number])=><li key={c.stock_item_id}>{c.quantity} × {product?contentName(product,c.name):c.name}</li>;
    // Same fold as the PDP: three items listed, the rest behind a disclosure.
    return line.contents.length<=3?<ul className="cart-contents">{line.contents.map(item)}</ul>:<><ul className="cart-contents">{line.contents.slice(0,3).map(item)}</ul><details className="contents-more"><summary><span className="more-show">Lihat {line.contents.length-3} barang lainnya</span><span className="more-hide">Sembunyikan barang lainnya</span><Icon name="chevron"/></summary><ul className="cart-contents">{line.contents.slice(3).map(item)}</ul></details></>;})()}</div>
    {!closed&&product&&offer&&publicationChanged&&<section className="cart-warning" id={`review-${line.id}`} role="alert"><h3>Rincian pilihan berubah</h3><h4>Isi terbaru</h4><ul className="publication-contents">{offer.contents.map(c=><li key={c.name}>{c.quantity} × {contentName(product,c.name)}</li>)}</ul><p>Persetujuan mempertahankan jumlah {line.quantity} pilihan. Periksa isinya sebelum menyetujui.</p></section>}
    {!closed&&<div className="cart-line-actions"><CartForm intent={initialCartIntent({...base,kind:'update'})} label={reviewable?'Setujui isi terbaru':'Perbarui jumlah'} subject={`${line.name}, ${line.variant_label}`} notice={!product||!offer?'Pilihan ini tidak lagi dijual. Hapus dari keranjang atau pilih produk lain.':!stock?'Stok tidak cukup untuk jumlah ini. Kurangi jumlah atau hapus pilihan.':undefined} reviewId={reviewable?`review-${line.id}`:undefined} quantity={!reviewable} stepper disabled={closed||!offer}/><CartForm intent={initialCartIntent({...base,kind:'remove'})} label="Hapus" subject={`${line.name}, ${line.variant_label}`} quantity={false} disabled={closed}/></div>}
    <p className="line-total"><strong>{rupiah(line.line_total)}</strong><span>{line.quantity} pilihan lengkap × {rupiah(line.unit_price)}</span></p>
   </li>;
  })}</ul><div className="cart-summary"><CartProgression checkout={checkoutReady}><div className="cart-total"><h2>{closed?'Catatan keranjang':`Estimasi total (${cartUnits(cart)} pilihan)`}</h2><p className="cart-total-amount">{rupiah(cart.merchandise_total)}</p></div><p className="cart-advisory">{cartUnits(cart)} pilihan lengkap. {closed?'Jumlah ini adalah catatan produk pada keranjang sebelumnya.':'Ongkir dan penyesuaian dihitung saat checkout. Isi keranjang belum memesan stok.'}</p>{!closed&&view.quote==='expired'&&<p className="cart-warning">Perhitungan ongkir sebelumnya kedaluwarsa. Pilih ulang pengiriman saat checkout.</p>}{!closed&&view.quote==='current'&&<p className="cart-advisory">Perhitungan pengiriman tersedia untuk isi keranjang saat ini. Perubahan isi perlu dihitung ulang.</p>}{!closed&&view.quote==='unavailable'&&<p className="cart-warning">Perhitungan pengiriman belum dapat dimuat. Periksa ulang saat checkout.</p>}{!closed&&!checkoutReady&&<p className="cart-warning">Periksa stok dan rincian pilihan sebelum melanjutkan checkout.</p>}</CartProgression><Link className="detail-help" href="/bantuan#returns">Pengiriman dan pengembalian</Link></div></section>
  {!closed&&picks.length>0&&<CartRail products={picks} cart={cart.id} version={String(cart.version)}/>}</div>:<section className="empty-state"><h2>Keranjang masih kosong</h2><p>Pilih produk untuk menambahkan satu pilihan lengkap.</p><Link href="/cari" className="button">Lihat produk</Link></section>}</CartMutations>
 </main></Shell>;
}

// Rail row: 80px photo, name and option, price, and the same add mutation as the PDP (one complete option).
function CartRail({products,cart,version}:{products:PublicProduct[];cart:string;version:string}){
 return <aside className="cart-rail" aria-labelledby="cart-rail-heading"><h2 id="cart-rail-heading">Mungkin Anda suka</h2><ul>{products.map(product=>{const offer=matchingVariant(product),image=offer?.image??product.images[0];if(!offer) return null;
  return <li key={product.id} className="cart-rail-item"><span className="cart-rail-media">{image&&<CatalogImage src={sameOrigin(image.url)} sizes="80px" max={256} min={128} alt="" width={image.width} height={image.height} loading="lazy" decoding="async" referrerPolicy="no-referrer"/>}</span>
   <div className="cart-rail-text"><h3><ProductLink product={product.id} slug={product.public_slug} offer={offer.id} defaultOffer={offer.id}>{product.name}</ProductLink></h3><p>{offer.label}</p></div><p className="cart-rail-price">{rupiah(offer.price)}</p>
   <CartForm intent={initialCartIntent({product:product.id,variant:offer.id,publication:product.publication_id,cart,version})} label="Tambah ke keranjang" subject={`${product.name}, ${offer.label}`} quantity={false}/></li>;})}</ul></aside>;
}
