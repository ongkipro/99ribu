import {runtimeTarget} from '../../config/runtime.ts';
import type {LocalAuth} from '../access/auth.ts';
import {type CatalogQuery,featuredDepartments,listProducts} from './catalog.ts';

// Public catalog reads are the same for every visitor, but the guarded public reader (catalog.ts publicProduct)
// runs several queries per product and offer, serially in one transaction: the production home took 5-8 s at the
// origin (measured 2026-10-30). Production keeps each read for CATALOG_TTL and serves the stale value while one
// refresh runs in the background (stale-while-revalidate), so a visitor never waits for a re-render. Availability may
// lag by up to the TTL; the cart, quote and order paths read stock fresh. Local and test read through (TTL 0), so a
// fixture publication shows at once. lazy: per-process memory; upgrade path: tag revalidation from publication/stock.
export const CATALOG_TTL=60_000;
const LIMIT=500;
type Entry={at:number;value:Promise<unknown>;refreshing:boolean};
const entries=new Map<string,Entry>();

export function catalogTtl(){return runtimeTarget()==='production'?CATALOG_TTL:0;}

export function memo<T>(key:string,ttl:number,load:()=>Promise<T>):Promise<T>{
 if(ttl<=0) return load();
 const entry=entries.get(key);
 if(entry&&Date.now()-entry.at<ttl) return entry.value as Promise<T>;
 if(entry){
  if(!entry.refreshing){
   entry.refreshing=true;
   const next=load();
   next.then(()=>{entries.set(key,{at:Date.now(),value:next,refreshing:false});},()=>{entry.refreshing=false;});
  }
  return entry.value as Promise<T>;
 }
 // Bounded: query strings come from visitors (filters, cursors); the oldest entry goes first.
 if(entries.size>=LIMIT) entries.delete(entries.keys().next().value as string);
 const value=load();
 entries.set(key,{at:Date.now(),value,refreshing:false});
 value.catch(()=>{if(entries.get(key)?.value===value) entries.delete(key);});
 return value;
}

// The storefront pages' product listings and department list (the JSON API keeps reading through).
export const publicList=(identity:LocalAuth,input:CatalogQuery)=>memo(`list:${JSON.stringify(input)}`,catalogTtl(),()=>listProducts(identity,input));
export const publicDepartments=(identity:LocalAuth,limit:number)=>memo(`departments:${limit}`,catalogTtl(),()=>featuredDepartments(identity,limit));
