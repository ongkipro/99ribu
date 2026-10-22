import {getLocalAuth} from "@/modules/access/auth";
import {handleManualFulfillment} from "@/modules/fulfillment/manual-routes";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function GET(request:Request){return handleManualFulfillment(request,getLocalAuth());}
