import {getLocalAuth} from "@/modules/access/auth";
import {handleCodRemittances} from "@/modules/finance/cod-remittance-routes";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function GET(request:Request){return handleCodRemittances(request,getLocalAuth());}
