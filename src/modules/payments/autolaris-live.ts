import { readLocalConfig } from "../../config/local.ts";
import type { AutolarisClient, Envelope } from "./autolaris.ts";

// S97 preparation (owner 2026-11-02: "siapkan dulu, tetap simulasi"). The HTTP client for the documented
// AutoLaris H2H endpoints (public Postman collection, skill autolaris-h2h): base URL
// https://api-h2h.autolaris.com, `Authorization: Bearer <API_KEY>`, JSON bodies, GET list_payment without a body.
// Live use stays refused (AUTOLARIS_LIVE_GATED) until S97 (static egress IP whitelist, verified advice settlement
// mapping, owner go). Both profiles refuse every AUTOLARIS_* variable until then (DEC-028 D6), so the https reader
// below is reachable from tests only. The one constructed use is the loopback stand-in (DEC-028, S166) further down.

export const AUTOLARIS_DEFAULT_BASE_URL = "https://api-h2h.autolaris.com";
const TIMEOUT_MS = 10_000;

export type AutolarisLiveConfig = { baseUrl: string; apiKey: string };

// AUTOLARIS_API_KEY (secret, server-only) and the optional AUTOLARIS_BASE_URL. Null when no key is set (S97 only).
export function readAutolarisLiveConfig(env: Record<string, string | undefined>): AutolarisLiveConfig | null {
	const apiKey = env.AUTOLARIS_API_KEY?.trim();
	if (!apiKey) return null;
	if (!/^[\x21-\x7e]{8,512}$/.test(apiKey)) throw new Error("AUTOLARIS_API_KEY must be a printable token.");
	const raw = env.AUTOLARIS_BASE_URL?.trim() || AUTOLARIS_DEFAULT_BASE_URL;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("AUTOLARIS_BASE_URL must be an https origin.");
	}
	if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
		throw new Error("AUTOLARIS_BASE_URL must be an https origin.");
	}
	return { baseUrl: url.origin, apiKey };
}

// Each call is bounded; an HTTP failure, a non-JSON body or a missing envelope throws a sanitized error
// (never the key, never the body), so the caller's unknown-outcome path decides what happens next.
export function liveAutolaris(config: AutolarisLiveConfig, fetchImpl: typeof fetch = fetch): AutolarisClient {
	const call = async (method: "GET" | "POST", path: string, body: unknown, signal?: AbortSignal): Promise<Envelope> => {
		const timeout = AbortSignal.timeout(TIMEOUT_MS);
		const response = await fetchImpl(`${config.baseUrl}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${config.apiKey}`,
				accept: "application/json",
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
			redirect: "error",
		});
		if (!response.ok) throw new Error(`AutoLaris ${path} answered HTTP ${response.status}`);
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			throw new Error(`AutoLaris ${path} answered non-JSON`);
		}
		const envelope = payload as Partial<Envelope> | null;
		if (!envelope || typeof envelope !== "object" || typeof envelope.rc !== "string") {
			throw new Error(`AutoLaris ${path} answered without an rc envelope`);
		}
		return { rc: envelope.rc, ket: typeof envelope.ket === "string" ? envelope.ket : "", data: envelope.data ?? null };
	};
	return {
		listPayment: (signal) => call("GET", "/api/h2h/list_payment", undefined, signal),
		createPayment: (body, signal) => call("POST", "/api/h2h/create_payment", body, signal),
		advice: (body, signal) => call("POST", "/api/h2h/advice", body, signal),
	};
}

// DEC-028 / S166: local provider mode. The client above, pointed at the AdsBookCMS stand-in: only the S163-validated
// LOCAL_PROVIDER_ORIGIN (http://127.0.0.1:<port>) with the literal bearer `local`, never a credential. The https
// reader is untouched. Null in production and whenever the variable is unset.
export function readAutolarisStandInConfig(env: Record<string, string | undefined>): AutolarisLiveConfig | null {
	// Unset: return before reading any profile, so callers behave exactly as before S166.
	if (env.APP_ENV === "production" || !env.LOCAL_PROVIDER_ORIGIN) return null;
	const origin = readLocalConfig(env).providerOrigin;
	return origin ? { baseUrl: origin, apiKey: "local" } : null;
}

// Egress guard for the stand-in client: any URL outside its own origin is refused before a request is made.
export function originBoundFetch(origin: string, fetchImpl: typeof fetch = fetch): typeof fetch {
	return ((input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (url.origin !== origin) return Promise.reject(new Error("AutoLaris stand-in egress refused"));
		return fetchImpl(input, init);
	}) as typeof fetch;
}
