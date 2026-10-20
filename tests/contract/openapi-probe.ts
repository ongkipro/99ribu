import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export type Exchange = {
  url: string; method: string; request_headers: Record<string, string>; request_body?: string;
  body_bytes?: number; request_valid?: boolean; status: number; headers: Record<string, string>; payload: unknown;
};

export function validateExchanges(samples: Exchange[], group = "access") {
  const result = spawnSync("python3", ["tests/contract/openapi-probe.py"], {
    input: JSON.stringify({ samples, group }), encoding: "utf8", timeout: 15000, maxBuffer: 4096,
  });
  assert.equal(result.status, 0, result.stderr || "Contract probe failed without payload disclosure.");
  assert.equal(JSON.parse(result.stdout).ok, true);
}
