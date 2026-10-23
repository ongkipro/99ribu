import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

// S84 image content audit, run inside the built image:
//   docker run --rm --entrypoint node <image> scripts/image-audit.ts
// Fails when private or test-only material is present anywhere on the image filesystem, when .local
// holds anything but the empty volume mount points, or when those are not uid 10001 with mode 0700.
// System CA bundles under /etc/ssl and /usr/share are not application material and are skipped.
export const RUNTIME_UID = 10001;
export const VOLUME_DIRECTORIES = ["/app/.local", "/app/.local/catalog-media", "/app/.local/artifacts"];
const appForbidden = [
  /\.key$/, /\.pem$/, /(^|\/)\.env/, /(^|\/)\.delivery(\/|$)/, /(^|\/)tests?\//, /\.test\.[cm]?[jt]s$/,
  /\/public\/prototypes(\/|$)/, /\/public\/catalog-local(\/|$)/, /localhost-commerce\.json$/, /\/scripts\/check-tests\.ts$/,
  /\/docs\/(?!spec\/fixtures\/shipping-local\.json$)/, /\/design\//,
];
const anywhereForbidden = /\.(?:key|pem)$|(^|\/)\.env/;
const skip = new Set(["/proc", "/sys", "/dev", "/etc/ssl", "/usr/share", "/usr/lib/ssl"]);

// Is this non-directory path a finding? Third-party packages under /app/node_modules ship their own test
// folders and sample keys and are not audited; elsewhere only keys/.env files are.
export function forbiddenFile(path: string) {
  if (path.startsWith("/app/node_modules/")) return false;
  if (path.startsWith("/app/.local/")) return true;
  if (path.startsWith("/app/")) return appForbidden.some((pattern) => pattern.test(path));
  return anywhereForbidden.test(path);
}

export function audit(root = "/") {
  const findings: string[] = [];
  const walk = (path: string) => {
    if (skip.has(path)) return;
    let names: string[];
    try { names = readdirSync(path); } catch { return; }
    for (const name of names) {
      const child = join(path, name);
      const stat = lstatSync(child);
      const directory = stat.isDirectory() && !stat.isSymbolicLink();
      if (!directory && forbiddenFile(child)) findings.push(child);
      if (directory && child.startsWith("/app/.local/") && !VOLUME_DIRECTORIES.includes(child)) findings.push(child);
      if (directory) walk(child);
    }
  };
  walk(root);
  for (const path of VOLUME_DIRECTORIES) {
    let stat: ReturnType<typeof lstatSync> | undefined;
    try { stat = lstatSync(path, { throwIfNoEntry: false }); } catch { stat = undefined; } // unreadable = wrong owner
    if (!stat?.isDirectory() || stat.uid !== RUNTIME_UID || stat.gid !== RUNTIME_UID || (stat.mode & 0o7777) !== 0o700) findings.push(`${path} (must be a ${RUNTIME_UID}:${RUNTIME_UID} 0700 directory)`);
  }
  if (process.getuid?.() !== RUNTIME_UID) findings.push(`process uid ${process.getuid?.()} (image USER must be ${RUNTIME_UID})`);
  return findings;
}

if (import.meta.main) {
  const findings = audit();
  console.log(JSON.stringify({ findings }));
  process.exitCode = findings.length ? 1 : 0;
}
