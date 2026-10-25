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
  if (url.origin !== BASE || /^\/(?:masuk|api|_next)(?:\/|$)/.test(url.pathname)) return null;
  return url.pathname + url.search + url.hash;
}

// S123: where a plain email verification link lands (Better Auth redirects to the callbackURL and adds
// `error=` for a bad link). Since the owner decision of 2026-10-25 public sign-up never sends one; only
// in-process harness accounts (fixtures, seeds) still get it.
export const VERIFIED_PATH = "/masuk/verifikasi";
// The set-password page. Public sign-up and resend mail a set-password link whose callback is
// `/masuk/atur-sandi?aktivasi=1[&next=…]`; the buyer creates the password there, which activates the account.
export const PASSWORD_PATH = "/masuk/atur-sandi";
export const ACTIVATION_CALLBACK = `${PASSWORD_PATH}?aktivasi=1`;
export const activationCallback = (next: string | null) => (next ? `${ACTIVATION_CALLBACK}&${new URLSearchParams({ next })}` : ACTIVATION_CALLBACK);
export function isActivationCallback(value: unknown) {
  if (value === ACTIVATION_CALLBACK) return true;
  if (typeof value !== "string" || !value.startsWith(`${ACTIVATION_CALLBACK}&`)) return false;
  const next = safeReturnPath(new URLSearchParams(value.slice(ACTIVATION_CALLBACK.length + 1)).get("next"));
  return next !== null && value === activationCallback(next);
}
export const verificationCallback = (next: string | null) => (next ? `${VERIFIED_PATH}?${new URLSearchParams({ next })}` : VERIFIED_PATH);
export function isVerificationCallback(value: unknown) {
  if (value === VERIFIED_PATH) return true;
  if (typeof value !== "string" || !value.startsWith(`${VERIFIED_PATH}?`)) return false;
  const query = new URLSearchParams(value.slice(VERIFIED_PATH.length + 1));
  const next = safeReturnPath(query.get("next"));
  return next !== null && value === verificationCallback(next);
}

export const isAdminPath = (path: string) => path === "/admin" || path.startsWith("/admin/") || path.startsWith("/admin?");

// S128 (spec 17): a signed-out production request to the console goes to sign-in and returns to the same
// console page; local/test keep the signed-out preview (null). Anything that is not a valid console path
// returns to /admin.
export const CONSOLE_PATH_HEADER = "x-99ribu-console-path"; // set by src/proxy.ts
export function consoleSignInRedirect(profile: string, signedIn: boolean, path: string | null) {
  if (profile !== "production" || signedIn) return null;
  const next = path && isAdminPath(path) ? safeReturnPath(path) : null;
  return `/masuk?${new URLSearchParams({ next: next ?? "/admin" })}`;
}

// Staff go to their console, buyers and affiliates to their account; a validated `next` wins when the role can use it.
export function signInDestination(next: string | null, staff: boolean) {
  if (next && (staff || !isAdminPath(next))) return next;
  return staff ? "/admin" : "/akun";
}
