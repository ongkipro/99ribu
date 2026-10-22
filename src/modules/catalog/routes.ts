import type { LocalAuth } from "../access/auth.ts";
import { assertOrigin, privateJson, problem, readBody } from "../access/http.ts";
import { AccessError, getPrincipal } from "../access/policy.ts";
import { createCategory, createProduct, createStockItem, patchProduct, readCatalog } from "./catalog.ts";
import { publishProduct, readPublicationState, withdrawPublication } from "./publication.ts";
import { listProductSummaries } from "./summary.ts";

export async function handleCatalog(request: Request, identity: LocalAuth) {
  try {
    assertOrigin(request);
    if (["authorization", "x-cart-token", "x-order-token"].some((h) => request.headers.has(h))) throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
    const url = new URL(request.url);
    if (request.method !== "GET" && url.search) throw new AccessError(400, "INVALID_INPUT");
    const principal = await getPrincipal(request, identity);
    // Coarse gate only: authority() rechecks role, finance.costs.read and warehouse scope in the read transaction.
    const read = request.method === "GET" && url.pathname !== "/api/v1/admin/stock-items";
    const allowed = read ? ["owner", "ecommerce_admin", "warehouse", "finance"] : ["owner", "ecommerce_admin"];
    if (!principal.roles.some((r) => allowed.includes(r))) throw new AccessError(403, "FORBIDDEN");
    const product = /^\/api\/v1\/admin\/products\/([^/]+)$/.exec(url.pathname);
    const publication = /^\/api\/v1\/admin\/products\/([^/]+)\/publications$/.exec(url.pathname);
    if (publication && request.method === "GET") {
      if (url.search) throw new AccessError(400,"INVALID_INPUT");
      return privateJson(await readPublicationState(identity,principal,publication[1]));
    }
    if (publication && request.method === "POST") return privateJson(await publishProduct(request,identity,principal,publication[1],await readBody(request)),201);
    const withdrawal = /^\/api\/v1\/admin\/products\/([^/]+)\/publication-retractions$/.exec(url.pathname);
    if (withdrawal && request.method === "POST") return privateJson(await withdrawPublication(request,identity,principal,withdrawal[1],await readBody(request)),201);
    if (request.method === "GET" && url.pathname === "/api/v1/admin/products") return privateJson(await listProductSummaries(identity, principal, url));
    const list = ["/api/v1/admin/categories", "/api/v1/admin/stock-items", "/api/v1/admin/products"].includes(url.pathname);
    if (request.method === "GET" && (product || list)) return privateJson(await readCatalog(identity, principal, url, product?.[1]));
    if (request.method === "PATCH" && product) return privateJson(await patchProduct(request, identity, principal, product[1], await readBody(request)));
    if (request.method === "POST" && list) {
      const body = await readBody(request);
      const result = url.pathname.endsWith("/categories") ? await createCategory(request, identity, principal, body)
        : url.pathname.endsWith("/stock-items") ? await createStockItem(request, identity, principal, body)
        : await createProduct(request, identity, principal, body);
      return privateJson(result, 201);
    }
    throw new AccessError(404, "NOT_FOUND");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") return problem(new AccessError(409, "CATALOG_IDENTITY_CONFLICT"));
    return problem(error);
  }
}
