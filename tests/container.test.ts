import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// S84 static checks of the image recipe; `docker build` + container smoke are the README commands.
const dockerfile = readFileSync("Dockerfile", "utf8");
const ignore = readFileSync(".dockerignore", "utf8").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
const stages = dockerfile.split(/^FROM /m).slice(1);
const runtime = stages.at(-1) ?? "";

test("Dockerfile: digest-pinned bases, Node from .node-version, npm ci + build, PostgreSQL client equal to the database image", () => {
  const froms = [...dockerfile.matchAll(/^FROM (\S+)/gm)].map((match) => match[1]);
  assert.ok(froms.length >= 3);
  for (const image of froms) assert.match(image, /^[a-z0-9./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/, image);
  const node = readFileSync(".node-version", "utf8").trim();
  assert.ok(froms.filter((image) => image.startsWith("node:")).every((image) => image.startsWith(`node:${node}-`)));
  const engines = JSON.parse(readFileSync("package.json", "utf8")).engines;
  assert.equal(engines.node, node);
  assert.match(dockerfile, new RegExp(`npm install --global --ignore-scripts npm@${engines.npm.replaceAll(".", "\\.")}\\n`));
  assert.match(dockerfile, /^RUN npm ci$/m);
  assert.match(dockerfile, /^RUN npm run build && npm prune --omit=dev/m);
  const composeImage = /image: (postgres:[^\s]+)/.exec(readFileSync("compose.yaml", "utf8"))?.[1];
  assert.ok(composeImage && froms.includes(composeImage), "backup client comes from the same pinned PostgreSQL image");
  const serverVersion = /^postgres:(\d+\.\d+)-/.exec(composeImage)?.[1];
  assert.match(runtime, new RegExp(`postgresql-client-18=${serverVersion?.replace(".", "\\.")}-`));
});

test("Dockerfile runtime stage: fixed non-root uid, node-only HEALTHCHECK, explicit allow-list, migrate-then-start", () => {
  const user = /^USER (\d+):(\d+)$/m.exec(runtime);
  assert.ok(user && Number(user[1]) >= 1000 && Number(user[2]) >= 1000, "numeric non-root USER");
  assert.match(runtime, /^HEALTHCHECK .*CMD \["node", "scripts\/healthcheck\.ts"\]$/m);
  assert.match(runtime, /^STOPSIGNAL SIGTERM$/m);
  assert.match(runtime, /^ENTRYPOINT \["\/usr\/bin\/tini", "--"\]$/m, "an init process forwards signals and reaps children");
  assert.match(runtime, /install -d -o 10001 -g 10001 -m 0700 \.local \.local\/catalog-media \.local\/artifacts/);
  const copies = [...runtime.matchAll(/^COPY --from=build (.+) \S+$/gm)].flatMap((match) => match[1].split(" "));
  for (const source of copies) {
    assert.ok(!/\.env|\/tests|\/\.local|\/\.delivery|\/design|prototypes|localhost-commerce/.test(source), source);
    assert.ok(!source.startsWith("/app/docs") || source === "/app/docs/spec/fixtures/shipping-local.json", source);
  }
  assert.ok(!/^COPY (?!--from=)/m.test(runtime), "runtime copies only from the build stage");
  // The S82 production listener only; migrations run in compose.production.yaml's one-shot `migrate` service.
  assert.match(runtime, /^CMD \["node", "scripts\/run-local\.ts", "start"\]$/m);
  const compose = readFileSync("compose.production.yaml", "utf8").replace(/^\s*#.*$/gm, "");
  // Only the one-shot migrate service receives the owner password; web and worker wait for it to succeed.
  assert.equal(compose.match(/^\s+DATABASE_OWNER_PASSWORD:/gm)?.length, 1);
  assert.match(compose, /migrate:\n(?:.*\n)*?\s+command: \["node", "scripts\/migrate\.ts", "production"\]/);
  assert.equal(compose.match(/condition: service_completed_successfully/g)?.length, 2);
});

test(".dockerignore keeps private, test and design material out of the build context", () => {
  for (const entry of [".git", ".local", ".delivery", ".env", ".env.*", "!.env.example", "**/*.key", "**/*.pem", "tests", "docs", "design", "public/prototypes", "public/catalog-local", "**/node_modules", ".next"]) {
    assert.ok(ignore.includes(entry), entry);
  }
  // The only re-included docs file is the shipping JSON the runtime imports.
  assert.deepEqual(ignore.filter((line) => line.startsWith("!")), ["!.env.example", "!docs/spec/fixtures/shipping-local.json"]);
});

// Async spawn: the probe calls the in-process server below, so the event loop must keep running.
const probe = (env: Record<string, string>) => new Promise<number | null>((done) => {
  spawn(process.execPath, ["scripts/healthcheck.ts"], { env: { PATH: process.env.PATH, ...env } as unknown as NodeJS.ProcessEnv, timeout: 10000, stdio: "ignore" }).on("close", done);
});

test("healthcheck: worker heartbeat must be fresh; web must answer /api/health 200", async () => {
  const directory = await mkdtemp(join(tmpdir(), "99ribu-healthcheck-"));
  let status = 200;
  const server = createServer((request, response) => response.writeHead(request.url === "/api/health" ? status : 404).end());
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const heartbeat = join(directory, "heartbeat");
    assert.equal(await probe({ WORKER_HEARTBEAT_FILE: heartbeat }), 1, "missing heartbeat");
    await writeFile(heartbeat, "1\n");
    assert.equal(await probe({ WORKER_HEARTBEAT_FILE: heartbeat }), 0, "fresh heartbeat");
    const old = new Date(Date.now() - 120_000);
    await utimes(heartbeat, old, old);
    assert.equal(await probe({ WORKER_HEARTBEAT_FILE: heartbeat }), 1, "stale heartbeat");
    const port = String((server.address() as AddressInfo).port);
    assert.equal(await probe({ PORT: port }), 0, "ready");
    status = 503;
    assert.equal(await probe({ PORT: port }), 1, "unavailable");
    assert.equal(await probe({ PORT: "not-a-port" }), 1, "invalid port");
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("image audit patterns: private, test and design material is flagged; runtime files and third-party packages are not", async () => {
  const { forbiddenFile } = await import("../scripts/image-audit.ts");
  for (const path of [
    "/app/.env", "/app/.env.production", "/app/.env.example", "/app/.local/auth/local.key", "/app/.local/catalog-media/x.webp",
    "/app/tests/smoke.test.ts", "/app/src/x.test.ts", "/app/public/prototypes/index.html", "/app/docs/spec/fixtures/localhost-commerce.json",
    "/app/docs/spec/openapi.yaml", "/app/design/review.md", "/app/scripts/check-tests.ts", "/app/.delivery/runs/x.json", "/root/.env", "/etc/server.key",
  ]) assert.equal(forbiddenFile(path), true, path);
  for (const path of [
    "/app/docs/spec/fixtures/shipping-local.json", "/app/scripts/backup.ts", "/app/src/ops/backup.ts", "/app/data/catalog/berlapak/manifest.json",
    "/app/public/brand/logo-512.png", "/app/node_modules/some-package/test/fixture.key", "/usr/local/bin/node",
  ]) assert.equal(forbiddenFile(path), false, path);
});
