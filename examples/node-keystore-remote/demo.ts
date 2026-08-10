/**
 * Runs the whole story end to end, so the example is a single command.
 *
 * It starts {@link file://./daemon.ts} in its own process, waits for it to
 * report the URL it bound, then runs {@link file://./consumer.ts} against it and
 * shuts the daemon down. Two processes, one machine — but the consumer only
 * ever knows a URL, which is exactly what makes the same script work when the
 * daemon is on another host.
 *
 * Run it with:
 * ```sh
 * pnpm --filter node-keystore-remote-example start
 * ```
 */

import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

/** A spawned example process: no stdin, both output streams piped to us. */
type ExampleProcess = ChildProcessByStdio<null, Readable, Readable>;

/** Runs a TypeScript entry point in its own Node process, through tsx. */
function run(script: string, args: string[] = []): ExampleProcess {
  return spawn(
    process.execPath,
    ["--import", "tsx", fileURLToPath(new URL(script, import.meta.url)), ...args],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KEYSTORE_WS_PORT: "0" } },
  );
}

/** Mirrors a child's output under a label, and resolves once `marker` appears. */
function pipe(child: ExampleProcess, label: string, marker?: RegExp): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const echo = (chunk: Buffer, stream: NodeJS.WriteStream): void => {
      const text = chunk.toString("utf8");
      for (const line of text.split("\n")) {
        if (line.length > 0) stream.write(`[${label}] ${line}\n`);
      }
      const found = marker?.exec(text);
      if (found) resolve(found[0]);
    };
    child.stdout.on("data", (chunk: Buffer) => echo(chunk, process.stdout));
    child.stderr.on("data", (chunk: Buffer) => echo(chunk, process.stderr));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (marker) reject(new Error(`${label} exited (${code}) before it was ready`));
      else if (code === 0) resolve("");
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

async function main(): Promise<void> {
  const daemon = run("daemon.ts");
  const url = await pipe(daemon, "daemon", /ws:\/\/\S+/);
  console.log(`\n--- daemon is up on ${url}; starting the remote consumer ---\n`);

  try {
    await pipe(run("consumer.ts", [url]), "consumer");
  } finally {
    daemon.kill("SIGINT");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
