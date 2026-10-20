import { randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { privateDirectory, readLocalConfig } from "../../config/local.ts";

// Runtime-owned local signing material. Never print, return through HTTP, or replace on failure.
export function localSigningKey(target: "local" | "test") {
  readLocalConfig(process.env);
  if (!["local", "test"].includes(target)) throw new Error("Unknown local identity target.");
  const path = join(privateDirectory("auth"), `${target}.key`);
  try {
    const fd = openSync(path, "wx", 0o600);
    try { writeFileSync(fd, randomBytes(48).toString("base64url")); }
    finally { closeSync(fd); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== 0o600) {
      throw new Error("Local identity material must remain private.");
    }
    const key = readFileSync(fd, "utf8");
    if (!/^[A-Za-z0-9_-]{64}$/.test(key)) throw new Error("Local identity material is invalid; recovery is required.");
    return key;
  } finally { closeSync(fd); }
}
