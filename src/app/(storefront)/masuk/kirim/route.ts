import { getLocalAuth } from "@/modules/access/auth";
import { handleAuth } from "@/modules/access/handler";
import { safeReturnPath, verificationCallback } from "@/modules/access/return-to";
import { type AuthMode, authHref, codeInput, failureKind, type SignInStep, signInHref, signUpFailureKind } from "@/components/storefront/sign-in-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function formBody(request: Request) {
	const reader = request.body?.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (reader) {
		const chunk = await reader.read();
		if (chunk.done) break;
		size += chunk.value.byteLength;
		if (size > 4096) { await reader.cancel(); return null; }
		chunks.push(chunk.value);
	}
	return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

// No-JS sign-in and sign-up: the /masuk forms post here as plain forms. Each step is re-sent as JSON through
// the same Better Auth handler the JS forms call (Origin check, per-account rate limits, the signed
// two_factor cookie, the production NOTIFICATION_DISABLED gate); its cookies are passed on and the browser
// goes back to /masuk with the next step or the failure kind in the URL, never the name, email, password or
// a code. /masuk then routes a new session by role. Sign-up (S123) answers `langkah=cek-email` for a new and
// a registered email alike; `resend` asks for a new verification link.
export async function POST(request: Request) {
	if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return new Response(null, { status: 415 });
	const form = await formBody(request);
	if (!form) return new Response(null, { status: 413 });
	const next = safeReturnPath(form.get("next"));
	const raw = form.get("step");
	const step: SignInStep | "signup" | "resend" = raw === "totp" || raw === "backup" || raw === "signup" || raw === "resend" ? raw : "password";
	const go = (target: SignInStep | AuthMode, query: Record<string, string> = {}, cookies: string[] = []) => {
		const url = new URL(target === "daftar" || target === "cek-email" || target === "masuk" ? authHref(next, target) : signInHref(next, target), "http://localhost");
		for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
		const headers = new Headers({ location: url.pathname + url.search, "cache-control": "no-store", "referrer-policy": "no-referrer" });
		for (const cookie of cookies) headers.append("set-cookie", cookie);
		return new Response(null, { status: 303, headers });
	};
	let path = "/api/auth/sign-in/email";
	let body: Record<string, string>;
	if (step === "password") {
		const email = form.get("email")?.trim() ?? "", password = form.get("password") ?? "";
		if (!email || !password) return go(step, { galat: "kosong" });
		body = { email, password };
	} else if (step === "signup") {
		const name = form.get("name")?.trim() ?? "", email = form.get("email")?.trim() ?? "", password = form.get("password") ?? "";
		if (!name || !email || !password) return go("daftar", { galat: "empty" });
		path = "/api/auth/sign-up/email";
		body = { name, email, password, callbackURL: verificationCallback(next) };
	} else if (step === "resend") {
		const email = form.get("email")?.trim() ?? "";
		if (!email) return go("cek-email", { galat: "email" });
		path = "/api/auth/send-verification-email";
		body = { email, callbackURL: verificationCallback(next) };
	} else {
		const input = codeInput(step, form.get("code") ?? "");
		if (input.code === null) return go(step, { galat: "format" });
		path = step === "backup" ? "/api/auth/two-factor/verify-backup-code" : "/api/auth/two-factor/verify-totp";
		body = { code: input.code };
	}
	const headers = new Headers(request.headers);
	headers.set("content-type", "application/json");
	headers.delete("content-length");
	const response = await handleAuth(new Request(new URL(path, request.url), { method: "POST", headers, body: JSON.stringify(body) }), getLocalAuth());
	const cookies = response.headers.getSetCookie();
	const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
	// Better Auth's own limiter answers 429 with X-Retry-After; ours sends Retry-After.
	const retry = Number(response.headers.get("retry-after") ?? response.headers.get("x-retry-after"));
	const wait: Record<string, string> = retry > 0 ? { tunggu: String(Math.ceil(retry)) } : {};
	// Sign-up and resend set no cookie (autoSignIn is off); nothing from their answer is passed on.
	if (step === "signup" || step === "resend") {
		if (response.status === 200) return go("cek-email", step === "resend" ? { ulang: "1" } : {});
		return go(step === "signup" ? "daftar" : "cek-email", { galat: signUpFailureKind(response.status, payload?.code), ...wait });
	}
	if (response.status === 200) return go(step === "password" && payload?.twoFactorRedirect === true ? "totp" : "password", {}, cookies);
	return go(step, { galat: failureKind(response.status, payload?.code), ...wait }, cookies);
}
