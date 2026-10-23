'use client';

import {Component,createContext,startTransition,useActionState,useContext,useEffect,useId,useRef,useState} from 'react';
import Link from 'next/link';
import {useFormStatus} from 'react-dom';
import {changeCart,restartShopping} from '../../app/(storefront)/keranjang/actions';
import type {CartIntent,CartMutationState} from '../../modules/storefront/cart';
import {Icon} from './icon';
import {rupiah} from '../../modules/storefront/format';

const formData=(intent:CartIntent)=>{const data=new FormData();for(const [key,value] of Object.entries(intent))data.set(key,value);return data;};
const target=(intent:CartIntent)=>`${intent.kind}:${intent.line||intent.variant}`;
type Mutations={state:CartMutationState;action:(data:FormData)=>void;pending:boolean;recovering:boolean;capture:(intent:CartIntent)=>void;feedbackId:string};
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
 const [recovering,setRecovering]=useState(retry.length>0);const continued=useRef(new Set<string>());const replayed=useRef(false);
 useEffect(()=>{if(state.acknowledgedKey)settle(state.acknowledgedKey);},[state.acknowledgedKey,settle]);
 useEffect(()=>{
  if(state.phase!=='bootstrap'||continued.current.has(state.intent.key))return;
  continued.current.add(state.intent.key);startTransition(()=>action(formData(state.intent)));
 },[state,action]);
 useEffect(()=>{
  if(replayed.current||!retry.length)return;replayed.current=true;
  startTransition(()=>{for(const intent of retry)action(formData(intent));});
 },[retry,action]);
 useEffect(()=>{if(recovering&&replayed.current&&!pending&&['success','error'].includes(state.phase))setRecovering(false);},[recovering,pending,state.phase]);
 const lostTarget=state.phase==='error'&&state.intent.line&&activeLines&&!activeLines.includes(state.intent.line);
 return <Context value={{state,action,pending,recovering,capture,feedbackId}}><div id={feedbackId} className="cart-feedback" data-phase={state.phase} role={state.phase==='unknown'||lostTarget?'alert':'status'} aria-live="polite" aria-atomic="true">{state.message&&(state.phase!=='error'||lostTarget)&&<><h2><Icon name={state.phase==='success'||state.phase==='bootstrap'?'check':'alert'}/>{state.phase==='success'?'Keranjang diperbarui':state.phase==='bootstrap'?'Sesi siap':state.phase==='unknown'?'Hasil tindakan belum diketahui':'Perubahan belum tersimpan'}</h2><p>{state.message}</p>{state.phase==='success'&&state.total!==null&&(state.count??0)>0&&<p>{state.count} pilihan · {rupiah(state.total)}</p>}{state.phase==='unknown'&&<Link className="detail-help" href="/keranjang">Periksa keranjang</Link>}</>}</div>{children}{showCartLink&&state.phase==='success'&&<Link className="detail-help" href="/keranjang">Lihat keranjang</Link>}</Context>;
}
export function CartMutations({initial,permalink,children,activeLines,showCartLink=false}:{initial:CartMutationState;permalink:string;children:React.ReactNode;activeLines?:string[];showCartLink?:boolean}){
 return <MutationBoundary>{(capture,settle,retry)=><Controller initial={initial} permalink={permalink} capture={capture} settle={settle} retry={retry} activeLines={activeLines} showCartLink={showCartLink}>{children}</Controller>}</MutationBoundary>;
}

type CartFormProps={intent:CartIntent;label:string;subject?:string;disabled?:boolean;quantity?:boolean;notice?:string;reviewId?:string};
export function CartForm(props:CartFormProps){
 const context=useContext(Context);if(!context)throw new Error('CartForm requires CartMutations');
 return <form action={context.action} className="cart-mutation" onSubmit={event=>{
  const data=new FormData(event.currentTarget);context.capture(Object.fromEntries(Object.keys(props.intent).map(key=>[key,String(data.get(key)??'')])) as CartIntent);
 }}><CartControls {...props}/></form>;
}
function CartControls({intent:base,label,subject,disabled=false,quantity=true,notice,reviewId}:CartFormProps){
 const messageId=useId(),status=useFormStatus(),context=useContext(Context);if(!context)throw new Error('CartControls requires CartMutations');
 const {state,pending,recovering}=context;
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
 return <fieldset className="cart-fields" aria-busy={busy} disabled={busy||blocked}><legend className="sr-only">{subject??label}</legend>
  {Object.entries(intent).filter(([name])=>name!=='quantity').map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
  {!error&&!unknown&&notice&&<p id={messageId} className="cart-advisory">{notice}</p>}
  {(error&&!reviewError||unknown&&!same)&&<p id={messageId} className="cart-form-error" role={error||!same?'alert':undefined}><Icon name="alert"/><span>{subject?`${subject}: `:''}{message}{error&&quantity&&' Perubahan jumlah belum diterapkan.'}</span></p>}
  {quantity?<label>Jumlah pilihan<input aria-label={subject?`Jumlah ${subject}`:'Jumlah pilihan'} aria-describedby={describedBy} aria-invalid={invalid||undefined} type="number" name="quantity" min="1" max="50" step="1" required defaultValue={intent.quantity} key={`${target(base)}:${intent.quantity}`} readOnly={unknown||disabled}/></label>:<input type="hidden" name="quantity" value={intent.quantity}/>}
  {busy&&<p className="cart-form-pending" role="status">Menyimpan perubahan pilihan ini…</p>}
  <button type="submit" aria-describedby={!quantity?describedBy:undefined} aria-label={subject?`${label} ${subject}`:undefined} className={`button${intent.kind==='remove'?' quiet':intent.kind==='add'||reviewId?'':' secondary'}`} disabled={!unknown&&disabled}>{intent.kind==='remove'&&<Icon name="close"/>}{busy?'Menyimpan…':unknown?'Ulangi tindakan yang sama':retained?'Lanjutkan pilihan':label}</button>
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
