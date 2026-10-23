import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

// S84 image content audit, run inside the built image:
//   docker run --rm --entrypoint node <image> scripts/image-audit.ts
// Fails when private or test-only material is present anywhere on the image filesystem, or when .local
// holds anything but the empty volume mount points. System CA bundles under /etc/ssl and /usr/share are
// not application material and are skipped.
const forbidden = [
  /\.key$/, /\.pem$/, /(^|\/)\.env/, /(^|\/)\.delivery(\/|$)/, /(^|\/)tests?\//, /\.test\.[cm]?[jt]s$/,
  /\/public\/prototypes(\/|$)/, /\/public\/catalog-local(\/|$)/, /localhost-commerce\.json$/, /\/scripts\/check-tests\.ts$/,
  /\/docs\/(?!spec\/fixtures\/shipping-local\.json$)/, /\/design\//,
];
const skip = new Set(["/proc", "/sys", "/dev", "/etc/ssl", "/usr/share", "/usr/lib/ssl"]);
const app = "/app/";
const findings: string[] = [];
function walk(path: string) {
  if (skip.has(path)) return;
  let names: string[];
  try { names = readdirSync(path); } catch { return; }
  for (const name of names) {
    const child = join(path, name);
    const stat = lstatSync(child);
    // Third-party packages ship their own test folders and sample keys; only the app tree is audited for those.
    const inApp = child.startsWith(app) && !child.startsWith(`${app}node_modules/`);
    if (inApp && !stat.isDirectory() && forbidden.some((pattern) => pattern.test(child))) findings.push(child);
    else if (!inApp && /\.(?:key|pem)$|(^|\/)\.env/.test(name) && !child.startsWith(`${app}node_modules/`)) findings.push(child);
    if (child.startsWith(`${app}.local/`) && !(stat.isDirectory() && ["/app/.local/catalog-media", "/app/.local/artifacts"].includes(child))) findings.push(child);
    if (stat.isDirectory() && !stat.isSymbolicLink()) walk(child);
  }
}
walk("/");
const owner = lstatSync("/app/.local");
console.log(JSON.stringify({ findings, local: { uid: owner.uid, mode: (owner.mode & 0o7777).toString(8) }, uid: process.getuid?.() }));
process.exitCode = findings.length ? 1 : 0;
