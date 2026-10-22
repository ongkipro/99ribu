import {getLocalAuth} from "@/modules/access/auth";
import {handleCatalog} from "@/modules/catalog/routes";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function POST(request:Request){return handleCatalog(request,getLocalAuth());}
