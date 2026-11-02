import {getLocalAuth} from "@/modules/access/auth";
import {handlePicklists} from "@/modules/fulfillment/picklist";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function GET(request:Request){return handlePicklists(request,getLocalAuth());}
