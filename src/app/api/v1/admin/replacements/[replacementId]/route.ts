import {getLocalAuth} from "@/modules/access/auth";
import {handleReplacements} from "@/modules/returns/replacement-routes";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function GET(request:Request){return handleReplacements(request,getLocalAuth());}
