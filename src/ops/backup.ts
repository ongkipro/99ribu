import { createHash, createHmac, createPrivateKey, createPublicKey, constants as cryptoConstants, type KeyObject, privateDecrypt, publicEncrypt } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

// S85 backup set format: one directory (or object prefix) per set, objects first, manifest.json last.
// A set without a manifest is incomplete and is never restored. Pure helpers here; I/O orchestration
// lives in scripts/backup.ts. Nothing in this module logs or returns a secret.

export const BACKUP_FORMAT = "99ribu-backup-v1";
export const SET_ID = /^\d{8}T\d{6}Z$/;
export const BACKUP_OBJECTS = ["database.dump", "globals.sql", "files.tar", "auth-escrow.bin"] as const;
export type BackupObject = (typeof BACKUP_OBJECTS)[number];
export type Digest = { sha256: string; bytes: number };
export type FileEntry = Digest & { path: string };
export type Manifest = {
  format: typeof BACKUP_FORMAT;
  id: string;
  target: "local" | "test" | "production";
  createdAt: string;
  database: { name: string; serverVersion: string; tables: Record<string, number> };
  objects: Record<BackupObject, Digest>;
  files: FileEntry[];
  auth: { fingerprint: string; escrow: "rsa-oaep-sha256"; escrowKey: string };
};

const HEX64 = /^[0-9a-f]{64}$/;
// Archived roots under .local (DEC-005 media and private artifacts); auth/postgres/pgsocket never are.
export const FILE_ROOTS = ["catalog-media", "artifacts"] as const;
const FILE_PATH = /^(?:catalog-media|artifacts)(?:\/(?!\.{1,2}(?:\/|$))[A-Za-z0-9._-]+)*$/;

export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

export function setId(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function parseManifest(bytes: Uint8Array): Manifest {
  const value = JSON.parse(Buffer.from(bytes).toString("utf8")) as Manifest;
  const digest = (d: Digest | undefined) => !!d && HEX64.test(d.sha256) && Number.isSafeInteger(d.bytes) && d.bytes >= 0;
  if (
    value?.format !== BACKUP_FORMAT || !SET_ID.test(value.id) || !["local", "test", "production"].includes(value.target) ||
    !BACKUP_OBJECTS.every((name) => digest(value.objects?.[name])) || !Array.isArray(value.files) ||
    !value.files.every((file) => digest(file) && FILE_PATH.test(file.path)) ||
    new Set(value.files.map((file) => file.path)).size !== value.files.length ||
    !HEX64.test(value.auth?.fingerprint) || !HEX64.test(value.auth?.escrowKey) || value.auth.escrow !== "rsa-oaep-sha256" ||
    typeof value.database?.name !== "string" || typeof value.database.tables !== "object" ||
    !Object.values(value.database.tables).every((count) => Number.isSafeInteger(count) && count >= 0)
  ) {
    throw new Error("Backup manifest is malformed.");
  }
  return value;
}

export async function digestFile(path: string): Promise<Digest> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

export async function verifyObject(path: string, expected: Digest, name: string) {
  const actual = await digestFile(path);
  if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) throw new Error(`Backup object ${name} does not match its manifest checksum.`);
}

// ---------------------------------------------------------------------------------------------
// Auth secret escrow (audit 2026-10-23). BETTER_AUTH_SECRET encrypts staff TOTP secrets; a DB restore
// without it locks staff MFA. The server holds only the owner's RSA public key, so a bucket or server
// compromise cannot read the escrow; the drill decrypts it with the owner-held private key.

export const authFingerprint = (secret: string) => sha256(`99ribu-auth-escrow-v1\0${secret}`);

function escrowPublicKey(value: string): KeyObject {
  const key = value.includes("-----BEGIN")
    ? createPublicKey(value.replace(/\\n/g, "\n"))
    : createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) {
    throw new Error("BACKUP_ESCROW_PUBLIC_KEY must be an RSA public key of at least 3072 bits.");
  }
  return key;
}

export function escrowSecret(secret: string, publicKey: string) {
  if (secret.length < 32) throw new Error("The auth secret to escrow is too short.");
  const key = escrowPublicKey(publicKey);
  const ciphertext = publicEncrypt({ key, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(secret, "utf8"));
  return { ciphertext, escrowKey: sha256(key.export({ format: "der", type: "spki" })) };
}

export function recoverSecret(ciphertext: Uint8Array, privateKeyPem: string | Buffer, fingerprint: string) {
  let secret: string;
  try {
    secret = privateDecrypt({ key: createPrivateKey(privateKeyPem), padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, ciphertext).toString("utf8");
  } catch {
    throw new Error("The escrow private key cannot open this backup's auth escrow.");
  }
  if (authFingerprint(secret) !== fingerprint) throw new Error("Escrowed auth secret does not match the manifest fingerprint.");
  return secret;
}

// ---------------------------------------------------------------------------------------------
// Minimal ustar writer/reader for the media/artifacts archive: regular files and directories only,
// fixed 0600/0700 modes, no links, no extensions. Parsing it ourselves means a tampered archive can
// never write outside the restore directory or plant a symlink.

const BLOCK = 512;
function header(path: string, size: number, directory: boolean) {
  const name = directory ? `${path}/` : path;
  if (Buffer.byteLength(name) > 100) throw new Error("Archive path is too long."); // lazy: ustar prefix field would lift this; current names are < 90 bytes.
  const block = Buffer.alloc(BLOCK);
  const field = (offset: number, length: number, value: string) => block.write(value, offset, length, "utf8");
  field(0, 100, name);
  field(100, 8, directory ? "0000700\0" : "0000600\0");
  field(108, 8, "0000000\0");
  field(116, 8, "0000000\0");
  field(124, 12, `${size.toString(8).padStart(11, "0")}\0`);
  field(136, 12, "00000000000\0");
  block.fill(0x20, 148, 156);
  field(156, 1, directory ? "5" : "0");
  field(257, 8, "ustar\u000000");
  let sum = 0;
  for (const byte of block) sum += byte;
  field(148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return block;
}

// Streams `entries` (paths relative to `root`) into `out`. Directories are emitted for every parent.
export async function writeArchive(root: string, files: readonly string[], out: string) {
  const handle = await open(out, "wx", 0o600);
  try {
    const directories = new Set<string>();
    for (const file of files) {
      const parts = file.split("/");
      for (let index = 1; index < parts.length; index++) {
        const directory = parts.slice(0, index).join("/");
        if (!directories.has(directory)) {
          directories.add(directory);
          await handle.write(header(directory, 0, true));
        }
      }
      const bytes = await readPrivateFile(join(root, file));
      await handle.write(header(file, bytes.length, false));
      await handle.write(bytes);
      const padding = (BLOCK - (bytes.length % BLOCK)) % BLOCK;
      if (padding) await handle.write(Buffer.alloc(padding));
    }
    await handle.write(Buffer.alloc(BLOCK * 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export type ArchiveEntry = { path: string; directory: boolean; data: Buffer };
export function readArchive(archive: Buffer): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  const octal = (start: number, length: number) => {
    const text = archive.toString("latin1", start, start + length).replace(/[\0 ]+$/, "");
    if (!/^[0-7]+$/.test(text)) throw new Error("Archive header is malformed.");
    return Number.parseInt(text, 8);
  };
  while (offset + BLOCK <= archive.length) {
    const block = archive.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) return entries;
    let sum = 0;
    for (let index = 0; index < BLOCK; index++) sum += index >= 148 && index < 156 ? 0x20 : block[index];
    if (sum !== octal(offset + 148, 8)) throw new Error("Archive header checksum mismatch.");
    if (archive.toString("latin1", offset + 257, offset + 263) !== "ustar\0" || block[345] !== 0) throw new Error("Archive entry format is not supported.");
    const type = String.fromCharCode(block[156]);
    const raw = block.toString("utf8", 0, 100).replace(/\0.*$/s, "");
    const directory = type === "5";
    const path = directory ? raw.replace(/\/$/, "") : raw;
    if ((type !== "0" && !directory) || !FILE_PATH.test(path)) throw new Error("Archive contains a link, special file or unsafe path.");
    const size = octal(offset + 124, 12);
    if (directory && size !== 0) throw new Error("Archive directory entry has content.");
    const start = offset + BLOCK;
    if (start + size > archive.length) throw new Error("Archive is truncated.");
    entries.push({ path, directory, data: archive.subarray(start, start + size) });
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new Error("Archive is truncated.");
}

// Extracts into an empty destination with the modes the runtime requires (0700 dirs, 0600 files) and
// verifies the archive holds exactly the manifest's files with matching checksums.
export async function extractArchive(archive: Buffer, files: readonly FileEntry[], destination: string) {
  const expected = new Map(files.map((file) => [file.path, file]));
  const seen = new Set<string>();
  for (const root of FILE_ROOTS) await mkdir(join(destination, root), { recursive: true, mode: 0o700 });
  for (const entry of readArchive(archive)) {
    const target = join(destination, ...entry.path.split("/"));
    if (relative(destination, target).split(sep)[0] === "..") throw new Error("Archive path escapes the restore directory.");
    if (entry.directory) {
      await mkdir(target, { recursive: true, mode: 0o700 });
      continue;
    }
    const file = expected.get(entry.path);
    if (!file || seen.has(entry.path)) throw new Error("Archive holds a file the manifest does not list.");
    if (sha256(entry.data) !== file.sha256 || entry.data.length !== file.bytes) throw new Error(`Archived file ${entry.path} does not match its manifest checksum.`);
    seen.add(entry.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, entry.data, { mode: 0o600, flag: "wx" });
  }
  if (seen.size !== expected.size) throw new Error("Archive is missing files listed in the manifest.");
}

async function readPrivateFile(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Backup source must be a regular file.");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

// Every regular file under .local/<root> except in-flight `*.tmp` writes; symlinks and special files
// fail the backup instead of being followed.
export async function listFiles(localRoot: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  async function walk(path: string) {
    for (const name of (await readdir(join(localRoot, path))).sort()) {
      const child = `${path}/${name}`;
      const stat = await lstat(join(localRoot, child));
      if (stat.isDirectory()) await walk(child);
      else if (stat.isFile()) {
        if (name.endsWith(".tmp")) continue;
        if (!FILE_PATH.test(child)) throw new Error("A stored file name cannot be archived safely.");
        const bytes = await readPrivateFile(join(localRoot, child));
        entries.push({ path: child, sha256: sha256(bytes), bytes: bytes.length });
      } else throw new Error("Storage contains a symlink or special file; backup refused.");
    }
  }
  for (const root of FILE_ROOTS) await walk(root);
  return entries;
}

// ---------------------------------------------------------------------------------------------
// Retention (OD-5 default: 7 daily + 4 weekly): keep the newest set of each of the newest `daily`
// UTC days and of the newest `weekly` ISO weeks; the newest set is always kept.

function isoWeek(day: string) {
  // The ISO week (and its year) is the one holding this date's Thursday.
  const thursday = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))));
  thursday.setUTCDate(thursday.getUTCDate() - ((thursday.getUTCDay() + 6) % 7) + 3);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / 604800000);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function selectRetained(ids: readonly string[], { daily, weekly }: { daily: number; weekly: number }) {
  if (!Number.isSafeInteger(daily) || !Number.isSafeInteger(weekly) || daily < 1 || weekly < 0) throw new Error("Retention must keep at least one daily set.");
  const sorted = [...new Set(ids)].filter((id) => SET_ID.test(id)).sort().reverse();
  const keep = new Set<string>(sorted.slice(0, 1));
  const pick = (bucket: (id: string) => string, limit: number) => {
    const seen = new Set<string>();
    for (const id of sorted) {
      const key = bucket(id);
      if (seen.has(key)) continue;
      if (seen.size >= limit) break;
      seen.add(key);
      keep.add(id);
    }
  };
  pick((id) => id.slice(0, 8), daily);
  pick((id) => isoWeek(id.slice(0, 8)), weekly);
  return { keep: sorted.filter((id) => keep.has(id)), remove: sorted.filter((id) => !keep.has(id)) };
}

// ---------------------------------------------------------------------------------------------
// Off-host stores: `file:///absolute/dir` (drills, tests, an operator-mounted disk) or
// `s3://bucket/prefix` against any S3-compatible endpoint (path-style, SigV4). Credentials come only
// from the environment and never appear in errors or logs.

export interface ObjectStore {
  put(key: string, path: string, digest: Digest): Promise<void>;
  get(key: string, path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
}

const KEY = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
function checkKey(key: string) {
  if (!KEY.test(key) || key.split("/").some((part) => part === "." || part === "..")) throw new Error("Unsafe backup object key.");
  return key;
}

export function openStore(env: Record<string, string | undefined>): ObjectStore {
  const raw = env.BACKUP_STORE;
  if (!raw) throw new Error("BACKUP_STORE is not configured (file:///absolute/dir or s3://bucket/prefix).");
  const url = new URL(raw);
  if (url.protocol === "file:") {
    if (url.host || url.search || url.hash) throw new Error("BACKUP_STORE file URL must be file:///absolute/dir.");
    return fileStore(decodeURIComponent(url.pathname));
  }
  if (url.protocol === "s3:") {
    const endpoint = new URL(env.BACKUP_S3_ENDPOINT ?? "");
    const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(endpoint.hostname);
    if ((endpoint.protocol !== "https:" && !(loopback && endpoint.protocol === "http:")) || endpoint.username || endpoint.password || endpoint.search) {
      throw new Error("BACKUP_S3_ENDPOINT must be an https:// origin.");
    }
    const prefix = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(url.hostname) || (prefix && !KEY.test(prefix))) throw new Error("BACKUP_STORE must be s3://bucket/prefix.");
    const { BACKUP_S3_ACCESS_KEY_ID: accessKeyId, BACKUP_S3_SECRET_ACCESS_KEY: secretAccessKey, BACKUP_S3_REGION: region } = env;
    if (!accessKeyId || !secretAccessKey || !region) throw new Error("BACKUP_S3_REGION, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY are required.");
    return s3Store({ endpoint, bucket: url.hostname, prefix, region, accessKeyId, secretAccessKey });
  }
  throw new Error("BACKUP_STORE must use file:// or s3://.");
}

function fileStore(root: string): ObjectStore {
  if (!root.startsWith("/")) throw new Error("BACKUP_STORE file path must be absolute.");
  const path = (key: string) => join(root, ...checkKey(key).split("/"));
  return {
    async put(key, source) {
      const target = path(key);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const temporary = `${target}.partial`;
      await writeFile(temporary, await readFile(source), { mode: 0o600 });
      await rename(temporary, target);
    },
    async get(key, target) {
      await writeFile(target, await readFile(path(key)), { mode: 0o600, flag: "wx" });
    },
    async list(prefix) {
      const found: string[] = [];
      async function walk(relativePath: string) {
        let names: string[];
        try { names = await readdir(join(root, relativePath)); } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
          throw error;
        }
        for (const name of names) {
          const child = relativePath ? `${relativePath}/${name}` : name;
          if ((await lstat(join(root, child))).isDirectory()) await walk(child);
          else if (!name.endsWith(".partial")) found.push(child);
        }
      }
      await walk("");
      return found.filter((key) => key.startsWith(prefix)).sort();
    },
    async remove(key) {
      await rm(path(key), { force: true });
    },
  };
}

const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value).digest();

// AWS Signature Version 4 for a request whose payload hash is already known.
export function signV4(input: {
  method: string; url: URL; headers: Record<string, string>; payloadHash: string;
  accessKeyId: string; secretAccessKey: string; region: string; now: Date; service?: string;
}) {
  const amzDate = input.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const day = amzDate.slice(0, 8);
  const service = input.service ?? "s3";
  const headers: Record<string, string> = { ...input.headers, host: input.url.host, "x-amz-content-sha256": input.payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(headers).map((name) => name.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")]));
  const query = [...input.url.searchParams].map(([k, v]) => [encode(k), encode(v)]).sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
  const canonicalPath = input.url.pathname.split("/").map((part) => encode(decodeURIComponent(part))).join("/");
  const canonical = [input.method, canonicalPath, query, ...names.map((name) => `${name}:${lower[name]}`), "", names.join(";"), input.payloadHash].join("\n");
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}

const EMPTY_SHA256 = sha256("");
function s3Store(config: { endpoint: URL; bucket: string; prefix: string; region: string; accessKeyId: string; secretAccessKey: string }): ObjectStore {
  const objectUrl = (key: string) => new URL(`${config.endpoint.origin}/${config.bucket}/${[config.prefix, checkKey(key)].filter(Boolean).join("/")}`);
  async function send(method: string, url: URL, payloadHash = EMPTY_SHA256, body?: Buffer) {
    const headers = signV4({ method, url, headers: {}, payloadHash, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, region: config.region, now: new Date() });
    delete (headers as Record<string, string>).host;
    const response = await fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(300000) });
    if (!response.ok) {
      const code = /<Code>([A-Za-z]{1,64})<\/Code>/.exec(await response.text())?.[1];
      throw new Error(`Object store ${method} failed with HTTP ${response.status}${code ? ` ${code}` : ""}.`);
    }
    return response;
  }
  return {
    async put(key, source, digest) {
      // lazy: single PUT reads the object into memory (sets are tens of MB); multipart upload is the upgrade path past ~1 GB.
      await send("PUT", objectUrl(key), digest.sha256, await readFile(source));
    },
    async get(key, target) {
      const response = await send("GET", objectUrl(key));
      await writeFile(target, Buffer.from(await response.arrayBuffer()), { mode: 0o600, flag: "wx" });
    },
    async list(prefix) {
      const keys: string[] = [];
      const base = config.prefix ? `${config.prefix}/` : "";
      let token: string | undefined;
      do {
        const url = new URL(`${config.endpoint.origin}/${config.bucket}`);
        url.searchParams.set("list-type", "2");
        url.searchParams.set("prefix", `${base}${prefix}`);
        if (token) url.searchParams.set("continuation-token", token);
        const xml = await (await send("GET", url)).text();
        for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
          const key = match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
          if (key.startsWith(base)) keys.push(key.slice(base.length));
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] : undefined;
      } while (token);
      return keys.sort();
    },
    async remove(key) {
      await send("DELETE", objectUrl(key));
    },
  };
}
