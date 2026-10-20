import { advanceFixtureClock, readFixtureClock, readFixtureInbox, seedLocal } from "../src/modules/local/fixtures.ts";

const [command, target, namespace, ...args] = process.argv.slice(2);
const usage = "Use fixture seed|commerce|storefront|clock|inbox local|test namespace; clock advance needs seconds/version; inbox needs principal ID. No reset command exists.";
if (!namespace || !["local", "test"].includes(target) || !["seed", "commerce", "storefront", "clock", "inbox"].includes(command)) {
  console.error(usage); process.exitCode = 1;
} else {
  const selected = target as "local" | "test";
  try {
    if (command === "seed" && !args.length) console.log(JSON.stringify(await seedLocal(selected, namespace)));
    else if ((command === "commerce" || command === "storefront") && !args.length) {
      const {runCommerceFixture}=await import("../tests/integration/commerce-fixture-runtime.ts");
      console.log(JSON.stringify(await runCommerceFixture(selected,namespace,command==="storefront")));
    }
    else if (command === "clock" && !args.length) console.log(JSON.stringify(await readFixtureClock(selected, namespace)));
    else if (command === "clock" && args.length === 3 && args[0] === "advance" && args.slice(1).every((v) => /^[1-9][0-9]*$/.test(v))) {
      console.log(JSON.stringify(await advanceFixtureClock(selected, namespace, Number(args[1]), Number(args[2]))));
    } else if (command === "inbox" && args.length === 1) {
      const messages = await readFixtureInbox(selected, namespace, args[0]);
      console.log(JSON.stringify({ messages: messages.map(({ id, kind, expiresAt }) => ({ id, kind, expiresAt })) }));
    } else { console.error(usage); process.exitCode = 1; }
  } catch {
    console.error("Local fixture command refused or failed; verify profile, namespace, migrations and clock version. No private values disclosed.");
    process.exitCode ??= 1;
  }
}
