// S86 staff operator commands, production only. Run inside the deployed web container with a TTY, e.g.
//   docker exec -it <web container> node scripts/staff.ts bootstrap-owner production
// bootstrap-owner: the first owner from an operator-typed name, real email and password (never echoed), then TOTP
//   enrolment (the URI and backup codes are shown once on this terminal). Refused when any owner exists.
// enroll-mfa: TOTP enrolment for an existing staff account that has none (an interrupted bootstrap, a new staff member).
// Further staff come from the owner's role grants in the console. Local accounts stay with `fixture -- login local`.
import { createLocalAuth } from "../src/modules/access/auth.ts";
import { bootstrapOwner, ownerInput, startEnrollment } from "../src/modules/access/operator.ts";
import { AccessError } from "../src/modules/access/policy.ts";
import { operatorPrompt } from "../src/ops/prompt.ts";

const [command, target, ...extra] = process.argv.slice(2);
const usage = "Use: staff.ts bootstrap-owner production | staff.ts enroll-mfa production";
if (!["bootstrap-owner", "enroll-mfa"].includes(command) || target !== "production" || extra.length) {
  console.error(usage);
  process.exit(1);
}
const input = operatorPrompt();
let userId: string | null = null;
const identity = createLocalAuth("production");
try {
  let email: string, password: string;
  if (command === "bootstrap-owner") {
    const name = await input.ask("Owner name: ");
    email = await input.ask("Owner email: ");
    password = await input.ask("Password (12-128 characters): ", true);
    if (password !== await input.ask("Repeat password: ", true)) throw new AccessError(400, "PASSWORD_MISMATCH");
    ownerInput(name, email, password);
    userId = await bootstrapOwner(identity, { name, email, password });
    input.say("Owner created. Enrol two-step verification now.");
  } else {
    email = await input.ask("Staff email: ");
    password = await input.ask("Password: ", true);
  }
  const { setup, verify, end } = await startEnrollment(identity, email, password);
  input.say(`\nAdd this account to an authenticator app (scan or enter the key):\n  ${setup.totpURI}\n  key: ${new URL(setup.totpURI).searchParams.get("secret")}`);
  input.say(`Backup codes (store offline; each works once):\n  ${setup.backupCodes.join("  ")}\n`);
  let verified = false;
  try {
    for (let attempt = 0; attempt < 3 && !verified; attempt++) verified = await verify(await input.ask("6-digit code from the app: "));
  } finally { await end(); }
  if (!verified) throw new AccessError(401, "MFA_VERIFY_REJECTED");
  console.log(JSON.stringify({ command, target, ...(userId ? { owner_created: true } : {}), mfa_enrolled: true }));
} catch (error) {
  if (error instanceof AccessError) console.error(`Refused: ${error.code}.`);
  else if (error instanceof Error && error.cause === "visible") console.error(error.message);
  else console.error("Staff command failed; check the database target and migrations. No private values disclosed.");
  // The owner exists but two-step is not enrolled yet: bootstrap would now answer OWNER_EXISTS.
  if (userId || (error instanceof AccessError && error.code === "MFA_VERIFY_REJECTED")) console.error("Finish two-step enrolment with `node scripts/staff.ts enroll-mfa production`.");
  process.exitCode = 1;
} finally {
  input.close();
  await identity.sql.end();
}
