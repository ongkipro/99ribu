import assert from "node:assert/strict";
import test from "node:test";

test("built localhost server renders the public storefront without claiming complete commerce acceptance", async () => {
  const response = await fetch("http://127.0.0.1:3099", { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  
  assert.equal(response.headers.get("x-powered-by"), null);
  const html=await response.text();
  assert.match(html, /<html lang="id"/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /Pilihan lengkap/);
  assert.match(html, /Data contoh/);
  const favicon=await fetch('http://127.0.0.1:3099/favicon.ico');
  assert.equal(favicon.status,204);assert.equal(await favicon.text(),'');
});

test("public readiness checks the local schema without exposing internal or user data", async () => {
  const response = await fetch("http://127.0.0.1:3099/api/health", {
    signal: AbortSignal.timeout(5000),
    headers: { authorization: "Bearer synthetic-do-not-reflect", baggage: "secret=synthetic-do-not-reflect" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { service: "99ribu", status: "ready" });
});
