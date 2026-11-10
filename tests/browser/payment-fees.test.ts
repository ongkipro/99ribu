import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import test from 'node:test';
import {type Browser,chromium,expect,type Page} from '@playwright/test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {releaseReservation} from '../../src/modules/inventory/reservations.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {CommerceClient} from '../integration/checkout-fixture.ts';
import {RENDERS} from '../render-root.ts';

// DEC-029 / S172 on the built web at 127.0.0.1:3099 (local profile, provider mode off): the owner's fee-bearer switches
// in Pengaturan → Pembayaran, and the buyer's order page when the buyer bears the VA/QRIS admin fee. The buyer part
// writes a real payment-policy version through the owner + reauthentication flow and restores the previous one.
const origin='http://127.0.0.1:3099',namespace=`s172-${randomUUID().slice(0,8)}`;
const output=`${RENDERS}/s172/${readFileSync('.next/BUILD_ID','utf8').trim()}`;
const identity=createLocalAuth('local');
const TABLE={VABNI:{kind:'fixed',amount:3000},VAPERMATA:{kind:'fixed',amount:3000},VABCA:{kind:'fixed',amount:6500},VAMANDIRI:{kind:'fixed',amount:3000},VABRI:{kind:'fixed',amount:3000},QRIS:{kind:'bps',bps:70}};
let browser:Browser,owner:Awaited<ReturnType<typeof actor>>,seeded:Awaited<ReturnType<typeof seedCommerce>>,curated:Awaited<ReturnType<typeof prepareStorefront>>;

test.before(async()=>{
 browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
 const request=()=>owner.browser.request('/api/v1/admin/products');
 seeded=await seedCommerce(request(),identity,'local',namespace);curated=await prepareStorefront(request(),identity,'local',namespace,seeded);
 const clock=await readFixtureClock('local',namespace),seconds=Math.ceil((Date.now()-Date.parse(clock.now))/1000);if(seconds>0)await advanceFixtureClock('local',namespace,seconds,clock.version);
});
test.after(async()=>{
 const failures:unknown[]=[];
 try{await browser?.close();}catch(error){failures.push(error);}
 try{for(const reservation of Object.values(seeded?.reservations??{})){await identity.sql.begin(tx=>releaseReservation(tx,reservation,'Owned S172 browser fixture finished'));await identity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${reservation}`;}}catch(error){failures.push(error);}
 try{if(owner){await identity.sql`delete from app.auth_rate_limit where key=${`access-proof:${owner.id}`}`;await cleanup(identity,[owner]);}}catch(error){failures.push(error);}
 await identity.sql.end();if(failures.length)throw new AggregateError(failures,'Owned S172 browser cleanup failed');
});

async function staffPage(width:number){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
 await context.addCookies([...owner.browser.cookies].map(([name,value])=>({name,value,domain:'127.0.0.1',path:'/'})));
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 page.on('request',r=>assert.equal(new URL(r.url()).origin,origin,'No external browser request'));
 return {page,errors,close:()=>context.close()};
}
async function capture(page:Page,name:string){
 await mkdir(output,{recursive:true});await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,`${name}: no horizontal overflow`);
 await writeFile(`${output}/${name}.png`,await page.screenshot({fullPage:true}));
}

test('S172 owner switches who bears the VA/QRIS and COD fees; the new version carries both bearers and the full fee table',async()=>{
 for(const width of [390,1440]){
  const view=await staffPage(width);const posted:Record<string,unknown>[]=[];
  try{
   // The write is intercepted (no real version in this half); reads stay real.
   await view.page.route(url=>url.origin===origin&&(url.pathname==='/api/v1/me/reauthentication-proofs'||url.pathname==='/api/v1/admin/policy-versions'),async route=>{
    const req=route.request();
    if(new URL(req.url()).pathname==='/api/v1/me/reauthentication-proofs')return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({proof:'SYNTHETIC-PROOF-TOKEN',expires_at:new Date(Date.now()+300000).toISOString()})});
    if(req.method()==='POST'){const body=req.postDataJSON() as Record<string,unknown>;posted.push(body);
     return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:randomUUID(),kind:'payment',warehouse_id:null,version:Number(body.expected_version)+1,effective_at:new Date().toISOString(),values:body.values,actor_id:owner.id,reason:body.reason,created_at:new Date().toISOString()})});}
    return route.continue();
   });
   await view.page.goto(`${origin}/admin/pengaturan/pembayaran`);
   await expect(view.page.getByTestId('payment-fee-bearer')).toBeVisible();
   await view.page.getByTestId('payment-policy-new').click();
   const dialog=view.page.getByRole('dialog');
   await dialog.getByTestId('payment-fee-bearer-switch').getByLabel(/^Pembeli/).check();
   await expect(dialog.getByTestId('payment-fee-table')).toBeVisible();
   // The form starts with the owner's rates (QRIS 0,7%, VA BCA Rp6.500, other VA Rp3.000).
   await expect(dialog.getByLabel('VA BCA (Rp)')).toHaveValue('6500');await expect(dialog.getByLabel('VA BRI (Rp)')).toHaveValue('3000');await expect(dialog.getByLabel('QRIS (%)')).toHaveValue('0,7');
   await dialog.getByTestId('cod-fee-bearer-switch').getByLabel(/^Platform/).check();
   await capture(view.page,`settings-page-${width}`);
   await writeFile(`${output}/settings-dialog-${width}.png`,await dialog.screenshot());
   await dialog.getByTestId('payment-reason').fill('SYNTHETIC S172 fee bearer');await dialog.getByTestId('payment-password').fill(owner.password);
   await dialog.getByRole('button',{name:'Simpan ketentuan'}).click();
   await expect.poll(()=>posted.length).toBe(1);
   const values=posted[0].values as Record<string,unknown>;
   assert.equal(values.payment_fee_bearer,'buyer');assert.equal(values.cod_fee_bearer,'store');
   assert.deepEqual(Object.keys(values.autolaris_fees as object).sort(),['QRIS','VABCA','VABNI','VABRI','VAMANDIRI','VAPERMATA']);
   assert.deepEqual((values.autolaris_fees as Record<string,unknown>).QRIS,{kind:'bps',bps:70});
   // With the platform bearing the fee the table is still saved, so a later switch keeps the rates.
   await view.page.getByTestId('payment-policy-new').click();
   const again=view.page.getByRole('dialog');
   await again.getByTestId('payment-fee-bearer-switch').getByLabel(/^Platform/).check();
   await again.getByTestId('payment-reason').fill('SYNTHETIC S172 platform bears the fee');await again.getByTestId('payment-password').fill(owner.password);
   await again.getByRole('button',{name:'Simpan ketentuan'}).click();
   await expect.poll(()=>posted.length).toBe(2);
   const platform=posted[1].values as Record<string,unknown>;
   assert.equal(platform.payment_fee_bearer,'store');assert.deepEqual((platform.autolaris_fees as Record<string,unknown>).VABCA,{kind:'fixed',amount:6500});
   assert.deepEqual(view.errors,[]);
  }finally{await view.close();}
 }
});

test('S172 the buyer sees the admin fee per bank before choosing, and the instruction bills the order plus that fee',async()=>{
 const read=async()=>(await (await owner.browser.access('/admin/policy-versions?kind=payment')).json()) as {latest_version:number;current:{values:Record<string,unknown>}|null};
 const write=async(values:Record<string,unknown>)=>{
  const proofReq=owner.browser.request('/api/v1/me/reauthentication-proofs',{password:owner.password,action:'payment_policy.version',subject_id:'company-payment'});proofReq.headers.set('idempotency-key',randomUUID());
  const proof=(await (await handleAccess(proofReq,identity)).json()).proof as string;
  const req=owner.browser.request('/api/v1/admin/policy-versions',{kind:'payment',warehouse_id:null,expected_version:(await read()).latest_version,effective_at:null,values,reason:'SYNTHETIC S172 browser fee bearer',reauthentication_proof:proof});
  req.headers.set('idempotency-key',randomUUID());const response=await handleAccess(req,identity);assert.equal(response.status,201,JSON.stringify(await response.clone().json()));
  const clock=await readFixtureClock('local',namespace),[wall]=await identity.sql`select clock_timestamp() now`;
  await advanceFixtureClock('local',namespace,Math.max(1,Math.ceil((new Date(wall.now).getTime()-Date.parse(clock.now))/1000)+5),clock.version);
 };
 const original=(await read()).current?.values;assert.ok(original,'local payment terms must exist (npm run fixture -- payment-terms local <ns>)');
 // Place an AutoLaris order as a guest through the real cart, quote and order handlers.
 const product=curated.products['shirt-cream'];assert.ok(product.publication_id);
 const client=new CommerceClient(identity),lines={lines:[{variant_id:product.offer_id,quantity:1,expected_publication_id:product.publication_id}]},key=randomUUID();
 assert.equal((await client.call('/api/v1/carts',lines,{key})).response.status,401);
 const cartReq=client.request('/api/v1/carts',lines,{key}),principal=await commerceActor(cartReq,identity);assert.ok(principal?.kind==='guest');
 const cart=await identity.sql.begin(tx=>createCart(tx,cartReq,identity,principal,lines,{clock_namespace:namespace}));
 assert.equal((await client.call('/api/v1/carts',lines,{key})).response.status,201);
 const address={recipient_name:'Penerima Contoh',phone:'+6281200000000',address_line:'Jalan Contoh 12',destination_id:'test-malang',postal_code:'00001'};
 const quote=await client.call('/api/v1/checkout/quotes',{cart_id:cart.cart.id,address,contact:{phone:'+6281200000000'},payment_method:'prepaid',payment_channel:'autolaris'},{version:1});assert.equal(quote.response.status,201,JSON.stringify(quote.payload));
 const placed=await client.call('/api/v1/orders',{quote_id:quote.payload.id},{version:1});assert.equal(placed.response.status,201,JSON.stringify(placed.payload));
 const order=placed.payload.order as {id:string;amount_due:number};
 try{
  await write({...original,payment_fee_bearer:'buyer',autolaris_fees:TABLE});
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   // The guest order capability is a __Host- cookie: Secure, path /, no domain (127.0.0.1 is a secure context for Chromium).
   await context.addCookies([...client.cookies.values()].map(c=>c.name.startsWith('__Host-')?{name:c.name,value:c.value,url:origin,path:'/',httpOnly:true,sameSite:'Lax' as const,secure:true}:{name:c.name,value:c.value,domain:'127.0.0.1',path:c.path,httpOnly:true,sameSite:'Lax' as const,secure:false}));
   // The order page reads the checkout alias of the guest order capability, which the browser checkout's server action
   // would have set beside the native API cookie (checkoutIssuedCookies).
   const grant=[...client.cookies.values()].find(c=>c.name.endsWith('.order_access'));assert.ok(grant,'guest order capability issued');
   await context.addCookies([{name:grant.name.replace(/\.order_access$/,'.checkout_access'),value:grant.value,domain:'127.0.0.1',path:`/checkout/order/${order.id}`,httpOnly:true,sameSite:'Lax',secure:false},
    // and the receipt alias the same server action sets for /pesanan/<id> (allOrderIssuedCookies).
    {name:grant.name.replace(/\.order_access$/,'.receipt_access'),value:grant.value,domain:'127.0.0.1',path:`/pesanan/${order.id}`,httpOnly:true,sameSite:'Lax',secure:false}]);
   const page=await context.newPage();page.setDefaultTimeout(15000);const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
   try{
    await page.goto(`${origin}/checkout/order/${order.id}`);
    const methods=page.getByRole('group',{name:'Bank Virtual Account atau QRIS'});
    await expect(methods).toBeVisible();
    await expect(methods.getByText('Biaya admin Rp6.500')).toBeVisible();
    await expect(methods.getByText('Biaya admin bank atau QRIS dibayar pembeli dan ditambahkan ke tagihan.',{exact:false})).toBeVisible();
    await capture(page,`order-channels-${width}`);
    if(width===1440){
     await methods.getByLabel(/BCA/).check();await page.getByRole('button',{name:'Siapkan instruksi pembayaran'}).click();
     await expect(page.getByTestId('autolaris-instructions')).toContainText('Instruksi pembayaran sedang dibuat.');
     const [attempt]=await identity.sql`select id,creation_job_id,expected_amount,payment_fee_amount from app.payment_attempt where order_id=${order.id} order by created_at desc limit 1`;
     assert.deepEqual([Number(attempt.expected_amount),Number(attempt.payment_fee_amount)],[order.amount_due,6500]);
     await identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${attempt.creation_job_id}`;
     assert.equal(await runOneJob(identity.sql,{'payment.create':paymentAdapter(identity.sql,'local')},String(attempt.creation_job_id)),true);
     await page.reload();
     const instruction=page.getByTestId('autolaris-instructions');
     await expect(instruction).toContainText(`Rp${(order.amount_due+6500).toLocaleString('id-ID')}`);
     await expect(instruction).toContainText('termasuk biaya admin Rp6.500');
     await expect(instruction.getByRole('heading',{level:2})).toHaveText('Virtual Account BCA');
     await capture(page,`order-instruction-${width}`);
     // The order receipt shows the same bill, bank and Virtual Account number for a buyer who comes back later.
     const [va]=await identity.sql`select l.instruction_value from app.autolaris_payment l join app.payment_attempt a on a.id=l.attempt_id where a.order_id=${order.id} order by a.created_at desc limit 1`;
     await page.goto(`${origin}/pesanan/${order.id}`);
     const receipt=page.getByTestId('autolaris-receipt-instructions');
     await expect(receipt.getByRole('heading',{level:2})).toHaveText('Virtual Account BCA');
     await expect(receipt).toContainText(String(va.instruction_value));
     await expect(receipt).toContainText('Rp6.500, sudah termasuk dalam nominal');
     await expect(receipt).toContainText('Batas pembayaran');
     await capture(page,`receipt-instruction-${width}`);
    }
    assert.deepEqual(errors,[]);
   }finally{await context.close();}
  }
 }finally{await write(original);}
});
