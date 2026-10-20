import {getLocalAuth} from '../../../../../modules/access/auth';
import {handleStorefront} from '../../../../../modules/storefront/routes';
export const runtime='nodejs';
export function GET(request:Request){return handleStorefront(request,getLocalAuth());}
