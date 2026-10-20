import {getLocalAuth} from "@/modules/access/auth";
import {handleFinance} from "@/modules/finance/routes";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function GET(request:Request){return handleFinance(request,getLocalAuth());}
export function POST(request:Request){return handleFinance(request,getLocalAuth());}
