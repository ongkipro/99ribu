import { type NextRequest, NextResponse } from "next/server";
import { CONSOLE_PATH_HEADER } from "./modules/access/return-to";

// S128: layouts cannot see the request path, so the console layout reads it from this header to send a
// signed-out production request to /masuk?next=<path>. The value is always overwritten here (a client copy
// never survives) and is still validated as a console path before use. No auth decision is made here.
export function proxy(request: NextRequest) {
	const headers = new Headers(request.headers);
	headers.set(
		CONSOLE_PATH_HEADER,
		request.nextUrl.pathname + request.nextUrl.search,
	);
	return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
