import { getLocalAuth } from "../../../modules/access/auth";
import { readProfileCompletion } from "../../../modules/accounts/profile-completion";
import { readBuyerAccountWorkspace } from "../../../modules/accounts/service";
import { shippingFixture } from "../../../modules/shipping/address";
import { storefrontRequest } from "../../../modules/storefront/browser";

// One read for every account page: each page asks only for what it shows (order summaries are
// the expensive part; profile completion carries the destinations for the address form).
export async function loadAccount(path: string, options: { orders: boolean; completion: boolean }) {
	const req = await storefrontRequest("GET", path);
	const identity = getLocalAuth();
	const workspace = await readBuyerAccountWorkspace(req, identity, { orders: options.orders });
	const completion =
		workspace.authenticated && options.completion
			? await readProfileCompletion(req, identity)
					.then((data) => ({
						...data,
						destinations: shippingFixture().destinations.map(({ id, province, city, district, postal_code }) => ({
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
