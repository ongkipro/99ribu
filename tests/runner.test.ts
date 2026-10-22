import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const runner = new URL("../scripts/check-tests.ts", import.meta.url).href;

test("acceptance runner refuses skipped, TODO, failing and empty files but accepts executed checks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "99ribu-runner-"));
  const driver = join(directory, "runner.mjs");
  await writeFile(driver, `import { checkFiles } from ${JSON.stringify(runner)}; await checkFiles(JSON.parse(process.argv[2]));`);
  async function checkFiles(selected: string[]) {
    // A separate script avoids node:test recursion and inherited --eval source in its children.
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const { stdout } = await exec(process.execPath, [driver, JSON.stringify(selected)], { env: environment, timeout: 10000 });
    return JSON.parse(stdout.trim());
  }
  const files: string[] = [];
  try {
    await assert.rejects(checkFiles([]), /No test files/);
    for (const [name, body, expected] of [
      ["pass", "test('observable pass', () => assert.equal(2+2, 4));", true],
      ["skip", "test.skip('required skipped check', () => {});", false],
      ["todo", "test.todo('unfinished check');", false],
      ["fail", "test('observable failure', () => assert.equal(1, 2));", false],
      ["empty", "", false],
    ] as const) {
      const file = join(directory, `${name}.mjs`); files.push(file);
      await writeFile(file, `import test from 'node:test'; import assert from 'node:assert/strict';\n${body}\n`);
      assert.equal((await checkFiles([file])).ok, expected, name);
    }
    assert.equal((await checkFiles([files[0], files[4]])).ok, false, "One passing file cannot hide an empty file");
  } finally {
    for (const file of files) await unlink(file);
    await unlink(driver);
    await rmdir(directory);
  }
});

test("unknown or widened acceptance selections fail before executing any cases", async () => {
  for (const args of [[], ["integration"], ["integration", "--case=missing"], ["browser", "--case=foundation", "--skip"], ["integration", "--case=foundation", "--case=foundation"]]) {
    await assert.rejects(exec(process.execPath, ["--env-file=.env.example", "scripts/check-tests.ts", ...args], { timeout: 10000 }), (error: unknown) => {
      assert.ok(error instanceof Error && "stdout" in error && !String(error.stdout).includes('"passed"'));
      return true;
    });
  }
});

test("all-current selects every direct integration/browser test file and never a historical candidate", async () => {
  const { currentFiles } = await import("../scripts/check-tests.ts");
  const { readdirSync } = await import("node:fs");
  for (const mode of ["integration", "browser"] as const) {
    const expected = readdirSync(`tests/${mode}`).filter((name) => name.endsWith(".test.ts")).map((name) => `tests/${mode}/${name}`).sort();
    assert.ok(expected.length > 0);
    assert.deepEqual(currentFiles(mode), expected);
  }
  const historical = readdirSync("tests/historical").filter((name) => name.endsWith(".test.ts"));
  assert.equal(historical.length, 14);
  const current = new Set(currentFiles("integration").map((file) => file.slice("tests/integration/".length)));
  assert.ok(historical.every((name) => !current.has(name)));
});
