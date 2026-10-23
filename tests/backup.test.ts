import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  authFingerprint, digestFile, escrowSecret, extractArchive, listFiles, openStore, parseManifest,
  readArchive, recoverSecret, selectRetained, sha256, signV4, writeArchive,
} from "../src/ops/backup.ts";

// S85 backup format, escrow, retention and off-host store plumbing (no database; the restore drill
// itself is tests/integration/backup-restore.test.ts).

const temp = () => mkdtemp(join(tmpdir(), "99ribu-backup-unit-"));
const rsa = (bits: number) => generateKeyPairSync("rsa", { modulusLength: bits, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });

test("SigV4 matches the AWS S3 documentation examples (GET object, PUT object, list objects)", () => {
  const credentials = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", now: new Date("2013-05-24T00:00:00Z") };
  const signature = (headers: Record<string, string>) => /Signature=([0-9a-f]{64})$/.exec(headers.authorization)?.[1];
  assert.equal(signature(signV4({ ...credentials, method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), headers: { range: "bytes=0-9" }, payloadHash: sha256("") })),
    "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  assert.equal(signature(signV4({ ...credentials, method: "PUT", url: new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
    headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" }, payloadHash: sha256("Welcome to Amazon S3.") })),
    "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  assert.equal(signature(signV4({ ...credentials, method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J"), headers: {}, payloadHash: sha256("") })),
    "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
});

test("auth escrow: only the owner's private key recovers the secret, and it must match the fingerprint", () => {
  const owner = rsa(3072);
  const secret = "s".repeat(20) + "e".repeat(44);
  const { ciphertext, escrowKey } = escrowSecret(secret, owner.publicKey);
  assert.match(escrowKey, /^[0-9a-f]{64}$/);
  assert.ok(!ciphertext.includes(Buffer.from(secret)));
  assert.equal(recoverSecret(ciphertext, owner.privateKey, authFingerprint(secret)), secret);
  assert.throws(() => recoverSecret(ciphertext, rsa(3072).privateKey, authFingerprint(secret)), /cannot open/);
  assert.throws(() => recoverSecret(ciphertext, owner.privateKey, authFingerprint(`${secret}x`)), /fingerprint/);
  // Coolify-style single-line values: escaped newlines or base64 DER.
  const der = owner.publicKey.replace(/-----[A-Z ]+-----|\s/g, "");
  assert.equal(recoverSecret(escrowSecret(secret, der).ciphertext, owner.privateKey, authFingerprint(secret)), secret);
  assert.equal(recoverSecret(escrowSecret(secret, owner.publicKey.replace(/\n/g, "\\n")).ciphertext, owner.privateKey, authFingerprint(secret)), secret);
  assert.throws(() => escrowSecret(secret, rsa(2048).publicKey), /3072/);
  assert.throws(() => escrowSecret("short", owner.publicKey), /too short/);
});

test("files archive: exact manifest round trip with private modes; tampering, links and unsafe paths are refused", async () => {
  const root = await temp();
  try {
    const local = join(root, ".local");
    await mkdir(join(local, "catalog-media"), { recursive: true, mode: 0o700 });
    await mkdir(join(local, "artifacts", "checkout-drafts"), { recursive: true, mode: 0o700 });
    const photo = Buffer.from("synthetic photo bytes");
    await writeFile(join(local, "catalog-media", `${sha256(photo)}.webp`), photo, { mode: 0o600 });
    await writeFile(join(local, "catalog-media", ".0b8c.tmp"), "in-flight write", { mode: 0o600 });
    await writeFile(join(local, "artifacts", "1d4c7a6e-5f2b-4c1a-9e3d-7a6b5c4d3e2f"), Buffer.alloc(1500, 7), { mode: 0o600 });
    await writeFile(join(local, "artifacts", "checkout-drafts", "draft.json"), "{}", { mode: 0o600 });
    const files = await listFiles(local);
    // In-flight *.tmp writes are skipped; roots in FILE_ROOTS order, names sorted.
    assert.deepEqual(files.map((f) => f.path), [`catalog-media/${sha256(photo)}.webp`, "artifacts/1d4c7a6e-5f2b-4c1a-9e3d-7a6b5c4d3e2f", "artifacts/checkout-drafts/draft.json"]);
    const archivePath = join(root, "files.tar");
    await writeArchive(local, files.map((f) => f.path), archivePath);
    const archive = await readFile(archivePath);
    assert.equal(archive.length % 512, 0);
    const restored = join(root, "restored");
    await extractArchive(archive, files, restored);
    for (const file of files) {
      const path = join(restored, file.path);
      assert.equal(sha256(await readFile(path)), file.sha256);
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    }
    assert.equal((await stat(join(restored, "artifacts", "checkout-drafts"))).mode & 0o777, 0o700);
    assert.deepEqual(await readdir(join(restored, "catalog-media")), [`${sha256(photo)}.webp`]);

    // Content tamper, missing file, unlisted file
    const tampered = Buffer.from(archive);
    tampered[tampered.indexOf(photo)] ^= 1;
    await assert.rejects(extractArchive(tampered, files, join(root, "t1")), /does not match its manifest checksum/);
    await assert.rejects(extractArchive(archive, [...files, { path: "artifacts/missing", sha256: sha256(""), bytes: 0 }], join(root, "t2")), /missing files/);
    await assert.rejects(extractArchive(archive, files.slice(1), join(root, "t3")), /does not list/);

    // Rewritten headers: symlink type, traversal and absolute names are refused before anything is written.
    const rewrite = (name: string, type: string) => {
      const copy = Buffer.from(archive);
      const offset = copy.indexOf(Buffer.from(files[0].path));
      const header = copy.subarray(offset, offset + 512);
      header.fill(0, 0, 100);
      header.write(name, 0, "utf8");
      header.write(type, 156, "latin1");
      header.fill(0x20, 148, 156);
      let sum = 0;
      for (const byte of header) sum += byte;
      header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
      return copy;
    };
    for (const [name, type] of [["catalog-media/link.webp", "2"], ["catalog-media/../../etc/passwd", "0"], ["/etc/passwd", "0"], ["auth/local.key", "0"]] as const) {
      assert.throws(() => readArchive(rewrite(name, type)), /link, special file or unsafe path/, name);
    }
    const badSum = Buffer.from(archive);
    badSum[0] ^= 1;
    assert.throws(() => readArchive(badSum), /checksum/);
    assert.throws(() => readArchive(archive.subarray(0, 700)), /truncated/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest parsing rejects malformed sets", () => {
  const digest = { sha256: "a".repeat(64), bytes: 1 };
  const valid = {
    format: "99ribu-backup-v1", id: "20261024T010203Z", target: "production", createdAt: "2026-10-24T01:02:03.000Z",
    database: { name: "99ribu_production", serverVersion: "18.6", tables: { "app.offer": 392 } },
    objects: { "database.dump": digest, "globals.sql": digest, "files.tar": digest, "auth-escrow.bin": digest },
    files: [{ path: `catalog-media/${"b".repeat(64)}.webp`, ...digest }],
    auth: { fingerprint: "c".repeat(64), escrow: "rsa-oaep-sha256", escrowKey: "d".repeat(64) },
  };
  const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
  assert.equal(parseManifest(bytes(valid)).id, valid.id);
  for (const broken of [
    { ...valid, format: "other" }, { ...valid, id: "latest" }, { ...valid, target: "staging" },
    { ...valid, objects: { ...valid.objects, "files.tar": undefined } },
    { ...valid, files: [{ path: "catalog-media/../auth/local.key", ...digest }] },
    { ...valid, files: [valid.files[0], valid.files[0]] },
    { ...valid, auth: { ...valid.auth, fingerprint: "short" } },
    { ...valid, database: { ...valid.database, tables: { "app.offer": -1 } } },
  ]) assert.throws(() => parseManifest(bytes(broken)), /malformed/);
});

test("retention keeps the newest set per day for 7 days and per ISO week for 4 weeks", () => {
  // Two sets a day for 60 days ending 2026-10-24.
  const ids: string[] = [];
  for (let day = 0; day < 60; day++) {
    const date = new Date(Date.UTC(2026, 9, 24 - day));
    const stamp = date.toISOString().slice(0, 10).replace(/-/g, "");
    ids.push(`${stamp}T020000Z`, `${stamp}T140000Z`);
  }
  const { keep, remove } = selectRetained(ids, { daily: 7, weekly: 4 });
  assert.equal(keep.length + remove.length, ids.length);
  // 7 daily (Oct 18–24) + 4 ISO weeks: Oct 19–25 and Oct 12–18 are already covered by Oct 24 and Sunday
  // Oct 18; the other two add the newest set of Oct 5–11 and Sep 28–Oct 4.
  assert.deepEqual(keep, [
    "20261024T140000Z", "20261023T140000Z", "20261022T140000Z", "20261021T140000Z", "20261020T140000Z", "20261019T140000Z",
    "20261018T140000Z", "20261011T140000Z", "20261004T140000Z",
  ]);
  assert.deepEqual(selectRetained(["20261024T020000Z"], { daily: 1, weekly: 0 }), { keep: ["20261024T020000Z"], remove: [] });
  assert.throws(() => selectRetained(ids, { daily: 0, weekly: 4 }), /at least one daily/);
});

test("file store: atomic put, get, prefix list, delete; keys cannot escape the root", async () => {
  const root = await temp();
  try {
    const store = openStore({ BACKUP_STORE: `file://${root}/store` });
    const source = join(root, "object");
    await writeFile(source, "payload");
    await store.put("20261024T010203Z/files.tar", source, await digestFile(source));
    await store.put("20261024T010203Z/manifest.json", source, await digestFile(source));
    assert.deepEqual(await store.list("2026"), ["20261024T010203Z/files.tar", "20261024T010203Z/manifest.json"]);
    await store.get("20261024T010203Z/files.tar", join(root, "copy"));
    assert.equal(await readFile(join(root, "copy"), "utf8"), "payload");
    assert.equal((await stat(join(root, "store", "20261024T010203Z", "files.tar"))).mode & 0o777, 0o600);
    await store.remove("20261024T010203Z/files.tar");
    assert.deepEqual(await store.list(""), ["20261024T010203Z/manifest.json"]);
    await assert.rejects(store.put("../escape", source, await digestFile(source)), /Unsafe/);
    for (const bad of [{}, { BACKUP_STORE: "file://relative/dir" }, { BACKUP_STORE: "ftp://x/y" },
      { BACKUP_STORE: "s3://bucket/prefix", BACKUP_S3_ENDPOINT: "http://objects.example.test", BACKUP_S3_REGION: "x", BACKUP_S3_ACCESS_KEY_ID: "x", BACKUP_S3_SECRET_ACCESS_KEY: "x" },
      { BACKUP_STORE: "s3://bucket/prefix", BACKUP_S3_ENDPOINT: "https://objects.example.test" }]) {
      assert.throws(() => openStore(bad), /BACKUP_/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("S3 store speaks signed path-style requests, pages listings and never leaks credentials in errors", async () => {
  const root = await temp();
  const objects = new Map<string, Buffer>();
  const credentials = { accessKeyId: "TESTACCESSKEY", secretAccessKey: "test-secret-value-not-real", region: "test-region-1" };
  let failNext = false;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const amzDate = String(request.headers["x-amz-date"]);
    const payloadHash = String(request.headers["x-amz-content-sha256"]);
    const now = new Date(`${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`);
    const expected = signV4({ ...credentials, method: request.method ?? "", url, headers: {}, payloadHash, now }).authorization;
    if (request.headers.authorization !== expected || (request.method === "PUT" && sha256(body) !== payloadHash) || failNext) {
      failNext = false;
      response.writeHead(403).end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
      return;
    }
    const [, bucket, ...key] = url.pathname.split("/");
    assert.equal(bucket, "backups");
    const name = key.join("/");
    if (request.method === "PUT") { objects.set(name, body); response.writeHead(200).end(); }
    else if (request.method === "DELETE") { objects.delete(name); response.writeHead(204).end(); }
    else if (name) { const object = objects.get(name); if (object) response.writeHead(200).end(object); else response.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>"); }
    else {
      const prefix = url.searchParams.get("prefix") ?? "";
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = Number(url.searchParams.get("continuation-token") ?? 0);
      const page = all.slice(start, start + 2);
      const truncated = start + 2 < all.length;
      response.writeHead(200, { "content-type": "application/xml" }).end(`<ListBucketResult>${page.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}<IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${start + 2}</NextContinuationToken>` : ""}</ListBucketResult>`);
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const { port } = server.address() as AddressInfo;
    const store = openStore({ BACKUP_STORE: "s3://backups/99ribu/production", BACKUP_S3_ENDPOINT: `http://127.0.0.1:${port}`, BACKUP_S3_REGION: credentials.region, BACKUP_S3_ACCESS_KEY_ID: credentials.accessKeyId, BACKUP_S3_SECRET_ACCESS_KEY: credentials.secretAccessKey });
    const source = join(root, "object");
    for (const [index, name] of ["database.dump", "globals.sql", "files.tar", "manifest.json", "auth-escrow.bin"].entries()) {
      await writeFile(source, `object ${index}`);
      await store.put(`20261024T010203Z/${name}`, source, await digestFile(source));
    }
    assert.ok([...objects.keys()].every((key) => key.startsWith("99ribu/production/20261024T010203Z/")));
    assert.deepEqual(await store.list(""), ["20261024T010203Z/auth-escrow.bin", "20261024T010203Z/database.dump", "20261024T010203Z/files.tar", "20261024T010203Z/globals.sql", "20261024T010203Z/manifest.json"]);
    await store.get("20261024T010203Z/files.tar", join(root, "copy"));
    assert.equal(await readFile(join(root, "copy"), "utf8"), "object 2");
    await store.remove("20261024T010203Z/files.tar");
    assert.equal((await store.list("20261024T010203Z/f")).length, 0);
    failNext = true;
    await assert.rejects(store.get("20261024T010203Z/globals.sql", join(root, "never")), (error: Error) =>
      /HTTP 403 SignatureDoesNotMatch/.test(error.message) && !error.message.includes(credentials.secretAccessKey) && !error.message.includes(credentials.accessKeyId));
    await assert.rejects(store.get("20261024T010203Z/missing", join(root, "never2")), /HTTP 404 NoSuchKey/);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
