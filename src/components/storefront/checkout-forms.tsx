'use client';

import {Component,startTransition,useActionState,useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {changeCheckout,observeCheckoutEntry,preparePayment,recoverPaymentAccess,saveCheckoutDraft} from '../../app/(storefront)/checkout/actions';
import type {CheckoutAllocation,CheckoutDraft,CheckoutIntent,CheckoutQuote,CheckoutState} from '../../modules/storefront/checkout';
import type {CheckoutPaymentState} from '../../modules/storefront/checkout-order';
import {CheckoutHelp} from './checkout-help';
import {rupiah} from '../../modules/storefront/format';
import {Icon} from './ui/icon';
import {CatalogImage} from './ui/media';
import {filterContact} from './ui/contact-fields';
import {displayPhone} from '../../modules/storefront/contact';
import {CheckoutAddress} from './checkout-address';
import {CheckoutVoucher,VoucherDiscountRow} from './checkout-voucher';
import {VOUCHERS_ENABLED,type VoucherState} from '../../modules/storefront/vouchers';
// S168: the shipping provider failed or timed out; the quote can simply be requested again.
const PROVIDER_RETRY=['SHIPPING_RATE_TIMEOUT','SHIPPING_RATE_UNAVAILABLE','SHIPPING_RATE_INVALID'];

type RetryChild=(capture:(data:FormData|null,snapshot?:CheckoutState)=>void,retry:FormData|null)=>React.ReactNode;
class CheckoutBoundary extends Component<{children:RetryChild;heading?:boolean;href:string},{failed:boolean;revision:number;retry:FormData|null}>{
 state={failed:false,revision:0,retry:null as FormData|null};submitted:FormData|null=null;snapshot:CheckoutState|null=null;
 static getDerivedStateFromError(error:unknown){
  if(typeof (error as {digest?:string})?.digest==='string'&&(error as {digest:string}).digest.startsWith('NEXT_REDIRECT'))throw error;
  return {failed:true};
 }
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
// No email in checkout (owner 2026-11-05); the draft keeps the field for stored drafts but never shows or re-posts it.
const labels:Record<Exclude<keyof CheckoutDraft,'email'>,string>={recipient_name:'Nama lengkap',phone:'Nomor WhatsApp',destination_id:'Kelurahan / desa',address_line:'Alamat lengkap',buyer_note:'Catatan pengiriman (opsional)',payment_method:'Preferensi pembayaran'};

// The first invalid field in reading order takes focus after a submit (with JavaScript here, without it by autoFocus);
// the buyer note in the summary comes last.
// The address fields that decide couriers, and whether focus is in a field the buyer types into.
const courierKey=(d:CheckoutDraft)=>JSON.stringify([d.recipient_name,d.phone,d.address_line,d.destination_id,d.payment_method]);
const typing=(el:EventTarget|Element|null)=>el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement&&['text','tel','search'].includes(el.type)&&el.getAttribute('role')!=='combobox';
const FIELD_ORDER=['recipient_name','phone','address_line','query','destination_id','payment_method','buyer_note'];
const firstInvalid=(errors:CheckoutState['errors'])=>FIELD_ORDER.find(name=>name in errors)??Object.keys(errors)[0];
function useDraftSave(form:React.RefObject<HTMLFormElement|null>,state:CheckoutState,busy:boolean){
 const [feedback,setFeedback]=useState(''),[failed,setFailed]=useState(false),[denied,setDenied]=useState(false),[conflict,setConflict]=useState(state.draftConflict),metadata=useRef({writer:state.intent.draft_writer,sequence:Number(state.intent.draft_sequence),revision:Number(state.intent.draft_revision)});
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
    if(sequence===metadata.current.sequence&&!queued.current){unsaved.current=false;setFeedback(result.message);setFailed(false);}
   }else{stopped.current=true;setFeedback(result.message);setFailed(result.kind!=='conflict');if(result.kind==='conflict')setConflict(true);if(result.kind==='denied'){unsaved.current=false;setDenied(true);}}
  }catch{setFeedback('Draf belum tersimpan. Isian tetap ada di halaman ini.');setFailed(true);}
  finally{inflight.current=false;if(queued.current&&!stopped.current)void save();}
 };
 const changed=()=>{
  unsaved.current=true;
  // No server drafts (production): nothing to save or report, but leaving still warns about the unsaved form.
  if(!state.view.drafts)return;if(conflict||state.draftConflict)return;setFeedback(stopped.current?'Draf belum tersimpan. Muat ulang untuk memeriksa sesi dan draf terbaru.':'Menyimpan draf…');setFailed(stopped.current);
  if(timer.current)clearTimeout(timer.current);if(!stopped.current)timer.current=setTimeout(()=>void save(),400);
 };
 const submit=(event:React.FormEvent<HTMLFormElement>)=>{
  if(busy||conflict||state.draftConflict){event.preventDefault();if(conflict||state.draftConflict)document.querySelector<HTMLAnchorElement>('.checkout-conflict a')?.focus();return null;}
  cancel();const data=prepare(submittedData(event));
  for(const name of ['draft_writer','draft_sequence','draft_revision']){const input=event.currentTarget.elements.namedItem(name);if(input instanceof HTMLInputElement)input.value=String(data.get(name));}
  return data;
 };
 useLayoutEffect(()=>{
  cancel();metadata.current={writer:state.intent.draft_writer,sequence:Math.max(metadata.current.sequence,Number(state.intent.draft_sequence)),revision:Number(state.intent.draft_revision)};
  stopped.current=state.blocked||state.draftConflict;unsaved.current=state.draftConflict;setConflict(state.draftConflict);setFeedback('');setFailed(false);
 },[state,cancel]);
 useEffect(()=>{
  const warn=(event:BeforeUnloadEvent)=>{if(unsaved.current){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',warn);return()=>{cancel();window.removeEventListener('beforeunload',warn);};
 },[cancel]);
 // `failure`: only a save that did not happen is worth announcing; routine saving stays silent (owner 2026-11-05).
 return {changed,submit,feedback,failure:failed?feedback:'',denied,conflict};
}

function IntentFields({intent,omit=[]}:{intent:CheckoutIntent;omit?:string[]}){
 const {draft,packages,...plain}=intent;
 return <>{Object.entries({...plain,...draft}).filter(([name])=>name!=='navigate'&&!omit.includes(name)).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}{intent.kind==='shipping'&&!omit.includes('packages')&&packages.map(p=><span key={p.package_id}><input type="hidden" name="package_id" value={p.package_id}/><input type="hidden" name="shipping_option_id" value={p.shipping_option_id}/></span>)}</>;
}
function DraftField({name,value,error,onChange,focusFirst=false,hint,form}:{name:Exclude<keyof CheckoutDraft,'destination_id'|'payment_method'|'email'>;value:string;error?:string;onChange:(name:keyof CheckoutDraft,value:string)=>void;focusFirst?:boolean;hint?:string;form?:string}){
 const multiline=name==='address_line'||name==='buyer_note',optional=name==='buyer_note',fieldId=`checkout-${name}`,errorId=`${fieldId}-error`,hintId=`${fieldId}-hint`,described=[error?errorId:'',hint?hintId:''].filter(Boolean).join(' ');
 // Only a server validation result requests autofocus; initial entry never does.
 // S123 contact input: the phone keeps digits only (a pasted +62… shows as 08…). No email in checkout (owner 2026-11-05).
 const props={id:fieldId,name,value,form,placeholder:' ',onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>onChange(name,name==='phone'?filterContact(event as React.ChangeEvent<HTMLInputElement>):event.currentTarget.value),required:!optional,autoFocus:focusFirst,'aria-invalid':error?true as const:undefined,'aria-describedby':described||undefined};
 return <div className="checkout-field"><div className="checkout-float">{multiline?<textarea {...props} rows={3} maxLength={500} autoComplete={name==='address_line'?'shipping street-address':'off'}/>:<input {...props} type={name==='phone'?'tel':'text'} inputMode={name==='phone'?'numeric':'text'} pattern={name==='phone'?'0[0-9]{8,13}':undefined} maxLength={name==='recipient_name'?200:30} autoComplete={name==='recipient_name'?'shipping name':'shipping tel'}/>}<label htmlFor={fieldId}>{labels[name]}</label></div>{hint&&<p id={hintId} className="checkout-hint">{hint}</p>}{error&&<p id={errorId} className="checkout-field-error"><Icon name="alert"/>{error}</p>}</div>;
}
function Contents({contents}:{contents:NonNullable<CheckoutState['view']['cart']>['lines'][number]['contents']}){
 return <ul className="checkout-contents">{contents.map(c=><li key={c.stock_item_id}>{c.quantity} × {c.name}</li>)}</ul>;
}
// DEC-009 label follows the frozen rate, e.g. 333 bps -> "3,33%".
export function codFeePercent(bps:number|null){return `${((bps??0)/100).toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2})}%`;}
function QuoteCharges({quote,voucher={kind:'idle'}}:{quote:CheckoutQuote;voucher?:VoucherState}){
 // S177 2B: a store voucher discounts the products (its row follows Produk) and stacks with the automatic shipping
 // subsidy; a shipping voucher replaces that subsidy row.
 const store=voucher.kind==='applied'&&voucher.target==='merchandise';
 return <><dl className="checkout-charges"><div><dt>Produk</dt><dd>{rupiah(quote.merchandise_total)}</dd></div>{store&&<VoucherDiscountRow state={voucher}/>}<div><dt>Tarif pengiriman {quote.packages.length} paket</dt><dd>{rupiah(quote.shipping_total)}</dd></div>{quote.subsidy_total>0&&(voucher.kind!=='applied'||store)&&<div><dt>Subsidi ongkir</dt><dd>−{rupiah(quote.subsidy_total)}</dd></div>}{quote.cod_fee_total>0&&<div><dt>Biaya COD ({codFeePercent(quote.cod_fee_bps)})</dt><dd>{rupiah(quote.cod_fee_total)}</dd></div>}{!store&&<VoucherDiscountRow state={voucher}/>}<div className="checkout-total"><dt>{quote.payment_method==='cod'?`Total COD (${quote.packages.length} paket)`:'Total'}</dt><dd>{rupiah(quote.amount_due)}</dd></div></dl>{quote.payment_channel==='manual-bank'&&<p className="checkout-hint">Kode unik 1–999 rupiah ditambahkan ke total saat pesanan dibuat untuk mencocokkan transfer.</p>}</>;
}
// The buyer note sits in the summary (owner 2026-11-05) but still belongs to the checkout form (form="checkout-form").
function NoteDisclosure({value,error,onChange}:{value:string;error?:string;onChange:(name:keyof CheckoutDraft,value:string)=>void}){
 const [open,setOpen]=useState(Boolean(value||error));
 useEffect(()=>{if(error)setOpen(true);},[error]);
 return <details className="checkout-note" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary><Icon name="chevron" size={20}/><span>{value?'Catatan pengiriman':'Tambah catatan pengiriman'}</span></summary><DraftField name="buyer_note" value={value} error={error} focusFirst={Boolean(error)} onChange={onChange} form="checkout-form"/></details>;
}
// S177: what the current quote made of the code (applied or refused), or a code of the wrong shape the action never sent.
export function voucherState(state:CheckoutState):VoucherState{
 const v=state.view.quote?.voucher,quote=state.view.quote;
 if(v?.status==='applied')return {kind:'applied',code:v.code,discount:v.amount,target:v.target??'shipping'};
 if(v?.status==='refused')return {kind:'error',reason:v.reason,code:v.code,detail:{
  ...(v.reason==='MIN_SUBTOTAL'&&v.minimum_merchandise!==undefined&&quote?{shortfall:rupiah(Math.max(0,v.minimum_merchandise-quote.merchandise_total))}:{}),
  ...(v.reason==='METHOD_NOT_ELIGIBLE'?{method:quote?.payment_method==='cod'?'COD':'pembayaran di muka'}:{})}};
 return state.errors.voucher?{kind:'error',reason:'NOT_FOUND',code:state.intent.voucher}:{kind:'idle'};
}
function Summary({state,dirty,recovery=false,note,noteError=false,voucher={kind:'idle'}}:{state:CheckoutState;dirty:boolean;recovery?:boolean;note?:React.ReactNode;noteError?:boolean;voucher?:VoucherState}){
 const disclosure=useRef<HTMLDetailsElement>(null),cart=state.view.cart,quote=state.view.quote;
 useEffect(()=>{const wide=window.matchMedia('(min-width: 1024px)'),open=()=>{if(disclosure.current)disclosure.current.open=noteError||wide.matches&&parseFloat(getComputedStyle(document.documentElement).fontSize)<24;};open();wide.addEventListener('change',open);return()=>wide.removeEventListener('change',open);},[noteError]);
 if(!cart)return null;
 const expired=quote&&state.view.now&&Date.parse(quote.expires_at)<=Date.parse(state.view.now);
 const parcelOrder=new Map([...new Set(quote?.packages.flatMap(p=>p.lines.map(line=>line.cart_line_id))??[])].map((id,index)=>[id,index] as const));
 const lines=cart.lines.slice().sort((a,b)=>(parcelOrder.get(a.id)??Number.MAX_SAFE_INTEGER)-(parcelOrder.get(b.id)??Number.MAX_SAFE_INTEGER));
 return <aside className="checkout-summary" aria-label="Ringkasan pesanan"><details ref={disclosure}><summary><span><span className="summary-toggle-label">Ringkasan pesanan<span className="summary-chevron"><Icon name="chevron"/></span></span><span className="summary-desktop-title">Ringkasan pesanan</span><small>{quote?expired?'Ongkir berubah':dirty&&!recovery?'Belum diperbarui':recovery||state.step!=='review'||!state.view.quoteCurrent?'Perhitungan tersimpan':'Total perhitungan':'Produk · ongkir belum dihitung'}</small></span><strong>{rupiah(quote?.amount_due??cart.merchandise_total)}</strong></summary><div className="checkout-summary-body"><ul className="checkout-summary-lines">{lines.map(line=>{const image=state.view.images[line.id];return <li key={line.id} className="checkout-summary-line"><span className="checkout-summary-media">{image?<CatalogImage src={image.src} sizes="64px" max={128} min={64} alt="" width={image.width} height={image.height} loading="lazy" decoding="async"/>:<Icon name="cart"/>}<b className="checkout-qty" aria-hidden="true">{line.quantity}</b></span><span className="checkout-summary-text"><strong>{line.name}</strong><span>{line.variant_label} · {line.quantity} pilihan</span></span><strong className="checkout-summary-price">{rupiah(line.line_total)}</strong></li>;})}</ul>{note}{VOUCHERS_ENABLED&&note&&<CheckoutVoucher key={state.view.quote?.id??'none'} state={voucher} disabled={recovery}/>}{quote?<QuoteCharges quote={quote} voucher={voucher}/>:<dl className="checkout-charges"><div><dt>Produk</dt><dd>{rupiah(cart.merchandise_total)}</dd></div><div><dt>Ongkir</dt><dd>Belum dihitung</dd></div></dl>}<p className="checkout-hint">{recovery?'Perhitungan terakhir yang tersedia. Periksa hasil dengan permintaan yang sama.':quote&&!state.view.quoteCurrent?'Ongkir berubah. Periksa pilihan kurir.':dirty&&quote?'Perhitungan tersimpan belum mengikuti perubahan Anda.':quote?'Periksa setiap paket sebelum membuat pesanan.':'Ongkir dan total akhir ditampilkan setelah alamat diperiksa.'}</p></div></details></aside>;
}
// Phones (Shopify's mobile footer total): the thumbnail, "Total", the number of choices and the amount, just above the
// order button. A visual echo of the summary; the button itself states the total.
function MobileTotal({state}:{state:CheckoutState}){
 const cart=state.view.cart,quote=state.view.quote;if(!cart)return null;
 const first=cart.lines[0],image=first?state.view.images[first.id]:undefined,count=cart.lines.reduce((n,l)=>n+l.quantity,0);
 return <div className="checkout-mobile-total" aria-hidden="true"><span className="checkout-summary-media">{image?<CatalogImage src={image.src} sizes="40px" max={80} min={40} alt="" width={image.width} height={image.height} loading="lazy" decoding="async"/>:<Icon name="cart"/>}</span><span><strong>Total</strong><small>{count} pilihan</small></span><strong>{rupiah(quote?.amount_due??cart.merchandise_total)}</strong></div>;
}
function UnknownOrder({state,message='Balasan belum diterima. Periksa hasil dengan permintaan yang sama.',children}:{state:CheckoutState|null;message?:string;children:React.ReactNode}){
 return <><h1 className="checkout-title">Hasil tindakan belum diketahui</h1><div className="checkout-layout">{state&&<Summary state={state} dirty recovery/>}<section className="checkout-fields checkout-recovery"><div className="checkout-caution" role="alert"><Icon name="alert"/><p>{message}</p></div>{children}<CheckoutHelp context="order"/></section></div></>;
}
function Parcels({state,editable,choices={},onChange}:{state:CheckoutState;editable:boolean;choices?:Record<string,string>;onChange?:(parcel:string,service:string)=>void}){
 const quote=state.view.quote,cart=state.view.cart;if(!quote||!cart)return null;
 return <div className="checkout-parcels">{quote.packages.map((parcel,index)=>{const selected=choices[parcel.id]??state.intent.packages.find(p=>p.package_id===parcel.id)?.shipping_option_id??parcel.selected_option_id;return <fieldset className="checkout-parcel" key={parcel.id}><legend>Paket {index+1} · dari {parcel.origin_city}</legend><ul>{parcel.lines.map(part=>{const line=cart.lines.find(l=>l.id===part.cart_line_id);return line?<li key={part.cart_line_id}><strong>{line.name}</strong><span>{line.variant_label} · {part.quantity} pilihan lengkap</span><p className="checkout-content-label">Isi per pilihan</p><Contents contents={line.contents}/></li>:null;})}</ul>{editable?<><input type="hidden" name="package_id" value={parcel.id}/><fieldset className="checkout-choices"><legend>Layanan pengiriman</legend>{parcel.options.map(o=><label key={o.id}><input type="radio" name={`shipping_option:${parcel.id}`} value={o.id} checked={selected===o.id} data-issued-selected={o.id===parcel.selected_option_id} onChange={event=>onChange?.(parcel.id,event.currentTarget.value)}/><span><strong>{o.courier_name}</strong><span>{o.service_name}</span></span><b className="checkout-choice-price">{rupiah(o.shipping_amount)}</b></label>)}</fieldset></>:<p>{parcel.options.find(o=>o.id===parcel.selected_option_id)?.courier_name} · {parcel.options.find(o=>o.id===parcel.selected_option_id)?.service_name}</p>}{quote.source==='TEST-ONLY'&&<p className="checkout-hint">Estimasi waktu belum tersedia pada layanan simulasi ini.</p>}{editable&&<p className="checkout-hint checkout-parcel-pending">Biaya paket menunggu perhitungan baru.</p>}<dl className="checkout-charges">{parcel.subsidy_amount>0&&<><div><dt>Tarif paket</dt><dd>{rupiah(parcel.shipping_amount)}</dd></div><div><dt>Subsidi paket</dt><dd>−{rupiah(parcel.subsidy_amount)}</dd></div></>}<div><dt>Ongkir</dt><dd>{rupiah(parcel.buyer_shipping_amount)}</dd></div>{parcel.cod_collect_amount!==undefined&&<div className="checkout-total"><dt>COD paket ini</dt><dd>{rupiah(parcel.cod_collect_amount)}</dd></div>}</dl></fieldset>;})}</div>;
}


function AllocationChoices({choices,selected,allocation,initiallyOpen,onChange}:{choices:CheckoutAllocation[];selected:string;allocation:string;initiallyOpen:boolean;onChange:(id:string)=>void}){
 const current=choices.find(p=>p.id===selected)??choices[0],group=useRef<HTMLFieldSetElement>(null),restoreFocus=useRef(false);
 const [open,setOpen]=useState(initiallyOpen);
 useLayoutEffect(()=>{const checked=group.current?.querySelector<HTMLInputElement>('input:checked');if(restoreFocus.current&&checked?.value===allocation){checked.focus({preventScroll:true});restoreFocus.current=false;}},[allocation]);
 if(!current)return null;
 const difference=(choice:CheckoutAllocation)=>{
  if(choice.id===current.id)return 'Asal dan isi tersimpan';
  const key=(item:CheckoutAllocation['packages'][number]['items'][number])=>JSON.stringify([item.name,item.variant,item.contents]);
  const changes:string[]=[];
  for(const origin of new Set([...current.packages,...choice.packages].map(parcel=>parcel.origin_city))){
   const before=current.packages.filter(parcel=>parcel.origin_city===origin),after=choice.packages.filter(parcel=>parcel.origin_city===origin);
   if(before.length!==after.length)changes.push(`${origin}: ${after.length} paket`);
   const items=new Map(after.flatMap(parcel=>parcel.items).map(item=>[key(item),item]));
   for(const [id,item] of items){
    const quantity=(parcels:typeof after)=>parcels.flatMap(parcel=>parcel.items).filter(value=>key(value)===id).reduce((sum,value)=>sum+value.quantity,0);
    const moved=quantity(after)-quantity(before);if(moved<=0)continue;
    const parcels=after.filter(parcel=>parcel.items.some(value=>key(value)===id)),shared=parcels.every(parcel=>parcel.items.some(value=>key(value)!==id)),separate=parcels.every(parcel=>parcel.items.every(value=>key(value)===id));
    changes.push(`${item.name} ×${moved} dikirim dari ${origin}${shared?' bersama produk lain':separate?' dalam paket terpisah':''}`);
   }
  }
  if(changes.length)return changes.join(' · ');
  const contents=(parcel:CheckoutAllocation['packages'][number])=>JSON.stringify([parcel.origin_city,parcel.items]);
  const saved=current.packages.map(contents),changed=choice.packages.filter(parcel=>{const index=saved.indexOf(contents(parcel));if(index<0)return true;saved.splice(index,1);return false;});
  return changed.length?`Susunan baru: ${changed.map(parcel=>`${parcel.origin_city}: ${parcel.items.map(item=>`${item.name} (${item.variant}) ×${item.quantity}`).join(' + ')}`).join(' / ')}`:'Asal dan isi sama dengan tersimpan';
 };
 const primary=[current,...choices.filter(p=>p.id===allocation&&p.id!==current.id),...choices.filter(p=>p.id!==current.id&&p.id!==allocation)].slice(0,2);
 const option=(p:CheckoutAllocation)=><div className="checkout-allocation-option" key={p.id}><label><input type="radio" name="allocation_id" value={p.id} checked={allocation===p.id} data-issued-selected={p.id===selected} onKeyDown={event=>{const step=event.key==='ArrowDown'||event.key==='ArrowRight'?1:event.key==='ArrowUp'||event.key==='ArrowLeft'?-1:0;if(!step||event.altKey||event.ctrlKey||event.metaKey)return;event.preventDefault();const next=choices[(choices.findIndex(choice=>choice.id===p.id)+step+choices.length)%choices.length];restoreFocus.current=true;Array.from(group.current?.querySelectorAll<HTMLInputElement>('input')??[]).find(input=>input.value===next.id)?.click();}} onChange={event=>{restoreFocus.current=restoreFocus.current||event.currentTarget===document.activeElement;onChange(event.currentTarget.value);}}/><span>{(p.id===selected||p.id===allocation)&&<small>{p.id===selected?'Pembagian tersimpan':'Pilihan belum diterapkan'}</small>}<strong>{p.packages.length} paket · Tarif {rupiah(p.shipping_total)}</strong><span className="checkout-allocation-difference">{difference(p)}</span><span className="checkout-allocation-rows">{p.packages.map((parcel,index)=><span key={parcel.id}><span><strong>Paket {index+1} · dari {parcel.origin_city}:</strong> {parcel.items.map(item=>`${item.name} (${item.variant}) ×${item.quantity}`).join(', ')} · {parcel.service_name}</span><span>{rupiah(parcel.shipping_amount)}</span></span>)}</span>{p.equivalent_count>1&&<small>{p.equivalent_count} pembagian setara digabung.</small>}</span></label></div>;
 const others=choices.filter(p=>!primary.some(v=>v.id===p.id));
 return <fieldset ref={group} className="checkout-choices checkout-allocation"><legend>Pembagian paket</legend>{primary.map(option)}{others.length>0&&<details open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>Lihat {others.length} pembagian lain</summary><div>{others.map(option)}</div></details>}<p className="checkout-hint">Tarif belum dikurangi subsidi. Subsidi yang berlaku, ongkir yang dibayar, dan layanan ada pada kartu paket. Perubahan dihitung ulang sebelum tinjauan akhir.</p></fieldset>;
}

// Payment rows in the order buyers decide; only the view's offered methods render (production: transfer and COD).
const paymentRows=[
 {id:'prepaid',label:'Pembayaran simulasi',hint:'Hanya untuk uji lokal.'},
 {id:'transfer',label:'Transfer bank',hint:'Transfer ke rekening toko, dicek manual. Bayar dalam 24 jam.'},
 {id:'va',label:'Virtual Account / QRIS',hint:'Simulasi AutoLaris (lokal).'},
 {id:'cod',label:'Bayar di tempat (COD)',hint:'Bayar tunai ke kurir saat paket tiba. Ada biaya COD; tidak semua kurir dan tujuan tersedia.'},
];
export function CheckoutForm({initial}:{initial:CheckoutState}){
 return <CheckoutBoundary heading href="/checkout">{(capture,retry)=><CheckoutController initial={initial} capture={capture} retry={retry}/>}</CheckoutBoundary>;
}
function CheckoutController({initial,capture,retry}:{initial:CheckoutState;capture:(data:FormData|null,snapshot?:CheckoutState)=>void;retry:FormData|null}){
 const [state,action,pending]=useActionState(changeCheckout,initial,'/checkout');
 const [draft,setDraft]=useState(state.intent.draft),[query,setQuery]=useState(state.intent.query),[allocation,setAllocation]=useState(state.intent.allocation_id),[services,setServices]=useState<Record<string,string>>({}),[dirty,setDirty]=useState(false),[recovering,setRecovering]=useState(Boolean(retry));
 const synchronized=useRef<CheckoutState|null>(null),initialKey=useRef(initial.intent.key),replayed=useRef(false),form=useRef<HTMLFormElement>(null),heading=useRef<HTMLHeadingElement>(null),lastStep=useRef(state.step);
 const draftSave=useDraftSave(form,state,pending||recovering);
 const [enhanced,setEnhanced]=useState(false),[nudge,setNudge]=useState(0),autoTried=useRef(''),viaPick=useRef(false);useEffect(()=>setEnhanced(true),[]);
 const entryCart=initial.view.cart?.id,entryVersion=initial.view.cart?.version,entryReady=initial.view.kind==='ready'&&!initial.view.issue;
 useEffect(()=>{if(entryReady&&entryCart&&entryVersion)void observeCheckoutEntry(entryCart,entryVersion).catch(()=>{});},[entryCart,entryVersion,entryReady]);
 useEffect(()=>{if(retry&&!replayed.current){replayed.current=true;startTransition(()=>action(retry));}},[retry,action]);
 useLayoutEffect(()=>{
  if(synchronized.current===state)return;const first=synchronized.current===null;synchronized.current=state;
  if(first&&form.current&&(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined)?.type==='navigate'){
   // Fresh navigation adopts early input; reload/history open the stored draft.
   const data=new FormData(form.current),typed={...state.intent.draft},fields=Object.keys(labels) as (keyof typeof labels)[];
   for(const name of fields){const value=data.get(name);if(typeof value==='string')typed[name]=value;}
   const query=data.get('query'),typedQuery=typeof query==='string'?query:state.intent.query;
   if(fields.some(name=>typed[name]!==state.intent.draft[name])||typedQuery!==state.intent.query){setDraft(typed);setQuery(typedQuery);setDirty(fields.some(name=>name!=='buyer_note'&&typed[name]!==state.intent.draft[name]));draftSave.changed();}
  }else{setDraft({...state.intent.draft});setQuery(state.intent.query);setAllocation(state.intent.allocation_id);setServices({});setDirty(false);}
  if(state.phase!=='idle'||state.intent.key!==initialKey.current){setRecovering(false);if(state.phase!=='unknown')capture(null);}
  if(state.phase==='error'&&Object.keys(state.errors).length){const name=firstInvalid(state.errors),found=document.getElementById(`checkout-${name}`),target=found instanceof HTMLInputElement&&found.disabled?document.getElementById('checkout-query'):found;(target instanceof HTMLFieldSetElement?target.querySelector<HTMLElement>('input'):target)?.focus();}
  else if(state.step!==lastStep.current){heading.current?.focus();heading.current?.scrollIntoView({block:'start'});}
  lastStep.current=state.step;
  // The server has answered for this draft (quoted, refused, or reopened it via "Ubah"): no automatic retry until it changes.
  autoTried.current=courierKey(state.intent.draft);
 },[state,capture,draftSave.changed]);
 const setField=(name:keyof CheckoutDraft,value:string)=>{setDraft(current=>({...current,[name]:value}));if(name!=='buyer_note')setDirty(true);};
 const busy=pending||recovering,unknown=state.phase==='unknown',cart=state.view.cart,quote=state.view.quote;
 const intent={...state.intent,draft,query,allocation_id:allocation};
 const contact=state.step==='contact',review=!contact,firstError=firstInvalid(state.errors);
 // Single page (owner 2026-10-31, Shopify-like): once a quote exists, couriers and the package split stay editable next to
 // the order button; a changed choice is applied (and the total refreshed) before an order can be placed.
 const allocationChanged=Boolean(review&&quote&&allocation&&allocation!==quote.selected_allocation_id),servicePending=Boolean(review&&quote?.packages.some(p=>(services[p.id]??state.intent.packages.find(choice=>choice.package_id===p.id)?.shipping_option_id??p.selected_option_id)!==p.selected_option_id)),selectionPending=allocationChanged||servicePending,draftConflict=state.draftConflict||draftSave.conflict;
 const kind=contact?'quote' as const:selectionPending?'shipping' as const:'order' as const;
 const omit=contact?['recipient_name','phone','email','destination_id','address_line','buyer_note','payment_method','query']:['allocation_id','packages','buyer_note','email'];
 const pendingLabel=contact?'Memuat pilihan kurir…':kind==='shipping'?'Memperbarui pengiriman…':'Menyimpan pesanan…';
 const method=quote?.payment_channel==='manual-bank'?'Transfer bank':quote?.payment_channel==='autolaris'?'Virtual Account / QRIS':quote?.payment_method==='cod'?'Bayar di tempat (COD)':quote?.available_payment_methods.find(m=>m.kind===quote.payment_method)?.label??'';
 const submitIntent={...intent,kind};
 // Couriers load by themselves at the decisive steps (owner 2026-11-05, like Shopee/Tokopedia/Shopify): a kelurahan
 // picked, the payment method changed, or leaving the name, phone or street field, once the address is complete. Never while the buyer is
 // typing in a text field, and once per draft the server has not answered for yet.
 const complete=Boolean(draft.recipient_name.trim()&&/^0\d{8,13}$/.test(draft.phone.replace(/\D/g,''))&&draft.address_line.trim()&&draft.destination_id&&draft.payment_method);
 // biome-ignore lint/correctness/useExhaustiveDependencies: runs per decisive step (nudge) or step/busy change, reading the draft of that render.
 useEffect(()=>{
  if(!nudge||!contact||!enhanced||busy||draftConflict||state.phase==='unknown'||!complete||autoTried.current===courierKey(draft))return;
  // A pick (kelurahan, payment) may fire with focus still in its combobox; leaving a text field must not fire while the
  // buyer has moved on into the kecamatan or kelurahan field to change it.
  // The timer is cancelled when the step or busy state changes, and re-checks the step itself before submitting: on the
  // order step the same button places the order, which must only ever be the buyer's own press.
  const key=courierKey(draft),timer=setTimeout(()=>{const active=document.activeElement;if(typing(active)||!viaPick.current&&active?.getAttribute('role')==='combobox'||!form.current||form.current.querySelector('dl.checkout-review-box')||form.current.querySelector('fieldset[disabled]'))return;autoTried.current=key;form.current.requestSubmit(document.getElementById('checkout-primary') as HTMLButtonElement|null);},300);
  return()=>clearTimeout(timer);
 },[nudge,contact,busy]);
 // With JavaScript a changed courier or split is applied at once, like Shopify's shipping step; once per choice.
 const applied=useRef(''),refocus=useRef(''),touched=useRef(false);
 // The applied reply re-renders the choices; keyboard focus returns to the checked radio of the group the buyer used.
 // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each new server reply (state), not on values read here.
 useLayoutEffect(()=>{const name=refocus.current;if(!name||busy)return;refocus.current='';const group=name.startsWith('shipping_option:')?'input[name^="shipping_option:"]':`input[name="${name}"]`;form.current?.querySelector<HTMLInputElement>(`${group}:checked`)?.focus({preventScroll:true});},[state,busy]);const selectionKey=review&&quote?JSON.stringify([quote.id,allocation,services]):'';
 useEffect(()=>{if(!touched.current||!selectionPending||busy||draftConflict||applied.current===selectionKey)return;applied.current=selectionKey;touched.current=false;refocus.current=(document.activeElement as HTMLInputElement|null)?.name??'';form.current?.requestSubmit(document.getElementById('checkout-primary') as HTMLButtonElement|null);},[selectionPending,busy,draftConflict,selectionKey]);
 if(draftSave.denied||state.blocked||state.view.kind==='denied'||state.view.kind==='none')return <section className="checkout-recovery" role="alert"><h1>Sesi belanja perlu diperiksa</h1><p>{state.message||'Buka kembali keranjang melalui sesi belanja Anda.'}</p><Link className="button" href="/keranjang">Periksa keranjang</Link><CheckoutHelp context="recovery"/></section>;
 if(unknown)return <UnknownOrder state={state} message={state.message}><form id="checkout-form" action={action} onSubmit={event=>capture(submittedData(event),state)}><IntentFields intent={state.intent}/><button type="submit" className="button" disabled={busy}>{busy?'Memeriksa…':'Periksa hasil tindakan'}</button></form></UnknownOrder>;
 if(state.view.issue==='submitted'&&cart?.submitted_order_id)return <section className="checkout-recovery"><h1>Pesanan sudah tersimpan</h1><p>Periksa pesanan yang tersimpan sebelum melanjutkan.</p><Link className="button" href={`/checkout/order/${cart.submitted_order_id}`}>Periksa pesanan</Link><CheckoutHelp context="payment"/></section>;
 if(state.view.issue==='expired'||state.view.issue==='cart')return <section className="checkout-recovery" role="alert"><h1>Keranjang perlu diperiksa</h1><p>{state.view.issue==='expired'?'Keranjang ini kedaluwarsa. Pilih produk dari keranjang untuk memulai lagi.':'Stok atau rincian pilihan berubah. Periksa isi terbaru dari keranjang.'}</p><Link className="button" href="/keranjang">Kembali ke keranjang</Link><CheckoutHelp context="cart"/></section>;
 const reviewRow=(label:string,children:React.ReactNode)=><div className="checkout-review-row"><dt>{label}</dt><dd>{children}</dd><dd><button className="checkout-text-button" type="submit" name="navigate" value="contact">Ubah<span className="sr-only"> {label.toLowerCase()}</span></button></dd></div>;
 return <><h1 className="checkout-title sr-only">Checkout</h1><div className="checkout-layout">{/* Implicit submission (Enter in a field) uses the first submit button of the form in tree order; the summary's voucher
   buttons come before the form, so this hidden copy of the primary action keeps Enter doing what it did before (S177 review). */}<button type="submit" form="checkout-form" hidden tabIndex={-1} aria-hidden="true" disabled={draftConflict||review&&!quote}/><Summary state={state} voucher={voucherState(state)} dirty={dirty||selectionPending} noteError={Boolean(state.errors.buyer_note)} note={<NoteDisclosure value={draft.buyer_note} error={state.errors.buyer_note} onChange={(name,value)=>{setField(name,value);draftSave.changed();}}/>}/><div className="checkout-fields">
  {/* Field errors stand under their fields and the first invalid field takes focus (owner 2026-11-05: no summary list);
      this alert is only for errors no field owns (provider, quote, stock, session). */}
  {state.message&&state.phase==='error'&&!draftConflict&&!Object.keys(state.errors).length&&<div className="checkout-feedback checkout-error" role="alert"><Icon name="alert"/><div><p>{state.message}</p></div></div>}
  {state.message&&review&&state.phase!=='error'&&!selectionPending&&!draftConflict&&<p className="checkout-hint checkout-step-notice" data-phase={state.phase} role="status">{state.message}</p>}
  {state.previousTotal!==undefined&&quote&&state.previousTotal!==quote.amount_due&&state.phase==='success'&&!selectionPending&&!draftConflict&&<div role="status" className="checkout-caution checkout-total-change"><Icon name="alert"/><p>Total berubah dari {rupiah(state.previousTotal)} menjadi {rupiah(quote.amount_due)}. Periksa rincian paket.</p></div>}
  {draftConflict?<div className="checkout-caution checkout-conflict" role="alert"><Icon name="alert"/><div><p>Draf berubah di halaman lain. Muat ulang untuk memeriksanya.</p><p>Isian di halaman ini belum menggantikan draf tersimpan. Muat ulang akan membuka draf tersimpan.</p><a className="button secondary" href="/checkout">Muat ulang draf tersimpan</a><a href="/keranjang">Kembali ke keranjang tanpa menyimpan isian ini</a></div></div>:null}
  <form id="checkout-form" ref={form} action={action} noValidate onChange={draftSave.changed} onBlur={event=>{if(typing(event.target)&&['recipient_name','phone','address_line'].includes((event.target as unknown as HTMLInputElement).name)){viaPick.current=false;setNudge(n=>n+1);}}} onSubmit={event=>{const data=draftSave.submit(event);if(data)capture(data,state);}}>
   <IntentFields intent={submitIntent} omit={omit}/><fieldset className="checkout-controls" disabled={busy} aria-busy={busy}><legend className="sr-only">{contact?'Kontak, alamat dan pembayaran':'Pengiriman dan pesanan'}</legend>
    {contact?<>
     <section className="checkout-section" aria-labelledby="checkout-step"><h2 id="checkout-step" tabIndex={-1} ref={heading}>Pengiriman</h2>
      <p className="checkout-hint">Semua kolom wajib kecuali yang bertanda opsional.</p>
      <div className="checkout-pair"><DraftField name="recipient_name" value={draft.recipient_name} error={state.errors.recipient_name} focusFirst={firstError==='recipient_name'} onChange={setField}/><DraftField name="phone" value={draft.phone} error={state.errors.phone} focusFirst={firstError==='phone'} onChange={setField} hint="Contoh: 0812 3456 7890"/></div>
      <DraftField name="address_line" value={draft.address_line} error={state.errors.address_line} focusFirst={firstError==='address_line'} onChange={setField} hint="Nama jalan, no. rumah, RT/RW, dan patokan terdekat."/>
      <CheckoutAddress draft={draft} query={query} destinations={state.view.destinations} errors={state.errors} firstError={firstError} lookupMessage={state.phase==='idle'?state.message:''} setQuery={setQuery} setField={setField} onPicked={()=>{draftSave.changed();viaPick.current=true;setNudge(n=>n+1);}} enhanced={enhanced}/>
     </section>
     <section className="checkout-section" aria-labelledby="checkout-shipping-heading"><h2 id="checkout-shipping-heading" className="checkout-subheading">Metode pengiriman</h2>{busy?<p className="checkout-placeholder" role="status">Memuat pilihan kurir…</p>:PROVIDER_RETRY.includes(state.code??'')?<div className="checkout-placeholder"><p>Pilihan kurir belum bisa dimuat.</p><button className="checkout-text-button" type="submit">Coba lagi</button></div>:<p className="checkout-placeholder">Isi alamat pengiriman untuk melihat pilihan kurir.</p>}</section>
     <section className="checkout-section" aria-labelledby="checkout-payment-heading"><h2 id="checkout-payment-heading">Pembayaran</h2>
      <fieldset id="checkout-payment_method" className="checkout-methods checkout-rows" aria-invalid={Boolean(state.errors.payment_method)||undefined} aria-describedby={state.errors.payment_method?'checkout-method-error':'checkout-method-hint'}><legend className="sr-only">Metode pembayaran</legend>{paymentRows.filter(m=>state.view.methods.includes(m.id)).map((m,index)=><label key={m.id}>{/* biome-ignore lint/a11y/noAutofocus: native POST validation focuses only the first invalid field. */}
       <input autoFocus={firstError==='payment_method'&&index===0} type="radio" name="payment_method" value={m.id} checked={draft.payment_method===m.id} onChange={event=>{setField('payment_method',event.currentTarget.value);viaPick.current=true;setNudge(n=>n+1);}} required/><span><strong>{m.label}</strong><small>{m.hint}</small></span></label>)}</fieldset>
      <p id="checkout-method-hint" className="checkout-hint">Metode pembayaran ikut menentukan kurir yang tersedia.</p>{state.errors.payment_method&&<p id="checkout-method-error" className="checkout-field-error">{state.errors.payment_method}</p>}
     </section>
    </>:quote?<>
     <h2 id="checkout-step" className="sr-only" tabIndex={-1} ref={heading}>Pilih kurir, lalu buat pesanan</h2>
     <dl className="checkout-review-box">
      {reviewRow('Kontak',displayPhone(quote.contact.phone))}
      {reviewRow('Kirim ke',<><strong>{quote.address.recipient_name}</strong><span>{quote.address.address_line}, {[quote.address.subdistrict,quote.address.district,quote.address.city,quote.address.province].filter(Boolean).join(', ')} {quote.address.postal_code}</span></>)}
      {reviewRow('Pembayaran',<>{method}{quote.payment_method==='cod'&&<small>Bayar sesuai nominal setiap paket saat diterima.</small>}</>)}
     </dl>
     <section className="checkout-section" aria-labelledby="checkout-shipping-heading"><h2 id="checkout-shipping-heading" className="checkout-subheading">Metode pengiriman</h2>
      {quote.allocation_options.length>1?<AllocationChoices key={quote.id} choices={state.view.allocations} selected={quote.selected_allocation_id} allocation={allocation} initiallyOpen={state.intent.allocation_id!==quote.selected_allocation_id} onChange={id=>{touched.current=true;setAllocation(id);}}/>:<input type="hidden" name="allocation_id" value={allocation||quote.selected_allocation_id}/>}
      {allocationChanged?<p className="checkout-hint" role="status">Pembagian paket dihitung ulang…</p>:<Parcels key={`${quote.id}:${state.intent.key}`} state={state} editable choices={services} onChange={(parcel,service)=>{touched.current=true;setServices(current=>({...current,[parcel]:service}));}}/>}
     </section>
     <div className="checkout-due"><span>{quote.payment_method==='cod'?'Total COD':'Total'}</span><strong>{selectionPending?'Menghitung…':rupiah(quote.amount_due)}</strong></div>
    </>:<p role="alert">Perhitungan belum tersedia. Ubah alamat untuk menghitung ulang.</p>}
    <div className="checkout-actions">{contact&&cart&&<MobileTotal state={state}/>}<button id="checkout-primary" className="button" type="submit" disabled={draftConflict||review&&!quote}>{busy?pendingLabel:contact?enhanced?'Buat pesanan':'Cek ongkir':kind==='shipping'?'Perbarui pengiriman':quote?<><span className="checkout-order-label">Buat pesanan</span><span className="checkout-update-label">Perbarui pengiriman</span></>:'Periksa perhitungan'}</button>{busy&&<span className="sr-only" role="status">{pendingLabel}</span>}
</div>
   </fieldset>
   {/* Draft saving is silent (owner 2026-11-05); only a failed save is announced, to screen readers. */}
   {draftSave.failure&&!draftConflict&&<p className="sr-only" role="status">{draftSave.failure}</p>}
  </form>
 </div></div></>;
}

export function CheckoutPaymentForm({initial,recover=false,channels=[]}:{initial:CheckoutPaymentState;recover?:boolean;channels?:{channel_code:string;name:string;fee?:number}[]}){
 return <CheckoutBoundary href={`/checkout/order/${initial.order}`}>{(capture,retry)=><PaymentController initial={initial} recover={recover} channels={channels} capture={capture} retry={retry}/>}</CheckoutBoundary>;
}
function PaymentController({initial,recover,channels,capture,retry}:{initial:CheckoutPaymentState;recover:boolean;channels:{channel_code:string;name:string;fee?:number}[];capture:(data:FormData|null,snapshot?:CheckoutState)=>void;retry:FormData|null}){
 const path=`/checkout/order/${initial.order}`,[state,action,pending]=useActionState(recover?recoverPaymentAccess:preparePayment,initial,path),[recovering,setRecovering]=useState(Boolean(retry)),replayed=useRef(false);
 useEffect(()=>{if(retry&&!replayed.current){replayed.current=true;startTransition(()=>action(retry));}},[retry,action]);
 useEffect(()=>{if(state.phase!=='idle'){setRecovering(false);if(state.phase!=='unknown')capture(null);}},[state,capture]);
 return <form action={action} className="checkout-payment-action" onSubmit={event=>capture(submittedData(event))}><input type="hidden" name="order" value={state.order}/><input type="hidden" name="key" value={state.key}/>{!recover&&channels.length>0&&<fieldset className="checkout-methods"><legend>Bank Virtual Account atau QRIS</legend>{channels.map((c,index)=><label key={c.channel_code}><input type="radio" name="channel_code" value={c.channel_code} defaultChecked={index===0} required/>{c.name}{(c.fee??0)>0&&<span className="checkout-hint">Biaya admin {rupiah(c.fee??0)}</span>}</label>)}<p className="checkout-hint">{channels.some(c=>(c.fee??0)>0)?'Biaya admin bank atau QRIS dibayar pembeli dan ditambahkan ke tagihan. Biaya ini tidak dikembalikan bila pesanan dibatalkan setelah dibayar.':'Biaya layanan pembayaran ditanggung toko.'}</p></fieldset>}{state.message&&<p role={state.phase==='error'||state.phase==='unknown'?'alert':'status'} className={state.phase==='error'||state.phase==='unknown'?'checkout-field-error':'checkout-hint'}>{state.message}</p>}<button className="button" type="submit" disabled={pending||recovering||state.blocked}>{pending||recovering?'Memeriksa…':state.phase==='unknown'?'Ulangi permintaan yang sama':recover?'Pulihkan akses pesanan':'Siapkan instruksi pembayaran'}</button></form>;
}
