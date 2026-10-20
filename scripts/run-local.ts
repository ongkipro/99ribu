import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { readLocalConfig } from "../src/config/local.ts";

const [mode, ...extra] = process.argv.slice(2);
if (!["dev", "build", "start"].includes(mode) || extra.length) {
  console.error("Usage: run-local.ts dev|build|start; extra arguments are refused.");
  process.exit(1);
}

try {
  const config = readLocalConfig(process.env);
  const args = [resolve("node_modules/next/dist/bin/next"), mode];
  if (mode !== "build") args.push("--hostname", config.hostname, "--port", String(config.port));
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", () => {
    console.error("Could not start the local application process.");
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid local profile.");
  process.exitCode = 1;
}
