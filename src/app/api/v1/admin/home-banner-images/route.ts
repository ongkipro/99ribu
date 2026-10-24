import {getLocalAuth} from "@/modules/access/auth";
import {handleHomeBanners} from "@/modules/storefront/home-banners";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){return handleHomeBanners(request,getLocalAuth());}
