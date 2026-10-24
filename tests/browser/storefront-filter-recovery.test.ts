import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test,{after,before} from 'node:test';
import {chromium,expect,type Page} from '@playwright/test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {createCategory,createProduct,readCatalogRevision} from '../../src/modules/catalog/catalog.ts';
import {publishProduct,readPublicationState} from '../../src/modules/catalog/publication.ts';
import {appendCostVersion} from '../../src/modules/finance/costs.ts';
import {releaseReservation} from '../../src/modules/inventory/reservations.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {catalogQuery,listProducts} from '../../src/modules/storefront/catalog.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {RENDERS} from '../render-root.ts';

const origin='http://127.0.0.1:3099',namespace='s21-filter-recovery',query='S21 filter recovery';
const identity=createLocalAuth('local');
let owner:Awaited<ReturnType<typeof actor>>|undefined,seeded:Awaited<ReturnType<typeof seedCommerce>>|undefined;
let sizeCategory:string,colorCategory:string,matchingProduct:string;
before(async()=>{
 owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
 const command=()=>{assert.ok(owner);const request=owner.browser.request('/api/v1/admin/products');request.headers.set('idempotency-key',randomUUID());return request;};
 const principal=await getPrincipal(command(),identity);seeded=await seedCommerce(command(),identity,'local',namespace);
 const base=await readCatalogRevision(identity.sql,seeded.products['fixture-offer-shirt']),offer=base.variants[0];
 const categories:Record<string,string>={};
 for(const [key,values] of [['size',['M','L']],['color',['Blue']]] as const){
  const slug=`${namespace}-${key}`,definitions=[{key,label:key,value_type:'enum',required:true,allowed_values:[...values]}];
  let [category]=await identity.sql`select id,attribute_definitions from app.category where slug=${slug}`;
  if(!category){const created=await createCategory(command(),identity,principal,{name:`Contoh ${key==='size'?'ukuran':'warna'}`,slug,parent_id:null,attribute_definitions:definitions});category={...created,attribute_definitions:definitions};}
  assert.deepEqual(category.attribute_definitions,definitions);categories[key]=category.id;
 }
 sizeCategory=categories.size;colorCategory=categories.color;
 // Fixed owned SKUs make RED/GREEN reruns non-destructive. The oldest M
 // publication follows five newer L candidates in the bounded newest scan.
 for(const [index,size] of ['M','L','L','L','L','L','Blue'].entries()){
  const key=size==='Blue'?'color':'size',categoryId=categories[key],sku=`S21_FILTER_RECOVERY_${index}`,name=`${query} ${size} ${index}`;
  const attributes=[{key,label:key,values:[size]}];let [stored]=await identity.sql`select id,product_id from app.offer where sku=${sku}`;
  if(!stored){const created=await createProduct(command(),identity,principal,{name,description:'Synthetic localhost filter recovery fixture.',category_id:categoryId,images:base.images,variants:[{
   sku,label:size,attributes,offer_kind:'unit',weight_grams:offer.weight_grams,length_mm:offer.length_mm,width_mm:offer.width_mm,height_mm:offer.height_mm,default_warehouse_id:offer.default_warehouse_id,contents:offer.contents}]});stored={id:created.variants[0].id,product_id:created.id};}
  const draft=await readCatalogRevision(identity.sql,stored.product_id);assert.equal(draft.version,1);assert.equal(draft.name,name);assert.equal(draft.category_id,categoryId);assert.deepEqual(draft.variants[0].attributes,attributes);
  if(!(await identity.sql`select id from app.offer_cost_assumption_version where offer_id=${stored.id} limit 1`).length)await appendCostVersion(command(),identity,principal,'assumption',stored.id,{expected_version:0,effective_from:null,packaging_idr:1000,provider_fee_idr:1000,subsidy_idr:5000,returns_reserve_idr:1000,source:'TEST-ONLY filter recovery assumptions',reason:'Initialize empty owned regression assumption'});
  let state=await readPublicationState(identity,principal,stored.product_id);
  if(!state.current){await publishProduct(command(),identity,principal,stored.product_id,{expected_version:1,expected_publication_version:state.latest_version,reason:'Guarded synthetic filter recovery publication'});state=await readPublicationState(identity,principal,stored.product_id);}
  assert.equal(state.current_review_state,'approved');if(size==='M')matchingProduct=stored.product_id;
 }
});
after(async()=>{
 try{if(seeded)for(const id of Object.values(seeded.reservations)){await identity.sql.begin(tx=>releaseReservation(tx,id,'Owned filter recovery fixture finished'));await identity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${id}`;}
  if(owner)await cleanup(identity,[owner]);
 }finally{await identity.sql.end();}
});
async function openFilters(page:Page){if(!await page.locator('.filters').evaluate(element=>(element as HTMLDetailsElement).open))await page.locator('.filters summary').click();}
async function checkReflow(page:Page){
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=1);
 const joined=await page.locator('.active-filters a>span').evaluateAll(spans=>spans.every(span=>{const text=span.querySelector('.filter-tail>span')?.firstChild;if(!text?.textContent)return false;const range=document.createRange();range.setStart(text,text.textContent.trimEnd().length-1);range.setEnd(text,text.textContent.trimEnd().length);const glyph=span.querySelector('svg')?.getBoundingClientRect(),letter=range.getBoundingClientRect();return glyph!==undefined&&glyph.top>=letter.top-1&&glyph.bottom<=letter.bottom+1;}));
 assert.equal(joined,true,'Each filter close glyph stays on the last label line');
}
test('an actual empty bounded scan continues with the same filters instead of declaring no matches',async()=>{
 const params=new URLSearchParams({q:query,category_id:sizeCategory,attributes:JSON.stringify({size:['M']}),sort:'newest',limit:'1'});
 const result=await listProducts(identity,catalogQuery(params));assert.equal(result.data.length,0);assert.ok(result.pagination.next_cursor);
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900},javaScriptEnabled:false});page.setDefaultTimeout(10000);
  assert.equal((await page.goto(`${origin}/cari?${params}`))?.status(),200);
  await expect(page.getByRole('heading',{name:'Belum ada kecocokan di halaman ini',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Belum ada produk yang sesuai',exact:true})).toHaveCount(0);
  const next=page.getByRole('link',{name:'Halaman berikutnya',exact:true});await expect(next).toHaveCount(1);
  const href=new URL(await next.getAttribute('href') as string,origin);assert.equal(href.searchParams.get('attributes'),params.get('attributes'));assert.equal(href.searchParams.get('category_id'),sizeCategory);assert.ok(href.searchParams.get('cursor'));
  await page.evaluate(()=>document.fonts.ready);await checkReflow(page);await page.screenshot({path:`${RENDERS}/s21/continuation-${width}.png`,fullPage:true});
  if(width===390){await page.setViewportSize({width:320,height:900});await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});await checkReflow(page);await page.screenshot({path:`${RENDERS}/s21/continuation-text-200-320.png`,fullPage:true});}
  await next.click();const matchingCard=page.locator(`.product-link[href^="/produk/"][href*="${matchingProduct}?offer="]`);await expect(matchingCard).toBeVisible();assert.ok(new URL(await matchingCard.getAttribute('href') as string,origin).searchParams.get('offer'));await page.close();
 }}finally{await browser.close();}
});
test('native category switching drops stale facets and repeated checkbox values remain valid',async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900},javaScriptEnabled:false});page.setDefaultTimeout(10000);
  const initial=new URLSearchParams({q:query,category_id:sizeCategory,attributes:JSON.stringify({size:['M']})});
  await page.goto(`${origin}/cari?${initial}`);await openFilters(page);await page.getByRole('form',{name:'Ganti kategori'}).getByLabel('Kategori',{exact:true}).selectOption(colorCategory);
  await page.getByRole('button',{name:'Lihat kategori',exact:true}).click();
  let url=new URL(page.url());assert.equal(url.searchParams.get('category_id'),colorCategory);assert.equal(url.searchParams.get('q'),query);assert.equal(url.searchParams.has('attributes'),false);assert.equal([...url.searchParams.keys()].some(k=>k.startsWith('filter.')),false);
  await expect(page.locator('.product')).toHaveCount(1);await expect(page.getByRole('heading',{name:'Filter belum bisa digunakan'})).toHaveCount(0);
  await page.goto(`${origin}/cari?${initial}`);await openFilters(page);await page.getByRole('form',{name:'Ganti kategori'}).getByLabel('Kategori',{exact:true}).selectOption('');await page.getByRole('button',{name:'Lihat kategori',exact:true}).click();
  url=new URL(page.url());assert.equal(url.searchParams.get('category_id'),'');assert.equal(url.searchParams.has('attributes'),false);await expect(page.locator('.product')).toHaveCount(7);
  await page.goto(`${origin}/cari?${new URLSearchParams({q:query,category_id:sizeCategory})}`);await openFilters(page);
  await page.locator('input[name="filter.size"][value="M"]').check();await page.locator('input[name="filter.size"][value="L"]').check();
  await page.getByRole('button',{name:'Terapkan filter',exact:true}).click();await expect(page.locator('.product')).toHaveCount(6);await openFilters(page);
  await expect(page.locator('input[name="filter.size"]:checked')).toHaveCount(2);await expect(page.getByRole('heading',{name:'Filter belum bisa digunakan'})).toHaveCount(0);
  await page.evaluate(()=>document.fonts.ready);await checkReflow(page);await page.screenshot({path:`${RENDERS}/s21/attributed-filters-${width}.png`,fullPage:true});
  if(width===390){await page.setViewportSize({width:320,height:900});await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});await checkReflow(page);await page.locator('.facet').evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:`${RENDERS}/s21/attributed-filters-text-200-320.png`});}
  await page.close();
 }}finally{await browser.close();}
});
