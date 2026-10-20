import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, lstat, symlink, unlink, mkdtemp, mkdir, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { privateDirectory } from "../src/config/local.ts";
import { readPrivateArtifact, savePrivateArtifact } from "../src/storage/private.ts";

test("private artifacts round-trip with owner-only permissions", async (t) => {
  const bytes = new TextEncoder().encode("synthetic receipt, not customer data");
  const id = await savePrivateArtifact(bytes);
  const path = join(privateDirectory("artifacts"), id);
  t.after(() => unlink(path));
  assert.deepEqual(await readPrivateArtifact(id), Buffer.from(bytes));
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  assert.equal((await lstat(privateDirectory("artifacts"))).mode & 0o777, 0o700);
});

test("private artifact paths refuse traversal and missing identifiers", async () => {
  for (const id of ["../README.md", "../../.env", "", "/etc/passwd", "receipt.pdf"]) {
    await assert.rejects(readPrivateArtifact(id), /Invalid private artifact/);
  }
  await assert.rejects(readPrivateArtifact(randomUUID()), { code: "ENOENT" });
});

test("private reads refuse a symlink and a file with broadened permissions", async (t) => {
  const id = await savePrivateArtifact(new Uint8Array([1, 2, 3]));
  const path = join(privateDirectory("artifacts"), id);
  const link = join(privateDirectory("artifacts"), randomUUID());
  t.after(async () => { await unlink(link); await unlink(path); });
  await symlink(path, link);
  await assert.rejects(readPrivateArtifact(link.split("/").at(-1) ?? ""), { code: "ELOOP" });
  await chmod(path, 0o644);
  await assert.rejects(readPrivateArtifact(id), /permissions are invalid/);
});

test("storage refuses an accessible or symlinked private root", async () => {
  const original = process.cwd();
  const scratch = await mkdtemp(join(tmpdir(), "99ribu-storage-"));
  try {
    process.chdir(scratch);
    await mkdir(".local", { mode: 0o755 });
    assert.throws(() => privateDirectory("artifacts"), /owner-only/);
    await rmdir(".local");
    await mkdir("outside", { mode: 0o700 });
    await symlink(join(scratch, "outside"), ".local");
    assert.throws(() => privateDirectory("artifacts"), /owner-only/);
    await unlink(".local");
    await rmdir("outside");
  } finally {
    process.chdir(original);
    await rmdir(scratch);
  }
});
