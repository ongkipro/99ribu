import { randomUUID } from "node:crypto";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";

// Commerce fixtures publish only under a current owner-configured commercial policy, and the seed
// never creates one (README "Synthetic commerce seed checkpoint"). A fresh isolated test database
// gets the same baseline the finance suites write when none exists, through the real owner API.
export async function ensureCommercialBaseline() {
	const identity = createLocalAuth("test");
	const owner = await actor(identity, "owner", []);
	try {
		await enroll(owner.browser, owner.password);
		const history = await (await owner.browser.access("/admin/policy-versions?kind=commercial")).json();
		if (history.latest_version !== 0) return false;
		const proofRequest = owner.browser.request("/api/v1/me/reauthentication-proofs", {
			password: owner.password,
			action: "company_policy.version",
			subject_id: "company-commercial",
		});
		proofRequest.headers.set("idempotency-key", randomUUID());
		const proof = await handleAccess(proofRequest, identity);
		if (proof.status !== 201) throw new Error(`Commercial baseline proof rejected: ${proof.status}`);
		const request = owner.browser.request("/api/v1/admin/policy-versions", {
			kind: "commercial",
			warehouse_id: null,
			expected_version: 0,
			effective_at: null,
			values: { default_commission_bps: 1000, minimum_payout_idr: 99000 },
			reason: "Synthetic explicit publication baseline",
			reauthentication_proof: (await proof.json()).proof,
		});
		request.headers.set("idempotency-key", randomUUID());
		const saved = await handleAccess(request, identity);
		if (saved.status !== 201) throw new Error(`Commercial baseline rejected: ${saved.status}`);
		return true;
	} finally {
		await cleanup(identity, [owner]);
		await identity.sql.end();
	}
}
