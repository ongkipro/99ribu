import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {handleAuth} from '../../src/modules/access/handler.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {BrowserSession,enroll} from '../contract/access-fixture.ts';

// Developer-only host bootstrap. Existing real rate limits remain enabled;
// unlike acceptance actor()/cleanup(), this command never clears shared buckets.
export async function runCommerceFixture(target:'local'|'test',namespace:string,storefront=false){
  if(!['local','test'].includes(target)||!/^[a-z][a-z0-9-]{0,23}$/.test(namespace)) throw new Error('Invalid local seed target.');
  const identity=createLocalAuth(target);const browser=new BrowserSession(identity);
  const interruption=new AbortController();
  const stopInt=()=>{process.exitCode=130;interruption.abort(new Error('Synthetic seed interrupted'));};
  const stopTerm=()=>{process.exitCode=143;interruption.abort(new Error('Synthetic seed interrupted'));};
  process.once('SIGINT',stopInt);process.once('SIGTERM',stopTerm);
  const check=()=>interruption.signal.throwIfAborted();
  const email=`${namespace}.seed-op-${randomUUID()}@example.invalid`;const password=randomBytes(24).toString('base64url');
  try{
    assert.equal((await browser.auth('/sign-up/email',{name:`SYNTHETIC temporary seed operator [${namespace}]`,email,password})).status,200);check();
    const [user]=await identity.sql`select id from app.auth_user where email=${email}`;
    const [message]=await identity.sql`select url from app.local_delivery where recipient=${email} and kind='verification'`;
    assert.ok([200,302].includes((await handleAuth(new Request(message.url),identity)).status));check();
    assert.equal((await browser.auth('/sign-in/email',{email,password})).status,200);check();
    await identity.sql`insert into app.role_grant (user_id,roles) values (${user.id},ARRAY['owner']::text[])`;
    await enroll(browser,password);check();
    const request=browser.request('/api/v1/admin/local-fixture-command');
    const seeded=await seedCommerce(request,identity,target,namespace,interruption.signal);
    if(!storefront) return seeded;
    return {...seeded,storefront:await prepareStorefront(request,identity,target,namespace,seeded,interruption.signal)};
  }finally{
    process.off('SIGINT',stopInt);process.off('SIGTERM',stopTerm);
    // Scope cleanup to this exact randomly generated account, even when auth
    // fails before bootstrap returns its user ID. No other identity/bucket reset.
    await identity.sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
    await identity.sql`delete from app.local_delivery where recipient=${email}`;
    const [user]=await identity.sql`select id from app.auth_user where email=${email}`;
    if(user){await identity.sql`delete from app.auth_verification where value=${user.id}`;await identity.sql`delete from app.access_operation where actor_id=${user.id}`;await identity.sql`delete from app.auth_user where id=${user.id}`;}
    await identity.sql.end();
  }
}
