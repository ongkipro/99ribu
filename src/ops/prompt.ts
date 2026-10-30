import { createInterface } from "node:readline";
import { Writable } from "node:stream";

// Operator input for the production commands (scripts/staff.ts, scripts/catalog.ts). Prompts go to stderr, so
// stdout stays one JSON summary. On a TTY a secret is read without echo; piped stdin (tests, a scripted run)
// supplies one line per answer. Values stay in process memory and are never printed or logged.
export function operatorPrompt() {
  const tty = Boolean(process.stdin.isTTY);
  let muted = false;
  const output = new Writable({ write(chunk, _encoding, done) { if (!muted) process.stderr.write(chunk); done(); } });
  const reader = createInterface({ input: process.stdin, output, terminal: tty });
  const lines = reader[Symbol.asyncIterator]();
  return {
    async ask(question: string, secret = false) {
      process.stderr.write(question);
      muted = secret && tty;
      const next = await lines.next();
      muted = false;
      if (secret && tty) process.stderr.write("\n");
      if (next.done) throw new Error("Operator input ended before every answer was given.", { cause: "visible" });
      return next.value as string;
    },
    say(text: string) { process.stderr.write(`${text}\n`); },
    close() { reader.close(); },
  };
}
