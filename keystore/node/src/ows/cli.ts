/**
 * @module ows/cli
 *
 * The **local subprocess** OWS access profile: an {@link OwsBinding} that
 * shells out to the `ows` binary, one child process per operation.
 *
 * This is the profile to use when OWS is installed as a CLI (the default
 * `curl … | bash` install) rather than as NAPI bindings, and the only one that
 * works when the native package has no prebuilt binary for the host platform.
 * Structured `--json` output is requested wherever the CLI offers it, secrets
 * (mnemonics, private keys) are handed over on **stdin** rather than argv so
 * they never appear in the process table, and the credential travels in
 * `OWS_PASSPHRASE`, which is exactly how the CLI expects an owner passphrase or
 * an `ows_key_…` agent token.
 */

import { spawn } from "node:child_process";

import { InvalidKeyDataError } from "@algorandfoundation/keystore-core";

import { OwsError } from "./errors.ts";
import { toSignResult, toWalletInfo } from "./store.ts";
import type {
  OwsBinding,
  OwsCliBindingOptions,
  OwsCliRunner,
  OwsCreateWalletRequest,
  OwsImportMnemonicRequest,
  OwsImportPrivateKeyRequest,
  OwsSignMessageRequest,
  OwsSignResult,
  OwsSignTransactionRequest,
  OwsWalletInfo,
} from "./types.ts";

/** The default `ows` executable, resolved on `PATH`. */
export const OWS_CLI_BIN = "ows";

/** Environment variable the CLI reads the owner passphrase / API token from. */
export const OWS_PASSPHRASE_ENV = "OWS_PASSPHRASE";

/** Environment variable pointing the CLI at a non-default vault root. */
export const OWS_VAULT_PATH_ENV = "OWS_VAULT_PATH";

/**
 * Creates the default {@link OwsCliRunner}: spawns the `ows` binary, feeds it
 * `input` on stdin and resolves with its stdout.
 *
 * A non-zero exit rejects with the process's stderr, so an OWS denial
 * (`policy denied`, `invalid passphrase`, …) surfaces verbatim and can be
 * classified by {@link import("./errors.ts").toKeyStoreError}.
 *
 * @param bin - Path of the `ows` binary.
 * @returns A runner suitable for {@link OwsCliBindingOptions.run}.
 */
export function createOwsCliRunner(bin: string = OWS_CLI_BIN): OwsCliRunner {
  return (args, { input, env } = {}) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(bin, args, {
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code: number | null) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(new Error(stderr.trim() || `${bin} ${args.join(" ")} exited with code ${code}`));
      });
      child.stdin.end(input ?? "");
    });
}

/** Extracts the first JSON document embedded in a CLI output. */
function parseJson(output: string): unknown {
  const start = output.search(/[[{]/);
  if (start >= 0) {
    try {
      return JSON.parse(output.slice(start)) as unknown;
    } catch {
      // Fall through to the "not JSON" error below.
    }
  }
  throw new InvalidKeyDataError(`the ows CLI did not return JSON: ${output.trim().slice(0, 200)}`);
}

/** Unwraps the `{ wallets: [...] }` envelope some CLI versions print. */
function walletList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const wallets = (value as { wallets?: unknown })?.wallets;
  return Array.isArray(wallets) ? wallets : [];
}

/**
 * Creates an {@link OwsBinding} on the `ows` command-line interface (access
 * profile B: local subprocess).
 *
 * Only the CLI's documented surface is used, so the binding tracks the standard
 * rather than any internal API: `wallet list|create|import|export|delete`,
 * `sign message` and `sign tx`. Operations the CLI does not expose (raw digest
 * signing) are simply absent from the returned binding, which the engine
 * reports as an {@link import("./errors.ts").OwsUnsupportedOperationError}
 * instead of silently substituting a different signing mode.
 *
 * @param options - {@link OwsCliBindingOptions}.
 * @returns The subprocess {@link OwsBinding}.
 *
 * @example
 * ```typescript
 * const binding = createOwsCliBinding({ vaultPath: "/tmp/ows-vault" });
 * const result = await binding.signMessage({
 *   wallet: "agent-treasury",
 *   chain: "evm",
 *   message: "hello",
 *   passphrase: process.env.OWS_PASSPHRASE,
 * });
 * ```
 */
export function createOwsCliBinding(options: OwsCliBindingOptions = {}): OwsBinding {
  const run = options.run ?? createOwsCliRunner(options.bin ?? OWS_CLI_BIN);
  const baseEnv: Record<string, string | undefined> = {
    ...options.env,
    ...(options.vaultPath === undefined ? {} : { [OWS_VAULT_PATH_ENV]: options.vaultPath }),
  };

  /** Runs the CLI with the credential in the environment, never in argv. */
  const exec = (args: string[], extra: { input?: string; passphrase?: string } = {}) => {
    const env: Record<string, string | undefined> = { ...baseEnv };
    if (extra.passphrase !== undefined) env[OWS_PASSPHRASE_ENV] = extra.passphrase;
    return run(args, { input: extra.input, env });
  };

  const listWallets = async (): Promise<OwsWalletInfo[]> =>
    walletList(parseJson(await exec(["wallet", "list", "--json"]))).map(toWalletInfo);

  const getWallet = async (nameOrId: string): Promise<OwsWalletInfo> => {
    const wallet = (await listWallets()).find((w) => w.id === nameOrId || w.name === nameOrId);
    if (!wallet) throw new OwsError("WALLET_NOT_FOUND", `no wallet named ${nameOrId}`);
    return wallet;
  };

  /**
   * Resolves the wallet a mutating command just produced. `wallet create` and
   * `wallet import` print a human summary on some builds, so the vault is
   * re-read by name when the output is not JSON.
   */
  const resolveWallet = async (output: string, name: string): Promise<OwsWalletInfo> => {
    try {
      return toWalletInfo(parseJson(output));
    } catch {
      return getWallet(name);
    }
  };

  return {
    kind: "cli",
    listWallets,
    getWallet,

    async createWallet(request: OwsCreateWalletRequest): Promise<OwsWalletInfo> {
      const args = ["wallet", "create", "--name", request.name];
      if (request.words !== undefined) args.push("--words", String(request.words));
      args.push("--json");
      return resolveWallet(await exec(args, { passphrase: request.passphrase }), request.name);
    },

    async importMnemonic(request: OwsImportMnemonicRequest): Promise<OwsWalletInfo> {
      const args = ["wallet", "import", "--name", request.name, "--mnemonic"];
      if (request.index !== undefined) args.push("--index", String(request.index));
      args.push("--json");
      return resolveWallet(
        await exec(args, { input: `${request.mnemonic}\n`, passphrase: request.passphrase }),
        request.name,
      );
    },

    async importPrivateKey(request: OwsImportPrivateKeyRequest): Promise<OwsWalletInfo> {
      const args = ["wallet", "import", "--name", request.name, "--private-key"];
      if (request.chain !== undefined) args.push("--chain", request.chain);
      args.push("--json");
      return resolveWallet(
        await exec(args, { input: `${request.privateKeyHex}\n`, passphrase: request.passphrase }),
        request.name,
      );
    },

    async deleteWallet(nameOrId: string): Promise<void> {
      const wallet = await getWallet(nameOrId);
      await exec(["wallet", "delete", "--id", wallet.id, "--confirm"]);
    },

    async exportWallet(nameOrId: string, passphrase?: string): Promise<string> {
      const output = await exec(["wallet", "export", "--wallet", nameOrId], { passphrase });
      return output.trim();
    },

    async signMessage(request: OwsSignMessageRequest): Promise<OwsSignResult> {
      const args = [
        "sign",
        "message",
        "--wallet",
        request.wallet,
        "--chain",
        request.chain,
        "--message",
        request.message,
      ];
      if (request.encoding !== undefined) args.push("--encoding", request.encoding);
      args.push("--json");
      return toSignResult(parseJson(await exec(args, { passphrase: request.passphrase })));
    },

    async signTransaction(request: OwsSignTransactionRequest): Promise<OwsSignResult> {
      const args = [
        "sign",
        "tx",
        "--wallet",
        request.wallet,
        "--chain",
        request.chain,
        "--tx",
        request.transactionHex,
        "--json",
      ];
      return toSignResult(parseJson(await exec(args, { passphrase: request.passphrase })));
    },
  };
}
