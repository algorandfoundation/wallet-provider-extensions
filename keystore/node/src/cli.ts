#!/usr/bin/env node
/**
 * @module cli
 *
 * `keystore` — a small command-line interface for the Node.js keystore.
 *
 * It is a thin driver over the shared {@link createNodeKeyStore} engine: secret
 * material lives in the OS keychain and all UI-safe metadata in a single sealed
 * file, exactly like any other consumer of `@algorandfoundation/keystore-node`.
 * The CLI ships here (rather than in the meta package) because it is inherently
 * Node-only and depends on this package's server engine; the meta package stays
 * a pure conditional-export resolver.
 *
 * @example
 * ```sh
 * keystore generate seed                 # mint a BIP39 seed (prints the phrase once)
 * keystore generate root --seed <id>     # derive an HD (BIP32-Ed25519) root key
 * keystore generate account --root <id>  # derive the next Ed25519 account key
 * keystore generate falcon --seed <id>   # derive a post-quantum Falcon-1024 key
 * keystore list                          # list key metadata
 * keystore sign <id> --message "hi"      # sign a UTF-8 message (prints hex)
 * keystore verify <id> --message "hi" --signature <hex>
 * keystore export <id>                   # export a key's public data
 * keystore remove <id>                   # delete a key
 * keystore clear                         # remove every key
 * keystore algorithms                    # list active cryptographic capabilities
 * keystore serve                         # run the RPC service over a local socket
 * keystore serve --ws --port 7413        # …or over a WebSocket, for remote consumers
 * ```
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type { KeyData, KeyStoreState } from "@algorandfoundation/keystore-core";
import { generateMnemonic, mnemonicToSeed } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { Store } from "@tanstack/store";

import { createNodeKeyStore, type NodeKeyStore, type NodeKeyStoreOptions } from "./engine.ts";
import {
  createKeyStoreRpcServer,
  createKeyStoreWebSocketServer,
  DEFAULT_KEYSTORE_WS_PORT,
  defaultRpcSocketPath,
} from "./rpc/index.ts";

/** Where the CLI writes its normal and error output. */
export interface CliIO {
  /** Writes a normal output line. */
  out(line: string): void;
  /** Writes an error/diagnostic line. */
  err(line: string): void;
}

/**
 * Injectable dependencies for {@link runCli}, so the command surface can be
 * exercised in tests against an in-memory keychain/metadata store instead of the
 * real OS keychain.
 */
export interface CliDeps {
  /** Output sink; defaults to the process stdout/stderr. */
  io?: Partial<CliIO>;
  /**
   * Factory that builds the keystore from the reactive store. Defaults to
   * {@link createNodeKeyStore} (real OS keychain + sealed metadata file).
   */
  createKeystore?: (options: NodeKeyStoreOptions) => NodeKeyStore;
}

/** The short usage banner printed by `--help` and on unknown commands. */
const USAGE = `keystore — Node.js keystore CLI

Usage: keystore <command> [options]

Commands:
  list                                   List all key metadata
  algorithms                             List active cryptographic capabilities
  generate seed    [--name <label>]      Mint a BIP39 seed (prints the phrase once)
  generate root    --seed <id>           Derive an HD (BIP32-Ed25519) root key
  generate account --root <id> [--index <n>]
                                         Derive the next Ed25519 account key
  generate falcon  --seed <id>           Derive a post-quantum Falcon-1024 key
  generate ed25519 [--name <label>]      Generate a standalone Ed25519 key
  export <id>      [--format <fmt>]      Export a key's public data (default raw)
  sign   <id>      (--message <text> | --hex <hex>)
                                         Sign data; prints a hex signature
  verify <id>      --signature <hex> (--message <text> | --hex <hex>)
                                         Verify a signature
  remove <id>                            Delete a key
  clear                                  Remove every key
  serve            [--socket <path>]     Run the RPC service over a local socket
                                         (Unix domain socket / named pipe) so
                                         other processes can drive this keystore
                   [--ws] [--host <h>] [--port <n>]
                                         Also (or instead) serve a WebSocket, so
                                         a remote consumer — a wallet, a web page
                                         — can drive it. Binds 127.0.0.1:7413 by
                                         default; the link is unauthenticated

Global options:
  --json                                 Emit machine-readable JSON where useful
  -h, --help                             Show this help
`;

/** Hex-encodes a byte array. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Decodes a hex string to bytes, throwing on malformed input. */
function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error(`invalid hex string: ${hex}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Serializes {@link KeyData}, rendering any byte material as hex for display. */
function formatKeyData(data: KeyData): string {
  return JSON.stringify(
    data,
    (_key, value) => (value instanceof Uint8Array ? toHex(value) : value),
    2,
  );
}

/**
 * Resolves the payload bytes to sign/verify from the mutually-exclusive
 * `--message` (UTF-8) and `--hex` options.
 */
function resolvePayload(values: { message?: string; hex?: string }): Uint8Array {
  if (values.message !== undefined && values.hex !== undefined) {
    throw new Error("pass either --message or --hex, not both");
  }
  if (values.message !== undefined) return new TextEncoder().encode(values.message);
  if (values.hex !== undefined) return fromHex(values.hex);
  throw new Error("missing payload: pass --message <text> or --hex <hex>");
}

/**
 * Runs the CLI for the given argument vector (everything after `node <script>`).
 *
 * @param argv - The user arguments (e.g. `process.argv.slice(2)`).
 * @param deps - Optional {@link CliDeps} for output redirection / test injection.
 * @returns The process exit code (`0` on success, non-zero on failure).
 *
 * @example
 * ```typescript
 * const code = await runCli(["list", "--json"]);
 * process.exit(code);
 * ```
 */
export async function runCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const io: CliIO = {
    out: deps.io?.out ?? ((line) => console.log(line)),
    err: deps.io?.err ?? ((line) => console.error(line)),
  };
  const build = deps.createKeystore ?? createNodeKeyStore;

  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    io.out(USAGE);
    return command === undefined ? 1 : 0;
  }

  const store = new Store<KeyStoreState>({ keys: [], status: "idle", algorithms: [] });

  try {
    switch (command) {
      case "list": {
        const keystore = build({ store });
        await keystore.ready;
        const keys = store.state.keys;
        if (rest.includes("--json")) {
          io.out(JSON.stringify(keys, null, 2));
        } else if (keys.length === 0) {
          io.out("No keys stored.");
        } else {
          for (const key of keys) {
            const name = key.metadata?.name ? ` (${String(key.metadata.name)})` : "";
            io.out(`${key.id}  ${key.type}  ${key.algorithm}${name}`);
          }
        }
        return 0;
      }

      case "algorithms": {
        const keystore = build({ store });
        await keystore.ready;
        const algorithms = store.state.algorithms ?? [];
        if (rest.includes("--json")) {
          io.out(JSON.stringify(algorithms, null, 2));
        } else if (algorithms.length === 0) {
          io.out("No capabilities reported.");
        } else {
          for (const cap of algorithms) {
            io.out(`${cap.algorithm}  [${cap.source}]`);
          }
        }
        return 0;
      }

      case "generate":
        return await runGenerate(rest, build, store, io);

      case "serve":
        return await runServe(rest, build, store, io);

      case "export": {
        const { positionals, values } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { format: { type: "string" }, json: { type: "boolean" } },
        });
        const id = positionals[0];
        if (!id) throw new Error("usage: keystore export <id> [--format <fmt>]");
        const keystore = build({ store });
        await keystore.ready;
        const data = await keystore.export(id, { format: values.format ?? "raw" });
        io.out(formatKeyData(data));
        return 0;
      }

      case "sign": {
        const { positionals, values } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { message: { type: "string" }, hex: { type: "string" } },
        });
        const id = positionals[0];
        if (!id) throw new Error("usage: keystore sign <id> (--message <text> | --hex <hex>)");
        const payload = resolvePayload(values);
        const keystore = build({ store });
        await keystore.ready;
        const signature = await keystore.sign(id, payload);
        io.out(toHex(signature));
        return 0;
      }

      case "verify": {
        const { positionals, values } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: {
            message: { type: "string" },
            hex: { type: "string" },
            signature: { type: "string" },
          },
        });
        const id = positionals[0];
        if (!id || !values.signature) {
          throw new Error(
            "usage: keystore verify <id> --signature <hex> (--message <text> | --hex <hex>)",
          );
        }
        const payload = resolvePayload(values);
        const keystore = build({ store });
        await keystore.ready;
        const valid = await keystore.verify(id, payload, fromHex(values.signature));
        io.out(valid ? "valid" : "invalid");
        return valid ? 0 : 1;
      }

      case "remove": {
        const { positionals } = parseArgs({ args: rest, allowPositionals: true });
        const id = positionals[0];
        if (!id) throw new Error("usage: keystore remove <id>");
        const keystore = build({ store });
        await keystore.ready;
        await keystore.remove(id);
        io.out(`Removed ${id}`);
        return 0;
      }

      case "clear": {
        const keystore = build({ store });
        await keystore.ready;
        if (!keystore.clear) throw new Error("this keystore does not support clear");
        await keystore.clear();
        io.out("Cleared all keys.");
        return 0;
      }

      default:
        io.err(`Unknown command: ${command}\n`);
        io.err(USAGE);
        return 1;
    }
  } catch (error) {
    io.err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/**
 * Handles the `generate <kind>` sub-commands (seed / root / account / falcon /
 * ed25519), each mapping to the corresponding {@link NodeKeyStore} call.
 */
async function runGenerate(
  args: string[],
  build: (options: NodeKeyStoreOptions) => NodeKeyStore,
  store: Store<KeyStoreState>,
  io: CliIO,
): Promise<number> {
  const [kind, ...rest] = args;
  const { values } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      name: { type: "string" },
      seed: { type: "string" },
      root: { type: "string" },
      index: { type: "string" },
      json: { type: "boolean" },
    },
  });

  const keystore = build({ store });
  await keystore.ready;

  switch (kind) {
    case "seed": {
      const mnemonic = generateMnemonic(wordlist, 256);
      const seed = await mnemonicToSeed(mnemonic);
      const seedId = await keystore.importSeed!(seed, { name: values.name ?? "Wallet Seed" });
      if (values.json) {
        io.out(JSON.stringify({ seedId, mnemonic }, null, 2));
      } else {
        io.out(`Seed id:  ${seedId}`);
        io.out(`Mnemonic (store safely — shown once):\n${mnemonic}`);
      }
      return 0;
    }

    case "root": {
      if (!values.seed) throw new Error("usage: keystore generate root --seed <id>");
      const rootKeyId = await keystore.generate({
        type: "hd-root-key",
        algorithm: "raw",
        extractable: false,
        keyUsages: ["deriveBits", "deriveKey"],
        params: { parentKeyId: values.seed },
      });
      io.out(values.json ? JSON.stringify({ rootKeyId }, null, 2) : rootKeyId);
      return 0;
    }

    case "account": {
      if (!values.root) throw new Error("usage: keystore generate account --root <id> [--index n]");
      const index = values.index ? Number.parseInt(values.index, 10) : 0;
      if (Number.isNaN(index) || index < 0)
        throw new Error("--index must be a non-negative integer");
      const accountId = await keystore.deriveFromSeed!(values.root, `m/44'/283'/0'/0/${index}`);
      io.out(values.json ? JSON.stringify({ accountId, index }, null, 2) : accountId);
      return 0;
    }

    case "falcon": {
      if (!values.seed) throw new Error("usage: keystore generate falcon --seed <id>");
      const falconId = await keystore.generate({
        type: "falcon-1024",
        algorithm: "Falcon-1024",
        extractable: false,
        keyUsages: ["sign", "verify"],
        params: { parentKeyId: values.seed },
      });
      io.out(values.json ? JSON.stringify({ falconId }, null, 2) : falconId);
      return 0;
    }

    case "ed25519": {
      const keyId = await keystore.generate({
        type: "ed25519",
        algorithm: "EdDSA",
        extractable: false,
        keyUsages: ["sign", "verify"],
        params: values.name ? { name: values.name } : undefined,
      });
      io.out(values.json ? JSON.stringify({ keyId }, null, 2) : keyId);
      return 0;
    }

    default:
      throw new Error("usage: keystore generate <seed|root|account|falcon|ed25519> [options]");
  }
}

/**
 * Handles the `serve` command: builds the Node keystore and hosts it so other
 * processes can drive it through the drop-in
 * {@link import("./rpc/client.ts").createRpcKeyStore} client (or any transport's
 * equivalent).
 *
 * By default it listens on a local socket only — the private choice, gated by
 * filesystem permissions. `--ws` additionally opens a WebSocket, which is what
 * a *remote* consumer (a wallet, a web page) connects to; pass `--ws --socket
 * ""` to serve the WebSocket alone. The command runs until interrupted
 * (SIGINT/SIGTERM), then shuts every listener down cleanly.
 */
async function runServe(
  args: string[],
  build: (options: NodeKeyStoreOptions) => NodeKeyStore,
  store: Store<KeyStoreState>,
  io: CliIO,
): Promise<number> {
  const { values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      socket: { type: "string" },
      ws: { type: "boolean" },
      host: { type: "string" },
      port: { type: "string" },
    },
  });

  const port = values.port ? Number.parseInt(values.port, 10) : DEFAULT_KEYSTORE_WS_PORT;
  if (Number.isNaN(port) || port < 0 || port > 65535) {
    throw new Error("--port must be a TCP port number");
  }
  // An explicit empty `--socket` means "WebSocket only"; otherwise the local
  // socket is always served, because it is the safe default.
  const socketPath = values.socket === "" ? undefined : (values.socket ?? defaultRpcSocketPath());
  if (socketPath === undefined && values.ws !== true) {
    throw new Error("nothing to serve: pass --ws when disabling the local socket");
  }

  const keystore = build({ store });
  await keystore.ready;

  const stop: Array<() => Promise<void>> = [];

  if (socketPath !== undefined) {
    const server = createKeyStoreRpcServer({ keystore, store, path: socketPath });
    io.out(`keystore RPC listening on ${await server.listen()}`);
    stop.push(() => server.close());
  }

  if (values.ws === true) {
    const server = createKeyStoreWebSocketServer({
      keystore,
      store,
      port,
      ...(values.host === undefined ? {} : { host: values.host }),
    });
    io.out(`keystore RPC listening on ${await server.listen()}`);
    io.err("The WebSocket link is unauthenticated; keep it on loopback or behind TLS.");
    stop.push(() => server.close());
  }

  io.out("Press Ctrl+C to stop.");

  // Keep the process alive until interrupted, then close the services cleanly.
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      io.err("\nShutting down…");
      Promise.all(stop.map((close) => close())).finally(resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  return 0;
}

/**
 * True when this module is the process entry point (`node cli.js`, or the
 * `keystore` bin — usually a symlink in `node_modules/.bin`).
 *
 * Comparing `import.meta.url` to `` `file://${process.argv[1]}` `` does not
 * work: Node resolves the main module through its real path while `argv[1]`
 * keeps the symlink, so the bin shim never matched and the published binary
 * silently did nothing. It also never matched on Windows (`file://C:\…` vs
 * `file:///C:/…`) or for paths needing URL escaping. Comparing real paths is
 * exact on every platform; `import.meta.main` is not available on the Node 22
 * target. Any error (no `argv[1]`, a path that vanished) simply means "not the
 * entry point".
 */
function isEntryPoint(): boolean {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Entry point when executed directly as the `keystore` bin. Guarded so importing
// this module (e.g. from tests) does not run the CLI.
if (isEntryPoint()) {
  runCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
