import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { symmetricDecrypt } from "better-auth/crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { privateDirectory, readLocalConfig } from "../src/config/local.ts";
import {
  BACKUP_FORMAT, BACKUP_OBJECTS, type BackupObject, type Digest, FILE_ROOTS, type Manifest, SET_ID,
  authFingerprint, digestFile, escrowSecret, extractArchive, listFiles, openStore, parseManifest,
  readArchive, recoverSecret, selectRetained, setId, verifyObject, writeArchive,
} from "../src/ops/backup.ts";
import { readCatalogMedia, resolveCatalogMedia } from "../src/storage/catalog-media.ts";

// S85 backup, retention and restore drill. One set = database (pg_dump under an exported snapshot) +
// role globals + .local/{catalog-media,artifacts} archive + escrowed auth secret, with a checksum manifest.
// Usage (README "Backups and restore drill"):
//   backup.ts create local|test|production
//   backup.ts list
//   backup.ts prune [--apply]
//   backup.ts drill <set-id|latest> --escrow-private-key <path>
//   backup.ts extract <set-id|latest> <new-dir>
// Never prints a secret, a credential or a connection URL.

type Target = "local" | "test" | "production";
type Pg = {
  database: string;
  tool(name: "pg_dump" | "pg_dumpall" | "pg_restore", args: string[], io: { stdin?: string; stdout?: string }): Promise<void>;
  connect(database: string): Sql;
  endpoint: string;
};

const env = process.env;
const RESTORE_DB = /^99ribu_restore_[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Running pg tools, so a SIGTERM/SIGINT during a drill can stop them before the restore database is dropped.
const children = new Set<ReturnType<typeof spawn>>();

function run(command: string, args: string[], childEnv: Record<string, string | undefined>, io: { stdin?: string; stdout?: string }) {
  return new Promise<void>((done, fail) => {
    const child = spawn(command, args, { env: childEnv as NodeJS.ProcessEnv, stdio: [io.stdin ? "pipe" : "ignore", io.stdout ? "pipe" : "ignore", "pipe"] });
    children.add(child);
    const errors: Buffer[] = [];
    child.stderr?.on("data", (chunk: Buffer) => errors.push(chunk));
    const out = io.stdout ? createWriteStream(io.stdout, { mode: 0o600, flags: "wx" }) : null;
    if (out && child.stdout) child.stdout.pipe(out);
    if (io.stdin && child.stdin) {
      child.stdin.on("error", () => {}); // an early exit closes stdin; the exit code below carries the failure
      createReadStream(io.stdin).pipe(child.stdin);
    }
    child.on("error", fail);
    child.on("close", (code) => {
      children.delete(child);
      const finish = () => code === 0 ? done() : fail(new Error(`${args.find((a) => a.startsWith("pg_")) ?? command} exited ${code}: ${Buffer.concat(errors).toString().slice(0, 2000)}`));
      if (out && !out.closed) out.on("close", finish); else finish();
    });
  });
}

// local/test: the pinned compose cluster of this checkout; tools run inside its container as the
// bootstrap role over the private socket (same path as the S67 rehearsal).
function composePg(database: string): Pg {
  readLocalConfig(env);
  const project = `99ribu-${createHash("sha256").update(process.cwd()).digest("hex").slice(0, 10)}`;
  const childEnv = { ...env, LOCAL_UID: String(process.getuid?.()), LOCAL_GID: String(process.getgid?.()) };
  return {
    database,
    endpoint: `compose:${project}`,
    tool: (name, args, io) => run("docker", ["compose", "--project-name", project, "--file", "compose.yaml", "exec", "-T", "database", name, "--username=bootstrap", ...args], childEnv, io),
    connect: (db) => postgres({ path: join(privateDirectory("pgsocket"), ".s.PGSQL.5432"), database: db, username: "bootstrap", max: 1, connect_timeout: 5, onnotice: () => {} }),
  };
}

// production / disposable server: libpq tools from the image over TCP. The URL is split into libpq
// environment variables for the child only, so the password never appears in argv.
function directPg(name: "BACKUP_DATABASE_URL" | "RESTORE_ADMIN_URL"): Pg {
  const raw = env[name];
  if (!raw) throw new Error(`${name} is not configured.`);
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username) throw new Error(`${name} must be postgres://user:password@host:port/database.`);
  const database = decodeURIComponent(url.pathname.slice(1)) || "postgres";
  const childEnv: Record<string, string | undefined> = {
    PATH: env.PATH, LANG: "C.UTF-8", PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGAPPNAME: "99ribu-backup", PGCONNECT_TIMEOUT: "10",
    ...(url.searchParams.get("sslmode") ? { PGSSLMODE: url.searchParams.get("sslmode") as string } : {}),
  };
  return {
    database,
    endpoint: `${url.hostname}:${url.port || "5432"}`,
    tool: (tool, args, io) => run(tool, args, childEnv, io),
    connect: (db) => postgres(raw, { database: db, max: 1, connect_timeout: 10, onnotice: () => {} }),
  };
}

function sourcePg(target: Target) {
  if (target === "production") {
    // S82 interface: the production profile sets APP_ENV=production; the local reader refuses it.
    if (env.APP_ENV !== "production") throw new Error("The production backup requires APP_ENV=production.");
    return directPg("BACKUP_DATABASE_URL");
  }
  return composePg(`99ribu_${target}`);
}

// local/test: the runtime-owned signing key file; production: BETTER_AUTH_SECRET (S82 interface).
async function authSecret(target: Target) {
  if (target === "production") {
    const secret = env.BETTER_AUTH_SECRET ?? "";
    if (Buffer.byteLength(secret) < 32) throw new Error("BETTER_AUTH_SECRET is missing or too short; nothing to escrow.");
    return secret;
  }
  const { localSigningKey } = await import("../src/modules/access/local-key.ts");
  return localSigningKey(target);
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
async function tableCounts(db: Sql | TransactionSql) {
  const tables = await db<{ schemaname: string; tablename: string }[]>`
    select schemaname, tablename from pg_tables
    where schemaname not in ('pg_catalog', 'information_schema') and schemaname not like 'pg\_%'
    order by 1, 2`;
  const counts: Record<string, number> = {};
  // lazy: exact count(*) per table is fine at this catalog size; pg_class estimates are the upgrade path for very large tables.
  for (const { schemaname, tablename } of tables) {
    const [{ n }] = await db.unsafe<{ n: number }[]>(`select count(*)::int as n from ${quote(schemaname)}.${quote(tablename)}`);
    counts[`${schemaname}.${tablename}`] = n;
  }
  return counts;
}

async function create(target: Target) {
  const store = openStore(env);
  const publicKey = env.BACKUP_ESCROW_PUBLIC_KEY;
  if (!publicKey) throw new Error("BACKUP_ESCROW_PUBLIC_KEY is not configured; a backup without the auth escrow cannot restore staff MFA.");
  const pg = sourcePg(target);
  const secret = await authSecret(target);
  const escrow = escrowSecret(secret, publicKey);
  const localRoot = resolve(".local");
  for (const root of FILE_ROOTS) privateDirectory(root);
  const work = await mkdtemp(join(tmpdir(), "99ribu-backup-"));
  const id = setId();
  const started = Date.now();
  const source = pg.connect(pg.database);
  try {
    // Database first under one exported snapshot (counts and dump describe the same instant), then
    // files: media are written before any row references them, so every referenced photo is archived.
    const database = await source.begin("isolation level repeatable read read only", async (tx) => {
      const [{ snapshot }] = await tx<{ snapshot: string }[]>`select pg_export_snapshot() as snapshot`;
      const [{ version }] = await tx<{ version: string }[]>`select current_setting('server_version') as version`;
      const tables = await tableCounts(tx);
      await pg.tool("pg_dump", [`--dbname=${pg.database}`, "--format=custom", `--snapshot=${snapshot}`], { stdout: join(work, "database.dump") });
      return { name: pg.database, serverVersion: version, tables };
    });
    await pg.tool("pg_dumpall", [`--database=${pg.database}`, "--globals-only", "--no-role-passwords"], { stdout: join(work, "globals.sql") });
    const files = await listFiles(localRoot);
    await writeArchive(localRoot, files.map((file) => file.path), join(work, "files.tar"));
    // A file that changed between listing and archiving fails here instead of producing a set that cannot verify.
    const archived = new Map(readArchive(await readFile(join(work, "files.tar"))).filter((e) => !e.directory).map((e) => [e.path, createHash("sha256").update(e.data).digest("hex")]));
    if (archived.size !== files.length || files.some((file) => archived.get(file.path) !== file.sha256)) throw new Error("Storage changed while it was archived; retry the backup.");
    await writeFile(join(work, "auth-escrow.bin"), escrow.ciphertext, { mode: 0o600, flag: "wx" });
    const objects = {} as Record<BackupObject, Digest>;
    for (const name of BACKUP_OBJECTS) objects[name] = await digestFile(join(work, name));
    const manifest: Manifest = {
      format: BACKUP_FORMAT, id, target, createdAt: new Date().toISOString(), database, objects, files,
      auth: { fingerprint: authFingerprint(secret), escrow: "rsa-oaep-sha256", escrowKey: escrow.escrowKey },
    };
    await writeFile(join(work, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`, { mode: 0o600, flag: "wx" });
    parseManifest(await readFile(join(work, "manifest.json")));
    // Objects first, manifest last: a set without a manifest is incomplete and never restored.
    for (const name of BACKUP_OBJECTS) await store.put(`${id}/${name}`, join(work, name), objects[name]);
    await store.put(`${id}/manifest.json`, join(work, "manifest.json"), await digestFile(join(work, "manifest.json")));
    const rows = Object.values(database.tables).reduce((sum, n) => sum + n, 0);
    console.log(JSON.stringify({ backup: id, target, tables: Object.keys(database.tables).length, rows, files: files.length, bytes: Object.values(objects).reduce((sum, o) => sum + o.bytes, 0), elapsed_ms: Date.now() - started }));
  } finally {
    await source.end();
    await rm(work, { recursive: true, force: true });
  }
}

async function sets() {
  const keys = await openStore(env).list("");
  const byId = new Map<string, string[]>();
  for (const key of keys) {
    const [id] = key.split("/");
    if (SET_ID.test(id)) byId.set(id, [...(byId.get(id) ?? []), key]);
  }
  const complete = [...byId].filter(([, k]) => k.some((key) => key.endsWith("/manifest.json"))).map(([id]) => id).sort();
  return { byId, complete, incomplete: [...byId.keys()].filter((id) => !complete.includes(id)).sort() };
}

async function prune(apply: boolean) {
  const { byId, complete, incomplete } = await sets();
  const retention = { daily: Number(env.BACKUP_KEEP_DAILY ?? 7), weekly: Number(env.BACKUP_KEEP_WEEKLY ?? 4) };
  const { keep, remove } = selectRetained(complete, retention);
  // An incomplete set younger than a day may still be uploading.
  const cutoff = new Date(Date.now() - 86_400_000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const stale = incomplete.filter((id) => id < cutoff);
  if (apply) {
    const store = openStore(env);
    for (const id of [...remove, ...stale]) {
      const keys = byId.get(id) ?? [];
      // Manifest first: an interrupted prune leaves an incomplete set, never a manifest without objects.
      for (const key of keys.filter((k) => k.endsWith("/manifest.json"))) await store.remove(key);
      for (const key of keys.filter((k) => !k.endsWith("/manifest.json"))) await store.remove(key);
    }
  }
  console.log(JSON.stringify({ prune: apply ? "applied" : "dry-run", retention, keep, remove, stale_incomplete: stale }));
}

async function drill(requested: string, privateKeyPath: string) {
  const started = Date.now();
  const store = openStore(env);
  const { complete } = await sets();
  const id = requested === "latest" ? complete.at(-1) : requested;
  if (!id || !complete.includes(id)) throw new Error("No complete backup set with that id.");
  // Never the live database: a fresh 99ribu_restore_<uuid> on a disposable server (RESTORE_ADMIN_URL)
  // or, for local/test, in this checkout's compose cluster beside the live databases (S67 procedure).
  let pg: Pg;
  if (env.RESTORE_ADMIN_URL) {
    pg = directPg("RESTORE_ADMIN_URL");
    if (env.BACKUP_DATABASE_URL && directPg("BACKUP_DATABASE_URL").endpoint === pg.endpoint) throw new Error("RESTORE_ADMIN_URL must point at a disposable server, not the live database server.");
  } else {
    pg = composePg("postgres");
  }
  const work = await mkdtemp(join(tmpdir(), "99ribu-drill-"));
  const restoreDatabase = `99ribu_restore_${randomUUID().replaceAll("-", "")}`;
  const maintenance = pg.connect(pg.database);
  let created = false;
  let restored: Sql | null = null;
  // Runs once: from the finally below, or from SIGTERM/SIGINT (container stop, operator Ctrl-C), so an
  // interrupted drill never leaves its restore database or decrypted temporary files behind.
  let cleaning: Promise<void> | null = null;
  const cleanup = () => {
    cleaning ??= (async () => {
      for (const child of children) child.kill("SIGTERM");
      try {
        await restored?.end({ timeout: 5 });
        // Only the disposable database this drill created is ever dropped.
        if (created && RESTORE_DB.test(restoreDatabase)) await maintenance.unsafe(`drop database if exists ${quote(restoreDatabase)} with (force)`);
      } finally {
        await maintenance.end({ timeout: 5 });
        await rm(work, { recursive: true, force: true });
      }
    })();
    return cleaning;
  };
  const interrupted = (signal: NodeJS.Signals) => {
    console.error(`Drill interrupted by ${signal}; dropping the restore database.`);
    cleanup().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  };
  process.once("SIGTERM", interrupted);
  process.once("SIGINT", interrupted);
  try {
    // A disposable server never holds the production database, and is never the live cluster itself
    // (same system identifier), whatever host name or port the URLs use.
    const [{ live }] = await maintenance<{ live: boolean }[]>`select exists (select 1 from pg_database where datname = '99ribu_production') as live`;
    if (live) throw new Error("The restore server holds 99ribu_production; drills run only on a disposable server.");
    if (env.RESTORE_ADMIN_URL && env.BACKUP_DATABASE_URL) {
      const livePg = directPg("BACKUP_DATABASE_URL");
      const liveSql = livePg.connect(livePg.database);
      try {
        const identifier = async (db: Sql) => (await db<{ id: string }[]>`select system_identifier::text as id from pg_control_system()`)[0].id;
        const [restoreId, liveId] = await Promise.all([identifier(maintenance), identifier(liveSql)]);
        if (restoreId === liveId) throw new Error("RESTORE_ADMIN_URL reaches the live database cluster; drills run only on a disposable server.");
      } catch (error) {
        if (error instanceof Error && error.message.includes("live database cluster")) throw error;
        throw new Error("Cannot confirm that RESTORE_ADMIN_URL is not the live cluster (system identifier unreadable); drill refused.");
      } finally {
        await liveSql.end({ timeout: 5 });
      }
    }
    await store.get(`${id}/manifest.json`, join(work, "manifest.json"));
    const manifest = parseManifest(await readFile(join(work, "manifest.json")));
    if (manifest.id !== id) throw new Error("Backup manifest id does not match its set.");
    for (const name of BACKUP_OBJECTS) {
      await store.get(`${id}/${name}`, join(work, name));
      await verifyObject(join(work, name), manifest.objects[name], name);
    }

    // 1. Auth escrow: the owner-held private key recovers exactly the secret the backup fingerprinted.
    const secret = recoverSecret(await readFile(join(work, "auth-escrow.bin")), await readFile(privateKeyPath), manifest.auth.fingerprint);

    // 2. Files: extract into a disposable volume directory and re-verify every photo against its name.
    const volume = join(work, "volume");
    await extractArchive(await readFile(join(work, "files.tar")), manifest.files, volume);
    const mediaDirectory = join(volume, "catalog-media");
    const photos = (await readdir(mediaDirectory)).filter((name) => /^[0-9a-f]{64}\.webp$/.test(name));
    for (const name of photos) await readCatalogMedia(name, mediaDirectory);

    // 3. Globals carry the target's roles (passwords are excluded; they live in the deploy env).
    const globals = await readFile(join(work, "globals.sql"), "utf8");
    const roles = [`99ribu_${manifest.target}_owner`, `99ribu_${manifest.target}_app`].filter((role) => !globals.includes(`CREATE ROLE ${quote(role)}`));
    if (roles.length) throw new Error(`Role globals are missing ${roles.join(", ")}.`);

    // 4. Database: S67 restore with the creating-XID reseal between data and post-data.
    await maintenance.unsafe(`create database ${quote(restoreDatabase)}`);
    created = true;
    const restoreArgs = [`--dbname=${restoreDatabase}`, "--exit-on-error", "--no-owner", "--no-privileges"];
    await pg.tool("pg_restore", [...restoreArgs, "--section=pre-data", "--section=data"], { stdin: join(work, "database.dump") });
    restored = pg.connect(restoreDatabase);
    const db = restored;
    const xidTables = await db<{ table_name: string }[]>`select table_name from information_schema.columns where table_schema = 'app' and column_name = 'created_xid' order by 1`;
    for (const { table_name } of xidTables) {
      await db.unsafe(`update app.${quote(table_name)} set created_xid = 'restored:' || created_xid where created_xid !~ '^restored:'`);
    }
    await pg.tool("pg_restore", [...restoreArgs, "--section=post-data"], { stdin: join(work, "database.dump") });

    const counts = await tableCounts(db);
    const mismatched = [...new Set([...Object.keys(counts), ...Object.keys(manifest.database.tables)])].filter((table) => counts[table] !== manifest.database.tables[table]);
    if (mismatched.length) throw new Error(`Restored row counts differ from the backup snapshot: ${mismatched.slice(0, 10).join(", ")}.`);
    const [{ unbalanced }] = await db<{ unbalanced: number }[]>`
      select count(*)::int as unbalanced from (
        select transaction_id from app.finance_posting group by transaction_id
        having coalesce(sum(amount) filter (where side = 'debit'), 0) <> coalesce(sum(amount) filter (where side = 'credit'), 0)) x`;
    if (unbalanced) throw new Error(`${unbalanced} restored journal(s) do not balance.`);
    const guards = await db<{ name: string }[]>`
      select c.relname || '.' || t.tgname as name from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relnamespace = 'app'::regnamespace and not t.tgisinternal
        and t.tgname in ('finance_transaction_immutable', 'finance_posting_immutable', 'finance_posting_guard') order by 1`;
    if (guards.length !== 3) throw new Error("Restored ledger immutability triggers are missing.");

    // 5. Every photo a product revision embeds is in the restored volume. The shared test database also
    //    holds rows from suites that use their own temporary media directories, so `test` only reports.
    const referenced = await db<{ name: string }[]>`
      select distinct substring(i.image->>'url' from '/media/catalog/([^/?#]+)$') as name
      from app.product_revision r cross join lateral jsonb_array_elements(r.images) as i(image)
      where i.image->>'url' like '%/media/catalog/%'`;
    let missing = 0;
    for (const { name } of referenced) if (!name || !(await resolveCatalogMedia(name, mediaDirectory))) missing++;
    if (missing && manifest.target !== "test") throw new Error(`${missing} referenced catalog photo(s) are missing from the restored volume.`);

    // 5b. Every private artifact a row points at (label PDFs, payout/return evidence, support attachments:
    //     any app column named storage_key or artifact_id) is in the restored volume. Same `test` exception.
    const artifactFiles = new Set(manifest.files.filter((file) => file.path.startsWith("artifacts/")).map((file) => file.path.slice("artifacts/".length)));
    const artifactColumns = await db<{ table_name: string; column_name: string }[]>`
      select table_name, column_name from information_schema.columns
      where table_schema = 'app' and column_name in ('storage_key', 'artifact_id') order by 1, 2`;
    let artifactReferences = 0;
    let missingArtifacts = 0;
    for (const { table_name, column_name } of artifactColumns) {
      const rows = await db.unsafe<{ id: string }[]>(`select distinct ${quote(column_name)}::text as id from app.${quote(table_name)} where ${quote(column_name)} is not null`);
      for (const { id: artifact } of rows) {
        artifactReferences++;
        if (!UUID.test(artifact) || !artifactFiles.has(artifact)) missingArtifacts++;
      }
    }
    if (missingArtifacts && manifest.target !== "test") throw new Error(`${missingArtifacts} referenced private artifact(s) are missing from the restored volume.`);

    // 6. Staff MFA survives the restore: every stored TOTP secret and backup-code set decrypts with the
    //    escrowed secret, exactly as Better Auth's two-factor plugin reads them.
    const factors = await db<{ secret: string; backup_codes: string }[]>`select secret, backup_codes from app.auth_two_factor`;
    for (const factor of factors) {
      try {
        if (!(await symmetricDecrypt({ key: secret, data: factor.secret })) || !(await symmetricDecrypt({ key: secret, data: factor.backup_codes }))) throw new Error("empty");
      } catch {
        throw new Error("A restored staff TOTP secret does not decrypt with the escrowed auth secret.");
      }
    }

    // DEC-005 catalog counts for comparison with the S87 load summary (reported, not asserted here).
    const [catalog] = await db<{ categories: number; origin_warehouses: number; b99_stock_items: number; b99_offers: number }[]>`
      select (select count(*)::int from app.category) as categories,
        (select count(*)::int from app.warehouse where origin_key is not null) as origin_warehouses,
        (select count(*)::int from app.stock_item where sku like 'B99\_%') as b99_stock_items,
        (select count(*)::int from app.offer where sku like 'B99\_%\_OFFER') as b99_offers`;
    console.log(JSON.stringify({
      drill: "PASS", backup: id, source_target: manifest.target, restored_database: restoreDatabase, tables: Object.keys(counts).length,
      rows: Object.values(counts).reduce((sum, n) => sum + n, 0), unbalanced_journals: 0, files: manifest.files.length, photos: photos.length,
      referenced_photos: referenced.length, missing_photos: missing, referenced_artifacts: artifactReferences, missing_artifacts: missingArtifacts, totp_factors: factors.length, catalog, elapsed_ms: Date.now() - started,
    }));
  } finally {
    process.off("SIGTERM", interrupted);
    process.off("SIGINT", interrupted);
    await cleanup();
  }
}

// Real restore of the media/artifacts volume (RELEASE.md runbook): verified extraction of one set's
// archive into a directory that must not exist yet; the operator then mounts or copies it as the volume.
async function extract(requested: string, destination: string) {
  const { complete } = await sets();
  const id = requested === "latest" ? complete.at(-1) : requested;
  if (!id || !complete.includes(id)) throw new Error("No complete backup set with that id.");
  const target = resolve(destination);
  const exists = await readdir(target).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (exists) throw new Error("The extraction directory must not exist yet.");
  const store = openStore(env);
  const work = await mkdtemp(join(tmpdir(), "99ribu-extract-"));
  try {
    await store.get(`${id}/manifest.json`, join(work, "manifest.json"));
    const manifest = parseManifest(await readFile(join(work, "manifest.json")));
    await store.get(`${id}/files.tar`, join(work, "files.tar"));
    await verifyObject(join(work, "files.tar"), manifest.objects["files.tar"], "files.tar");
    await extractArchive(await readFile(join(work, "files.tar")), manifest.files, target);
    console.log(JSON.stringify({ extracted: id, files: manifest.files.length }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const usage = "Use backup.ts create local|test|production | list | prune [--apply] | drill <set-id|latest> --escrow-private-key <path> | extract <set-id|latest> <new-dir>.";
  try {
    if (command === "create" && args.length === 1 && ["local", "test", "production"].includes(args[0])) await create(args[0] as Target);
    else if (command === "list" && args.length === 0) {
      const { complete, incomplete } = await sets();
      console.log(JSON.stringify({ complete, incomplete }));
    } else if (command === "prune" && (args.length === 0 || (args.length === 1 && args[0] === "--apply"))) await prune(args[0] === "--apply");
    else if (command === "extract" && args.length === 2 && (args[0] === "latest" || SET_ID.test(args[0]))) await extract(args[0], args[1]);
    else if (command === "drill" && args.length === 3 && (args[0] === "latest" || SET_ID.test(args[0])) && args[1] === "--escrow-private-key") await drill(args[0], args[2]);
    else throw new Error(usage);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Backup command failed.");
    process.exitCode = 1;
  }
}
