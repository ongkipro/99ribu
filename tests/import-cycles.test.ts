import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

// S114 guard: relative-import cycles among src/**/*.ts(x). The cycles that exist today are frozen below; a new cycle,
// or a known one gaining a file (a self-import included), fails. Breaking a cycle means deleting its entry here (the test then keeps it broken).
const KNOWN: readonly (readonly string[])[] = [
	["src/modules/access/auth.ts", "src/modules/access/http.ts", "src/modules/access/policy.ts", "src/modules/access/rate-limit.ts", "src/modules/access/signin-budget.ts", "src/modules/checkout/access.ts"],
	["src/modules/shipping/contribution.ts", "src/modules/shipping/quotes.ts"],
	["src/modules/affiliates/profile.ts", "src/modules/commissions/jobs.ts", "src/modules/commissions/service.ts", "src/modules/payouts/service.ts"],
	["src/modules/returns/cases.ts", "src/modules/returns/occurrences.ts", "src/modules/returns/replacement-receipts.ts"],
	["src/modules/storefront/checkout-draft.ts", "src/modules/storefront/checkout.ts"],
	// The money-path cycle (checkout exceptions, orders, finance settlements, fulfillment); breaking it is R4 work.
	[
		"src/modules/checkout/exceptions/collection-cases.ts",
		"src/modules/checkout/exceptions/collection.ts",
		"src/modules/checkout/exceptions/core.ts",
		"src/modules/checkout/exceptions/policy.ts",
		"src/modules/checkout/exceptions/stock-policy.ts",
		"src/modules/checkout/exceptions/stock.ts",
		"src/modules/checkout/orders.ts",
		"src/modules/finance/settlements/receivables.ts",
		"src/modules/fulfillment/cancellation-source.ts",
		"src/modules/fulfillment/commands.ts",
		"src/modules/fulfillment/core.ts",
		"src/modules/fulfillment/manual.ts",
		"src/modules/payments/attempts.ts",
		"src/modules/payments/autolaris-live.ts",
		"src/modules/payments/autolaris.ts",
		"src/modules/payments/cod-local.ts",
		"src/modules/payments/cod.ts",
		"src/modules/payments/local.ts",
		"src/modules/returns/financial-basis.ts",
		"src/modules/returns/receipt-source.ts",
		"src/modules/returns/replacement-core.ts",
	],
];

function cycles() {
	const root = resolve(".");
	const files: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(ts|tsx)$/.test(name)) files.push(resolve(path));
		}
	};
	walk(join(root, "src"));
	const known = new Set(files);
	const graph = new Map<string, string[]>();
	for (const file of files) {
		const deps: string[] = [];
		// TypeScript's own pre-processor: comments and strings are handled; static, side-effect, re-export, type-only
		// and dynamic imports all count (type-only on purpose: a structural cycle, even if erased at runtime).
		for (const { fileName } of ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles) {
			if (!fileName.startsWith(".")) continue;
			const target = resolve(dirname(file), fileName);
			const bare = target.replace(/\.js$/, "");
			const hit = [target, `${bare}.ts`, `${bare}.tsx`, join(target, "index.ts"), join(target, "index.tsx")].find((candidate) => known.has(candidate));
			if (hit) deps.push(hit);
		}
		graph.set(file, deps);
	}
	// Tarjan's strongly connected components; every component with more than one file is a cycle.
	const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], onStack = new Set<string>(), found: string[][] = [];
	let next = 0;
	const visit = (v: string) => {
		index.set(v, next); low.set(v, next); next++; stack.push(v); onStack.add(v);
		for (const w of graph.get(v) ?? []) {
			if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v) as number, low.get(w) as number)); }
			else if (onStack.has(w)) low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
		}
		if (low.get(v) === index.get(v)) {
			const component: string[] = [];
			let w: string;
			do { w = stack.pop() as string; onStack.delete(w); component.push(relative(root, w)); } while (w !== v);
			if (component.length > 1 || (graph.get(v) ?? []).includes(v)) found.push(component.sort());
		}
	};
	for (const file of files) if (!index.has(file)) visit(file);
	return found;
}

test("import cycles in src are exactly the frozen list (S114 ratchet)", () => {
	const key = (cycle: readonly string[]) => [...cycle].sort().join(" -> ");
	const found = cycles().map(key).sort();
	// New, grown, shrunk or broken cycles all fail: update KNOWN deliberately (a broken cycle is removed from it).
	assert.deepEqual(found, KNOWN.map(key).sort());
});
