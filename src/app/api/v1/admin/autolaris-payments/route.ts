import {getLocalAuth} from "@/modules/access/auth";
import {handleAutolarisPayments} from "@/modules/finance/autolaris-routes";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function GET(request:Request){return handleAutolarisPayments(request,getLocalAuth());}
