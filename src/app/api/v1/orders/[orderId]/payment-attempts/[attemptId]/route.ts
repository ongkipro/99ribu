import {getLocalAuth} from '../../../../../../../modules/access/auth.ts';
import {handlePayments} from '../../../../../../../modules/payments/routes.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request:Request){return handlePayments(request,getLocalAuth());}
