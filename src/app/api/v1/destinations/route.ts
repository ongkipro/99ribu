import {getLocalAuth} from "../../../../modules/access/auth.ts";
import {handleCheckout} from "../../../../modules/checkout/routes.ts";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function GET(request:Request){return handleCheckout(request,getLocalAuth());}
