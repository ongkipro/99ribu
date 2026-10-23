import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, symlink, unlink, mkdtemp, mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { privateDirectory } from "../src/config/local.ts";
import { catalogMediaFileName, serveCatalogMedia } from "../src/storage/catalog-media.ts";
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

test("catalog media file names use the product slug and the first 12 hex of the hash", () => {
  const sha = createHash("sha256").update("photo").digest("hex");
  assert.equal(catalogMediaFileName("Set Pisau Dapur 6 in 1", sha), `set-pisau-dapur-6-in-1-${sha.slice(0, 12)}.webp`);
  assert.equal(catalogMediaFileName("Krim Wajah Él – 30 ml!", sha), `krim-wajah-el-30-ml-${sha.slice(0, 12)}.webp`);
  assert.equal(catalogMediaFileName(`${"x".repeat(79)} yz`, sha), `${"x".repeat(79)}-${sha.slice(0, 12)}.webp`, "slug is sliced to 80 and trimmed");
  for (const title of ["", "  ", "!!!", "\u0301\u0301"]) assert.equal(catalogMediaFileName(title, sha), `${sha.slice(0, 12)}.webp`, `empty slug for ${JSON.stringify(title)}`);
  for (const bad of ["", sha.slice(0, 63), sha.toUpperCase(), `${sha}0`, `${sha.slice(0, 63)}g`, `../${sha.slice(3)}`]) {
    assert.throws(() => catalogMediaFileName("Foto", bad), /64 lowercase hex/);
  }
});

test("catalog media resolves SEO and legacy names by unique hash prefix, with safe headers", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "99ribu-catalog-media-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = new TextEncoder().encode(`synthetic photo ${randomUUID()}`);
  const sha = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(directory, `${sha}.webp`), bytes, { mode: 0o600 });
  // Two crafted names sharing one 12-hex prefix: the prefix is ambiguous, so neither public name resolves.
  const shared = "abcdefabcdef";
  for (const tail of ["0".repeat(52), "1".repeat(52)]) await writeFile(join(directory, `${shared}${tail}.webp`), "x", { mode: 0o600 });
  const serve = (name: string) => serveCatalogMedia(name, { directory });
  for (const name of [catalogMediaFileName("Set Pisau Dapur", sha), catalogMediaFileName("", sha), `${sha}.webp`, `lama-${sha.slice(0, 12)}.webp`]) {
    const response = await serve(name);
    assert.equal(response.status, 200, name);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(bytes));
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
    assert.equal(response.headers.get("content-disposition"), "inline");
  }
  const p = sha.slice(0, 12);
  for (const name of [
    `foto-${shared}.webp`, `${shared}.webp`, `x-${shared}${"0".repeat(52)}.webp`,
    `foto-${p.slice(0, 11)}.webp`, `foto-${sha.slice(0, 13)}.webp`, `foto-${p.toUpperCase()}.webp`, `Foto-${p}.webp`, `${sha.toUpperCase()}.webp`,
    `foto--${p}.webp`, `-foto-${p}.webp`, `foto-${p}.png`, `foto-${p}.webp.webp`, `${"a".repeat(81)}-${p}.webp`,
    `../${sha}.webp`, `foto/${p}.webp`, `foto%2F${p}.webp`, `.${sha}.webp`, `${"f".repeat(12)}.webp`, "", ".webp",
  ]) {
    const response = await serve(name);
    assert.equal(response.status, 404, name);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  // A tampered file (bytes no longer hash to its name) is not served under any name.
  const tampered = createHash("sha256").update("other").digest("hex");
  await writeFile(join(directory, `${tampered}.webp`), "not the hashed bytes", { mode: 0o600 });
  assert.equal((await serve(catalogMediaFileName("Foto", tampered))).status, 404);
  assert.equal((await serve(`${tampered}.webp`)).status, 404);
});
