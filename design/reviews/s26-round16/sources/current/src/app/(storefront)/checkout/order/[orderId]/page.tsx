import Link from 'next/link';
import {redirect} from 'next/navigation';
import {CheckoutFrame,CheckoutHelp} from '../../../../../components/storefront/checkout-frame';
import {CheckoutPaymentForm} from '../../../../../components/storefront/checkout-forms';
import {Icon} from '../../../../../components/storefront/icon';
import {rupiah} from '../../../../../modules/storefront/format';
import {getLocalAuth} from '../../../../../modules/access/auth';
import {id} from '../../../../../modules/catalog/validation';
import {storefrontRequest} from '../../../../../modules/storefront/browser';
import {checkoutOrderPath,initialCheckoutPayment,readCheckoutPayment} from '../../../../../modules/storefront/checkout-order';

export const dynamic='force-dynamic';
export const metadata={title:'Pembayaran pesanan',robots:{index:false,follow:false},referrer:'same-origin' as const};
export default async function CheckoutPayment({params}:{params:Promise<{orderId:string}>}){
 let orderId:string;try{orderId=id((await params).orderId);}catch{redirect('/404');}
 const path=checkoutOrderPath(orderId),view=await readCheckoutPayment(await storefrontRequest('GET',path),getLocalAuth(),orderId);
 if(view.kind!=='ready')return <CheckoutFrame back="catalog"><section className="checkout-recovery"><h1>{view.kind==='unavailable'?'Status belum dapat dimuat':'Akses pesanan perlu diperiksa'}</h1><p>{view.kind==='unavailable'?'Data pembayaran belum tersedia. Muat ulang untuk memeriksa status yang tersimpan.':'Halaman ini memerlukan sesi pemilik atau akses tamu yang sah. Nomor pesanan saja tidak membuka rincian.'}</p>{view.kind==='denied'?<CheckoutPaymentForm initial={initialCheckoutPayment(orderId)} recover/>:<a className="button" href={path}>Muat ulang status</a>}<Link className="detail-help" href="/cart">Periksa sesi belanja</Link><CheckoutHelp context={view.kind==='denied'?'recovery':'payment'}/></section></CheckoutFrame>;
 const {order,attempt}=view,paid=order.payment_status==='confirmed',cod=order.payment_method==='cod',closed=order.status!=='pending',expired=!cod&&!paid&&(Date.parse(order.expires_at)<=Date.parse(view.now)||attempt?.status==='expired'&&closed);
 const canPrepare=!cod&&!paid&&!closed&&!expired&&!view.attemptUnavailable&&(!attempt||attempt.status==='failed'||attempt.status==='expired');
 const failed=!cod&&!paid&&!closed&&!expired&&attempt?.status==='failed';
 const title=paid?'Pembayaran terkonfirmasi':cod?order.payment_status==='partially_collected'?'Sebagian COD sudah diterima':'Pembayaran COD':closed||expired?'Pembayaran tidak tersedia':failed?'Percobaan pembayaran gagal':attempt?.status==='unknown'?'Status pembayaran sedang diperiksa':'Menunggu pembayaran';
 return <CheckoutFrame back="catalog"><section className="checkout-payment"><h1>{title}</h1><p className="checkout-order-reference">Pesanan <strong>{order.number}</strong></p><div className="checkout-payment-status" data-phase={paid?'success':closed||expired?'closed':attempt?.status==='unknown'?'unknown':failed?'error':'pending'} role={failed?'alert':'status'}>{(paid||closed||expired||failed||attempt?.status==='unknown')&&<Icon name={paid?'check':'alert'}/>}<p>{paid?'Pembayaran pesanan sudah tercatat. Status pengiriman mengikuti proses setiap paket.':cod?order.payment_status==='cod_due'&&!closed?'Pesanan COD tersimpan. Pembayaran dicatat saat paket dibayar, bukan saat konfirmasi pesanan.':'Status pembayaran mengikuti penerimaan setiap paket.':closed||expired?expired?'Batas waktu pembayaran telah lewat. Instruksi baru tidak dapat dibuat untuk pesanan ini.':'Pesanan sudah ditutup. Instruksi pembayaran baru tidak dapat dibuat.':failed?'Percobaan pembayaran gagal. Selama pesanan masih berlaku, Anda dapat menyiapkan percobaan baru.':attempt?.status==='unknown'?'Hasil pembayaran belum pasti. Perbarui status; gunakan pesanan yang sama.':'Pesanan sudah tersimpan. Pembayaran belum dikonfirmasi.'}</p></div>
  <dl className="checkout-charges"><div><dt>Produk</dt><dd>{rupiah(order.merchandise_total)}</dd></div><div><dt>Ongkir</dt><dd>{rupiah(order.shipping_total)}</dd></div>{order.subsidy_total>0&&<div><dt>Subsidi ongkir</dt><dd>−{rupiah(order.subsidy_total)}</dd></div>}<div className="checkout-total"><dt>Total pesanan</dt><dd>{rupiah(order.buyer_total)}</dd></div></dl>
  {cod?<div className="checkout-cod-parcels"><h2>{order.payment_status==='cod_due'&&!closed?'Pembayaran setiap paket':'Nominal COD awal'}</h2>{order.shipments.filter(s=>s.kind==='original').map((parcel,index)=><p key={parcel.id}>Paket {index+1} dari {parcel.origin_city}: <strong>{parcel.cod_collect_amount!==undefined?rupiah(parcel.cod_collect_amount):'Perlu diperiksa'}</strong></p>)}</div>:<><p>Metode: pembayaran simulasi.</p>{!paid&&!closed&&!expired&&<p className="checkout-hint">Batas pembayaran: {new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'medium',timeStyle:'short'}).format(new Date(order.expires_at))} WIB.</p>}
   {view.attemptUnavailable?<p role="alert" className="checkout-field-error">Instruksi pembayaran belum dapat diperiksa. Perbarui status sebelum mencoba lagi.</p>:attempt?.status==='unknown'?<p>Permintaan sebelumnya masih diperiksa. Instruksi baru belum dapat dibuat.</p>:!paid&&!closed&&!expired&&attempt?.action.kind==='instructions'?<section className="checkout-payment-instructions"><h2>Instruksi pembayaran</h2><p>{attempt.action.display_text}</p></section>:null}
   {canPrepare&&<CheckoutPaymentForm initial={initialCheckoutPayment(order.id)}/>}</>}
  <a className="button secondary checkout-status-refresh" href={path}>Perbarui status</a><p className="checkout-hint">Muat ulang halaman untuk membaca status terbaru, bukan mengirim pesanan baru.</p>
 <CheckoutHelp context="payment"/></section></CheckoutFrame>;
}
