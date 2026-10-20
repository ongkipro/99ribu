import {getLocalAuth} from "../../../../../../../modules/access/auth.ts";
import {handleCheckout} from "../../../../../../../modules/checkout/routes.ts";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export function PATCH(request:Request){return handleCheckout(request,getLocalAuth());}
export function DELETE(request:Request){return handleCheckout(request,getLocalAuth());}
