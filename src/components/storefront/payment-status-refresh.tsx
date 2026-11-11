'use client';
import {useRouter} from 'next/navigation';
import {useEffect} from 'react';

// Re-reads the server-rendered payment state while it can still change by itself (instruction being created, payment awaiting
// the provider). Only while the tab is visible, and bounded: the buyer keeps the "Perbarui status" button after that.
export const PAYMENT_REFRESH_MS=10000,PAYMENT_REFRESH_MAX=30;
export function PaymentStatusRefresh({active}:{active:boolean}){
 const router=useRouter();
 useEffect(()=>{
  if(!active)return;
  let count=0;
  const timer=window.setInterval(()=>{
   if(document.visibilityState!=='visible')return;
   if(++count>PAYMENT_REFRESH_MAX){window.clearInterval(timer);return;}
   router.refresh();
  },PAYMENT_REFRESH_MS);
  return()=>window.clearInterval(timer);
 },[active,router]);
 return null;
}
