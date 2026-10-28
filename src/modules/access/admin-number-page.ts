import { notFound, permanentRedirect } from "next/navigation";
import { classifyAdminParam } from "./admin-number.ts";
import { type AdminNumberKind, adminPath } from "./admin-paths.ts";
import { getLocalAuth } from "./auth.ts";

// The Next half of the admin detail resolver (rules in admin-number.ts): a UUID answers 308 to the canonical numeric
// URL, anything non-canonical is not found, everything else yields the UUID the page passes to its client.
// Call it only after the page's own role gate.
/** `search` is a ready query string (`?dari=…`) or "": it survives the redirect so list context is kept. */
export async function resolveAdminId(kind: AdminNumberKind, param: string, search = ""): Promise<string> {
	const result = await classifyAdminParam(getLocalAuth().sql, kind, param);
	if (result.kind === "redirect") permanentRedirect(`${adminPath(kind, result.adminNo)}${search}`);
	if (result.kind === "missing") notFound();
	return result.id;
}

