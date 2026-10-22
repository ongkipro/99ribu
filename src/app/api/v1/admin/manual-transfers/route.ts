import {getLocalAuth} from "@/modules/access/auth";
import {handleManualTransfers} from "@/modules/finance/manual-bank-routes";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function GET(request:Request){return handleManualTransfers(request,getLocalAuth());}
