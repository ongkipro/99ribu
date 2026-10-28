import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { getLocalAuth } from "../../../../modules/access/auth";
import { type OwnProfile, readOwnProfile } from "../../../../modules/access/account-security";
import { AccessError, getPrincipal, isStaff } from "../../../../modules/access/policy";
import { storefrontRequest } from "../../../../modules/storefront/browser";

export type ProfileRead = { kind: "ready"; profile: OwnProfile } | { kind: "signed-out" } | { kind: "unavailable" };

/**
 * The signed-in staff member's own profile for /admin/account: the principal getCurrentUser returns
 * (current database roles and grants, MFA-verified session) plus name, email and warehouse names.
 * Deduped per request; a visitor without a verified staff session gets "signed-out", never data.
 */
export const readProfile = cache(async (): Promise<ProfileRead> => {
	try {
		const identity = getLocalAuth();
		const principal = await getPrincipal(await storefrontRequest("GET", "/admin"), identity);
		if (!isStaff(principal)) return { kind: "signed-out" };
		return { kind: "ready", profile: await readOwnProfile(identity, principal) };
	} catch (error) {
		unstable_rethrow(error);
		return error instanceof AccessError ? { kind: "signed-out" } : { kind: "unavailable" };
	}
});
