import {randomUUID} from 'node:crypto';
import type {LocalAuth} from '../../src/modules/access/auth.ts';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {readPublicationState,withdrawPublication} from '../../src/modules/catalog/publication.ts';
import type {BrowserSession} from '../contract/access-fixture.ts';

// A test that publishes its own synthetic product withdraws it when it finishes, through the ordinary audited
// retraction, so the shared storefront the built-web suites read never lists it (storefront-http checks every
// product image on the home page). Call before the owner is cleaned up. A product with no current publication is left as is.
export async function withdrawOwn(identity:LocalAuth,owner:{browser:BrowserSession},productId:string|undefined,reason='Synthetic test finished'){
 if(!productId) return;
 const principal=await getPrincipal(owner.browser.request('/api/v1/me'),identity);
 const state=await readPublicationState(identity,principal,productId);
 if(!state.current) return;
 const request=owner.browser.request(`/api/v1/admin/products/${productId}/publication-retractions`,{expected_publication_version:state.latest_version,reason});
 request.headers.set('idempotency-key',randomUUID());
 await withdrawPublication(request,identity,principal,productId,{expected_publication_version:state.latest_version,reason});
}
