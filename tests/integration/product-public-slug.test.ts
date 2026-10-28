import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {TransactionSql} from 'postgres';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {patchProduct} from '../../src/modules/catalog/catalog.ts';
import {handleCatalog} from '../../src/modules/catalog/routes.ts';
import {connectDatabase} from '../../src/db/client.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';

// Migration 0040: app.product.public_slug (the clean /produk/<slug> segment), app.next_public_slug and the guards around it.
const rollback=new Error('ROLLBACK_PUBLIC_SLUG_PROBE');
const letters=()=>randomBytes(6).toString('hex').replace(/[0-9]/g,c=>'ghijklmnop'[Number(c)]);
const migration=readFileSync(new URL('../../migrations/0040_product_public_slug.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
type Tx=TransactionSql;
const insertProduct=(tx:Tx,name:string)=>tx`insert into app.product (id,catalog_id,slug,public_slug) values (${randomUUID()},${`p_${randomUUID()}`},${`sql-${randomUUID()}`},app.next_public_slug(${name})) returning public_slug`;
async function probe(body:(tx:Tx)=>Promise<void>){
 const {sql}=connectDatabase('test','owner');
 try{await assert.rejects(sql.begin(async tx=>{await body(tx);throw rollback;}),error=>error===rollback);}finally{await sql.end();}
}
const failsWith=async(tx:Tx,code:string,write:()=>PromiseLike<unknown>)=>{
 await tx.unsafe('SAVEPOINT expected_failure');
 try{await write();assert.fail(`expected ${code}`);}catch(error){assert.equal((error as {code?:string}).code,code,(error as Error).message);}
 finally{await tx.unsafe('ROLLBACK TO SAVEPOINT expected_failure');await tx.unsafe('RELEASE SAVEPOINT expected_failure');}
};

test('slug base: lower case, transliterated accents, single hyphens, 60 characters cut at a word, produk when empty',async()=>probe(async tx=>{
 const base=async(name:string|null)=>(await tx`select app.public_slug_base(${name}) as s`)[0].s as string;
 assert.equal(await base('Paket Barber & Grooming Pria'),'paket-barber-grooming-pria');
 assert.equal(await base('  --Kaos  Polo__Pria!!  '),'kaos-polo-pria');
 assert.equal(await base('Café Crème Brûlée Ñandú Straße'),'cafe-creme-brulee-nandu-strasse');
 assert.equal(await base('2 pcs Lem 20ml, Super Kuat'),'2-pcs-lem-20ml-super-kuat');
 for(const empty of ['','   ','!!!','---','日本語',null])assert.equal(await base(empty),'produk',JSON.stringify(empty));
 const words=Array.from({length:30},(_,i)=>`kata${i}`).join(' '),cut=await base(words);
 assert.ok(cut.length<=60&&words.replaceAll(' ','-').startsWith(`${cut}-`),`cut at a word boundary: ${cut}`);
 assert.equal(await base(`${'a'.repeat(30)} ${'b'.repeat(30)} ${'c'.repeat(5)}`),'a'.repeat(30),'a word that would pass 60 characters is dropped whole, never cut');
 assert.equal(await base(`${'a'.repeat(29)} ${'b'.repeat(30)} cc`),`${'a'.repeat(29)}-${'b'.repeat(30)}`,'a slug of exactly 60 characters keeps its last word when a hyphen follows');
 assert.equal(await base('x'.repeat(100)),'x'.repeat(60),'one very long word is cut hard');
 assert.equal((await base(`${'x'.repeat(60)} yyyy`)),'x'.repeat(60));
}));

test('next_public_slug: the first holder keeps the clean slug, then -2, -3; the counter never overflows 64 characters; direct inserts get produk-<sequence>',async()=>probe(async tx=>{
 const name=`Paket ${letters()} Grooming`,expected=name.toLowerCase().replaceAll(' ','-');
 assert.deepEqual([(await insertProduct(tx,name))[0].public_slug,(await insertProduct(tx,name))[0].public_slug,(await insertProduct(tx,`  ${name.toUpperCase()}! `))[0].public_slug],[expected,`${expected}-2`,`${expected}-3`]);
 // A name that already looks like a counter slug takes the next free value rather than a duplicate.
 assert.equal((await insertProduct(tx,`${name} 4`))[0].public_slug,`${expected}-4`);
 assert.equal((await insertProduct(tx,name))[0].public_slug,`${expected}-5`,'a free slot is never reused or duplicated');

// A base of exactly 60 characters, so counters of four digits must shorten it.
 const long=`${'a'.repeat(17)}${letters()} ${'b'.repeat(30)}`,longBase=(await tx`select app.public_slug_base(${long}) as s`)[0].s as string;
 await tx`insert into app.product (id,catalog_id,slug,public_slug) select gen_random_uuid(),'p_'||gen_random_uuid(),'sql-'||gen_random_uuid(),
  case when n=1 then ${longBase} else left(${longBase},64-length('-'||n))||'-'||n end from generate_series(1,1000) n`;
 const next=(await insertProduct(tx,long))[0].public_slug as string;
 assert.equal(longBase.length,60);
 assert.ok(next.length===64&&/-1001$/.test(next)&&/^[a-z0-9]+(-[a-z0-9]+)*$/.test(next),next);

 const [first,second]=await tx`insert into app.product (id,catalog_id,slug) values (${randomUUID()},${`p_${randomUUID()}`},${`sql-${randomUUID()}`}),(${randomUUID()},${`p_${randomUUID()}`},${`sql-${randomUUID()}`}) returning public_slug`;
 assert.match(first.public_slug,/^produk-[0-9]+$/);assert.match(second.public_slug,/^produk-[0-9]+$/);assert.notEqual(first.public_slug,second.public_slug);
}));

test('public_slug is unique, shaped and immutable',async()=>probe(async tx=>{
 const [{public_slug:slug}]=await insertProduct(tx,`Bentuk ${letters()}`);
 const [row]=await tx`select id from app.product where public_slug=${slug}`;
 await failsWith(tx,'23505',()=>tx`insert into app.product (id,catalog_id,slug,public_slug) values (${randomUUID()},${`p_${randomUUID()}`},${`sql-${randomUUID()}`},${slug})`);
 for(const bad of ['Has Space','UPPER','-lead','trail-','double--hyphen','',`${'a'.repeat(65)}`,'a/b','a_b'])
  await failsWith(tx,'23514',()=>tx`insert into app.product (id,catalog_id,slug,public_slug) values (${randomUUID()},${`p_${randomUUID()}`},${`sql-${randomUUID()}`},${bad})`);
 await failsWith(tx,'23514',()=>tx`update app.product set public_slug=${`baru-${letters()}`} where id=${row.id}`);
}));

test('migration backfill names every existing product from its latest revision, oldest first, without touching assigned slugs',async()=>probe(async tx=>{
 // Put the table back into its pre-0040 state for rows we insert: nullable column, no fill trigger.
// The revision guard is off while the fixtures are staged (it demands complete offers); the migration step switches it back on.
 await tx.unsafe('ALTER TABLE app.product DISABLE TRIGGER product_public_slug_fill');await tx.unsafe('ALTER TABLE app.product DISABLE TRIGGER product_revision_guard');await tx.unsafe('ALTER TABLE app.product ALTER COLUMN public_slug DROP NOT NULL');
 const [{id:actorId}]=await tx`insert into app.auth_user (id,name,email,email_verified) values (${randomUUID()},'Synthetic slug backfill',${`slug-${randomUUID()}@example.invalid`},true) returning id`;
 const [{id:category}]=await tx`insert into app.category (name,slug,depth,attribute_definitions) values ('Synthetic slug category',${`slug-${randomUUID()}`},1,'[]'::jsonb) returning id`;
 const tag=letters(),blank=randomUUID(),renamed=randomUUID();
 // Ids are chosen so that id order is the reverse of age order: only the first revision time may decide who keeps the clean slug.
 const ids=[randomUUID(),randomUUID()].sort(),[late,early]=[ids[0],ids[1]];
 const make=async(id:string,revisions:[string,string][])=>{
  await tx`insert into app.product (id,catalog_id,slug,public_slug) values (${id},${`p_${randomUUID()}`},${`sql-${randomUUID()}`},null)`;
  for(const [i,[name,at]] of revisions.entries()){
   await tx`insert into app.product_revision (product_id,revision,name,description,category_id,images,facts,actor_id,reason,created_at)
    values (${id},${i+1},${name},'Synthetic',${category},'[]'::jsonb,'[]'::jsonb,${actorId},'Synthetic backfill',${at}::timestamptz)`;
   await tx`update app.product set revision=${i+1} where id=${id}`;
  }
 };
 await make(late,[[`Mie ${tag} Lama`,'2026-01-02T00:00:00Z'],[`Mie ${tag} Spesial`,'2026-02-01T00:00:00Z']]);
 await make(early,[[`Mie ${tag} Spesial`,'2026-01-01T00:00:00Z']]);
 await make(blank,[['!!!','2026-03-01T00:00:00Z']]);
 await make(renamed,[[`Nama ${tag} Awal`,'2026-03-02T00:00:00Z'],[`Nama ${tag} Akhir`,'2026-03-03T00:00:00Z']]);
 const orphan=randomUUID();await tx`insert into app.product (id,catalog_id,slug,public_slug) values (${orphan},${`p_${randomUUID()}`},${`sql-${randomUUID()}`},null)`;
 const [{existing}]=await tx`select count(*)::int existing from app.product where public_slug is not null`;

 const start=migration.findIndex(s=>/^(--.*\n)*SET LOCAL statement_timeout/.test(s)),stop=migration.findIndex(s=>/^(--.*\n)*RESET statement_timeout/.test(s));
 assert.ok(start>=0&&stop>start&&migration.slice(start,stop).some(s=>/FOR p IN SELECT/.test(s)),'the migration carries its backfill step');
 await tx.unsafe('ALTER TABLE app.product ENABLE TRIGGER product_revision_guard');
 for(const statement of migration.slice(start,stop+1))await tx.unsafe(statement);

 const slugOf=async(id:string)=>(await tx`select public_slug from app.product where id=${id}`)[0].public_slug as string;
 assert.equal(await slugOf(early),`mie-${tag}-spesial`,'the product with the earliest first revision keeps the clean slug');
 assert.equal(await slugOf(late),`mie-${tag}-spesial-2`,'the latest revision name is used and the later holder gets -2');
 assert.equal(await slugOf(renamed),`nama-${tag}-akhir`);
 assert.match(await slugOf(blank),/^produk(-[0-9]+)?$/);assert.match(await slugOf(orphan),/^produk(-[0-9]+)?$/);
 const [{missing,total,distinct,assigned}]=await tx`select count(*) filter (where public_slug is null)::int missing,count(*)::int total,count(distinct public_slug)::int distinct,count(*) filter (where public_slug is not null)::int assigned from app.product`;
 assert.deepEqual([missing,distinct===total,assigned>=existing+5],[0,true,true],'every product has a distinct slug and none already assigned was changed');
 // The revision guard is back on: an update that does not append a revision is still rejected.
 await failsWith(tx,'23514',()=>tx`update app.product set revision=revision+5 where id=${early}`);
}));

test('concurrent creations of one name get distinct slugs through the real create path, and a later rename never moves the URL',{timeout:90000},async()=>{
 const identity=createLocalAuth('test'),owner=await actor(identity,'owner',[]);
 try{
  await enroll(owner.browser,owner.password);
  const catalog=async(path:string,body:Record<string,unknown>)=>{const request=owner.browser.request(`/api/v1/admin${path}`,body);request.headers.set('idempotency-key',randomUUID());const response=await handleCatalog(request,identity);assert.equal(response.status,201);return response.json();};
  const [warehouse]=await identity.sql`insert into app.warehouse (name,city) values ('Synthetic slug warehouse','Malang') returning id`;
  const stock=await catalog('/stock-items',{name:'Synthetic slug stock',sku:`SLUG-${randomUUID()}`.toUpperCase()});
  const category=await catalog('/categories',{name:'Synthetic slug category',slug:`synthetic-${randomUUID()}`,parent_id:null,attribute_definitions:[]});
  const name=`Paket ${letters()} Barber & Grooming Pria`,base=name.toLowerCase().replace(/ & /g,' ').replaceAll(' ','-');
  const create=()=>catalog('/products',{name,description:'Synthetic only',images:[],category_id:category.id,variants:[{sku:`SLUG-${randomUUID()}`.toUpperCase(),label:'Satuan',attributes:[],offer_kind:'unit',weight_grams:100,length_mm:100,width_mm:100,height_mm:100,
   default_warehouse_id:warehouse.id,contents:[{stock_item_id:stock.id,name:stock.name,quantity:1}]}]});
  const products:{id:string}[]=await Promise.all([create(),create(),create(),create()]);
  const slugs=(await identity.sql<{id:string;public_slug:string}[]>`select id,public_slug from app.product where id in ${identity.sql(products.map(p=>p.id))}`).map(r=>r.public_slug).sort();
  assert.deepEqual(slugs,[base,`${base}-2`,`${base}-3`,`${base}-4`],'four simultaneous creations of the same name never collide');
  // The internal slug stays p-<uuid>; the public one is a different column.
  const [first]=await identity.sql`select id,slug,public_slug from app.product where id=${products[0].id}`;assert.match(first.slug,/^p-[0-9a-f-]{36}$/);
  const request=owner.browser.request(`/api/v1/admin/products/${first.id}`);request.headers.set('idempotency-key',randomUUID());
  await patchProduct(request,identity,await getPrincipal(request,identity),first.id,{expected_version:1,reason:'Synthetic rename keeps the URL',name:`Nama sama sekali baru ${letters()}`});
  const [after]=await identity.sql`select public_slug from app.product where id=${first.id}`;assert.equal(after.public_slug,first.public_slug,'a rename never changes the slug');
  await identity.sql`update app.warehouse set active=false where id=${warehouse.id}`;
 }finally{await cleanup(identity,[owner]);await identity.sql.end();}
});
