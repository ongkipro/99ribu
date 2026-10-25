import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { handleAccounts } from "../../src/modules/accounts/service.ts";
import { handleAdvertisingDiagnostics } from "../../src/modules/advertising/diagnostics.ts";
import { handleSignals } from "../../src/modules/advertising/routes.ts";
import { handleAffiliateProfile } from "../../src/modules/affiliates/profile.ts";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { handleCommerceExceptions } from "../../src/modules/checkout/exceptions/routes.ts";
import { handleCheckout } from "../../src/modules/checkout/routes.ts";
import { handleCommissions } from "../../src/modules/commissions/service.ts";
import { handleShippingLabels } from "../../src/modules/documents/labels.ts";
import { handleOrderHistory } from "../../src/modules/finance/history-routes.ts";
import { handleFulfillment } from "../../src/modules/fulfillment/routes.ts";
import { handleInventory } from "../../src/modules/inventory/routes.ts";
import { handleOrderReceipt } from "../../src/modules/orders/receipt.ts";
import { handleCodCollections } from "../../src/modules/payments/cod-routes.ts";
import { handlePayments } from "../../src/modules/payments/routes.ts";
import { handlePayouts } from "../../src/modules/payouts/service.ts";
import { handlePromotions } from "../../src/modules/promotions/routes.ts";
import { handleReporting } from "../../src/modules/reporting/service.ts";
import { handleReturns } from "../../src/modules/returns/routes.ts";
import { handleStorefront } from "../../src/modules/storefront/routes.ts";
import { handleSupport } from "../../src/modules/support/routes.ts";
import { actor, cleanup, enroll } from "./access-fixture.ts";

const exec = promisify(execFile);
const origin = "http://127.0.0.1:3099";

function walkFiles(dir: string, suffix: string): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			results.push(...walkFiles(full, suffix));
		} else if (full.endsWith(suffix)) {
			results.push(full);
		}
	}
	return results.sort();
}

async function assertProblemJson(
	response: Response,
	expectedStatus: number,
	expectedCode?: string,
) {
	assert.equal(
		response.status,
		expectedStatus,
		`Expected status ${expectedStatus}, got ${response.status}`,
	);
	assert.match(
		response.headers.get("content-type") ?? "",
		/^application\/problem\+json\b/i,
	);
	assert.equal(response.headers.get("cache-control"), "no-store");
	const body = (await response.json()) as Record<string, unknown>;
	assert.equal(body.status, expectedStatus);
	assert.equal(typeof body.type, "string");
	assert.equal(typeof body.title, "string");
	assert.equal(typeof body.code, "string");
	assert.equal(typeof body.request_id, "string");
	if (expectedCode) {
		assert.equal(body.code, expectedCode);
	}
	return body;
}

test("S64.1: check-openapi-contract.py validates all 204 paths, 244 operations, and 354 schemas", async () => {
	const { stdout } = await exec(
		"python3",
		["docs/spec/scripts/check-openapi-contract.py"],
		{
			timeout: 20000,
		},
	);
	assert.match(stdout, /204 paths, 244 operations, 354 schemas/);
});

// S75/DEC-001: 'preparing' (revision 0) is created and promoted to 'pending'
// inside the single order-create transaction, so it is never observable.
const ORDER_STATUSES = [
	"pending",
	"processing",
	"partially_completed",
	"cancelled",
];

test("S75: order status enums match the commerce_order_state_check lifecycle", async () => {
	const migrations = readdirSync("migrations")
		.filter((name) => name.endsWith(".sql"))
		.sort()
		.map((name) => readFileSync(join("migrations", name), "utf8"))
		.join("\n");
	const definitions = [
		...migrations.matchAll(
			/ADD CONSTRAINT "commerce_order_state_check" CHECK \((.*)\);/g,
		),
	];
	const latest = definitions.at(-1)?.[1];
	assert.ok(latest, "commerce_order_state_check definition");
	const dbStatuses = new Set<string>();
	for (const m of latest.matchAll(
		/"commerce_order"\."status"(?:='([a-z_]+)'| IN \(([^)]*)\))/g,
	)) {
		for (const value of (m[1] ?? m[2]).split(","))
			dbStatuses.add(value.replaceAll("'", "").trim());
	}
	assert.deepEqual(
		[...dbStatuses].sort(),
		[...ORDER_STATUSES, "preparing"].sort(),
	);

	const { stdout } = await exec("python3", [
		"-c",
		`import json,yaml
d=yaml.safe_load(open('docs/spec/openapi.yaml'))
s=d['components']['schemas']
p=[x for x in d['paths']['/admin/orders']['get']['parameters'] if x.get('name')=='status'][0]
print(json.dumps({'Order':s['Order']['properties']['status']['enum'],'AdminOrderSummary':s['AdminOrderSummary']['properties']['status']['enum'],'listAdminOrderHistory.status':p['schema']['enum']}))`,
	]);
	for (const [where, values] of Object.entries(
		JSON.parse(stdout) as Record<string, string[]>,
	)) {
		assert.deepEqual(values, ORDER_STATUSES, where);
	}
});

test("S64.2: every implemented OpenAPI operation has a matching route.ts HTTP method export and zero stub 200 placeholders exist", async () => {
	const apiRoot = join(process.cwd(), "src/app/api/v1");
	const routeFiles = walkFiles(apiRoot, "route.ts");
	assert.ok(
		routeFiles.length >= 140,
		`Expected >= 140 route.ts files, found ${routeFiles.length}`,
	);

	const actualRoutes = new Map<string, Set<string>>();
	for (const file of routeFiles) {
		const relDir = relative(apiRoot, join(file, "..")).replaceAll("\\", "/");
		const normPath = `/${relDir.replace(/\[([^\]]+)\]/g, "{$1}")}`;
		const content = readFileSync(file, "utf8");

		assert.match(
			content,
			/export\s+const\s+runtime\s*=\s*["']nodejs["']/,
			`${file} must export runtime = "nodejs"`,
		);
		assert.ok(
			!/Response\.json\s*\(\s*\{\s*\}\s*\)/.test(content),
			`${file} must not contain a stub Response.json({}) placeholder`,
		);

		const methods = new Set<string>();
		for (const match of content.matchAll(
			/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
		)) {
			methods.add(match[1].toLowerCase());
		}
		assert.ok(
			methods.size > 0,
			`${file} must export at least one HTTP method handler`,
		);
		actualRoutes.set(normPath, methods);
	}

	// Verify no domain module contains a stub Response.json({}) 200 placeholder
	const moduleFiles = walkFiles(join(process.cwd(), "src/modules"), ".ts");
	for (const modFile of moduleFiles) {
		const src = readFileSync(modFile, "utf8");
		assert.ok(
			!/Response\.json\s*\(\s*\{\s*\}\s*\)/.test(src),
			`${modFile} must not contain a stub Response.json({}) placeholder`,
		);
	}

	// Parse docs/spec/openapi.yaml via Python and verify operation-by-operation parity
	const { stdout } = await exec(
		"python3",
		[
			"-c",
			[
				"import json, yaml",
				"spec = yaml.safe_load(open('docs/spec/openapi.yaml').read())",
				"ops = []",
				"for p, item in spec['paths'].items():",
				"    for m, op in item.items():",
				"        if m in ('get','post','put','patch','delete'):",
				"            ops.append({'path': p, 'method': m, 'status': op.get('x-contract-status'), 'id': op.get('operationId'), 'description': op.get('description', '')})",
				"print(json.dumps({'paths': len(spec['paths']), 'ops': ops, 'schemas': len(spec['components']['schemas'])}))",
			].join("\n"),
		],
		{ timeout: 10000 },
	);
	const parsed = JSON.parse(stdout) as {
		paths: number;
		ops: {
			path: string;
			method: string;
			status: string;
			id: string;
			description: string;
		}[];
		schemas: number;
	};
	assert.equal(parsed.paths, 204);
	assert.equal(parsed.ops.length, 244);
	assert.equal(parsed.schemas, 354);

	const implementedOps = parsed.ops.filter(
		(op) => op.status === "implemented-local",
	);
	assert.equal(implementedOps.length, 244);

	// Bidirectional parity over ALL spec operations: every operation has an exported handler at its exact
	// path (no parameter aliases), and every exported handler method is a spec operation.
	for (const op of parsed.ops) {
		assert.ok(
			!/\b(?:proposed|not implemented|no implemented)\b/i.test(op.description),
			`Operation ${op.method.toUpperCase()} ${op.path} (${op.id}) still carries a proposed/not-implemented description: ${op.description}`,
		);
		const methods = actualRoutes.get(op.path);
		assert.ok(
			methods?.has(op.method),
			`Missing route.ts export for operation ${op.method.toUpperCase()} ${op.path} (${op.id})`,
		);
	}
	const specOperations = new Set(
		parsed.ops.map((op) => `${op.method} ${op.path}`),
	);
	for (const [path, methods] of actualRoutes) {
		for (const method of methods) {
			assert.ok(
				specOperations.has(`${method} ${path}`),
				`route.ts export ${method.toUpperCase()} ${path} has no OpenAPI operation`,
			);
		}
	}
});

test("S64.3: live handler/schema/IAM/CSRF parity across accounts, support, affiliates, commissions, payouts, reporting, advertising, labels, exceptions, and operations", async () => {
	const identity = createLocalAuth("test");
	const owner = await actor(identity, "owner", []);
	await enroll(owner.browser, owner.password);
	const warehouseA = randomUUID();
	await identity.sql`
		insert into app.warehouse (id, name, city, active)
		values (${warehouseA}, 'Synthetic Parity Warehouse', 'Malang', true)
	`;
	const whStaff = await actor(identity, "warehouse", [warehouseA]);
	await enroll(whStaff.browser, whStaff.password);
	const csStaff = await actor(identity, "customer_service", []);
	await enroll(csStaff.browser, csStaff.password);
	const financeStaff = await actor(identity, "finance", []);
	await enroll(financeStaff.browser, financeStaff.password);
	const staffNoMfa = await actor(identity, "ecommerce_admin", [warehouseA]);
	const buyer = await actor(identity, "buyer", []);
	const affiliate = await actor(identity, "affiliate", []);

	try {
		// 1. Unauthenticated requests to protected Buyer, Affiliate, and Admin endpoints return 401 Problem+JSON with Cache-Control: no-store
		const unauthTargets: Array<{
			name: string;
			call: () => Promise<Response>;
		}> = [
			{
				name: "GET /api/v1/me/profile",
				call: () =>
					handleAccounts(new Request(`${origin}/api/v1/me/profile`), identity),
			},
			{
				name: "GET /api/v1/me/addresses",
				call: () =>
					handleAccounts(
						new Request(`${origin}/api/v1/me/addresses`),
						identity,
					),
			},
			{
				name: "GET /api/v1/me/orders",
				call: () =>
					handleAccounts(new Request(`${origin}/api/v1/me/orders`), identity),
			},
			{
				name: "GET /api/v1/me/affiliate",
				call: () =>
					handleAffiliateProfile(
						new Request(`${origin}/api/v1/me/affiliate`),
						identity,
					),
			},
			{
				name: "GET /api/v1/me/affiliate/commissions",
				call: () =>
					handleCommissions(
						new Request(`${origin}/api/v1/me/affiliate/commissions`),
						identity,
					),
			},
			{
				name: "GET /api/v1/me/affiliate/payouts",
				call: () =>
					handlePayouts(
						new Request(`${origin}/api/v1/me/affiliate/payouts`),
						identity,
					),
			},
			{
				name: "GET /api/v1/admin/payouts",
				call: () =>
					handlePayouts(
						new Request(`${origin}/api/v1/admin/payouts`),
						identity,
					),
			},
			{
				name: "GET /api/v1/admin/support/conversations",
				call: () =>
					handleSupport(
						new Request(`${origin}/api/v1/admin/support/conversations`),
						identity,
					),
			},
			{
				name: "GET /api/v1/admin/dashboard?workspace=owner",
				call: () =>
					handleReporting(
						new Request(`${origin}/api/v1/admin/dashboard?workspace=owner`),
						identity,
					),
			},
			{
				name: "GET /api/v1/operations/{id}",
				call: () =>
					handleReporting(
						new Request(`${origin}/api/v1/operations/${randomUUID()}`),
						identity,
						randomUUID(),
					),
			},
			{
				name: "GET /api/v1/admin/advertising/destinations",
				call: () =>
					handleAdvertisingDiagnostics(
						new Request(`${origin}/api/v1/admin/advertising/destinations`),
						identity,
					),
			},
			{
				name: "GET /api/v1/admin/shipping-label-templates",
				call: () =>
					handleShippingLabels(
						new Request(`${origin}/api/v1/admin/shipping-label-templates`),
						identity,
					),
			},
			{
				name: "GET /api/v1/admin/label-queue",
				call: () =>
					handleShippingLabels(
						new Request(`${origin}/api/v1/admin/label-queue`),
						identity,
					),
			},
			{
				name: "GET /api/v1/admin/commerce-exceptions",
				call: () =>
					handleCommerceExceptions(
						new Request(`${origin}/api/v1/admin/commerce-exceptions`),
						identity,
					),
			},
			{
				name: "GET /api/v1/admin/products",
				call: () =>
					handleCatalog(
						new Request(`${origin}/api/v1/admin/products`),
						identity,
					),
			},
			{
				name: "GET /api/v1/admin/inventory",
				call: () =>
					handleInventory(
						new Request(`${origin}/api/v1/admin/inventory`),
						identity,
					),
			},
			{
				name: "GET /api/v1/admin/shipping-promotions",
				call: () =>
					handlePromotions(
						new Request(`${origin}/api/v1/admin/shipping-promotions`),
						identity,
					),
			},
			{
				name: "GET /api/v1/admin/fulfillments",
				call: () =>
					handleFulfillment(
						new Request(`${origin}/api/v1/admin/fulfillments`),
						identity,
					),
			},
			{
				name: "GET /api/v1/admin/orders",
				call: () =>
					handleOrderHistory(
						new Request(`${origin}/api/v1/admin/orders`),
						identity,
					),
			},
			{
				name: "GET /api/v1/admin/policy-versions",
				call: () =>
					handleAccess(
						new Request(`${origin}/api/v1/admin/policy-versions`),
						identity,
					),
			},
			{
				name: "GET /api/v1/admin/returns",
				call: () =>
					handleReturns(
						new Request(`${origin}/api/v1/admin/returns`),
						identity,
					),
			},
		];

		for (const target of unauthTargets) {
			const res = await target.call();
			await assertProblemJson(res, 401);
		}

		// 2. Cross-role IAM isolation: Buyer calling Affiliate or Admin endpoints returns 403 Problem+JSON
		const buyerForbiddenTargets: Array<() => Promise<Response>> = [
			() =>
				handleCommissions(
					buyer.browser.request("/api/v1/me/affiliate/commissions"),
					identity,
				),
			() =>
				handlePayouts(
					buyer.browser.request("/api/v1/me/affiliate/payouts"),
					identity,
				),
			() =>
				handlePayouts(buyer.browser.request("/api/v1/admin/payouts"), identity),
			() =>
				handleSupport(
					buyer.browser.request("/api/v1/admin/support/conversations"),
					identity,
				),
			() =>
				handleReporting(
					buyer.browser.request("/api/v1/admin/dashboard?workspace=owner"),
					identity,
				),
			() =>
				handleAdvertisingDiagnostics(
					buyer.browser.request("/api/v1/admin/advertising/destinations"),
					identity,
				),
			() =>
				handleShippingLabels(
					buyer.browser.request("/api/v1/admin/shipping-label-templates"),
					identity,
				),
			() =>
				handleShippingLabels(
					buyer.browser.request("/api/v1/admin/label-queue"),
					identity,
				),
			() =>
				handleCommerceExceptions(
					buyer.browser.request("/api/v1/admin/commerce-exceptions"),
					identity,
				),
		];
		for (const call of buyerForbiddenTargets) {
			await assertProblemJson(await call(), 403);
		}

		// Affiliate calling Admin endpoints returns 403 Problem+JSON
		await assertProblemJson(
			await handlePayouts(
				affiliate.browser.request("/api/v1/admin/payouts"),
				identity,
			),
			403,
		);
		await assertProblemJson(
			await handleReporting(
				affiliate.browser.request("/api/v1/admin/dashboard?workspace=owner"),
				identity,
			),
			403,
		);

		// Staff without MFA calling Admin endpoints returns 403 Problem+JSON
		await assertProblemJson(
			await handleReporting(
				staffNoMfa.browser.request(
					"/api/v1/admin/dashboard?workspace=ecommerce_admin",
				),
				identity,
			),
			403,
		);
		await assertProblemJson(
			await handleSupport(
				staffNoMfa.browser.request("/api/v1/admin/support/conversations"),
				identity,
			),
			403,
		);
		await assertProblemJson(
			await handleShippingLabels(
				staffNoMfa.browser.request("/api/v1/admin/shipping-label-templates"),
				identity,
			),
			403,
		);

		// Cross-staff role separation: warehouse cannot read payouts or CS inbox; finance cannot read CS inbox
		await assertProblemJson(
			await handlePayouts(
				whStaff.browser.request("/api/v1/admin/payouts"),
				identity,
			),
			403,
		);
		await assertProblemJson(
			await handleSupport(
				whStaff.browser.request("/api/v1/admin/support/conversations"),
				identity,
			),
			403,
		);
		await assertProblemJson(
			await handleSupport(
				financeStaff.browser.request("/api/v1/admin/support/conversations"),
				identity,
			),
			403,
		);

		// 3. CSRF / Origin enforcement: mutating POST/PATCH/DELETE without valid Origin returns 403 Problem+JSON
		const crossOriginPost = (path: string, body: Record<string, unknown>) => {
			const req = owner.browser.request(path, body);
			req.headers.set("origin", "https://evil.example");
			req.headers.set("idempotency-key", randomUUID());
			return req;
		};
		await assertProblemJson(
			await handleAccounts(
				crossOriginPost("/api/v1/me/addresses", {
					label: "Rumah",
					recipient_name: "Budi",
					phone: "+6281234567890",
					address_line: "Jl. Ijen 1",
					destination_id: "test-malang",
					postal_code: "65111",
					is_default: true,
				}),
				identity,
			),
			403,
		);
		await assertProblemJson(
			await handleSupport(
				crossOriginPost("/api/v1/guest-support-sessions", {
					client_request_id: `req-${randomUUID()}`,
				}),
				identity,
			),
			403,
		);
		await assertProblemJson(
			await handleAffiliateProfile(
				crossOriginPost("/api/v1/me/affiliate", {
					terms_version: "v1",
				}),
				identity,
			),
			403,
		);
		await assertProblemJson(
			await handlePayouts(
				crossOriginPost(`/api/v1/admin/payouts/${randomUUID()}/claims`, {
					expected_version: 1,
				}),
				identity,
			),
			403,
		);
		await assertProblemJson(
			await handleReporting(
				crossOriginPost("/api/v1/admin/exports", {
					dataset: "orders",
					format: "csv",
				}),
				identity,
			),
			403,
		);
		await assertProblemJson(
			await handleAdvertisingDiagnostics(
				crossOriginPost(
					`/api/v1/admin/advertising/destinations/${randomUUID()}/pause`,
					{
						reason: "Cross-origin test",
					},
				),
				identity,
			),
			403,
		);
		await assertProblemJson(
			await handleShippingLabels(
				crossOriginPost("/api/v1/admin/shipping-label-templates", {
					name: "Evil Template",
					format: "thermal_100x150",
					privacy_mode: "masked_phone",
					brand_mode: "99ribu",
				}),
				identity,
			),
			403,
		);
		await assertProblemJson(
			await handleCommerceExceptions(
				crossOriginPost("/api/v1/admin/commerce-exceptions", {}),
				identity,
			),
			403,
		);

		// 4. Unsupported auth transport fail-closed (401 UNSUPPORTED_AUTH_TRANSPORT)
		const withBearer = (path: string, body?: Record<string, unknown>) => {
			const req = owner.browser.request(path, body);
			req.headers.set("authorization", "Bearer unissued-token");
			if (body !== undefined) req.headers.set("idempotency-key", randomUUID());
			return req;
		};
		await assertProblemJson(
			await handleAccounts(withBearer("/api/v1/me/profile"), identity),
			401,
			"UNSUPPORTED_AUTH_TRANSPORT",
		);
		await assertProblemJson(
			await handleAffiliateProfile(
				withBearer("/api/v1/me/affiliate"),
				identity,
			),
			401,
			"UNSUPPORTED_AUTH_TRANSPORT",
		);
		await assertProblemJson(
			await handleCommissions(
				withBearer("/api/v1/me/affiliate/commissions"),
				identity,
			),
			401,
			"UNSUPPORTED_AUTH_TRANSPORT",
		);
		await assertProblemJson(
			await handlePayouts(withBearer("/api/v1/admin/payouts"), identity),
			401,
			"UNSUPPORTED_AUTH_TRANSPORT",
		);
		await assertProblemJson(
			await handleReporting(
				withBearer("/api/v1/admin/dashboard?workspace=owner"),
				identity,
			),
			401,
			"UNSUPPORTED_AUTH_TRANSPORT",
		);
		await assertProblemJson(
			await handleAdvertisingDiagnostics(
				withBearer("/api/v1/admin/advertising/destinations"),
				identity,
			),
			401,
			"UNSUPPORTED_AUTH_TRANSPORT",
		);
		await assertProblemJson(
			await handleShippingLabels(
				withBearer("/api/v1/admin/shipping-label-templates"),
				identity,
			),
			401,
			"UNSUPPORTED_AUTH_TRANSPORT",
		);
		await assertProblemJson(
			await handleCommerceExceptions(
				withBearer("/api/v1/admin/commerce-exceptions"),
				identity,
			),
			401,
			"UNSUPPORTED_AUTH_TRANSPORT",
		);
		await assertProblemJson(
			await handleAccess(withBearer("/api/v1/me"), identity),
			401,
			"UNSUPPORTED_AUTH_TRANSPORT",
		);

		// 5. Authenticated response parity across newly implemented domain handlers
		const profileRes = await handleAccounts(
			buyer.browser.request("/api/v1/me/profile"),
			identity,
		);
		assert.equal(profileRes.status, 200);
		assert.equal(profileRes.headers.get("cache-control"), "no-store");
		const profileJson = (await profileRes.json()) as Record<string, unknown>;
		assert.equal(profileJson.id, buyer.id);

		const enrollAffReq = affiliate.browser.request("/api/v1/me/affiliate", {
			terms_version: "v1",
			referral_code: `PARITY-${randomUUID().slice(0, 8).toUpperCase()}`,
			beneficiary_bank_code: "BCA",
			beneficiary_account_number: "1234567890",
			beneficiary_account_holder: "Mitra Parity",
		});
		enrollAffReq.headers.set("idempotency-key", randomUUID());
		const enrollAffRes = await handleAffiliateProfile(enrollAffReq, identity);
		assert.equal(enrollAffRes.status, 201);
		assert.equal(enrollAffRes.headers.get("cache-control"), "no-store");

		const commRes = await handleCommissions(
			affiliate.browser.request("/api/v1/me/affiliate/commissions"),
			identity,
		);
		assert.equal(commRes.status, 200);
		assert.equal(commRes.headers.get("cache-control"), "no-store");

		const affPayoutsRes = await handlePayouts(
			affiliate.browser.request("/api/v1/me/affiliate/payouts"),
			identity,
		);
		assert.equal(affPayoutsRes.status, 200);
		assert.equal(affPayoutsRes.headers.get("cache-control"), "no-store");

		const adminPayoutsRes = await handlePayouts(
			financeStaff.browser.request("/api/v1/admin/payouts"),
			identity,
		);
		assert.equal(adminPayoutsRes.status, 200);
		assert.equal(adminPayoutsRes.headers.get("cache-control"), "no-store");

		const supportInboxRes = await handleSupport(
			csStaff.browser.request("/api/v1/admin/support/conversations"),
			identity,
		);
		assert.equal(supportInboxRes.status, 200);
		assert.equal(supportInboxRes.headers.get("cache-control"), "no-store");

		const ownerDashRes = await handleReporting(
			owner.browser.request("/api/v1/admin/dashboard?workspace=owner"),
			identity,
		);
		assert.equal(ownerDashRes.status, 200);
		assert.equal(ownerDashRes.headers.get("cache-control"), "no-store");

		const adDestRes = await handleAdvertisingDiagnostics(
			owner.browser.request("/api/v1/admin/advertising/destinations"),
			identity,
		);
		assert.equal(adDestRes.status, 200);
		assert.equal(adDestRes.headers.get("cache-control"), "no-store");

		const labelTplRes = await handleShippingLabels(
			owner.browser.request("/api/v1/admin/shipping-label-templates"),
			identity,
		);
		assert.equal(labelTplRes.status, 200);
		assert.equal(labelTplRes.headers.get("cache-control"), "no-store");

		const labelQueueRes = await handleShippingLabels(
			owner.browser.request("/api/v1/admin/label-queue?limit=1"),
			identity,
		);
		assert.equal(labelQueueRes.status, 200);
		assert.equal(labelQueueRes.headers.get("cache-control"), "no-store");
		for (const bad of ["cursor=abc", "limit=0", "limit=101", "sort=due_at"])
			await assertProblemJson(
				await handleShippingLabels(
					owner.browser.request(`/api/v1/admin/label-queue?${bad}`),
					identity,
				),
				400,
			);

		const excListRes = await handleCommerceExceptions(
			owner.browser.request("/api/v1/admin/commerce-exceptions"),
			identity,
		);
		assert.equal(excListRes.status, 200);
		assert.equal(excListRes.headers.get("cache-control"), "no-store");

		// S75/DEC-001: history filter accepts exactly the reachable order lifecycle.
		for (const status of ORDER_STATUSES) {
			const res = await handleOrderHistory(
				owner.browser.request(`/api/v1/admin/orders?status=${status}`),
				identity,
			);
			assert.equal(res.status, 200, `status=${status}`);
		}
		for (const status of ["preparing", "confirmed", "completed"]) {
			await assertProblemJson(
				await handleOrderHistory(
					owner.browser.request(`/api/v1/admin/orders?status=${status}`),
					identity,
				),
				400,
			);
		}

		// Public storefront / signals / receipt parity checks
		const sfRes = await handleStorefront(
			new Request(`${origin}/api/v1/products`),
			identity,
		);
		assert.equal(sfRes.status, 200);

		for (const res of [
			await handleOrderReceipt(
				new Request(`${origin}/api/v1/orders/${randomUUID()}/receipt`),
				identity,
			),
			await handleCheckout(
				new Request(`${origin}/api/v1/orders/${randomUUID()}`),
				identity,
			),
			await handlePayments(
				new Request(
					`${origin}/api/v1/orders/${randomUUID()}/payment-attempts`,
					{
						method: "POST",
						headers: {
							origin,
							"content-type": "application/json",
							"idempotency-key": randomUUID(),
						},
						body: JSON.stringify({ method_id: "local-prepaid" }),
					},
				),
				identity,
			),
			await handleCodCollections(
				new Request(`${origin}/api/v1/orders/${randomUUID()}/cod-collections`),
				identity,
			),
		]) {
			assert.ok(
				res.status === 401 || res.status === 404,
				`Expected 401 or 404, got ${res.status}`,
			);
			await assertProblemJson(res, res.status);
		}
		await assertProblemJson(
			await handleSignals(
				new Request(`${origin}/api/v1/visitor-sessions`, {
					method: "POST",
					headers: {
						origin: "https://evil.example",
						"content-type": "application/json",
					},
					body: JSON.stringify({ client_request_id: randomUUID() }),
				}),
				identity,
			),
			403,
		);
	} finally {
		await identity.sql`delete from app.buyer_profile where user_id = ${buyer.id}`;
		await cleanup(identity, [
			owner,
			whStaff,
			csStaff,
			financeStaff,
			staffNoMfa,
			buyer,
		]);
		await identity.sql`delete from app.warehouse where id = ${warehouseA}`;
		await identity.sql.end();
	}
});
