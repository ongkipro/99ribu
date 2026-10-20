import type {LocalAuth} from '../access/auth.ts';
import {assertOrigin,privateJson,problem} from '../access/http.ts';
import {AccessError} from '../access/policy.ts';
import {catalogQuery,listCategories,listProducts,publicProduct} from './catalog.ts';

export async function handleStorefront(request:Request,identity:LocalAuth){
 try{
  assertOrigin(request);const url=new URL(request.url);if(request.method!=='GET') throw new AccessError(404,'NOT_FOUND');
  if(url.pathname==='/api/v1/categories') return privateJson(await listCategories(identity,url.searchParams));
  if(url.pathname==='/api/v1/products') return privateJson(await listProducts(identity,catalogQuery(url.searchParams)));
  const match=/^\/api\/v1\/products\/([^/]+)$/.exec(url.pathname);
  if(!match||url.search) throw new AccessError(400,'INVALID_INPUT');
  const product=await identity.sql.begin(tx=>publicProduct(tx,match[1]));if(!product) throw new AccessError(404,'NOT_FOUND');return privateJson(product);
 }catch(error){return problem(error);}
}
