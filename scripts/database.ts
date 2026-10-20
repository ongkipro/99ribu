import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { privateDirectory, readLocalConfig } from "../src/config/local.ts";

readLocalConfig(process.env);
const [command, ...extra] = process.argv.slice(2);
if (!["up", "stop", "status"].includes(command) || extra.length) {
  throw new Error("Use database.ts up|stop|status. Destructive commands are not provided.");
}
if (process.getuid?.() === undefined || process.getgid?.() === undefined) {
  throw new Error("The private socket profile requires a POSIX host.");
}
privateDirectory("postgres");
privateDirectory("pgsocket");
const project = `99ribu-${createHash("sha256").update(process.cwd()).digest("hex").slice(0, 10)}`;
const action = command === "up" ? ["up", "-d", "--wait", "--wait-timeout", "60"] : command === "stop" ? ["stop"] : ["ps"];
const result = spawnSync("docker", ["compose", "--project-name", project, "--file", "compose.yaml", ...action], {
  stdio: "inherit",
  env: { ...process.env, LOCAL_UID: String(process.getuid()), LOCAL_GID: String(process.getgid()) },
});
process.exitCode = result.status ?? 1;
