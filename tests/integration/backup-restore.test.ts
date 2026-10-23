import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { symmetricEncrypt } from "better-auth/crypto";
import { privateDirectory } from "../../src/config/local.ts";
import { connectDatabase } from "../../src/db/client.ts";
import { localSigningKey } from "../../src/modules/access/local-key.ts";
import { parseManifest } from "../../src/ops/backup.ts";
import { saveCatalogMedia } from "../../src/storage/catalog-media.ts";

// S85 CODE: backup set + restore drill against the shared test database. Every restore goes into a
// fresh 99ribu_restore_<uuid> database that the drill drops; the store, keys and restored volume live
// in a temporary directory. The seeded staff factor and photo are synthetic and removed afterwards.

const { sql } = connectDatabase("test");
let root = "";
let photoPath: string | null = null;
const users: string[] = [];
let publicKey = "";

function backup(args: string[], store: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn(process.execPath, ["scripts/backup.ts", ...args], {
      env: { ...process.env, BACKUP_STORE: `file://${store}`, BACKUP_ESCROW_PUBLIC_KEY: publicKey },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}
const restoreDatabases = async () => (await sql<{ datname: string }[]>`select datname from pg_database where datname like '99ribu\_restore\_%' order by 1`).map((row) => row.datname);

async function staffFactor(key: string) {
  const id = `backup-drill-${randomUUID()}`;
  users.push(id);
  await sql`insert into app.auth_user (id, name, email, email_verified, two_factor_enabled) values (${id}, 'Backup drill staff', ${`${id}@example.invalid`}, true, true)`;
  await sql`insert into app.auth_two_factor (id, secret, backup_codes, user_id, verified)
    values (${randomUUID()}, ${await symmetricEncrypt({ key, data: randomBytes(16).toString("hex") })}, ${await symmetricEncrypt({ key, data: JSON.stringify(["synthetic-code"]) })}, ${id}, true)`;
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "99ribu-backup-it-"));
  const pair = generateKeyPairSync("rsa", { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  publicKey = pair.publicKey;
  await writeFile(join(root, "escrow.pem"), pair.privateKey, { mode: 0o600 });
  await writeFile(join(root, "other.pem"), generateKeyPairSync("rsa", { modulusLength: 3072, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey, { mode: 0o600 });
  await staffFactor(localSigningKey("test"));
  // One clean synthetic WebP in the shared media store (removed afterwards only if this test created it).
  const header = Buffer.alloc(30);
  header.write("RIFF", 0, "latin1"); header.writeUInt32LE(22, 4); header.write("WEBPVP8X", 8, "latin1"); header.writeUInt32LE(10, 16);
  header.writeUIntLE(799, 24, 3); header.writeUIntLE(799, 27, 3);
  const saved = await saveCatalogMedia(Buffer.concat([header, randomBytes(16)]));
  if (saved.created) photoPath = join(privateDirectory("catalog-media"), saved.name);
});

after(async () => {
  try {
    for (const id of users) await sql`delete from app.auth_user where id = ${id}`;
    if (photoPath) await unlink(photoPath);
    await rm(root, { recursive: true, force: true });
  } finally {
    await sql.end();
  }
});

test("S85 backup set holds database, globals, media/artifacts and the escrowed auth secret with a checksum manifest; the drill restores it into a disposable database and verifies counts, ledger, photos and staff TOTP", async () => {
  const before = await restoreDatabases();
  const created = await backup(["create", "test"], join(root, "store"));
  assert.equal(created.code, 0, created.stderr);
  const summary = JSON.parse(created.stdout);
  assert.match(summary.backup, /^\d{8}T\d{6}Z$/);
  const manifest = parseManifest(await readFile(join(root, "store", summary.backup, "manifest.json")));
  assert.equal(manifest.target, "test");
  assert.equal(manifest.database.name, "99ribu_test");
  assert.ok(manifest.database.tables["app.auth_two_factor"] >= 1);
  assert.ok(manifest.database.tables["app.finance_posting"] >= 0);
  assert.ok(manifest.files.some((file) => file.path.startsWith("catalog-media/") && file.path.endsWith(".webp")));
  assert.ok(manifest.files.every((file) => !file.path.startsWith("auth/") && !file.path.includes("pgsocket")));
  const escrow = await readFile(join(root, "store", summary.backup, "auth-escrow.bin"));
  assert.ok(!escrow.includes(Buffer.from(localSigningKey("test"))), "the auth secret is stored only encrypted");
  assert.ok(!(await readFile(join(root, "store", summary.backup, "globals.sql"), "utf8")).includes("SCRAM-SHA-256$"), "role passwords are excluded");

  const drill = await backup(["drill", "latest", "--escrow-private-key", join(root, "escrow.pem")], join(root, "store"));
  assert.equal(drill.code, 0, drill.stderr);
  const result = JSON.parse(drill.stdout);
  assert.equal(result.drill, "PASS");
  assert.equal(result.backup, summary.backup);
  assert.equal(result.rows, Object.values(manifest.database.tables).reduce((sum, n) => sum + n, 0));
  assert.equal(result.unbalanced_journals, 0);
  assert.ok(result.totp_factors >= 1);
  assert.ok(result.photos >= 1);
  assert.equal(result.files, manifest.files.length);
  assert.deepEqual(await restoreDatabases(), before, "the disposable restore database is dropped");

  // Real volume restore path: verified extraction into a new directory only.
  const extracted = await backup(["extract", summary.backup, join(root, "volume")], join(root, "store"));
  assert.equal(extracted.code, 0, extracted.stderr);
  assert.equal(JSON.parse(extracted.stdout).files, manifest.files.length);
  const photo = manifest.files.find((file) => file.path.startsWith("catalog-media/"));
  assert.ok(photo);
  assert.equal(createHash("sha256").update(await readFile(join(root, "volume", photo.path))).digest("hex"), photo.sha256);
  const again = await backup(["extract", summary.backup, join(root, "volume")], join(root, "store"));
  assert.notEqual(again.code, 0);
  assert.match(again.stderr, /must not exist yet/);
});

test("S85 drill refuses a tampered archive and a wrong escrow key before restoring anything", async () => {
  const before = await restoreDatabases();
  const tampered = join(root, "tampered");
  await cp(join(root, "store"), tampered, { recursive: true });
  const [id] = JSON.parse((await backup(["list"], tampered)).stdout).complete;
  const archive = join(tampered, id, "files.tar");
  const bytes = await readFile(archive);
  bytes[bytes.length - 1100] ^= 1;
  await writeFile(archive, bytes);
  const broken = await backup(["drill", id, "--escrow-private-key", join(root, "escrow.pem")], tampered);
  assert.notEqual(broken.code, 0);
  assert.match(broken.stderr, /files\.tar does not match its manifest checksum/);

  const wrongKey = await backup(["drill", "latest", "--escrow-private-key", join(root, "other.pem")], join(root, "store"));
  assert.notEqual(wrongKey.code, 0);
  assert.match(wrongKey.stderr, /escrow private key cannot open/);
  assert.deepEqual(await restoreDatabases(), before);
});

test("S85 drill fails when a restored staff TOTP secret does not decrypt with the escrowed BETTER_AUTH_SECRET", async () => {
  const before = await restoreDatabases();
  await staffFactor(randomBytes(48).toString("base64url"));
  const store = join(root, "foreign-factor");
  const created = await backup(["create", "test"], store);
  assert.equal(created.code, 0, created.stderr);
  const drill = await backup(["drill", "latest", "--escrow-private-key", join(root, "escrow.pem")], store);
  assert.notEqual(drill.code, 0);
  assert.match(drill.stderr, /TOTP secret does not decrypt with the escrowed auth secret/);
  assert.deepEqual(await restoreDatabases(), before, "a failed drill still drops its restore database");
  const pruned = JSON.parse((await backup(["prune"], store)).stdout);
  assert.equal(pruned.prune, "dry-run");
  assert.deepEqual(pruned.remove, []);
});
