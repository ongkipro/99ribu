import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';

// Storefront control audit (round 43): account actions hold one busy state and surface failures,
// footer and help anchors land on real content, and headings keep their visible names.
const origin='http://127.0.0.1:3099';

test('guest order recovery sends one request per submit and reports a lost connection',async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:390,height:900}});
  let calls=0,sent:unknown,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/v1/guest-order-access/challenges',async route=>{calls++;sent=route.request().postDataJSON();await held;await route.abort('internetdisconnected');});
  await page.goto(`${origin}/akun`);
  // The visible heading is the accessible name (no aria-label that hides it).
  await expect(page.getByRole('heading',{level:1,name:'Akun opsional',exact:true})).toBeVisible();
  await page.getByTestId('guest-recovery-order-id').fill(' 99-ab12cd34ef56gh78 ');
  await page.getByTestId('guest-recovery-contact').fill('+6281200000000');
  const submit=page.getByTestId('guest-recovery-request-button');
  await submit.click();await expect(submit).toBeDisabled();
  await submit.dispatchEvent('click');await page.locator('form:has([data-testid="guest-recovery-request-button"])').evaluate(form=>(form as HTMLFormElement).requestSubmit());
  release();
  await expect(page.getByTestId('account-status-banner')).toHaveText('Tidak bisa terhubung. Periksa koneksi lalu coba lagi.');
  await expect(submit).toBeEnabled();
  // S118: the printed number goes out as order_number (the server uppercases it).
  assert.deepEqual(sent,{order_number:'99-ab12cd34ef56gh78',contact:'+6281200000000'});
  assert.equal(calls,1,'A second submit while the first is pending sends nothing');
  assert.equal(page.url(),`${origin}/akun`,'The form never falls back to a native submit');
 }finally{await browser.close();}
});

test('footer privacy and the order help links land on real sections',async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(`${origin}/`);
  const privacy=page.getByRole('contentinfo').getByRole('link',{name:'Kebijakan privasi',exact:true});
  await expect(privacy).toHaveAttribute('href','/bantuan#privacy');await privacy.click();
  await expect(page).toHaveURL(`${origin}/bantuan#privacy`);await expect(page.getByRole('heading',{name:'Privasi data pesanan'})).toBeInViewport();
  // Order pages link to the help conversations (#percakapan) instead of an ignored ?orderId= parameter.
  await page.goto(`${origin}/bantuan#percakapan`);await expect(page.getByRole('region',{name:'Percakapan bantuan'})).toBeVisible();
 }finally{await browser.close();}
});
