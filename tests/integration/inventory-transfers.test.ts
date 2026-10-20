import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { getPrincipal } from "../../src/modules/access/policy.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { handleInventory } from "../../src/modules/inventory/routes.ts";
import { createTransfer } from "../../src/modules/inventory/transfers.ts";
import { advanceFixtureClock, readFixtureClock, seedLocal } from "../../src/modules/local/fixtures.ts";
import { actor, BrowserSession, cleanup, enroll } from "../contract/access-fixture.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";
import { totp } from "./totp-fixture.ts";

type Actor=Awaited<ReturnType<typeof actor>>;
const root='/api/v1/admin/inventory';
function request(user:{browser:BrowserSession},path:string,body?:Record<string,unknown>,key:string=randomUUID()){
  const req=user.browser.request(root+path,body); req.headers.set('idempotency-key',key); return req;
}
async function setup(quantity=5,namespace:string|null=null){
  const identity=createLocalAuth('test'); const users:Actor[]=[]; let warehouses:string[];
  if(namespace){
    warehouses=Object.values((await seedLocal('test',namespace)).warehouses);
    let clock=await readFixtureClock('test',namespace);
    while(Date.parse(clock.now)<Date.now()) clock=await advanceFixtureClock('test',namespace,Math.min(31622400,Math.ceil((Date.now()-Date.parse(clock.now))/1000)),clock.version);
  } else warehouses=(await identity.sql`insert into app.warehouse (name,city) values ('Synthetic Transfer Source','Malang'),('Synthetic Transfer Destination','Surabaya') returning id`).map((r)=>r.id);
  const [from,to]=warehouses; const owner=await actor(identity,'owner',[]); users.push(owner); await enroll(owner.browser,owner.password);
  const req=owner.browser.request('/api/v1/admin/stock-items',{sku:`T-${randomUUID()}`.toUpperCase(),name:'Synthetic transfer component'}); req.headers.set('idempotency-key',randomUUID());
  const response=await handleCatalog(req,identity); assert.equal(response.status,201); const stock=await response.json();
  const call=async(user:Actor,path:string,body?:Record<string,unknown>,expected=201,key?:string)=>{
    const response=await handleInventory(request(user,path,body,key),identity); const payload=await response.json(); assert.equal(response.status,expected,JSON.stringify(payload)); return payload;
  };
  const position=await call(owner,'/positions',{warehouse_id:from,stock_item_id:stock.id,lot_id:null});
  if(quantity) await call(owner,'/movements',{warehouse_id:from,stock_item_id:stock.id,kind:'receive',quantity,expected_version:0,reason:'Synthetic transfer supply'});
  const transferBody=(quantity:number)=>({from_warehouse_id:from,to_warehouse_id:to,stock_item_id:stock.id,quantity,reason:'Synthetic warehouse transfer'});
  const close=async()=>{
    const pending=await identity.sql`select id,revision from app.warehouse_transfer where from_warehouse_id=${from} and status='requested'`;
    for(const row of pending) await call(owner,`/transfers/${row.id}/cancellations`,{expected_version:row.revision,reason:'Synthetic fixture completed'});
    await cleanup(identity,users); for(const wh of warehouses) await identity.sql`update app.warehouse set active=false where id=${wh}`; await identity.sql.end();
  };
  return {identity,users,owner,from,to,stock,position,call,transferBody,close};
}

test('six transfer HTTP operations preserve physical quantity, explicit lot receipts, zero exceptions and durable retry',async()=>{
  const f=await setup(); const samples:Exchange[]=[];
  async function observe(req:Request,expected:number,valid?:boolean){
    const body=req.body?await req.clone().text():undefined; const response=await handleInventory(req,f.identity); const payload=await response.json();
    assert.equal(response.status,expected,JSON.stringify(payload));
    samples.push({url:req.url,method:req.method,request_headers:Object.fromEntries([...req.headers].filter(([k])=>['content-type','idempotency-key'].includes(k))),
      request_body:body,body_bytes:body?Buffer.byteLength(body):undefined,request_valid:valid,status:response.status,headers:Object.fromEntries(response.headers),payload}); return payload;
  }
  try{
    const guest={browser:new BrowserSession(f.identity)}; const dummy=randomUUID();
    for(const path of ['/transfers',`/transfers/${dummy}`]) await observe(request(guest,path),401);
    for(const path of ['/transfers',...['dispatches','receipts','cancellations'].map((action)=>`/transfers/${dummy}/${action}`)]) await observe(request(guest,path,{}),401);
    await observe(request(f.owner,'/transfers',{...f.transferBody(1),to_warehouse_id:f.from}),400,true);
    for(const body of [{...f.transferBody(1),clock_namespace:'forged'},{...f.transferBody(1),quantity:0}]) await observe(request(f.owner,'/transfers',body),400,false);
    await observe(request(f.owner,'/transfers',{...f.transferBody(1),stock_item_id:randomUUID()}),404,true);
    const transfer=await observe(request(f.owner,'/transfers',f.transferBody(3)),201,true); assert.equal(transfer.status,'requested'); assert.equal(transfer.outstanding_quantity,0);
    const key=randomUUID(); const otherBody=f.transferBody(2); const other=await observe(request(f.owner,'/transfers',otherBody,key),201,true);
    assert.deepEqual(await observe(request(f.owner,'/transfers',otherBody,key),201,true),other);
    await observe(request(f.owner,'/transfers',{...otherBody,quantity:1},key),409,true);
    const cancelled=await observe(request(f.owner,`/transfers/${other.id}/cancellations`,{expected_version:1,reason:'Synthetic request cancellation'}),201,true); assert.equal(cancelled.status,'cancelled');
    const dispatch={expected_version:1,reason:'Synthetic physical dispatch'}; const dispatchKey=randomUUID();
    const sent=await observe(request(f.owner,`/transfers/${transfer.id}/dispatches`,dispatch,dispatchKey),201,true); assert.equal(sent.outstanding_quantity,3);
    await assert.rejects(f.identity.sql.begin(async(tx)=>{
      await tx`insert into app.transfer_receipt (transfer_id,revision,received_quantity,quarantined_quantity,actor_id,reason)
        values (${transfer.id},3,1,0,${f.owner.id},'Synthetic unapplied receipt must roll back')`;
    }),{code:'23514'});
    assert.deepEqual(await observe(request(f.owner,`/transfers/${transfer.id}/dispatches`,dispatch,dispatchKey),201,true),sent);
    await observe(request(f.owner,`/transfers/${transfer.id}/cancellations`,{expected_version:2,reason:'Cannot cancel transit'}),409,true);
    const zero=await observe(request(f.owner,`/transfers/${transfer.id}/receipts`,{expected_version:2,reason:'No goods arrived yet',allocations:[]}),201,true); assert.equal(zero.status,'exception'); assert.equal(zero.outstanding_quantity,3);
    const part={source_balance_id:transfer.allocations[0].source_balance_id,received_quantity:2,quarantined_quantity:1};
    const receipt={expected_version:3,reason:'Synthetic partial receipt with damage',allocations:[part]}; const receiptKey=randomUUID();
    const partial=await observe(request(f.owner,`/transfers/${transfer.id}/receipts`,receipt,receiptKey),201,true); assert.equal(partial.status,'exception'); assert.equal(partial.received_quantity,2); assert.equal(partial.quarantined_quantity,1); assert.equal(partial.outstanding_quantity,1);
    assert.deepEqual(await observe(request(f.owner,`/transfers/${transfer.id}/receipts`,receipt,receiptKey),201,true),partial);
    await observe(request(f.owner,`/transfers/${transfer.id}/receipts`,{...receipt,expected_version:4,allocations:[part]}),409,true);
    await observe(request(f.owner,`/transfers/${transfer.id}/receipts`,{expected_version:4,reason:'Synthetic invalid allocation',allocations:[{...part,source_balance_id:randomUUID()}]}),409,true);
    const complete=await observe(request(f.owner,`/transfers/${transfer.id}/receipts`,{expected_version:4,reason:'Synthetic remaining lot arrived',allocations:[{...part,received_quantity:1,quarantined_quantity:0}]}),201,true); assert.equal(complete.status,'received'); assert.equal(complete.outstanding_quantity,0);
    const detail=await observe(request(f.owner,`/transfers/${transfer.id}`),200,true); assert.deepEqual(detail,complete);
    const list=await observe(request(f.owner,`/transfers?warehouse_id=${f.to}&status=received&limit=1`),200,true); assert.equal(list.data[0].id,transfer.id);
    await observe(request(f.owner,'/transfers?limit=1&limit=2'),400,false);
    const [totals]=await f.identity.sql`select sum(on_hand)::int as on_hand,sum(reserved)::int as reserved,sum(quarantined)::int as quarantined from app.inventory_balance where stock_item_id=${f.stock.id}`;
    assert.deepEqual(totals,{on_hand:5,reserved:0,quarantined:1});
    const [count]=await f.identity.sql`select count(*)::int as n from app.transfer_receipt where transfer_id=${transfer.id}`; assert.equal(count.n,3);
    await assert.rejects(f.identity.sql`update app.transfer_receipt set received_quantity=999 where transfer_id=${transfer.id}`,{code:'23514'});
    validateExchanges(samples,'inventory-transfers');
  } finally {await f.close();}
});

test('transfer roles use both/source/destination scope and a revoked scope cannot recover an earlier result',async()=>{
  const f=await setup();
  try{
    const source=await actor(f.identity,'warehouse',[f.from]); f.users.push(source); await enroll(source.browser,source.password);
    const destination=await actor(f.identity,'warehouse',[f.to]); f.users.push(destination); await enroll(destination.browser,destination.password);
    const outsider=await actor(f.identity,'warehouse',[]); f.users.push(outsider); await enroll(outsider.browser,outsider.password);
    const staff=await actor(f.identity,'ecommerce_admin',[f.from]); f.users.push(staff); const factor=await enroll(staff.browser,staff.password);
    await f.call(source,'/transfers',f.transferBody(1),403); await f.call(staff,'/transfers',f.transferBody(1),404);
    const transfer=await f.call(f.owner,'/transfers',f.transferBody(2));
    for(const user of [source,destination]) assert.equal((await f.call(user,`/transfers/${transfer.id}`,undefined,200)).id,transfer.id);
    for(const user of [outsider]) for(const target of [transfer.id,randomUUID()]) await f.call(user,`/transfers/${target}`,undefined,404);
    const dispatch={expected_version:1,reason:'Synthetic source dispatch'};
    await f.call(destination,`/transfers/${transfer.id}/dispatches`,dispatch,404); await f.call(source,`/transfers/${transfer.id}/dispatches`,dispatch);
    const receipt={expected_version:2,reason:'Synthetic destination receipt',allocations:[{source_balance_id:transfer.allocations[0].source_balance_id,received_quantity:2,quarantined_quantity:0}]};
    await f.call(source,`/transfers/${transfer.id}/receipts`,receipt,404); await f.call(destination,`/transfers/${transfer.id}/receipts`,receipt);
    const created=await f.call(f.owner,'/transfers',f.transferBody(1)); const key=randomUUID(); const savedBody={expected_version:1,reason:'Synthetic recoverable cancellation'};
    await f.call(staff,`/transfers/${created.id}/cancellations`,savedBody,201,key);
    const proofReq=f.owner.browser.request('/api/v1/me/reauthentication-proofs',{password:f.owner.password,action:'staff_roles.replace',subject_id:staff.id}); proofReq.headers.set('idempotency-key',randomUUID());
    const issued=await handleAccess(proofReq,f.identity); assert.equal(issued.status,201);
    const grantReq=f.owner.browser.request('/api/v1/admin/role-grants',{user_id:staff.id,roles:['ecommerce_admin'],warehouse_ids:[f.to],permissions:[],expected_version:1,reason:'Synthetic scope revocation',reauthentication_proof:(await issued.json()).proof}); grantReq.headers.set('idempotency-key',randomUUID());
    assert.equal((await handleAccess(grantReq,f.identity)).status,201);
    assert.equal((await staff.browser.auth('/sign-in/email',{email:staff.email,password:staff.password})).status,200);
    assert.equal((await staff.browser.auth('/two-factor/verify-totp',{code:totp(factor.totpURI)})).status,200);
    await f.call(staff,`/transfers/${created.id}`,undefined,200);
    await f.call(staff,`/transfers/${created.id}/cancellations`,savedBody,404,key);
    const visible=await f.call(outsider,'/transfers',undefined,200); assert.equal(visible.data.length,0);
  } finally {await f.close();}
});

test('in-transit batch expiry is quarantined on receipt and competing receivers cannot credit the same lot twice',async()=>{
  const namespace=`it-${randomUUID().slice(0,8)}`; const f=await setup(0,namespace);
  try{
    const [dates]=await f.identity.sql`select (app.reservation_clock(${namespace}) at time zone timezone)::date::text as early,
      ((app.reservation_clock(${namespace}) at time zone timezone)::date+30)::text as late from app.warehouse where id=${f.from}`;
    const lots:{id:string}[]=[];
    for(const expiry of [dates.early,dates.late]){
      const lot=await f.call(f.owner,'/lots',{warehouse_id:f.from,stock_item_id:f.stock.id,code:`TRANSIT-${randomUUID()}`,expires_on:expiry,reason:'Synthetic transit batch'}); lots.push(lot);
      await f.call(f.owner,'/movements',{warehouse_id:f.from,stock_item_id:f.stock.id,lot_id:lot.id,kind:'receive',quantity:2,expected_version:0,reason:'Synthetic lot supply'});
    }
    const req=request(f.owner,'/transfers',f.transferBody(4)); const principal=await getPrincipal(req,f.identity);
    const transfer=await createTransfer(req,f.identity,principal,f.transferBody(4),namespace) as {id:string;allocations:{source_balance_id:string;lot_id:string}[]};
    await f.call(f.owner,`/transfers/${transfer.id}/dispatches`,{expected_version:1,reason:'Synthetic transit started'});
    const clock=await readFixtureClock('test',namespace); await advanceFixtureClock('test',namespace,172800,clock.version);
    const early=transfer.allocations.find((a)=>a.lot_id===lots[0].id); const late=transfer.allocations.find((a)=>a.lot_id===lots[1].id); assert.ok(early&&late);
    const partial=await f.call(f.owner,`/transfers/${transfer.id}/receipts`,{expected_version:2,reason:'Synthetic partly expired transit',allocations:[
      {source_balance_id:early.source_balance_id,received_quantity:2,quarantined_quantity:0},{source_balance_id:late.source_balance_id,received_quantity:1,quarantined_quantity:0}]});
    assert.equal(partial.received_quantity,3); assert.equal(partial.quarantined_quantity,2); assert.equal(partial.outstanding_quantity,1);
    const [expired]=await f.identity.sql`select on_hand,quarantined from app.inventory_balance where warehouse_id=${f.to} and lot_id=${lots[0].id}`; assert.deepEqual(expired,{on_hand:2,quarantined:2});
    const peer=await actor(f.identity,'warehouse',[f.to]); f.users.push(peer); await enroll(peer.browser,peer.password);
    let release=()=>{}; let ready=()=>{}; const held=new Promise<void>((r)=>{release=r;}); const locked=new Promise<void>((r)=>{ready=r;});
    const blocker=f.identity.sql.begin(async(tx)=>{await tx`select id from app.warehouse_transfer where id=${transfer.id} for update`;ready();await held;});
    let pending:Promise<Response[]>|undefined;
    try{
      await locked; const body={expected_version:3,reason:'Synthetic final batch contention',allocations:[{source_balance_id:late.source_balance_id,received_quantity:1,quarantined_quantity:0}]};
      pending=Promise.all([f.owner,peer].map((user)=>handleInventory(request(user,`/transfers/${transfer.id}/receipts`,body),f.identity)));
      let waiting=0;
      for(let i=0;i<100;i++){
        const [row]=await f.identity.sql`select count(*)::int as n from pg_stat_activity where datname='99ribu_test' and usename='99ribu_test_app' and wait_event_type='Lock' and query like '%select * from app.warehouse_transfer where id=%for update%'`;
        waiting=row.n;if(waiting===2) break;await setTimeout(20);
      }
      assert.equal(waiting,2);release();await blocker;assert.deepEqual((await pending).map((r)=>r.status).sort(),[201,409]);
    } finally {release();await Promise.allSettled([blocker,pending].filter((p)=>p!==undefined));}
    const final=await f.call(f.owner,`/transfers/${transfer.id}`,undefined,200); assert.equal(final.status,'received'); assert.equal(final.received_quantity,4); assert.equal(final.quarantined_quantity,2);
    const [total]=await f.identity.sql`select sum(on_hand)::int as n from app.inventory_balance where stock_item_id=${f.stock.id}`;assert.equal(total.n,4);
  } finally {await f.close();}
});
