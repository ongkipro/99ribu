import {resetBrowserAuthLimits} from './integration/storefront-http-fixture.ts';
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { chromium } from "@playwright/test";
import { connectDatabase } from "../src/db/client.ts";
import { activateOverHttp } from "./integration/http-activation.ts";

const origin = "http://127.0.0.1:3099";

test("built localhost auth uses browser HttpOnly cookies, denies CSRF and keeps inbox private", async () => {
 await resetBrowserAuthLimits();
  const connection = connectDatabase("local");
  const email = `browser-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  let userId = "";
  let worker: ChildProcess | undefined;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const initial = await page.goto(origin);
    assert.equal(initial?.status(), 200); // Public storefront is real; later commerce screens retain their own gates.
    const post = (path: string, body: Record<string, unknown>) => page.evaluate(async ({ path, body }) => {
      const response = await fetch(`/api/auth${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, payload: await response.json() };
    }, { path, body });
    const signup = await post("/sign-up/email", { name: "Browser Synthetic", email, phone: "081234567890" });
    assert.equal(signup.status, 200);
    const [user] = await connection.sql`select id from app.auth_user where email=${email}`;
    userId = user.id;
    const [pending] = await connection.sql`select id, delivered_at from app.local_delivery where recipient=${email} and kind='password_reset'`;
    assert.ok(pending.delivered_at === null, "Web must commit its intent while the separate worker is stopped");
    worker = spawn(process.execPath, ["--env-file=.env.example", "scripts/worker.ts", "local"], { stdio: "ignore" });
    let delivered = false;
    for (let i = 0; i < 100; i++) {
      const [row] = await connection.sql`select delivered_at from app.local_delivery where id=${pending.id}`;
      if (row.delivered_at) { delivered = true; break; }
      await setTimeout(50);
    }
    assert.ok(delivered, "Separate worker must deliver the web-created intent");
    // S123: the delivered set-password link creates the password (and verifies the email).
    await activateOverHttp(connection.sql, context.request, email, password);
    const login = await post("/sign-in/email", { email, password });
    assert.equal(login.status, 200);
    assert.ok(!Object.hasOwn(login.payload, "token"));
    const cookie = (await context.cookies()).find((item) => item.name === "99ribu-local.session_token");
    assert.ok(cookie?.httpOnly && cookie.sameSite === "Lax" && cookie.domain === "127.0.0.1" && !cookie.secure);
    assert.ok(!(await page.evaluate(() => document.cookie)).includes("session_token"));
    const signedIn = await page.evaluate(async () => {
      const response = await fetch("/api/auth/get-session");
      const payload = await response.json();
      return { authenticated: !!payload?.user, exposedToken: !!payload?.session?.token, cache: response.headers.get("cache-control") };
    });
    assert.equal(signedIn.authenticated, true); assert.equal(signedIn.exposedToken, false); assert.equal(signedIn.cache, "no-store");
    const forged = await context.request.post(`${origin}/api/auth/sign-out`, { headers: { origin: "https://evil.invalid" }, data: {} });
    assert.equal(forged.status(), 403);
    assert.equal((await context.request.get(`${origin}/api/auth/get-session`, { headers: { host: "localhost:3099" } })).status(), 403);
    for (const path of ["/api/auth/list-sessions", "/api/auth/local-inbox", "/.local/auth/local.key"]) {
      assert.equal((await context.request.get(`${origin}${path}`)).status(), 404);
    }
    assert.equal((await post("/sign-out", {})).status, 200);
    const revoked = await page.evaluate(async () => (await fetch("/api/auth/get-session")).json());
    assert.ok(revoked === null);
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      const stopped = once(worker, "exit"); worker.kill("SIGTERM"); await stopped;
    }
    await browser.close();
    await connection.sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
    await connection.sql`delete from app.local_delivery where recipient=${email}`;
    if (userId) {
      await connection.sql`delete from app.auth_verification where value=${userId}`;
      await connection.sql`delete from app.buyer_profile where user_id=${userId}`;
      await connection.sql`delete from app.auth_user where id=${userId}`;
    }
    await connection.sql.end();
  }
});
