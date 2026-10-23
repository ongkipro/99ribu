import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {siteConfig} from '../../src/config/site.ts';
import {patchProduct} from '../../src/modules/catalog/catalog.ts';
import {publishProduct,readPublicationState,withdrawPublication} from '../../src/modules/catalog/publication.ts';
import {publicProduct} from '../../src/modules/storefront/catalog.ts';
import {publicMetadata} from '../../src/modules/storefront/seo.ts';
import {catalogMediaFileName,serveCatalogMedia} from '../../src/storage/catalog-media.ts';
import {shippingFixture} from './shipping-fixture.ts';

const config=siteConfig(process.env);

test('catalog photos: canonical SEO name served, stale/legacy names 308 to it, ambiguous or malformed names 404',async()=>{
 const f=await shippingFixture();const directory=await mkdtemp(join(tmpdir(),'99ribu-catalog-media-'));
 try{
  // Fresh synthetic bytes per run, so earlier runs' publications never embed this hash.
  const store=async()=>{const bytes=new TextEncoder().encode(`synthetic catalog photo ${randomUUID()}`);const sha=createHash('sha256').update(bytes).digest('hex');await writeFile(join(directory,`${sha}.webp`),bytes,{mode:0o600});return {bytes,sha};};
  const photo=await store(),unpublished=await store();
  const serve=(name:string)=>serveCatalogMedia(name,{sql:f.identity.sql,directory});
  const published=Object.entries(f.seeded.publications).filter(([,p])=>p.id).map(([key])=>f.seeded.products[key]);assert.ok(published.length>=2);
  const embed=async(product:string,name:string)=>{
   const state=await readPublicationState(f.identity,f.principal,product);
   const patch=f.request();patch.headers.set('idempotency-key',randomUUID());
   await patchProduct(patch,f.identity,f.principal,product,{expected_version:state.draft_version,reason:'Synthetic SEO photo name',name,
    images:[{url:`${config.origin}/media/catalog/${catalogMediaFileName(name,photo.sha)}`,alt:name,width:800,height:800}]});
   const publish=f.request();publish.headers.set('idempotency-key',randomUUID());
   await publishProduct(publish,f.identity,f.principal,product,{expected_version:state.draft_version+1,expected_publication_version:state.latest_version,reason:'Synthetic SEO photo publication'});
  };
  const zeta=`Zeta synthetic photo ${f.namespace}`,alpha=`Alpha synthetic photo ${f.namespace}`;
  await embed(published[0],zeta);await embed(published[1],alpha);

  // Storefront consumers read the stored per-photo alt (product card and PDP gallery render image.alt; OG copies it).
  const product=await f.identity.sql.begin((tx)=>publicProduct(tx,published[1]));assert.ok(product);
  assert.equal(product.images[0].alt,alpha,'product photo alt is the product title');
  for(const offer of product.variants) if(!offer.image?.url.includes('/fixtures/')) assert.equal(offer.image?.alt,alpha,'an offer without its own photo shows the product photo and its alt');
  const og=(publicMetadata(config,{path:'/produk/x',title:'T',description:'D',image:product.images[0]}).openGraph as {images:{alt:string}[]}).images;
  assert.equal(og[0].alt,alpha);

  // Two current products embed the hash: the lexicographically smallest file name is canonical.
  const canonical=catalogMediaFileName(alpha,photo.sha),other=catalogMediaFileName(zeta,photo.sha);
  assert.ok(canonical<other);
  const ok=await serve(canonical);
  assert.equal(ok.status,200);assert.deepEqual(Buffer.from(await ok.arrayBuffer()),Buffer.from(photo.bytes));
  assert.deepEqual(['content-type','cache-control','x-content-type-options','content-security-policy','content-disposition'].map(h=>ok.headers.get(h)),
   ['image/webp','public, max-age=31536000, immutable','nosniff',"default-src 'none'; sandbox",'inline']);
  for(const stale of [other,`judul-lama-${photo.sha.slice(0,12)}.webp`,`${photo.sha.slice(0,12)}.webp`,`${photo.sha}.webp`]){
   const moved=await serve(stale);
   assert.equal(moved.status,308,stale);assert.equal(moved.headers.get('location'),`/media/catalog/${canonical}`,stale);
   assert.equal(moved.headers.get('cache-control'),'no-store','a redirect is never cached immutably');
  }

  // A withdrawn publication no longer names the photo; the remaining current product does.
  const head=await readPublicationState(f.identity,f.principal,published[1]);assert.ok(head.current);
  const withdraw=f.request();withdraw.headers.set('idempotency-key',randomUUID());
  await withdrawPublication(withdraw,f.identity,f.principal,published[1],{expected_publication_version:head.latest_version,reason:'Synthetic photo-name withdrawal'});
  assert.equal((await serve(other)).status,200);
  const back=await serve(canonical);assert.equal(back.status,308);assert.equal(back.headers.get('location'),`/media/catalog/${other}`);

  // A stored photo no current publication embeds is still served under any well-formed name, legacy included.
  for(const name of [catalogMediaFileName('Foto lepas',unpublished.sha),`${unpublished.sha.slice(0,12)}.webp`,`${unpublished.sha}.webp`]) assert.equal((await serve(name)).status,200,name);

  // Two stored names sharing one 12-hex prefix: neither public name resolves.
  const shared=photo.sha.slice(0,12);await writeFile(join(directory,`${shared}${'0'.repeat(52)}.webp`),'x',{mode:0o600});
  for(const name of [other,canonical,`${shared}.webp`]){const response=await serve(name);assert.equal(response.status,404,name);assert.equal(response.headers.get('cache-control'),'no-store');}
  assert.equal((await serve(`${photo.sha}.webp`)).status,308,'the exact legacy name still resolves to its own file');

  for(const name of [`foto-${unpublished.sha.slice(0,11)}.webp`,`foto-${unpublished.sha.slice(0,13)}.webp`,`foto-${unpublished.sha.slice(0,12).toUpperCase()}.webp`,
   `${unpublished.sha.slice(0,63)}.webp`,`../${unpublished.sha}.webp`,`foto-${unpublished.sha.slice(0,12)}.png`,'../../artifacts/x.webp']) assert.equal((await serve(name)).status,404,name);
 }finally{await rm(directory,{recursive:true,force:true});await f.close();}
});
