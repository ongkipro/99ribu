import {getLocalAuth} from "@/modules/access/auth";
import {handleReturns} from "@/modules/returns/routes";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function GET(request:Request){return handleReturns(request,getLocalAuth());}
export function POST(request:Request){return handleReturns(request,getLocalAuth());}
