// Sign-in return destination (spec 17: "Login return destination is validated").
// Only a same-origin relative path is accepted; anything else falls back to the role home.
const BASE = "http://127.0.0.1:3099";

export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) return null;
  // Reject protocol-relative ("//host"), backslash-normalized ("/\host"), control and bidi/format characters before
  // parsing (same character rule as storefront publicReturnPath, which only covers catalog paths).
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\p{Cc}\p{Cf}]/u.test(value)) return null;
  let url: URL;
  try { url = new URL(value, BASE); } catch { return null; }
  if (url.origin !== BASE || url.pathname === "/masuk" || /^\/(?:api|_next)(?:\/|$)/.test(url.pathname)) return null;
  return url.pathname + url.search + url.hash;
}

export const isAdminPath = (path: string) => path === "/admin" || path.startsWith("/admin/") || path.startsWith("/admin?");

// Staff go to their console, buyers and affiliates to their account; a validated `next` wins when the role can use it.
export function signInDestination(next: string | null, staff: boolean) {
  if (next && (staff || !isAdminPath(next))) return next;
  return staff ? "/admin" : "/account";
}
