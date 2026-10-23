import { existsSync } from "node:fs";
import { advanceFixtureClock, readFixtureClock, readFixtureInbox, seedLocal } from "../src/modules/local/fixtures.ts";

const [command, target, namespace, ...args] = process.argv.slice(2);
const usage = "Use fixture seed|commerce|storefront|berlapak|clock|inbox local|test namespace; payment-terms|commercial-terms local namespace; demo-orders local [namespace]; clock advance needs seconds/version; inbox needs principal ID; local-only accounts: login|login-codes local, prune-accounts local [--apply]. No reset command exists.";
const accountCommand = ["login", "login-codes", "prune-accounts"].includes(command);
const demoCommand = command === "demo-orders";
if ((!namespace && !accountCommand && !demoCommand) || !["local", "test"].includes(target) || !["demo-orders", "seed", "commerce", "storefront", "berlapak", "payment-terms", "commercial-terms", "clock", "inbox", "login", "login-codes", "prune-accounts"].includes(command)) {
  console.error(usage); process.exitCode = 1;
} else {
  const selected = target as "local" | "test";
  try {
    const flags = [namespace, ...args].filter((value) => value !== undefined);
    if (accountCommand) {
      // Local dummy accounts: credentials/TOTP go to stdout only; the module refuses every non-local target.
      if (flags.length > (command === "prune-accounts" ? 1 : 0) || flags.some((flag) => flag !== "--apply")) throw new Error(usage, { cause: "visible" });
      const {provisionLocalAccounts,localAccountCodes,pruneLocalAccounts}=await import("../src/modules/local/logins.ts");
      console.log(JSON.stringify(command === "login" ? await provisionLocalAccounts(target) : command === "login-codes" ? await localAccountCodes(target) : await pruneLocalAccounts(target, flags[0] === "--apply"), null, 2));
    }
    else if (demoCommand) {
      // Local-only demo orders through the real flows; the summary table prints no IDs, tokens or credentials.
      if (target !== "local" || args.length) throw new Error(usage, { cause: "visible" });
      const {runDemoOrders,formatDemoSummary}=await import("../src/modules/local/demo-orders.ts");
      console.log(formatDemoSummary(await runDemoOrders("local", namespace ?? "demo-orders")));
    }
    else if (command === "seed" && !args.length) console.log(JSON.stringify(await seedLocal(selected, namespace)));
    else if ((command === "commerce" || command === "storefront") && !args.length) {
      const {runCommerceFixture}=await import("../src/modules/local/seed-runtime.ts");
      console.log(JSON.stringify(await runCommerceFixture(selected,namespace,command==="storefront")));
    }
    else if (command === "berlapak" && !args.length) {
      const directory = process.env.BERLAPAK_DATA_DIR || "/data/99ribu-berlapak-data";
      if (!existsSync(`${directory}/data-json`) || !existsSync(`${directory}/images`)) throw new Error(`Berlapak data directory not found: ${directory}. Set BERLAPAK_DATA_DIR.`, { cause: "visible" });
      const {runBerlapakFixture}=await import("../src/modules/local/seed-runtime.ts");
      console.log(JSON.stringify(await runBerlapakFixture(selected,namespace)));
    }
    else if ((command === "payment-terms" || command === "commercial-terms") && target === "local" && !args.length) {
      const {runPaymentTermsFixture,runCommercialTermsFixture}=await import("../src/modules/local/seed-runtime.ts");
      console.log(JSON.stringify(await (command === "payment-terms" ? runPaymentTermsFixture : runCommercialTermsFixture)("local",namespace)));
    }
    else if (command === "clock" && !args.length) console.log(JSON.stringify(await readFixtureClock(selected, namespace)));
    else if (command === "clock" && args.length === 3 && args[0] === "advance" && args.slice(1).every((v) => /^[1-9][0-9]*$/.test(v))) {
      console.log(JSON.stringify(await advanceFixtureClock(selected, namespace, Number(args[1]), Number(args[2]))));
    } else if (command === "inbox" && args.length === 1) {
      const messages = await readFixtureInbox(selected, namespace, args[0]);
      console.log(JSON.stringify({ messages: messages.map(({ id, kind, expiresAt }) => ({ id, kind, expiresAt })) }));
    } else { console.error(usage); process.exitCode = 1; }
  } catch (error) {
    if (error instanceof Error && error.cause === "visible") console.error(error.message);
    console.error("Local fixture command refused or failed; verify profile, namespace, migrations and clock version. No private values disclosed.");
    process.exitCode ??= 1;
  }
}
