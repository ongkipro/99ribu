import {getLocalAuth} from "@/modules/access/auth";
import {handleAffiliateRates} from "@/modules/affiliates/routes";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function POST(request:Request){return handleAffiliateRates(request,getLocalAuth());}
