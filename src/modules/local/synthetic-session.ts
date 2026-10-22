import {createHmac,randomUUID} from 'node:crypto';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError} from '../access/policy.ts';
import {handleAuth} from '../access/handler.ts';
import {handleAccess} from '../access/routes.ts';
import {handleCheckout} from '../checkout/routes.ts';

// In-process synthetic browser sessions for local host fixtures (seed operator,
// synthetic buyers). They call the real handlers; no network or provider effect.
const origin='http://127.0.0.1:3099';

// Independent RFC6238 generator from the enrollment URI. Values stay in process
// memory; no signing key or MFA material is printed/read from disk.
export function totp(uri:string){
  const encoded=new URL(uri).searchParams.get('secret')??'';
  let bits='';
  for(const char of encoded.replace(/=+$/,'')) bits+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char).toString(2).padStart(5,'0');
  const key=Buffer.from((bits.match(/.{8}/g)??[]).map((byte)=>Number.parseInt(byte,2)));
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac('sha1',key).update(counter).digest();
  return ((digest.readUInt32BE(digest[19]&15)&0x7fffffff)%1000000).toString().padStart(6,'0');
}

export class BrowserSession{
  cookies=new Map<string,string>();
  readonly identity:LocalAuth;
  constructor(identity:LocalAuth){this.identity=identity;}
  request(path:string,body?:Record<string,unknown>){
    return new Request(`${origin}${path}`,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',
      cookie:[...this.cookies].map(([name,value])=>`${name}=${value}`).join('; ')},body:body?JSON.stringify(body):undefined});
  }
  async auth(path:string,body?:Record<string,unknown>){
    const response=await handleAuth(this.request(`/api/auth${path}`,body),this.identity);
    for(const cookie of response.headers.getSetCookie()){
      const pair=cookie.split(';')[0];const index=pair.indexOf('=');
      const name=pair.slice(0,index);const value=pair.slice(index+1);
      if(value) this.cookies.set(name,value);else this.cookies.delete(name);
    }
    return response;
  }
  access(path:string,body?:Record<string,unknown>){return handleAccess(this.request(`/api/v1${path}`,body),this.identity);}
}

export async function enroll(browser:BrowserSession,password:string){
  const response=await browser.auth('/two-factor/enable',{password});
  if(response.status!==200) throw new AccessError(409,'SYNTHETIC_MFA_ENABLE_REJECTED');
  const setup=await response.json();
  if((await browser.auth('/two-factor/verify-totp',{code:totp(setup.totpURI)})).status!==200) throw new AccessError(409,'SYNTHETIC_MFA_VERIFY_REJECTED');
  return setup as {totpURI:string;backupCodes:string[]};
}

export class CommerceClient{
  readonly identity:LocalAuth;cookies=new Map<string,{name:string;value:string;path:string}>();
  constructor(identity:LocalAuth){this.identity=identity;}
  request(path:string,body?:unknown,options:{method?:string;key?:string;version?:number;headers?:Record<string,string>;anonymous?:boolean}={}){
    const headers=new Headers({origin,'content-type':'application/json',...(body!==undefined||options.method==='DELETE'?{'idempotency-key':options.key??randomUUID()}:{}),...(options.version?{'if-match':`"${options.version}"`}:{}),...options.headers});
    if(!options.anonymous) headers.set('cookie',[...this.cookies.values()].filter(c=>path===c.path||path.startsWith(c.path.endsWith('/')?c.path:`${c.path}/`)).sort((a,b)=>b.path.length-a.path.length).map(c=>`${c.name}=${c.value}`).join('; '));
    return new Request(`${origin}${path}`,{method:options.method??(body!==undefined?'POST':'GET'),headers,body:body!==undefined?JSON.stringify(body):undefined});
  }
  absorb(response:Response){for(const raw of response.headers.getSetCookie()){const [pair,...attributes]=raw.split(';').map(s=>s.trim());const index=pair.indexOf('=');const name=pair.slice(0,index),value=pair.slice(index+1);const path=attributes.find(s=>s.startsWith('Path='))?.slice(5)??'/';const key=`${name}:${path}`;if(value&&!attributes.includes('Max-Age=0')) this.cookies.set(key,{name,value,path});else this.cookies.delete(key);}}
  async call(path:string,body?:unknown,options:Parameters<CommerceClient['request']>[2]={}){const request=this.request(path,body,options);const response=await handleCheckout(request,this.identity);this.absorb(response);return {request,response,payload:await response.json()};}
  async auth(path:string,body:unknown){const response=await handleAuth(this.request(`/api/auth${path}`,body),this.identity);this.absorb(response);return response;}
}
