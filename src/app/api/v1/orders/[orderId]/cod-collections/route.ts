import {getLocalAuth} from '../../../../../../modules/access/auth.ts';
import {handleCodCollections} from '../../../../../../modules/payments/cod-routes.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleCodCollections(request,getLocalAuth());}
