import {getLocalAuth} from "@/modules/access/auth";
import {handleFulfillment} from "@/modules/fulfillment/routes";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function GET(request:Request){return handleFulfillment(request,getLocalAuth());}
