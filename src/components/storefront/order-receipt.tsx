'use client';

import {Component,startTransition,useActionState,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {observeReceiptView,prepareReceiptPayment,recoverReceiptAccess} from '../../app/(storefront)/checkout/actions';
import type {CheckoutPaymentState} from '../../modules/storefront/checkout-order';
import {Icon} from './ui/icon';

type RetryChild=(capture:(data:FormData|null)=>void,retry:FormData|null)=>React.ReactNode;
class ReceiptBoundary extends Component<{children:RetryChild;href:string},{failed:boolean;revision:number;retry:FormData|null}>{
 state={failed:false,revision:0,retry:null as FormData|null};submitted:FormData|null=null;
 static getDerivedStateFromError(error:unknown){
  if(typeof (error as {digest?:string})?.digest==='string'&&(error as {digest:string}).digest.startsWith('NEXT_REDIRECT'))throw error;
  return {failed:true};
 }
 capture=(data:FormData|null)=>{this.submitted=data;};
 render(){
  if(this.state.failed){
   const retry=this.submitted?<button className="button" type="button" onClick={()=>this.setState(s=>({failed:false,revision:s.revision+1,retry:this.submitted}))}>Periksa hasil tindakan</button>:<Link className="button" href={this.props.href}>Muat ulang halaman</Link>;
   return <section className="checkout-recovery"><h2>Hasil tindakan belum diketahui</h2><div className="checkout-caution" role="alert"><Icon name="alert"/><p>Balasan belum diterima. Periksa hasil dengan permintaan yang sama.</p></div>{retry}</section>;
  }
  return <div key={this.state.revision}>{this.props.children(this.capture,this.state.retry)}</div>;
 }
}

const submittedData=(event:React.FormEvent<HTMLFormElement>)=>new FormData(event.currentTarget,(event.nativeEvent as SubmitEvent).submitter);

export function OrderReceiptObserver({orderId}:{orderId:string}){
 useEffect(()=>{void observeReceiptView(orderId).catch(()=>{});},[orderId]);
 return null;
}

// Copies one payment value. The label names what is copied ("Salin nominal", "Salin nomor
// rekening"). Success is reported only when the clipboard accepted it; otherwise (no Clipboard API on
// an http origin, or a denied permission) the value is selected so the buyer can copy it manually.
export function OrderReceiptCopyCode({code,label='kode'}:{code:string;label?:string}){
 const [state,setState]=useState<'idle'|'copied'|'manual'>('idle'),value=useRef<HTMLElement>(null);
 const selectValue=()=>{const node=value.current;if(!node)return;const range=document.createRange();range.selectNodeContents(node);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);};
 const copy=async()=>{try{if(!navigator.clipboard)throw new Error('unavailable');await navigator.clipboard.writeText(code);setState('copied');}catch{selectValue();setState('manual');}};
 return <div className="receipt-code-box"><strong ref={value} className="receipt-code-value">{code}</strong><button type="button" className="receipt-copy-btn" onClick={()=>{void copy();}}>{state==='copied'?`${label[0].toUpperCase()}${label.slice(1)} disalin`:`Salin ${label}`}</button>{state==='manual'&&<p className="receipt-copy-manual" role="status">Belum bisa menyalin otomatis. Teks sudah dipilih; salin manual dengan tekan lama atau Ctrl+C.</p>}</div>;
}

export function OrderReceiptSummary({subtitle,total,children}:{subtitle:string;total:string;children:React.ReactNode}){
 const disclosure=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{
  const wide=window.matchMedia('(min-width: 1024px)'),open=()=>{if(disclosure.current){const desktop=wide.matches&&parseFloat(getComputedStyle(document.documentElement).fontSize)<24;disclosure.current.open=desktop;for(const more of disclosure.current.querySelectorAll<HTMLDetailsElement>('.receipt-more-items'))more.open=desktop;}};
  open();wide.addEventListener('change',open);return()=>wide.removeEventListener('change',open);
 },[]);
 return <aside className="checkout-summary receipt-summary-card" aria-label="Ringkasan pesanan"><details ref={disclosure}><summary><span><span className="summary-toggle-label"><span className="summary-show">Lihat ringkasan</span><span className="summary-hide">Tutup ringkasan</span></span><span className="summary-desktop-title">Ringkasan pesanan</span><small>{subtitle}</small></span><strong>{total}</strong><span className="summary-chevron"><Icon name="chevron"/></span></summary><div className="checkout-summary-body">{children}</div></details></aside>;
}

export function OrderReceiptPaymentForm({initial,recover=false}:{initial:CheckoutPaymentState;recover?:boolean}){
 return <ReceiptBoundary href={`/pesanan/${initial.order}`}>{(capture,retry)=><ReceiptPaymentController key={initial.key} initial={initial} recover={recover} capture={capture} retry={retry}/>}</ReceiptBoundary>;
}

function ReceiptPaymentController({initial,recover,capture,retry}:{initial:CheckoutPaymentState;recover:boolean;capture:(data:FormData|null)=>void;retry:FormData|null}){
 const path=`/pesanan/${initial.order}`,[state,action,pending]=useActionState(recover?recoverReceiptAccess:prepareReceiptPayment,initial,path),[recovering,setRecovering]=useState(Boolean(retry)),replayed=useRef(false);
 useEffect(()=>{if(retry&&!replayed.current){replayed.current=true;startTransition(()=>action(retry));}},[retry,action]);
 useEffect(()=>{if(state.phase!=='idle'){setRecovering(false);if(state.phase!=='unknown')capture(null);}},[state,capture]);
 return <form action={action} autoComplete="off" className="checkout-payment-action" onSubmit={event=>capture(submittedData(event))}><input type="hidden" name="order" value={state.order}/><input key={state.key} type="hidden" name="key" value={state.key}/>{state.message&&<p role={state.phase==='error'||state.phase==='unknown'?'alert':'status'} className={state.phase==='error'||state.phase==='unknown'?'checkout-field-error':'checkout-hint'}>{state.message}</p>}<button className="button" type="submit" disabled={pending||recovering||state.blocked}>{pending||recovering?'Memeriksa…':state.phase==='unknown'?'Ulangi permintaan yang sama':recover?'Pulihkan akses pesanan':'Siapkan instruksi pembayaran'}</button></form>;
}
