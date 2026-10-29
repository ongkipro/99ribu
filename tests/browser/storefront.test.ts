import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {RENDERS} from '../render-root.ts';

const origin='http://127.0.0.1:3099';
test('public missing category, product and unmatched routes render recoverable404 HTML without JavaScript',async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{
  const context=await browser.newContext({viewport:{width:390,height:900},javaScriptEnabled:false,reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(10000);
  for(const path of ['/kategori/not-a-real-department','/produk/not-a-valid-product','/kategori?cursor=invalid','/not-a-real-storefront-route']){
   const direct=await fetch(origin+path,{redirect:'manual'});
   assert.equal(direct.status,path==='/not-a-real-storefront-route'?404:307);
   if(direct.status===307) assert.equal(new URL(direct.headers.get('location') as string,origin).pathname,'/404');
   // The HTML is what is under test; eager header photos wait on a cold image optimizer after a fresh build.
   assert.equal((await page.goto(origin+path,{waitUntil:'domcontentloaded'}))?.status(),404);
   await expect(page).toHaveURL(origin+(path==='/not-a-real-storefront-route'?path:'/404'));
   await expect(page.getByRole('heading',{name:'Halaman belum tersedia',exact:true})).toBeVisible();
   await expect(page.locator('.shopping-tabs [aria-current]')).toHaveCount(0);
   const help=page.locator('.store-footer').getByRole('link',{name:'Pengembalian',exact:true});
   await expect(help).toHaveAttribute('href','/bantuan#returns');
   if(path.startsWith('/kategori/')){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`${RENDERS}/s21/not-found-nojs-390.png`});}
   await help.click();await expect(page).toHaveURL(origin+'/bantuan#returns');
   await expect(page.getByRole('heading',{name:'Pengembalian',exact:true})).toBeVisible();
  }
 }finally{await browser.close();}
});
