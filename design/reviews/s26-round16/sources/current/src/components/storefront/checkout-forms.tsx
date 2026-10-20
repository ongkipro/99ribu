'use client';

import {Component,startTransition,useActionState,useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {changeCheckout,observeCheckoutEntry,preparePayment,recoverPaymentAccess,saveCheckoutDraft} from '../../app/(storefront)/checkout/actions';
import type {CheckoutDraft,CheckoutIntent,CheckoutQuote,CheckoutState} from '../../modules/storefront/checkout';
import type {CheckoutPaymentState} from '../../modules/storefront/checkout-order';
import {CheckoutHelp} from './checkout-frame';
import {rupiah} from '../../modules/storefront/format';
import {Icon} from './icon';

type RetryChild=(capture:(data:FormData|null,snapshot?:CheckoutState)=>void,retry:FormData|null)=>React.ReactNode;
class CheckoutBoundary extends Component<{children:RetryChild;heading?:boolean;href:string},{failed:boolean;revision:number;retry:FormData|null}>{
 state={failed:false,revision:0,retry:null as FormData|null};submitted:FormData|null=null;snapshot:CheckoutState|null=null;
 static getDerivedStateFromError(){return {failed:true};}
 capture=(data:FormData|null,snapshot?:CheckoutState)=>{this.submitted=data;this.snapshot=data?snapshot??null:null;};
 render(){
  if(this.state.failed){
   const retry=this.submitted?<button className="button" type="button" onClick={()=>this.setState(s=>({failed:false,revision:s.revision+1,retry:this.submitted}))}>Periksa hasil tindakan</button>:<Link className="button" href={this.props.href}>Muat ulang halaman</Link>;
   return this.props.heading?<UnknownOrder state={this.snapshot}>{retry}</UnknownOrder>:<section className="checkout-recovery"><h2>Hasil tindakan belum diketahui</h2><div className="checkout-caution" role="alert"><Icon name="alert"/><p>Balasan belum diterima. Periksa hasil dengan permintaan yang sama.</p></div>{retry}</section>;
  }
  return <div key={this.state.revision}>{this.props.children(this.capture,this.state.retry)}</div>;
 }
}
const submittedData=(event:React.FormEvent<HTMLFormElement>)=>new FormData(event.currentTarget,(event.nativeEvent as SubmitEvent).submitter);
const labels:Record<keyof CheckoutDraft,string>={recipient_name:'Nama penerima',phone:'Nomor HP',email:'Email (opsional)',destination_id:'Wilayah pengiriman',address_line:'Alamat lengkap',buyer_note:'Catatan pengiriman (opsional)',payment_method:'Preferensi pembayaran'};

function useDraftSave(form:React.RefObject<HTMLFormElement|null>,state:CheckoutState,busy:boolean){
 const [feedback,setFeedback]=useState(''),[denied,setDenied]=useState(false),[conflict,setConflict]=useState(state.draftConflict),metadata=useRef({writer:state.intent.draft_writer,sequence:Number(state.intent.draft_sequence),revision:Number(state.intent.draft_revision)});
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),inflight=useRef(false),queued=useRef(false),stopped=useRef(false),unsaved=useRef(false);
 const cancel=useCallback(()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;queued.current=false;},[]);
 const prepare=(data:FormData)=>{
  const m=metadata.current;m.sequence+=1;data.set('draft_writer',m.writer);data.set('draft_sequence',String(m.sequence));data.set('draft_revision',String(m.revision));return data;
 };
 const save=async()=>{
  if(!form.current||stopped.current||busy||state.phase==='unknown'||state.blocked||state.draftConflict)return;
  if(inflight.current){queued.current=true;return;}
  inflight.current=true;queued.current=false;const data=prepare(new FormData(form.current)),sequence=metadata.current.sequence;
  try{
   const result=await saveCheckoutDraft(data);
   if(result.kind==='saved'||result.kind==='stale'){metadata.current.revision=Math.max(metadata.current.revision,result.revision);
    if(sequence===metadata.current.sequence&&!queued.current){unsaved.current=false;setFeedback(result.message);}
   }else{stopped.current=true;setFeedback(result.message);if(result.kind==='conflict')setConflict(true);if(result.kind==='denied'){unsaved.current=false;setDenied(true);}}
  }catch{setFeedback('Draf belum tersimpan. Isian tetap ada di halaman ini.');}
  finally{inflight.current=false;if(queued.current&&!stopped.current)void save();}
 };
 const changed=()=>{
  unsaved.current=true;if(conflict||state.draftConflict)return;setFeedback(stopped.current?'Draf belum tersimpan. Muat ulang untuk memeriksa sesi dan draf terbaru.':'Menyimpan draf…');
  if(timer.current)clearTimeout(timer.current);if(!stopped.current)timer.current=setTimeout(()=>void save(),400);
 };
 const submit=(event:React.FormEvent<HTMLFormElement>)=>{
  if(busy||conflict||state.draftConflict){event.preventDefault();return null;}
  cancel();const data=prepare(submittedData(event));
  for(const name of ['draft_writer','draft_sequence','draft_revision']){const input=event.currentTarget.elements.namedItem(name);if(input instanceof HTMLInputElement)input.value=String(data.get(name));}
  return data;
 };
 useEffect(()=>{
  cancel();metadata.current={writer:state.intent.draft_writer,sequence:Math.max(metadata.current.sequence,Number(state.intent.draft_sequence)),revision:Number(state.intent.draft_revision)};
  stopped.current=state.blocked||state.draftConflict;unsaved.current=state.draftConflict;setConflict(state.draftConflict);setFeedback('');
 },[state,cancel]);
 useEffect(()=>{
  const warn=(event:BeforeUnloadEvent)=>{if(unsaved.current){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',warn);return()=>{cancel();window.removeEventListener('beforeunload',warn);};
 },[cancel]);
 return {changed,submit,feedback,denied,conflict};
}

function IntentFields({intent,omit=[]}:{intent:CheckoutIntent;omit?:string[]}){
 const {draft,packages,...plain}=intent;
 return <>{Object.entries({...plain,...draft}).filter(([name])=>name!=='navigate'&&!omit.includes(name)).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}{intent.kind==='shipping'&&!omit.includes('packages')&&packages.map(p=><span key={p.package_id}><input type="hidden" name="package_id" value={p.package_id}/><input type="hidden" name="shipping_option_id" value={p.shipping_option_id}/></span>)}</>;
}
function DraftField({name,value,error,onChange,focusFirst=false}:{name:Exclude<keyof CheckoutDraft,'destination_id'|'payment_method'>;value:string;error?:string;onChange:(name:keyof CheckoutDraft,value:string)=>void;focusFirst?:boolean}){
 const multiline=name==='address_line'||name==='buyer_note',optional=name==='email'||name==='buyer_note',fieldId=`checkout-${name}`,errorId=`${fieldId}-error`;
 // Only a server validation result requests autofocus; initial entry never does.
 const props={id:fieldId,name,value,onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>onChange(name,event.currentTarget.value),required:!optional,autoFocus:focusFirst,'aria-invalid':error?true as const:undefined,'aria-describedby':error?errorId:undefined};
 return <div className="checkout-field"><label htmlFor={fieldId}>{labels[name]}</label>{multiline?<textarea {...props} rows={3} maxLength={500} autoComplete={name==='address_line'?'shipping street-address':'off'}/>:<input {...props} type={name==='email'?'email':name==='phone'?'tel':'text'} inputMode={name==='phone'?'tel':name==='email'?'email':'text'} maxLength={name==='recipient_name'?200:name==='phone'?30:254} autoComplete={name==='recipient_name'?'shipping name':name==='phone'?'shipping tel':'email'}/>} {error&&<p id={errorId} className="checkout-field-error"><Icon name="alert"/>{error}</p>}</div>;
}
function Contents({contents}:{contents:NonNullable<CheckoutState['view']['cart']>['lines'][number]['contents']}){
 return <ul className="checkout-contents">{contents.map(c=><li key={c.stock_item_id}>{c.quantity} × {c.name}</li>)}</ul>;
}
function QuoteCharges({quote}:{quote:CheckoutQuote}){
 return <dl className="checkout-charges"><div><dt>Produk</dt><dd>{rupiah(quote.merchandise_total)}</dd></div><div><dt>Ongkir {quote.packages.length} paket</dt><dd>{rupiah(quote.shipping_total)}</dd></div>{quote.subsidy_total>0&&<div><dt>Subsidi ongkir</dt><dd>−{rupiah(quote.subsidy_total)}</dd></div>}<div className="checkout-total"><dt>Total</dt><dd>{rupiah(quote.buyer_total)}</dd></div></dl>;
}
function Summary({state,dirty,recovery=false}:{state:CheckoutState;dirty:boolean;recovery?:boolean}){
 const disclosure=useRef<HTMLDetailsElement>(null),cart=state.view.cart,quote=state.view.quote;
 useEffect(()=>{const wide=window.matchMedia('(min-width: 1024px)'),open=()=>{if(disclosure.current)disclosure.current.open=wide.matches&&parseFloat(getComputedStyle(document.documentElement).fontSize)<24;};open();wide.addEventListener('change',open);return()=>wide.removeEventListener('change',open);},[]);
 if(!cart)return null;
 return <aside className="checkout-summary" aria-label="Ringkasan pesanan"><details ref={disclosure}><summary><span><span className="summary-toggle-label"><span className="summary-show">Lihat ringkasan</span><span className="summary-hide">Tutup ringkasan</span></span><span className="summary-desktop-title">Ringkasan pesanan</span><small>{quote?dirty||recovery||state.step!=='review'||!state.view.quoteCurrent?'Perhitungan tersimpan':'Total perhitungan':'Produk · ongkir belum dihitung'}</small></span><strong>{rupiah(quote?.buyer_total??cart.merchandise_total)}</strong><span className="summary-chevron"><Icon name="chevron"/></span></summary><div className="checkout-summary-body"><ul className="checkout-summary-lines">{cart.lines.map(line=><li key={line.id}><div><strong>{line.name}</strong><span>{line.variant_label} · {line.quantity} pilihan</span><p className="checkout-content-label">Isi per pilihan</p><Contents contents={line.contents}/></div><strong>{rupiah(line.line_total)}</strong></li>)}</ul>{quote?<QuoteCharges quote={quote}/>:<dl className="checkout-charges"><div><dt>Produk</dt><dd>{rupiah(cart.merchandise_total)}</dd></div><div><dt>Ongkir</dt><dd>Belum dihitung</dd></div></dl>}<p className="checkout-hint">{recovery?'Perhitungan terakhir yang tersedia. Periksa hasil dengan permintaan yang sama.':quote&&!state.view.quoteCurrent?'Perhitungan kedaluwarsa atau berubah. Hitung ulang pengiriman sebelum membuat pesanan.':dirty&&quote?'Perhitungan tersimpan belum mengikuti perubahan Anda.':quote?'Periksa setiap paket sebelum membuat pesanan.':'Ongkir dan total akhir ditampilkan setelah alamat diperiksa.'}</p></div></details></aside>;
}
function UnknownOrder({state,message='Balasan belum diterima. Periksa hasil dengan permintaan yang sama.',children}:{state:CheckoutState|null;message?:string;children:React.ReactNode}){
 return <><h1 className="checkout-title">Hasil tindakan belum diketahui</h1><div className="checkout-layout">{state&&<Summary state={state} dirty recovery/>}<section className="checkout-fields checkout-recovery"><div className="checkout-caution" role="alert"><Icon name="alert"/><p>{message}</p></div>{children}<CheckoutHelp context="order"/></section></div></>;
}
function Parcels({state,editable,onChange}:{state:CheckoutState;editable:boolean;onChange?:()=>void}){
 const [choices,setChoices]=useState<Record<string,string>>({}),quote=state.view.quote,cart=state.view.cart;if(!quote||!cart)return null;
 return <div className="checkout-parcels">{quote.packages.map((parcel,index)=>{const selected=choices[parcel.id]??state.intent.packages.find(p=>p.package_id===parcel.id)?.shipping_option_id??parcel.selected_option_id,pending=editable&&selected!==parcel.selected_option_id,service=parcel.options.find(o=>o.id===selected);return <fieldset className="checkout-parcel" key={parcel.id}><legend>Paket {index+1} · dari {parcel.origin_city}</legend><ul>{parcel.lines.map(part=>{const line=cart.lines.find(l=>l.id===part.cart_line_id);return line?<li key={part.cart_line_id}><strong>{line.name}</strong><span>{line.variant_label} · {part.quantity} pilihan lengkap</span><p className="checkout-content-label">Isi per pilihan</p><Contents contents={line.contents}/></li>:null;})}</ul>{editable?<><input type="hidden" name="package_id" value={parcel.id}/><label htmlFor={`service-${parcel.id}`}>Layanan pengiriman</label><select id={`service-${parcel.id}`} name="shipping_option_id" value={selected} onChange={event=>{const value=event.currentTarget.value;setChoices(current=>({...current,[parcel.id]:value}));onChange?.();}}>{parcel.options.map(o=><option key={o.id} value={o.id}>{rupiah(o.shipping_amount)} · {o.courier_name} · {o.service_name}</option>)}</select><p className="checkout-selected-service">{pending?'Pilihan layanan baru':'Layanan tersimpan'}: {service?.courier_name} · {service?.service_name}</p></>:<p>{parcel.options.find(o=>o.id===parcel.selected_option_id)?.courier_name} · {parcel.options.find(o=>o.id===parcel.selected_option_id)?.service_name}</p>}<p className="checkout-hint">Estimasi waktu belum tersedia pada layanan simulasi ini.</p>{pending?<p className="checkout-hint">Biaya paket menunggu perhitungan baru.</p>:<dl className="checkout-charges">{parcel.subsidy_amount>0&&<><div><dt>{editable?'Tarif paket tersimpan':'Ongkir paket'}</dt><dd>{rupiah(parcel.shipping_amount)}</dd></div><div><dt>{editable?'Subsidi paket tersimpan':'Subsidi paket'}</dt><dd>−{rupiah(parcel.subsidy_amount)}</dd></div></>}<div><dt>{editable?'Ongkir tersimpan':'Ongkir yang dibayar'}</dt><dd>{rupiah(parcel.buyer_shipping_amount)}</dd></div>{parcel.cod_collect_amount!==undefined&&<div className="checkout-total"><dt>{editable?'COD tersimpan':'COD paket ini'}</dt><dd>{rupiah(parcel.cod_collect_amount)}</dd></div>}</dl>}</fieldset>;})}</div>;
}

export function CheckoutForm({initial}:{initial:CheckoutState}){
 return <CheckoutBoundary heading href="/checkout">{(capture,retry)=><CheckoutController initial={initial} capture={capture} retry={retry}/>}</CheckoutBoundary>;
}
function CheckoutController({initial,capture,retry}:{initial:CheckoutState;capture:(data:FormData|null,snapshot?:CheckoutState)=>void;retry:FormData|null}){
 const [state,action,pending]=useActionState(changeCheckout,initial,'/checkout');
 const [draft,setDraft]=useState(state.intent.draft),[query,setQuery]=useState(state.intent.query),[allocation,setAllocation]=useState(state.intent.allocation_id),[dirty,setDirty]=useState(false),[recovering,setRecovering]=useState(Boolean(retry));
 const initialKey=useRef(initial.intent.key),replayed=useRef(false),form=useRef<HTMLFormElement>(null),heading=useRef<HTMLHeadingElement>(null),lastStep=useRef(state.step),previousTotal=useRef<number|null>(null);
 const draftSave=useDraftSave(form,state,pending||recovering);
 const entryCart=initial.view.cart?.id,entryVersion=initial.view.cart?.version,entryReady=initial.view.kind==='ready'&&!initial.view.issue;
 useEffect(()=>{if(entryReady&&entryCart&&entryVersion)void observeCheckoutEntry(entryCart,entryVersion).catch(()=>{});},[entryCart,entryVersion,entryReady]);
 useEffect(()=>{if(retry&&!replayed.current){replayed.current=true;startTransition(()=>action(retry));}},[retry,action]);
 useEffect(()=>{
  setDraft(state.intent.draft);setQuery(state.intent.query);setAllocation(state.intent.allocation_id);setDirty(false);
  if(state.phase!=='idle'||state.intent.key!==initialKey.current){setRecovering(false);if(state.phase!=='unknown')capture(null);}
  if(state.phase==='error'&&Object.keys(state.errors).length){const name=Object.keys(state.errors)[0];form.current?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();}
  else if(state.step!==lastStep.current){heading.current?.focus();heading.current?.scrollIntoView({block:'start'});}
  lastStep.current=state.step;
 },[state,capture]);
 const setField=(name:keyof CheckoutDraft,value:string)=>{setDraft(current=>({...current,[name]:value}));if(name!=='buyer_note')setDirty(true);};
 const busy=pending||recovering,unknown=state.phase==='unknown',cart=state.view.cart,quote=state.view.quote;
 const intent={...state.intent,draft,query,allocation_id:allocation};
 if(draftSave.denied||state.blocked||state.view.kind==='denied'||state.view.kind==='none')return <section className="checkout-recovery" role="alert"><h1>Sesi belanja perlu diperiksa</h1><p>{state.message||'Buka kembali keranjang melalui sesi belanja Anda.'}</p><Link className="button" href="/cart">Periksa keranjang</Link><CheckoutHelp context="recovery"/></section>;
 if(unknown)return <UnknownOrder state={state} message={state.message}><form id="checkout-form" action={action} onSubmit={event=>capture(submittedData(event),state)}><IntentFields intent={state.intent}/><button type="submit" className="button" disabled={busy}>{busy?'Memeriksa…':'Periksa hasil tindakan'}</button></form></UnknownOrder>;
 if(state.view.issue==='submitted'&&cart?.submitted_order_id)return <section className="checkout-recovery"><h1>Pesanan sudah tersimpan</h1><p>Periksa pesanan yang tersimpan sebelum melanjutkan.</p><Link className="button" href={`/checkout/order/${cart.submitted_order_id}`}>Periksa pesanan</Link><CheckoutHelp context="payment"/></section>;
 if(state.view.issue==='expired'||state.view.issue==='cart')return <section className="checkout-recovery" role="alert"><h1>Keranjang perlu diperiksa</h1><p>{state.view.issue==='expired'?'Keranjang ini kedaluwarsa. Pilih produk dari keranjang untuk memulai lagi.':'Stok atau rincian pilihan berubah. Periksa isi terbaru dari keranjang.'}</p><Link className="button" href="/cart">Kembali ke keranjang</Link><CheckoutHelp context="checkout"/></section>;
 const contact=state.step==='contact',shipping=state.step==='shipping',firstError=Object.keys(state.errors)[0];
 const allocationChanged=Boolean(shipping&&quote&&allocation!==quote.selected_allocation_id),servicePending=Boolean(shipping&&quote&&state.intent.packages.some(p=>quote.packages.find(parcel=>parcel.id===p.package_id)?.selected_option_id!==p.shipping_option_id)),selectionPending=Boolean(shipping&&(dirty||servicePending||allocationChanged)),draftConflict=state.draftConflict||draftSave.conflict;
 const selectedDestination=initial.view.destinations.find(d=>d.id===draft.destination_id),destinations=[...(selectedDestination&&!state.view.destinations.some(d=>d.id===selectedDestination.id)?[selectedDestination]:[]),...state.view.destinations],destination=destinations.find(d=>d.id===draft.destination_id);
 const omit=contact?['recipient_name','phone','email','destination_id','address_line','buyer_note','payment_method','query']:shipping?['allocation_id','packages']:['buyer_note'];
 const pendingLabel=contact?'Menghitung pengiriman…':shipping?'Memperbarui pengiriman…':'Menyimpan pesanan…';
 const method=quote?.available_payment_methods.find(m=>m.kind===quote.payment_method)?.label??'';
 return <><h1 className="checkout-title">Checkout</h1><div className="checkout-layout"><Summary state={state} dirty={dirty||allocationChanged||servicePending}/><div className="checkout-fields">
  <ol className="checkout-progress" aria-label="Langkah checkout">{['Alamat','Pengiriman','Tinjau'].map((label,index)=><li key={label} aria-current={index===(contact?0:shipping?1:2)?'step':undefined}>{index+1}. {label}</li>)}</ol>
  <h2 id="checkout-step" tabIndex={-1} ref={heading}>{contact?'Alamat penerima':shipping?'Pengiriman per paket':'Tinjau pesanan'}</h2>
  {state.message&&state.phase==='error'&&!draftConflict&&<div className="checkout-feedback checkout-error" role="alert"><Icon name="alert"/><div><p>{state.message}</p>{Object.keys(state.errors).length>0&&<ul>{Object.keys(state.errors).map(name=><li key={name}><a href={`#checkout-${name}`}>{name==='query'?'Cari wilayah':labels[name as keyof CheckoutDraft]}</a></li>)}</ul>}</div></div>}
  {state.message&&!contact&&state.phase!=='error'&&!selectionPending&&!draftConflict&&<p className="checkout-hint checkout-step-notice" role="status">{state.message}</p>}
  {previousTotal.current!==null&&quote&&previousTotal.current!==quote.buyer_total&&state.phase==='success'&&!selectionPending&&!draftConflict&&<p role="status" className="checkout-total-change">Total berubah dari {rupiah(previousTotal.current)} menjadi {rupiah(quote.buyer_total)}. Periksa rincian paket.</p>}
  {draftConflict?<div className="checkout-caution checkout-conflict" role="alert"><Icon name="alert"/><div><p>Draf berubah di halaman lain. Muat ulang untuk memeriksanya.</p><p>Isian di halaman ini belum menggantikan draf tersimpan. Muat ulang akan membuka draf tersimpan.</p><a href="/checkout">Muat ulang draf tersimpan</a></div></div>:selectionPending&&<div className="checkout-caution checkout-step-notice" role="status"><Icon name="alert"/><p>Perhitungan tersimpan belum mengikuti pilihan pengiriman. {allocationChanged?'Perbarui pembagian paket untuk melihat ongkir terbaru.':'Tinjau pesanan untuk memperbarui total.'}</p></div>}
  <form id="checkout-form" ref={form} action={action} noValidate onChange={draftSave.changed} onSubmit={event=>{const data=draftSave.submit(event);if(data)capture(data,state);previousTotal.current=quote?.buyer_total??null;}}>
   <IntentFields intent={intent} omit={omit}/><fieldset className="checkout-controls" disabled={busy} aria-busy={busy}><legend className="sr-only">{contact?'Alamat penerima':shipping?'Pengiriman':'Konfirmasi pesanan'}</legend>
    {contact?<><p>Tidak perlu membuat akun. Semua kolom wajib kecuali yang bertanda opsional.</p>
     <DraftField name="recipient_name" value={draft.recipient_name} error={state.errors.recipient_name} focusFirst={firstError==='recipient_name'} onChange={setField}/>
     <div className="checkout-contact-row"><DraftField name="phone" value={draft.phone} error={state.errors.phone} focusFirst={firstError==='phone'} onChange={setField}/><DraftField name="email" value={draft.email} error={state.errors.email} focusFirst={firstError==='email'} onChange={setField}/></div>
     <div className="checkout-field"><label htmlFor="checkout-query">Cari wilayah (opsional)</label><div className="checkout-search">{/* biome-ignore lint/a11y/noAutofocus: native POST validation focuses only the first invalid field. */}
      <input autoFocus={firstError==='query'} id="checkout-query" name="query" value={query} onChange={event=>setQuery(event.currentTarget.value)} maxLength={100} type="search" aria-invalid={Boolean(state.errors.query)||undefined} aria-describedby={state.errors.query?'checkout-query-error':undefined}/><button className="button secondary" type="submit" name="navigate" value="lookup">Cari wilayah</button></div>{state.errors.query&&<p id="checkout-query-error" className="checkout-field-error">{state.errors.query}</p>}</div>
     <div className="checkout-field"><label htmlFor="checkout-destination_id">Wilayah pengiriman</label>{/* biome-ignore lint/a11y/noAutofocus: native POST validation focuses only the first invalid field. */}
      <select autoFocus={firstError==='destination_id'} id="checkout-destination_id" name="destination_id" value={draft.destination_id} onChange={event=>setField('destination_id',event.currentTarget.value)} required aria-invalid={Boolean(state.errors.destination_id)||undefined} aria-describedby={state.errors.destination_id?'checkout-destination-error':'checkout-destination-hint'}><option value="">Pilih wilayah pengiriman</option>{destinations.map(d=><option key={d.id} value={d.id}>{d.label} · {d.postal_code}</option>)}</select><p id="checkout-destination-hint" className="checkout-hint">Pilih wilayah dari daftar; kode pos mengikuti tujuan yang dipilih.</p>{state.message&&state.phase==='idle'&&<p className="checkout-hint" role="status">{state.message}</p>}{destination&&<p className="checkout-hint">{destination.district}, {destination.city}, {destination.province} {destination.postal_code}</p>}{state.errors.destination_id&&<p id="checkout-destination-error" className="checkout-field-error">{state.errors.destination_id}</p>}</div>
     <DraftField name="address_line" value={draft.address_line} error={state.errors.address_line} focusFirst={firstError==='address_line'} onChange={setField}/><DraftField name="buyer_note" value={draft.buyer_note} error={state.errors.buyer_note} focusFirst={firstError==='buyer_note'} onChange={setField}/>
     <fieldset id="checkout-payment_method" className="checkout-methods" aria-describedby={state.errors.payment_method?'checkout-method-error':undefined}><legend>Preferensi pembayaran</legend><p className="checkout-hint">Ketersediaan layanan diperiksa bersama tujuan dan paket.</p>{[{id:'prepaid',label:'Pembayaran simulasi'},{id:'cod',label:'COD · cek ketersediaan'}].map(m=><label key={m.id}>{/* biome-ignore lint/a11y/noAutofocus: native POST validation focuses only the first invalid field. */}
      <input autoFocus={firstError==='payment_method'&&m.id==='prepaid'} type="radio" name="payment_method" value={m.id} checked={draft.payment_method===m.id} onChange={event=>setField('payment_method',event.currentTarget.value)} required/>{m.label}</label>)}{state.errors.payment_method&&<p id="checkout-method-error" className="checkout-field-error">{state.errors.payment_method}</p>}</fieldset>
    </>:shipping&&quote?<><div className="checkout-address-review"><p><strong>{quote.address.recipient_name}</strong> · {quote.contact.phone}</p><p>{quote.address.address_line}</p><p>{quote.address.district}, {quote.address.city}, {quote.address.province} {quote.address.postal_code}</p><button className="checkout-text-button" type="submit" name="navigate" value="contact">Ubah alamat atau metode</button></div>
     {quote.allocation_options.length>1?<div className="checkout-field"><label htmlFor="checkout-allocation">Pembagian paket</label><select id="checkout-allocation" name="allocation_id" value={allocation} onChange={event=>setAllocation(event.currentTarget.value)}>{quote.allocation_options.map(p=><option key={p.id} value={p.id}>{rupiah(p.id===quote.selected_allocation_id?quote.shipping_total:p.shipping_total)} ongkir · {p.package_count} paket · {p.origins.join(', ')}</option>)}</select><p className="checkout-hint">Perubahan pembagian dihitung ulang sebelum tinjauan akhir.</p><p className="checkout-hint">{allocationChanged?'Rencana asal paket':'Asal paket tersimpan'}: {quote.allocation_options.find(p=>p.id===allocation)?.origins.join(', ')}</p></div>:<input type="hidden" name="allocation_id" value={quote.selected_allocation_id}/>}
     {allocationChanged?<p>Paket baru ditampilkan setelah pembagian diperbarui.</p>:<Parcels key={`${quote.id}:${state.intent.key}`} state={state} editable onChange={()=>setDirty(true)}/>}
    </>:quote?<><div className="checkout-address-review"><h3>Penerima dan tujuan</h3><p><strong>{quote.address.recipient_name}</strong> · {quote.contact.phone}</p><p>{quote.address.address_line}</p><p>{quote.address.district}, {quote.address.city}, {quote.address.province} {quote.address.postal_code}</p><button className="checkout-text-button" type="submit" name="navigate" value="contact">Ubah alamat atau metode</button></div><h3>Metode pembayaran</h3><p>{method}</p>{quote.payment_method==='cod'&&<p>Pembayaran COD dilakukan sesuai nominal setiap paket saat diterima.</p>}<Parcels state={state} editable={false}/><DraftField name="buyer_note" value={draft.buyer_note} error={state.errors.buyer_note} onChange={setField}/>{!draft.buyer_note.trim()&&<p className="checkout-hint">Tidak ada catatan pengiriman.</p>}<QuoteCharges quote={quote}/><button className="checkout-text-button" type="submit" name="navigate" value="shipping">Ubah pengiriman</button></>:<p role="alert">Perhitungan belum tersedia. Kembali ke alamat untuk menghitung ulang.</p>}
    <div className="checkout-actions"><button className="button" type="submit" disabled={draftConflict||!contact&&!quote}>{busy?pendingLabel:contact?'Lanjut ke pengiriman':shipping?allocationChanged?'Perbarui pembagian paket':'Tinjau pesanan':quote?`Buat pesanan${quote.payment_method==='cod'?' COD':` · ${method}`} · ${rupiah(quote.buyer_total)}`:'Periksa perhitungan'}</button>{busy&&<span className="sr-only" role="status">{pendingLabel}</span>}</div>
   </fieldset>
   {draftSave.feedback&&!draftConflict&&<p className="checkout-hint" role="status">{draftSave.feedback}</p>}
  </form>
 <CheckoutHelp><a className="checkout-text-button" href="#checkout-step">Kembali ke formulir</a></CheckoutHelp></div></div></>;
}

export function CheckoutPaymentForm({initial,recover=false}:{initial:CheckoutPaymentState;recover?:boolean}){
 return <CheckoutBoundary href={`/checkout/order/${initial.order}`}>{(capture,retry)=><PaymentController initial={initial} recover={recover} capture={capture} retry={retry}/>}</CheckoutBoundary>;
}
function PaymentController({initial,recover,capture,retry}:{initial:CheckoutPaymentState;recover:boolean;capture:(data:FormData|null,snapshot?:CheckoutState)=>void;retry:FormData|null}){
 const path=`/checkout/order/${initial.order}`,[state,action,pending]=useActionState(recover?recoverPaymentAccess:preparePayment,initial,path),[recovering,setRecovering]=useState(Boolean(retry)),replayed=useRef(false);
 useEffect(()=>{if(retry&&!replayed.current){replayed.current=true;startTransition(()=>action(retry));}},[retry,action]);
 useEffect(()=>{if(state.phase!=='idle'){setRecovering(false);if(state.phase!=='unknown')capture(null);}},[state,capture]);
 return <form action={action} className="checkout-payment-action" onSubmit={event=>capture(submittedData(event))}><input type="hidden" name="order" value={state.order}/><input type="hidden" name="key" value={state.key}/>{state.message&&<p role={state.phase==='error'||state.phase==='unknown'?'alert':'status'} className={state.phase==='error'||state.phase==='unknown'?'checkout-field-error':'checkout-hint'}>{state.message}</p>}<button className="button" type="submit" disabled={pending||recovering||state.blocked}>{pending||recovering?'Memeriksa…':state.phase==='unknown'?'Ulangi permintaan yang sama':recover?'Pulihkan akses pesanan':'Siapkan instruksi pembayaran'}</button></form>;
}
