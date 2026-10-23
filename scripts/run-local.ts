import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { readRuntimeConfig } from "../src/config/runtime.ts";

const [mode, ...extra] = process.argv.slice(2);
if (!["dev", "build", "start"].includes(mode) || extra.length) {
  console.error("Usage: run-local.ts dev|build|start; extra arguments are refused.");
  process.exit(1);
}

try {
  // Local: fixed loopback listener. Production (S82): 0.0.0.0:<PORT> inside the container, no dev server.
  const config = readRuntimeConfig(process.env);
  if (config.profile === "production" && mode === "dev") throw new Error("The production profile has no dev server.");
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
    console.error("Could not start the application process.");
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid runtime profile.");
  process.exitCode = 1;
}
