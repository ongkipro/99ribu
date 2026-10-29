import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createLocalAuth,type LocalAuth} from '../../src/modules/access/auth.ts';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {handleCatalog} from '../../src/modules/catalog/routes.ts';
import {handleInventory} from '../../src/modules/inventory/routes.ts';
import {releaseReservation} from '../../src/modules/inventory/reservations.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {buildShippingPlans,type ShippingLine} from '../../src/modules/shipping/quotes.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
export const denied=(code:string)=>(error:unknown)=>error instanceof Error&&'code' in error&&error.code===code;
// Fixture warehouses are mapped per namespace and stay active unless a test deactivates them; left active they pile up
// in 99ribu_test and push other fixtures out of capped admin lists (warehouse-calendars hit the 500-row page).
export async function deactivateFixtureWarehouses(identity:LocalAuth,namespace:string){
 await identity.sql`update app.warehouse set active=false where active and id in (select warehouse_id from app.local_fixture_warehouse where namespace=${namespace})`;
}
export async function shippingFixture(){
 const identity=createLocalAuth('test');const owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);const namespace=`ship-${randomUUID().slice(0,10)}`;
 const request=()=>owner.browser.request('/api/v1/admin/products');const principal=await getPrincipal(request(),identity);
 const seeded=await seedCommerce(request(),identity,'test',namespace);
 const line=(offer:string,quantity=1):ShippingLine=>{const publication=seeded.publications[offer].id;if(!publication) throw new Error('Fixture offer requires guarded publication.');return {line_id:offer,product_id:seeded.products[offer],offer_id:seeded.offers[offer],publication_id:publication,quantity};};
 const plans=(lines:ShippingLine[],payment_method='prepaid',destination_id='test-malang')=>identity.sql.begin((tx)=>buildShippingPlans(tx,{lines,payment_method,destination_id},{clock_namespace:namespace}));
 const catalog=async(path:string,body:Record<string,unknown>)=>{const req=owner.browser.request(`/api/v1/admin${path}`,body);req.headers.set('idempotency-key',randomUUID());const response=await handleCatalog(req,identity);const result=await response.json();assert.equal(response.status,201,JSON.stringify(result));return result;};
 const move=async(positionKey:string,kind:string,quantity:number)=>{
  const [position]=await identity.sql`select warehouse_id,stock_item_id,revision from app.inventory_balance where id=${seeded.positions[positionKey]}`;
  const req=owner.browser.request('/api/v1/admin/inventory/movements',{warehouse_id:position.warehouse_id,stock_item_id:position.stock_item_id,kind,quantity,expected_version:position.revision,reason:'Synthetic shipping allocation supply'});req.headers.set('idempotency-key',randomUUID());assert.equal((await handleInventory(req,identity)).status,201);
 };
 const close=async()=>{for(const reservation of Object.values(seeded.reservations)){await identity.sql.begin((tx)=>releaseReservation(tx,reservation,'Synthetic shipping fixture finished'));await identity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${reservation}`;}await deactivateFixtureWarehouses(identity,namespace);await cleanup(identity,[owner]);await identity.sql.end();};
 return {identity,owner,namespace,principal,seeded,request,line,plans,catalog,move,close};
}
