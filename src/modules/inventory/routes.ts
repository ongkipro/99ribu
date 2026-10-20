import type { LocalAuth } from "../access/auth.ts";
import { assertOrigin, privateJson, problem, readBody } from "../access/http.ts";
import { AccessError, getPrincipal } from "../access/policy.ts";
import { createInventoryLot, createMovement, initializePosition, listInventoryLots, listPositions, movementHistory } from "./positions.ts";
import { createTransfer, getTransfer, listTransfers, receiveTransfer, resolveTransfer } from "./transfers.ts";

export async function handleInventory(request: Request, identity: LocalAuth) {
  try {
    assertOrigin(request);
    if (["authorization", "x-cart-token", "x-order-token"].some((h) => request.headers.has(h))) throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
    const url = new URL(request.url);
    if (request.method !== "GET" && url.search) throw new AccessError(400, "INVALID_INPUT");
    const principal = await getPrincipal(request, identity);
    if (!principal.roles.some((r) => ["owner", "ecommerce_admin", "warehouse"].includes(r))) throw new AccessError(403, "FORBIDDEN");
    const root = "/api/v1/admin/inventory";
    const transfer = new RegExp(`^${root}/transfers/([^/]+)(?:/(dispatches|receipts|cancellations))?$`).exec(url.pathname);
    if (request.method === "GET") {
      if (url.pathname === root) return privateJson(await listPositions(identity, principal, url));
      if (url.pathname === `${root}/lots`) return privateJson(await listInventoryLots(identity, principal, url));
      if (url.pathname === `${root}/movements`) return privateJson(await movementHistory(identity, principal, url));
      if (url.pathname === `${root}/transfers`) return privateJson(await listTransfers(identity,principal,url));
      if (transfer && !transfer[2]) {
        if (url.search) throw new AccessError(400,"INVALID_INPUT");
        return privateJson(await getTransfer(identity,principal,transfer[1]));
      }
    }
    if (request.method === "POST") {
      if (url.pathname === `${root}/lots`) return privateJson(await createInventoryLot(request, identity, principal, await readBody(request)), 201);
      if (url.pathname === `${root}/positions`) return privateJson(await initializePosition(request, identity, principal, await readBody(request)), 201);
      if (url.pathname === `${root}/movements`) return privateJson(await createMovement(request, identity, principal, await readBody(request)), 201);
      if (url.pathname === `${root}/transfers`) return privateJson(await createTransfer(request,identity,principal,await readBody(request)),201);
      if (transfer?.[2]==='receipts') return privateJson(await receiveTransfer(request,identity,principal,transfer[1],await readBody(request)),201);
      if (transfer?.[2]==='dispatches'||transfer?.[2]==='cancellations') return privateJson(await resolveTransfer(request,identity,principal,transfer[1],transfer[2]==='dispatches'?'dispatch':'cancel',await readBody(request)),201);
    }
    throw new AccessError(404, "NOT_FOUND");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") return problem(new AccessError(409, "INVENTORY_IDENTITY_CONFLICT"));
    return problem(error);
  }
}
