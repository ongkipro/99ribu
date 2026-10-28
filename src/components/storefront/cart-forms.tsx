'use client';

import {Component,createContext,startTransition,useActionState,useContext,useEffect,useId,useRef,useState} from 'react';
import Link from 'next/link';
import {useFormStatus} from 'react-dom';
import {changeCart,restartShopping} from '../../app/(storefront)/keranjang/actions';
import type {CartIntent,CartMutationState} from '../../modules/storefront/cart';
import {Icon} from './ui/icon';
import {rupiah} from '../../modules/storefront/format';

const formData=(intent:CartIntent)=>{const data=new FormData();for(const [key,value] of Object.entries(intent))data.set(key,value);return data;};
const target=(intent:CartIntent)=>`${intent.kind}:${intent.line||intent.variant}`;
type Mutations={state:CartMutationState;action:(data:FormData)=>void;pending:boolean;recovering:boolean;capture:(intent:CartIntent)=>void;feedbackId:string;buyNow:{current:string|null}};
const Context=createContext<Mutations|null>(null);

// A rejected Server Action cancels React's queue. Retain its exact submitted
// intents in memory so an explicit retry can recover committed acknowledgements.
class MutationBoundary extends Component<{children:(capture:(intent:CartIntent)=>void,settle:(key:string)=>void,retry:CartIntent[])=>React.ReactNode},{failed:boolean;revision:number;retry:CartIntent[]}>{
 state={failed:false,revision:0,retry:[] as CartIntent[]};
 submitted=new Map<string,CartIntent>();
 static getDerivedStateFromError(){return {failed:true};}
 capture=(intent:CartIntent)=>{this.submitted.set(intent.key,intent);};
 render(){
  if(this.state.failed)return <section className="cart-feedback" data-phase="unknown" role="alert"><h2><Icon name="alert"/>Hasil tindakan belum diketahui</h2><p>Periksa keranjang atau ulangi tindakan yang sama. Jumlah tidak ditambahkan dua kali.</p><button className="button" type="button" onClick={()=>this.setState(s=>({failed:false,revision:s.revision+1,retry:[...this.submitted.values()]}))}>Ulangi tindakan yang sama</button><Link href="/keranjang">Periksa keranjang</Link></section>;
  return <div key={this.state.revision}>{this.props.children(this.capture,key=>this.submitted.delete(key),this.state.retry)}</div>;
 }
}

function Controller({initial,permalink,children,capture,settle,retry,activeLines,showCartLink}:{initial:CartMutationState;permalink:string;children:React.ReactNode;capture:(intent:CartIntent)=>void;settle:(key:string)=>void;retry:CartIntent[];activeLines?:string[];showCartLink:boolean}){
 const feedbackId=useId();
 const [state,action,pending]=useActionState(changeCart,initial,permalink);
 const [recovering,setRecovering]=useState(retry.length>0);const continued=useRef(new Set<string>());const replayed=useRef(false);const buyNow=useRef<string|null>(null);
 useEffect(()=>{if(state.acknowledgedKey)settle(state.acknowledgedKey);},[state.acknowledgedKey,settle]);
 useEffect(()=>{
  if(state.phase!=='bootstrap'||continued.current.has(state.intent.key))return;
  // A guest bootstrap replays the same intent; keep "Beli sekarang" on it.
  continued.current.add(state.intent.key);const data=formData(state.intent);if(buyNow.current===state.intent.key)data.set('then','checkout');startTransition(()=>action(data));
 },[state,action]);
 useEffect(()=>{
  if(replayed.current||!retry.length)return;replayed.current=true;
  startTransition(()=>{for(const intent of retry)action(formData(intent));});
 },[retry,action]);
 useEffect(()=>{if(recovering&&replayed.current&&!pending&&['success','error'].includes(state.phase))setRecovering(false);},[recovering,pending,state.phase]);
 const lostTarget=state.phase==='error'&&state.intent.line&&activeLines&&!activeLines.includes(state.intent.line);
 return <Context value={{state,action,pending,recovering,capture,feedbackId,buyNow}}><div id={feedbackId} className="cart-feedback" data-phase={state.phase} role={state.phase==='unknown'||lostTarget?'alert':'status'} aria-live="polite" aria-atomic="true">{state.message&&(state.phase!=='error'||lostTarget)&&<><h2><Icon name={state.phase==='success'||state.phase==='bootstrap'?'check':'alert'}/>{state.phase==='success'?'Keranjang diperbarui':state.phase==='bootstrap'?'Sesi siap':state.phase==='unknown'?'Hasil tindakan belum diketahui':'Perubahan belum tersimpan'}</h2><p>{state.message}</p>{state.phase==='success'&&state.total!==null&&(state.count??0)>0&&<p>{state.count} pilihan · {rupiah(state.total)}</p>}{state.phase==='unknown'&&<Link className="detail-help" href="/keranjang">Periksa keranjang</Link>}</>}</div>{children}{showCartLink&&state.phase==='success'&&<Link className="detail-help" href="/keranjang">Lihat keranjang</Link>}</Context>;
}
export function CartMutations({initial,permalink,children,activeLines,showCartLink=false}:{initial:CartMutationState;permalink:string;children:React.ReactNode;activeLines?:string[];showCartLink?:boolean}){
 return <MutationBoundary>{(capture,settle,retry)=><Controller initial={initial} permalink={permalink} capture={capture} settle={settle} retry={retry} activeLines={activeLines} showCartLink={showCartLink}>{children}</Controller>}</MutationBoundary>;
}

type CartFormProps={intent:CartIntent;label:string;subject?:string;disabled?:boolean;quantity?:boolean;notice?:string;reviewId?:string;stepper?:boolean;bar?:string;buyNow?:boolean};
export function CartForm(props:CartFormProps){
 const context=useContext(Context);if(!context)throw new Error('CartForm requires CartMutations');
 return <form action={context.action} className="cart-mutation" onSubmit={event=>{
  const data=new FormData(event.currentTarget);context.capture(Object.fromEntries(Object.keys(props.intent).map(key=>[key,String(data.get(key)??'')])) as CartIntent);
  context.buyNow.current=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='checkout'?String(data.get('key')??''):null;
 }}><CartControls {...props}/></form>;
}
function CartControls({intent:base,label,subject,disabled=false,quantity=true,notice,reviewId,stepper=false,bar,buyNow=false}:CartFormProps){
 const messageId=useId(),quantityId=useId(),field=useRef<HTMLInputElement>(null),status=useFormStatus(),context=useContext(Context);if(!context)throw new Error('CartControls requires CartMutations');
 const {state,pending,recovering}=context;
 // PDP phone buy bar (`bar` is just the on/off flag; the bar carries chat, add-to-cart and "Beli sekarang"): a second submit button of this same form, shown only
 // while the main button is out of view, so it shares the quantity, pending lock and labels. It is a
 // pointer shortcut only (aria-hidden, out of the tab order); keyboard and screen-reader users keep
 // the one main button. After a result it was pressed for, the purchase region scrolls back into
 // view so the feedback is seen.
 const submit=useRef<HTMLButtonElement>(null),fromBar=useRef(false),[barShown,setBarShown]=useState(false);
 // Enlarged text (root above 20px) keeps the bar off: wrapped, it would cover a third of the screen. The top 64px
 // belong to the fixed phone top bar, so a main button scrolled under it already counts as out of view.
 useEffect(()=>{const el=submit.current;if(!bar||!el)return;const observer=new IntersectionObserver(([entry])=>setBarShown(!entry.isIntersecting&&Number.parseFloat(getComputedStyle(document.documentElement).fontSize)<=20),{rootMargin:'-64px 0px 0px 0px'});observer.observe(el);return ()=>observer.disconnect();},[bar]);
 useEffect(()=>{if(!fromBar.current||state.phase==='idle')return;fromBar.current=false;submit.current?.closest('.purchase-region')?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});},[state]);
 const same=target(base)===target(state.intent);
 const [previous,setPrevious]=useState<Pick<CartMutationState,'phase'|'intent'|'message'|'blocked'|'code'>|null>(null);
 useEffect(()=>{if(same&&state.phase!=='idle')setPrevious(state.phase==='success'?null:{phase:state.phase,intent:state.intent,message:state.message,blocked:state.blocked,code:state.code});},[same,state]);
 const own=same?state:previous&&target(previous.intent)===target(base)?previous:null;
 const retained=own!==null&&['bootstrap','unknown'].includes(own.phase),error=own?.phase==='error';
 const intent=retained?own.intent:error&&quantity?{...base,quantity:own.intent.quantity}:base,unknown=retained&&own.phase==='unknown';
 const reviewError=Boolean(error&&own?.code==='PUBLICATION_REVIEW_REQUIRED'&&reviewId);
 const message=error&&disabled&&notice&&!own?.blocked?notice:own?.message;
 const invalid=error&&!disabled&&['OFFER_UNAVAILABLE','INVALID_INPUT','CART_QUANTITY_LIMIT'].includes(own?.code??'');
 const describedBy=reviewError?reviewId:error||unknown&&!same?messageId:unknown?context.feedbackId:notice?messageId:undefined;
 const busy=status.pending||pending&&(recovering||state.phase==='bootstrap'&&same),blocked=Boolean(own?.blocked)||state.phase==='unknown'&&!same;
 const buttonText=busy?'Menyimpan…':unknown?'Ulangi tindakan yang sama':retained?'Lanjutkan pilihan':label;
 return <fieldset className="cart-fields" aria-busy={busy} disabled={busy||blocked}><legend className="sr-only">{subject??label}</legend>
  {Object.entries(intent).filter(([name])=>name!=='quantity').map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
  {!error&&!unknown&&notice&&<p id={messageId} className="cart-advisory">{notice}</p>}
  {(error&&!reviewError||unknown&&!same)&&<p id={messageId} className="cart-form-error" role={error||!same?'alert':undefined}><Icon name="alert"/><span>{subject?`${subject}: `:''}{message}{error&&quantity&&' Perubahan jumlah belum diterapkan.'}</span></p>}
  {quantity?(()=>{const input=<input ref={field} id={quantityId} aria-label={subject?`Jumlah ${subject}`:'Jumlah pilihan'} aria-describedby={describedBy} aria-invalid={invalid||undefined} type="number" name="quantity" min="1" max="50" step="1" required defaultValue={intent.quantity} key={`${target(base)}:${intent.quantity}`} readOnly={unknown||disabled}/>;
   // PDP (shop.com quantity pill): the same native number field between minus and plus steps.
   const step=(up:boolean)=>{const el=field.current;if(!el||el.readOnly)return;if(up)el.stepUp();else el.stepDown();};
   return stepper?<div className="cart-quantity"><label htmlFor={quantityId}>Jumlah pilihan</label><span className="quantity-stepper"><button type="button" aria-label="Kurangi jumlah" disabled={unknown||disabled} onClick={()=>step(false)}><Icon name="subtract"/></button>{input}<button type="button" aria-label="Tambah jumlah" disabled={unknown||disabled} onClick={()=>step(true)}><Icon name="add"/></button></span></div>:
    // biome-ignore lint/a11y/noLabelWithoutControl: the label wraps the number input held in `input`.
    <label>Jumlah pilihan{input}</label>;})():<input type="hidden" name="quantity" value={intent.quantity}/>}
  {busy&&<p className="cart-form-pending" role="status">Menyimpan perubahan pilihan ini…</p>}
  {/* PDP (DEC-020, shop.com action row): add to cart first in the DOM and tab order, shown on the right; "Beli sekarang" submits the same add, then checkout. Hidden while an unknown result offers the retry. */}
  {buyNow&&!disabled&&!unknown?<div className="purchase-actions"><button ref={submit} type="submit" aria-describedby={!quantity?describedBy:undefined} aria-label={subject?`${label} ${subject}`:undefined} className={`button${intent.kind==='remove'?' quiet':intent.kind==='add'||reviewId?'':' secondary'}`} disabled={!unknown&&disabled}>{intent.kind==='remove'&&<Icon name="close"/>}{buttonText}</button><button type="submit" name="then" value="checkout" className="button buy-now">{busy?'Menyimpan…':'Beli sekarang'}</button></div>:<button ref={submit} type="submit" aria-describedby={!quantity?describedBy:undefined} aria-label={subject?`${label} ${subject}`:undefined} className={`button${intent.kind==='remove'?' quiet':intent.kind==='add'||reviewId?'':' secondary'}`} disabled={!unknown&&disabled}>{intent.kind==='remove'&&<Icon name="close"/>}{buttonText}</button>}
  {/* Phone buy bar (marketplace pattern): chat icon, add-to-cart icon, then the "Beli sekarang" text button (the same add, then checkout). Pointer shortcuts only (aria-hidden, out of the tab order); the page's own controls keep the names and the keyboard path. */}
  {bar&&!disabled&&<div className="buy-bar" hidden={!barShown} aria-hidden="true">
   <Link href="/bantuan#percakapan" className="bar-chat" tabIndex={-1} prefetch={false}><svg aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg><span className="sr-only">Chat bantuan</span></Link>
   <button type="submit" className="button bar-add" tabIndex={-1} onClick={()=>{fromBar.current=true;}}><Icon name="cart"/><span className="sr-only">{buttonText}</span></button>
   {buyNow&&!unknown&&<button type="submit" name="then" value="checkout" className="button buy-now" tabIndex={-1} onClick={()=>{fromBar.current=true;}}>{busy?'Menyimpan…':'Beli sekarang'}</button>}
  </div>}
 </fieldset>;
}

export function CartProgression({children,checkout=false}:{children:React.ReactNode;checkout?:boolean}){
 const context=useContext(Context);
 const blocked=context&&(context.pending||context.recovering||context.state.phase==='bootstrap'||context.state.phase==='unknown'||context.state.blocked);
 return <div aria-busy={context?.pending}>{children}{checkout&&(blocked?<p className="cart-advisory" role="status">Periksa hasil perubahan keranjang sebelum checkout.</p>:<Link className="button" href="/checkout" prefetch={false}>Lanjut ke checkout</Link>)}</div>;
}

export function RestartShopping(){
 const [state,action,pending]=useActionState(restartShopping,{message:''},'/keranjang');
 return <form action={action} className="session-recovery"><p>Tindakan ini mengakhiri sesi akun dan belanja sebelumnya. Keranjang lama tidak dihapus; aksesnya tidak dipindahkan ke sesi baru.</p><button className="button danger" type="submit" disabled={pending}>{pending?'Mengakhiri sesi…':'Akhiri sesi dan mulai ulang'}</button><p role="status">{state.message}</p></form>;
}
