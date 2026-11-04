import assert from 'node:assert/strict';
import test from 'node:test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {handleCheckout} from '../../src/modules/checkout/routes.ts';

// GET /api/v1/destinations, 2026-11-05 modes: `q`+`group=district` lists kecamatan (at most 20), `district=<area id>`
// lists that kecamatan's kelurahan; both use the lookup rate-limit buckets, `q` alone keeps the search buckets.
const origin='http://127.0.0.1:3099';
const get=(identity:ReturnType<typeof createLocalAuth>,query:string)=>handleCheckout(new Request(`${origin}/api/v1/destinations?${query}`,{headers:{origin}}),identity);

test('destination lookup modes validate their parameters, cap their results and use their own rate-limit buckets',async()=>{
 const identity=createLocalAuth('test');
 try{
  for(const query of ['district=test-malang&q=contoh','district=test-malang&group=district','q=contoh&group=kota','district=BAD%20ID','district=','q=contoh&group=district&limit=21','group=district','q=contoh&group=district&group=district']){
   const response=await get(identity,query);assert.equal(response.status,400,query);await response.body?.cancel();
  }
  const keys=['rl:destination-lookup:ip:127.0.0.1','rl:destinations:ip:127.0.0.1'];
  await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(keys)}`;
  const districts=await get(identity,'q=kec%20contoh&group=district&limit=20');assert.equal(districts.status,200);
  const body=await districts.json() as {items:{id:string;district:string;postal_codes:string[];areas:number}[];source:string};
  assert.ok(body.items.length>0&&body.items.length<=20);assert.ok(body.items.every(d=>d.postal_codes.length>0&&d.areas>=1));
  const [lookup]=await identity.sql<{count:number}[]>`select count from app.auth_rate_limit where key=${keys[0]}`;assert.ok(lookup,'kecamatan type-ahead spends the lookup bucket');
  const areas=await get(identity,`district=${body.items[0].id}`);assert.equal(areas.status,200);
  const listed=(await areas.json() as {items:{id:string;district:string}[]}).items;assert.ok(listed.length>=1&&listed.every(a=>a.district===body.items[0].district),'only that kecamatan');
  const unknown=await get(identity,'district=unknown-area');assert.deepEqual((await unknown.json()).items,[]);
  const search=await get(identity,'q=contoh');assert.equal(search.status,200);await search.body?.cancel();
  const [scan]=await identity.sql<{count:number}[]>`select count from app.auth_rate_limit where key=${keys[1]}`;assert.ok(scan,'kelurahan search keeps the search bucket');
 }finally{await identity.sql.end();}
});
