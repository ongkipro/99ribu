import { getLocalAuth } from "../../../modules/access/auth";
import { readProfileCompletion } from "../../../modules/accounts/profile-completion";
import { readBuyerAccountWorkspace } from "../../../modules/accounts/service";
import { shippingFixture } from "../../../modules/shipping/address";
import { destinationSource } from "../../../modules/shipping/destinations";
import { storefrontRequest } from "../../../modules/storefront/browser";

// One read for every account page: each page asks only for what it shows (order summaries are
// the expensive part; profile completion carries the destinations for the address form).
const fixtureSource = () => {
	try {
		return destinationSource() === "TEST-ONLY";
	} catch {
		return false;
	}
};

export async function loadAccount(path: string, options: { orders: boolean; completion: boolean; returns?: boolean; returnsCursor?: string | null }) {
	const req = await storefrontRequest("GET", path);
	const identity = getLocalAuth();
	const workspace = await readBuyerAccountWorkspace(req, identity, { orders: options.orders, returns: options.returns, returnsCursor: options.returnsCursor });
	const completion =
		workspace.authenticated && options.completion
			? await readProfileCompletion(req, identity)
					.then((data) => ({
						...data,
						// S176: the fixture list only when it is the destination source; with the real catalogue (Mengantar or
						// local provider mode) the form searches it instead, so a saved address always uses a valid area id.
						destinations: (fixtureSource() ? shippingFixture().destinations : []).map(({ id, province, city, district, postal_code }) => ({
							id,
							province,
							city,
							district,
							postal_code,
						})),
					}))
					.catch(() => null)
			: null;
	return { workspace, completion };
}
