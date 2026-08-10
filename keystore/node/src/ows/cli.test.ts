import { describe, expect, it } from "vitest";

import { createOwsCliBinding, OWS_PASSPHRASE_ENV, OWS_VAULT_PATH_ENV } from "./cli.ts";
import type { OwsCliRunner } from "./types.ts";

const WALLETS = [
  {
    id: "3198bc9c",
    name: "agent-treasury",
    created_at: "2026-03-22T00:00:00Z",
    accounts: [{ chain_id: "eip155:1", address: "0xab16", derivation_path: "m/44'/60'/0'/0/0" }],
  },
];

interface Invocation {
  args: string[];
  input?: string;
  env?: Record<string, string | undefined>;
}

/** A fake `ows` process: records every invocation and replays canned stdout. */
function fakeCli(outputs: Record<string, string> = {}): {
  run: OwsCliRunner;
  calls: Invocation[];
} {
  const calls: Invocation[] = [];
  const run: OwsCliRunner = (args, options) => {
    calls.push({ args, ...options });
    const key = args.slice(0, 2).join(" ");
    return Promise.resolve(outputs[key] ?? JSON.stringify(WALLETS));
  };
  return { run, calls };
}

describe("createOwsCliBinding", () => {
  it("lists wallets from the CLI's JSON output, snake_case included", async () => {
    const { run, calls } = fakeCli();
    const binding = createOwsCliBinding({ run, vaultPath: "/tmp/ows-vault" });

    const wallets = await binding.listWallets();

    expect(calls[0]?.args).toEqual(["wallet", "list", "--json"]);
    expect(calls[0]?.env?.[OWS_VAULT_PATH_ENV]).toBe("/tmp/ows-vault");
    expect(wallets).toEqual([
      {
        id: "3198bc9c",
        name: "agent-treasury",
        createdAt: "2026-03-22T00:00:00Z",
        accounts: [{ chainId: "eip155:1", address: "0xab16", derivationPath: "m/44'/60'/0'/0/0" }],
      },
    ]);
  });

  it("passes the credential through the environment, never through argv", async () => {
    const { run, calls } = fakeCli({
      "sign message": JSON.stringify({ signature: "0xaabb", recovery_id: 1 }),
    });
    const binding = createOwsCliBinding({ run });

    const result = await binding.signMessage({
      wallet: "agent-treasury",
      chain: "evm",
      message: "hello",
      encoding: "utf8",
      passphrase: "ows_key_secret",
    });

    expect(calls[0]?.args).toEqual([
      "sign",
      "message",
      "--wallet",
      "agent-treasury",
      "--chain",
      "evm",
      "--message",
      "hello",
      "--encoding",
      "utf8",
      "--json",
    ]);
    expect(calls[0]?.args).not.toContain("ows_key_secret");
    expect(calls[0]?.env?.[OWS_PASSPHRASE_ENV]).toBe("ows_key_secret");
    expect(result).toEqual({ signature: "0xaabb", recoveryId: 1 });
  });

  it("signs transactions through `sign tx`", async () => {
    const { run, calls } = fakeCli({ "sign tx": JSON.stringify({ signature: "ccdd" }) });
    const binding = createOwsCliBinding({ run });

    await binding.signTransaction({
      wallet: "agent-treasury",
      chain: "base",
      transactionHex: "02f8",
    });

    expect(calls[0]?.args).toEqual([
      "sign",
      "tx",
      "--wallet",
      "agent-treasury",
      "--chain",
      "base",
      "--tx",
      "02f8",
      "--json",
    ]);
  });

  it("hands a mnemonic to the CLI on stdin rather than on the command line", async () => {
    const mnemonic = "goose puzzle decorate much stable beach";
    const { run, calls } = fakeCli({ "wallet import": "Created wallet 3198bc9c" });
    const binding = createOwsCliBinding({ run });

    const wallet = await binding.importMnemonic({ name: "agent-treasury", mnemonic });

    expect(calls[0]?.args).toEqual([
      "wallet",
      "import",
      "--name",
      "agent-treasury",
      "--mnemonic",
      "--json",
    ]);
    expect(calls[0]?.args.join(" ")).not.toContain(mnemonic);
    expect(calls[0]?.input).toBe(`${mnemonic}\n`);
    // The human-readable output is not JSON, so the vault is re-read by name.
    expect(calls[1]?.args).toEqual(["wallet", "list", "--json"]);
    expect(wallet.id).toBe("3198bc9c");
  });

  it("resolves a wallet name to its id before deleting, and confirms", async () => {
    const { run, calls } = fakeCli({ "wallet delete": "" });
    const binding = createOwsCliBinding({ run });

    await binding.deleteWallet("agent-treasury");

    expect(calls[1]?.args).toEqual(["wallet", "delete", "--id", "3198bc9c", "--confirm"]);
  });

  it("reports an unknown wallet with the canonical OWS code", async () => {
    const { run } = fakeCli();
    const binding = createOwsCliBinding({ run });

    await expect(binding.getWallet("nope")).rejects.toThrow(/WALLET_NOT_FOUND/);
  });

  it("does not expose raw digest signing, which the CLI has no command for", () => {
    const binding = createOwsCliBinding({ run: fakeCli().run });

    expect(binding.signHash).toBeUndefined();
  });
});
