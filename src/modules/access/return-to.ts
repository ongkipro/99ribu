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

// S123: the email verification link lands here (Better Auth redirects to the sign-up's callbackURL and
// adds `error=` for a bad link). Sign-up and resend accept no other callbackURL, so a link can only carry
// a validated `next` on to sign-in.
export const VERIFIED_PATH = "/masuk/verifikasi";
// S123 review M1: the set-password page. `aktivasi=1` marks the link that activates an unverified account.
export const PASSWORD_PATH = "/masuk/atur-sandi";
export const ACTIVATION_CALLBACK = `${PASSWORD_PATH}?aktivasi=1`;
export const verificationCallback = (next: string | null) => (next ? `${VERIFIED_PATH}?${new URLSearchParams({ next })}` : VERIFIED_PATH);
export function isVerificationCallback(value: unknown) {
  if (value === VERIFIED_PATH) return true;
  if (typeof value !== "string" || !value.startsWith(`${VERIFIED_PATH}?`)) return false;
  const query = new URLSearchParams(value.slice(VERIFIED_PATH.length + 1));
  const next = safeReturnPath(query.get("next"));
  return next !== null && value === verificationCallback(next);
}

export const isAdminPath = (path: string) => path === "/admin" || path.startsWith("/admin/") || path.startsWith("/admin?");

// Staff go to their console, buyers and affiliates to their account; a validated `next` wins when the role can use it.
export function signInDestination(next: string | null, staff: boolean) {
  if (next && (staff || !isAdminPath(next))) return next;
  return staff ? "/admin" : "/akun";
}
