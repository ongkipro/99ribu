import {getLocalAuth} from "@/modules/access/auth";
import {handleAutolarisCallback} from "@/modules/finance/autolaris-routes";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function POST(request:Request){return handleAutolarisCallback(request,getLocalAuth());}
