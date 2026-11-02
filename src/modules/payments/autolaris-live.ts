import type { AutolarisClient, Envelope } from "./autolaris.ts";

// S97 preparation (owner 2026-11-02: "siapkan dulu, tetap simulasi"). The HTTP client for the documented
// AutoLaris H2H endpoints (public Postman collection, skill autolaris-h2h): base URL
// https://api-h2h.autolaris.com, `Authorization: Bearer <API_KEY>`, JSON bodies, GET list_payment without a body.
// NOTHING constructs it yet: autolarisClientFor still returns the simulator locally and refuses live use
// (AUTOLARIS_LIVE_GATED) until S97 (static egress IP whitelist, verified advice settlement mapping, owner go).
// Production config refuses every AUTOLARIS_* variable until then (src/config/runtime.ts PROVIDER_KEY).

export const AUTOLARIS_DEFAULT_BASE_URL = "https://api-h2h.autolaris.com";
const TIMEOUT_MS = 10_000;

export type AutolarisLiveConfig = { baseUrl: string; apiKey: string };

// AUTOLARIS_API_KEY (secret, server-only) and the optional AUTOLARIS_BASE_URL. Null when no key is set.
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
