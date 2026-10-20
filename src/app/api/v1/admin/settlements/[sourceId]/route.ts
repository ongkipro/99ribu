import {getLocalAuth} from "@/modules/access/auth";
import {handleSettlements} from "@/modules/finance/settlements/routes";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function GET(request:Request){return handleSettlements(request,getLocalAuth());}
