import { timingSafeEqual } from "node:crypto";
import type { LocalAuth } from "../access/auth.ts";
import { AccessError } from "../access/policy.ts";
import { mac } from "../checkout/access.ts";

// Keyed by the running auth profile's secret (purpose-separated); no fallback key.
export async function signTokenPayload(
	identity: LocalAuth,
	payload: Record<string, unknown>,
): Promise<string> {
	const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
		"base64url",
	);
	return `${encoded}.${await mac(identity, "reporting-filter", [encoded])}`;
}

export async function verifyTokenPayload(
	identity: LocalAuth,
	token: string,
): Promise<Record<string, unknown>> {
	if (typeof token !== "string" || token.length < 16 || token.length > 2000) {
		throw new AccessError(409, "INVALID_FILTER_TOKEN");
	}
	const parts = token.split(".");
	if (parts.length !== 2) throw new AccessError(409, "INVALID_FILTER_TOKEN");
	const [encoded, sig] = parts;
	const expected = await mac(identity, "reporting-filter", [encoded]);
	const a = Buffer.from(sig, "utf8");
	const b = Buffer.from(expected, "utf8");
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		throw new AccessError(409, "INVALID_FILTER_TOKEN");
	}
	try {
		const parsed = JSON.parse(
			Buffer.from(encoded, "base64url").toString("utf8"),
		);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new AccessError(409, "INVALID_FILTER_TOKEN");
		}
		return parsed as Record<string, unknown>;
	} catch (err) {
		if (err instanceof AccessError) throw err;
		throw new AccessError(409, "INVALID_FILTER_TOKEN");
	}
}
