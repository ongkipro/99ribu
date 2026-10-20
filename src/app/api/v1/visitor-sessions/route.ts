import {getLocalAuth} from '../../../../modules/access/auth.ts';
import {handleSignals} from '../../../../modules/advertising/routes.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function POST(request:Request){return handleSignals(request,getLocalAuth());}
