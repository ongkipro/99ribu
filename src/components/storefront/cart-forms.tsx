'use client';

import {Component,createContext,startTransition,useActionState,useContext,useEffect,useId,useRef,useState} from 'react';
import Link from 'next/link';
import {useFormStatus} from 'react-dom';
import {changeCart,restartShopping} from '../../app/(storefront)/keranjang/actions';
import type {CartIntent,CartMutationState} from '../../modules/storefront/cart';
import {Icon} from './ui/icon';

const formData=(intent:CartIntent)=>{const data=new FormData();for(const [key,value] of Object.entries(intent))data.set(key,value);return data;};
const target=(intent:CartIntent)=>`${intent.kind}:${intent.line||intent.variant}`;
type Mutations={state:CartMutationState;action:(data:FormData)=>void;pending:boolean;recovering:boolean;capture:(intent:CartIntent)=>void;feedbackId:string;buyNow:{current:string|null};lastForm:{current:HTMLFormElement|null}};
const Context=createContext<Mutations|null>(null);

// Owner 2026-10-31: an add shows no "Keranjang diperbarui" box; like marketplace stores, the product photo flies to
// the visible cart icon and the icon bumps (its count is already re-rendered by the action's layout revalidation).
// No success text is rendered at all (owner: "hapus aja, jangan disembunyikan"); errors still show. Reduced motion:
// no flight, no bump; the count still changes.
const visible=(el:Element)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&getComputedStyle(el).visibility!=='hidden';};
function bump(target:HTMLElement){target.classList.remove('cart-bump');void target.offsetWidth;target.classList.add('cart-bump');target.addEventListener('animationend',()=>target.classList.remove('cart-bump'),{once:true});}
function flyToCart(form:HTMLFormElement|null){
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const target=[...document.querySelectorAll<HTMLElement>('a[href="/keranjang"]')].find(link=>link.querySelector('svg')&&visible(link));if(!target)return;
 const source=form?.closest('.purchase-region')?document.querySelector<HTMLImageElement>('.product-gallery .product-image'):form?.closest('article,li')?.querySelector<HTMLImageElement>('img');
 // From the photo when it is on screen, otherwise from the button that was pressed (the gallery may be scrolled away);
 // a product without a photo sends a small dot instead.
 const origin=source&&visible(source)?source:form?.querySelector<HTMLElement>('button[type=submit]');if(!origin||!visible(origin)){bump(target);return;}
 const from=origin.getBoundingClientRect(),to=target.getBoundingClientRect(),size=source?Math.min(from.width,from.height,160):20;
 const ghost=source?source.cloneNode() as HTMLImageElement:document.createElement('span');
 if(ghost instanceof HTMLImageElement){ghost.removeAttribute('id');ghost.alt='';ghost.loading='eager';}ghost.className=source?'cart-fly':'cart-fly cart-fly-dot';ghost.setAttribute('aria-hidden','true');
 Object.assign(ghost.style,{left:`${from.left+(from.width-size)/2}px`,top:`${from.top+(from.height-size)/2}px`,width:`${size}px`,height:`${size}px`});document.body.append(ghost);
 const dx=to.left+to.width/2-(from.left+from.width/2),dy=to.top+to.height/2-(from.top+from.height/2);
 ghost.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${dx}px,${dy}px) scale(${Math.max(16/size,0.08)})`,opacity:0.5}],{duration:650,easing:'cubic-bezier(0.55,0,0.75,0.2)'})
  .finished.then(()=>bump(target),()=>{}).finally(()=>ghost.remove());
}

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
 const [recovering,setRecovering]=useState(retry.length>0);const continued=useRef(new Set<string>());const replayed=useRef(false);const buyNow=useRef<string|null>(null);const lastForm=useRef<HTMLFormElement|null>(null);const flown=useRef<string|null>(null);
 useEffect(()=>{if(state.phase!=='success'||state.intent.kind!=='add'||flown.current===state.intent.key||buyNow.current===state.intent.key)return;flown.current=state.intent.key;flyToCart(lastForm.current);},[state]);
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
 return <Context value={{state,action,pending,recovering,capture,feedbackId,buyNow,lastForm}}><div id={feedbackId} className="cart-feedback" data-phase={state.phase} data-ack={state.acknowledgedKey??undefined} role={state.phase==='unknown'||lostTarget?'alert':'status'} aria-live="polite" aria-atomic="true">{state.message&&state.phase!=='success'&&(state.phase!=='error'||lostTarget)&&<><h2><Icon name={state.phase==='bootstrap'?'check':'alert'}/>{state.phase==='bootstrap'?'Sesi siap':state.phase==='unknown'?'Hasil tindakan belum diketahui':'Perubahan belum tersimpan'}</h2><p>{state.message}</p>{state.phase==='unknown'&&<Link className="detail-help" href="/keranjang">Periksa keranjang</Link>}</>}</div>{children}{showCartLink&&state.phase==='success'&&<Link className="detail-help" href="/keranjang">Lihat keranjang</Link>}</Context>;
}
export function CartMutations({initial,permalink,children,activeLines,showCartLink=false}:{initial:CartMutationState;permalink:string;children:React.ReactNode;activeLines?:string[];showCartLink?:boolean}){
 return <MutationBoundary>{(capture,settle,retry)=><Controller initial={initial} permalink={permalink} capture={capture} settle={settle} retry={retry} activeLines={activeLines} showCartLink={showCartLink}>{children}</Controller>}</MutationBoundary>;
}

type CartFormProps={intent:CartIntent;label:string;subject?:string;disabled?:boolean;quantity?:boolean;notice?:string;reviewId?:string;stepper?:boolean;bar?:string;buyNow?:boolean};
export function CartForm(props:CartFormProps){
 const context=useContext(Context);if(!context)throw new Error('CartForm requires CartMutations');
 return <form action={context.action} className="cart-mutation" onSubmit={event=>{
  const data=new FormData(event.currentTarget);context.capture(Object.fromEntries(Object.keys(props.intent).map(key=>[key,String(data.get(key)??'')])) as CartIntent);
  context.buyNow.current=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='checkout'?String(data.get('key')??''):null;context.lastForm.current=event.currentTarget;
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
 // belong to the fixed phone top bar and the bottom to the phone dock (measured; 0 where it is hidden), so a main
 // button under either already counts as out of view (owner 2026-10-30: it sat under the dock on the first screen).
 useEffect(()=>{const el=submit.current;if(!bar||!el)return;const dock=Math.ceil(document.querySelector('.shopping-tabs')?.getBoundingClientRect().height??0);
  const observer=new IntersectionObserver(([entry])=>setBarShown(!entry.isIntersecting&&Number.parseFloat(getComputedStyle(document.documentElement).fontSize)<=20),{rootMargin:`-64px 0px -${dock}px 0px`});observer.observe(el);return ()=>observer.disconnect();},[bar]);
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
 // Unsaved quantity (stepper or typed): the update button turns primary and says so; checkout stays the buyer's call (the saved quantity is what is ordered).
 const [value,setValue]=useState(Number(intent.quantity));useEffect(()=>{setValue(Number(intent.quantity));},[intent.quantity]);const dirty=quantity&&!busy&&value!==Number(intent.quantity);
 return <fieldset className="cart-fields" aria-busy={busy} disabled={busy||blocked}><legend className="sr-only">{subject??label}</legend>
  {Object.entries(intent).filter(([name])=>name!=='quantity').map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
  {!error&&!unknown&&notice&&<p id={messageId} className="cart-advisory">{notice}</p>}
  {(error&&!reviewError||unknown&&!same)&&<p id={messageId} className="cart-form-error" role={error||!same?'alert':undefined}><Icon name="alert"/><span>{subject?`${subject}: `:''}{message}{error&&quantity&&' Perubahan jumlah belum diterapkan.'}</span></p>}
  {quantity?(()=>{const input=<input ref={field} id={quantityId} aria-label={subject?`Jumlah ${subject}`:'Jumlah pilihan'} aria-describedby={describedBy} aria-invalid={invalid||undefined} type="number" name="quantity" min="1" max="50" step="1" required defaultValue={intent.quantity} key={`${target(base)}:${intent.quantity}`} onInput={event=>setValue(Number(event.currentTarget.value))} readOnly={unknown||disabled}/>;
   // PDP (shop.com quantity pill): the same native number field between minus and plus steps.
   const step=(up:boolean)=>{const el=field.current;if(!el||el.readOnly)return;if(up)el.stepUp();else el.stepDown();setValue(Number(el.value));};
   return stepper?<div className="cart-quantity"><label htmlFor={quantityId} className={subject?'sr-only':undefined}>Jumlah pilihan</label><span className="quantity-stepper"><button type="button" aria-label={subject?`Kurangi jumlah ${subject}`:'Kurangi jumlah'} disabled={unknown||disabled||value<=1} onClick={()=>step(false)}><Icon name="subtract" size={subject?20:24}/></button>{input}<button type="button" aria-label={subject?`Tambah jumlah ${subject}`:'Tambah jumlah'} disabled={unknown||disabled||value>=50} onClick={()=>step(true)}><Icon name="add" size={subject?20:24}/></button></span></div>:
    // biome-ignore lint/a11y/noLabelWithoutControl: the label wraps the number input held in `input`.
    <label>Jumlah pilihan{input}</label>;})():<input type="hidden" name="quantity" value={intent.quantity}/>}
  {busy&&<p className="cart-form-pending" role="status">Menyimpan perubahan pilihan ini…</p>}
  {/* PDP (DEC-020, shop.com action row): add to cart first in the DOM and tab order, shown on the right; "Beli sekarang" submits the same add, then checkout. Hidden while an unknown result offers the retry. */}
  {buyNow&&!disabled&&!unknown?<div className="purchase-actions"><button ref={submit} type="submit" aria-describedby={!quantity?describedBy:undefined} aria-label={subject?`${label} ${subject}`:undefined} className={`button${intent.kind==='remove'?' quiet':intent.kind==='add'||reviewId||dirty?'':' secondary'}`} disabled={!unknown&&disabled}>{intent.kind==='remove'&&<Icon name="close"/>}{buttonText}</button><button type="submit" name="then" value="checkout" className="button buy-now">{busy?'Menyimpan…':'Beli sekarang'}</button></div>:<button ref={submit} type="submit" aria-describedby={!quantity?describedBy:undefined} aria-label={subject?`${label} ${subject}`:undefined} className={`button${intent.kind==='remove'?' quiet':intent.kind==='add'||reviewId||dirty?'':' secondary'}`} disabled={!unknown&&disabled}>{intent.kind==='remove'&&<Icon name="close"/>}{buttonText}</button>}
  {dirty&&subject&&<p className="cart-advisory cart-dirty">Jumlah belum disimpan.</p>}
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
