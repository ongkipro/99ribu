import {getLocalAuth} from "@/modules/access/auth";
import {handlePromotions} from "@/modules/promotions/routes";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){return handlePromotions(request,getLocalAuth());}
export async function POST(request:Request){return handlePromotions(request,getLocalAuth());}
