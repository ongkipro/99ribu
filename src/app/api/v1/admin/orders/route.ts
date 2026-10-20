import {getLocalAuth} from '@/modules/access/auth';
import {handleOrderHistory} from '@/modules/finance/history-routes';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleOrderHistory(request,getLocalAuth());}
