import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localSigningKey } from "../src/modules/access/local-key.ts";

test("local signing material is private, stable, separated by target and never replaced on corruption", () => {
  const previous = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), "99ribu-auth-key-"));
  process.chdir(directory);
  try {
    const first = localSigningKey("test");
    assert.ok(first === localSigningKey("test"));
    assert.ok(first !== localSigningKey("local"));
    assert.equal(statSync(".local/auth/test.key").mode & 0o7777, 0o600);
    assert.equal(statSync(".local/auth").mode & 0o7777, 0o700);
    chmodSync(".local/auth/test.key", 0o644);
    assert.throws(() => localSigningKey("test"), /must remain private/);
    chmodSync(".local/auth/test.key", 0o600);
    writeFileSync(".local/auth/test.key", "invalid-synthetic-fixture");
    assert.throws(() => localSigningKey("test"), /recovery is required/);
    assert.ok(readFileSync(".local/auth/test.key", "utf8") === "invalid-synthetic-fixture");
  } finally {
    unlinkSync(".local/auth/test.key"); unlinkSync(".local/auth/local.key");
    rmdirSync(".local/auth"); rmdirSync(".local");
    process.chdir(previous); rmdirSync(directory);
  }
});
