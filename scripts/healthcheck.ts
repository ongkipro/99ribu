import { stat } from "node:fs/promises";

// Container HEALTHCHECK (S84). Uses only the node binary already in the image (no curl/wget).
// Web: GET http://127.0.0.1:$PORT/api/health must answer 200 (the route itself checks the database).
// Worker (no HTTP): WORKER_HEARTBEAT_FILE must have been touched by the worker loop within 60 s.
const heartbeat = process.env.WORKER_HEARTBEAT_FILE;
const port = process.env.PORT ?? "3000";
try {
  if (heartbeat) {
    process.exitCode = Date.now() - (await stat(heartbeat)).mtimeMs <= 60_000 ? 0 : 1;
  } else if (!/^[1-9]\d{0,4}$/.test(port)) {
    process.exitCode = 1;
  } else {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(4000) });
    process.exitCode = response.status === 200 ? 0 : 1;
  }
} catch {
  process.exitCode = 1;
}
