import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {cleanup} from '../contract/access-fixture.ts';

// Sequential isolated localhost acceptance only. Reuse the existing synthetic
// actor cleanup's eight exact loopback buckets; never import into app/seed code.
export async function resetBrowserAuthLimits(){
 const identity=createLocalAuth('local');try{await cleanup(identity,[]);}finally{await identity.sql.end();}
}
