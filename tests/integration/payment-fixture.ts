import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {capability,commerceActor,prefix} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {expireOwnedOrderJob} from '../../src/modules/checkout/expiry.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {handlePayments} from '../../src/modules/payments/routes.ts';
import {checkoutFixture,CommerceClient} from './checkout-fixture.ts';

export async function paymentFixture(){
 const f=await checkoutFixture(),orders:string[]=[];
 const order=async(quantity=1,payment_method:'prepaid'|'cod'='prepaid',payment_channel?:'local-prepaid'|'manual-bank'|'autolaris'|'cod',reuse?:CommerceClient,beforeSubmit?:()=>Promise<void>)=>{
  // reuse: the same guest context places another order (per-actor limits).
  const client=reuse??new CommerceClient(f.identity),input={lines:[f.line('fixture-offer-shirt',quantity)]},key=randomUUID();
  if(!reuse)assert.equal((await client.call('/api/v1/carts',input,{key})).response.status,401);
  const request=client.request('/api/v1/carts',input,{key}),actor=await commerceActor(request,f.identity);assert.ok(actor?.kind==='guest');
  const cart=await f.identity.sql.begin(tx=>createCart(tx,request,f.identity,actor,input,{clock_namespace:f.namespace}));
  const name=`${await prefix(f.identity)}.cart_access`,token=await capability(f.identity,'cart',cart.cart.id,actor.id,cart.cart.cap_issued_at as string);
  client.cookies.set(`${name}:/`,{name,value:`${cart.cart.id}.${token}`,path:'/'});
  const quote=await client.call('/api/v1/checkout/quotes',{cart_id:cart.cart.id,address:f.address,contact:f.contact(),payment_method,...(payment_channel?{payment_channel}:{})},{version:1});assert.equal(quote.response.status,201);
  await beforeSubmit?.();
  const submitted=await client.call("/api/v1/orders",{quote_id:quote.payload.id},{version:1});
  if(!reuse&&!beforeSubmit)assert.equal(submitted.response.status,201,JSON.stringify(submitted.payload));if(submitted.response.status===201)orders.push(submitted.payload.order.id);
  return {client,order:submitted.payload.order,status:submitted.response.status,code:submitted.payload.code as string|undefined};
 };
 const call=async(client:CommerceClient,path:string,body?:unknown,options:Parameters<CommerceClient['request']>[2]={})=>{
  const request=client.request(path,body,options),response=await handlePayments(request,f.identity);return {response,payload:await response.json()};
 };
 const close=async()=>{
  try{if(orders.length){const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
   for(const orderId of orders){const [job]=await f.identity.sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${orderId}`;
    assert.ok(job);await f.identity.sql.begin(tx=>expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload}));}
  }}finally{await f.close();}
 };
 return {...f,order,call,close};
}

type PaymentFixture=Awaited<ReturnType<typeof paymentFixture>>;
async function ownerPolicyProof(f:PaymentFixture){
 const req=f.owner.browser.request('/api/v1/me/reauthentication-proofs',{password:f.owner.password,action:'payment_policy.version',subject_id:'company-payment'});req.headers.set('idempotency-key',randomUUID());
 const response=await handleAccess(req,f.identity);assert.equal(response.status,201);return (await response.json()).proof as string;
}
// Append a payment-policy version through the real owner flow; returns set/restore.
export async function withCommercialTerms(f:PaymentFixture,values:Record<string,unknown>){
 const read=async()=>(await (await f.owner.browser.access('/admin/policy-versions?kind=payment')).json()) as {latest_version:number;current:{values:Record<string,unknown>}|null};
 const write=async(next:Record<string,unknown>,reason:string)=>{const history=await read();
  const req=f.owner.browser.request('/api/v1/admin/policy-versions',{kind:'payment',warehouse_id:null,expected_version:history.latest_version,effective_at:null,values:next,reason,reauthentication_proof:await ownerPolicyProof(f)});
  req.headers.set('idempotency-key',randomUUID());const response=await handleAccess(req,f.identity);assert.equal(response.status,201,JSON.stringify(await response.clone().json()));};
 // Fixture business clocks stand still: move past each new version's wall-clock effective time.
 const settle=async()=>{const clock=await readFixtureClock('test',f.namespace),[wall]=await f.identity.sql`select clock_timestamp() now`;
  await advanceFixtureClock('test',f.namespace,Math.max(1,Math.ceil((new Date(wall.now).getTime()-Date.parse(clock.now))/1000)+5),clock.version);};
 const original=(await read()).current?.values??{cod_fee_bps:0,manual_bank_accounts:[]};
 await write({cod_fee_bps:0,manual_bank_accounts:[],...values},'SYNTHETIC S92 payment terms');
 // A failure after the write must not leave the shared policy changed.
 try{await settle();}catch(error){await write(original,'SYNTHETIC S92 restore previous payment terms');throw error;}
 return {set:async(more:Record<string,unknown>)=>{await write({cod_fee_bps:0,manual_bank_accounts:[],...more},'SYNTHETIC S92 payment terms change');await settle();},restore:()=>write(original,'SYNTHETIC S92 restore previous payment terms')};
}
