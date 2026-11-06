import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// The test runner holds its run lock on a reserved connection for the whole campaign. After postgres.js max_lifetime
// (30-60 min in production) such a connection is flagged "ending" but never closed, so a plain sql.end() never
// resolved and the process hung after printing its result (full campaigns of 59 and 77 minutes). Here max_lifetime is
// 1 s so the same state is reached in seconds, in a child process that can be killed.
const child = (mode: "plain" | "bounded") => `
import postgres from "postgres";
import { privateDirectory } from "./src/config/local.ts";
import { endDatabase } from "./scripts/check-tests.ts";
const sql = postgres({ path: privateDirectory("pgsocket") + "/.s.PGSQL.5432", database: "99ribu_test", username: "99ribu_test_app", max: 2, max_lifetime: 1, onnotice: () => {} });
const lock = await sql.reserve();
await lock\`select pg_try_advisory_lock(hashtext('99ribu:runner-shutdown-test'))\`;
await new Promise((resolve) => setTimeout(resolve, 2500));
lock.release();
console.log("REACHED_END");
${mode === "plain" ? "await sql.end();" : "await endDatabase(sql);"}
`;
const run = (mode: "plain" | "bounded", timeout: number) =>
	spawnSync(process.execPath, ["--env-file=.env.example", "--input-type=module", "-e", child(mode)], { cwd: process.cwd(), timeout, killSignal: "SIGKILL", encoding: "utf8" });

test("runner shutdown: the bounded end completes after the lock connection outlived max_lifetime", () => {
	const result = run("bounded", 30000);
	assert.equal(result.signal, null, `hung: ${result.stderr}`);
	assert.equal(result.status, 0, result.stderr);
});

test("runner shutdown control: a plain sql.end() hangs in the same state (the defect this guards)", () => {
	const result = run("plain", 9000);
	assert.match(String(result.stdout), /REACHED_END/, "the child reached the shutdown call");
	assert.equal(result.signal, "SIGKILL", "the plain end must still be pending when the 9 s limit kills it");
});
