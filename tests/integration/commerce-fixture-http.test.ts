import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from '@playwright/test';

test('the built localhost server renders each actual synthetic catalog SVG with explicit accessible fixture labeling',async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:800,height:800}});
  for(const name of ['shirt','bag','cream','mixed']){
   const response=await page.goto(`http://127.0.0.1:3099/fixtures/${name}.svg`);assert.equal(response?.status(),200);assert.match(response?.headers()['content-type']??'',/^image\/svg\+xml/);
   const image=page.locator('svg');assert.equal(await image.getAttribute('role'),'img');assert.match(await image.locator('title').textContent()??'',new RegExp(`Synthetic ${name} fixture`));
   assert.equal(await image.locator('text').textContent(),'SYNTHETIC FIXTURE');assert.deepEqual(await image.boundingBox(),{x:0,y:0,width:480,height:600});
  }
 }finally{await browser.close();}
});
