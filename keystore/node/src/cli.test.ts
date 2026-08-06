import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { KeyStoreState } from "@algorandfoundation/keystore-core";
import type { Store } from "@tanstack/store";
import { describe, expect, it } from "vitest";

import { runCli } from "./cli.ts";
import { createNodeKeyStore } from "./engine.ts";
import type { KeyringBinding } from "./storage/keyring.ts";
import type { MetadataFile } from "./storage/metadata.ts";

/** A fresh in-memory OS-keychain fake. */
function memoryKeyring(): KeyringBinding {
  const map = new Map<string, string>();
  return {
    get: (account) => (map.has(account) ? (map.get(account) as string) : null),
    set: (account, secret) => {
      map.set(account, secret);
    },
    delete: (account) => map.delete(account),
  };
}

/** A fresh in-memory sealed-metadata file fake. */
function memoryMetadata(): MetadataFile {
  let blob: Uint8Array | null = null;
  return {
    read: () => blob,
    write: (b) => {
      blob = b;
    },
    remove: () => {
      blob = null;
    },
  };
}

/**
 * Builds a {@link runCli} deps object wired to a shared in-memory keychain +
 * metadata, plus a capturing IO sink, so a whole CLI flow persists across calls.
 */
function harness() {
  const keyring = memoryKeyring();
  const metadata = memoryMetadata();
  const lines: string[] = [];
  const errors: string[] = [];
  const deps = {
    io: { out: (l: string) => lines.push(l), err: (l: string) => errors.push(l) },
    createKeystore: (options: { store: Store<KeyStoreState> }) =>
      createNodeKeyStore({ ...options, keyring, metadata }),
  };
  return { deps, lines, errors, output: () => lines.join("\n") };
}

describe("runCli", () => {
  it("shows usage and exits non-zero with no command", async () => {
    const { deps, output } = harness();
    const code = await runCli([], deps);
    expect(code).toBe(1);
    expect(output()).toContain("Usage: keystore <command>");
  });

  it("reports capabilities including host and shim sources", async () => {
    const { deps, output } = harness();
    const code = await runCli(["algorithms", "--json"], deps);
    expect(code).toBe(0);
    const caps = JSON.parse(output()) as { algorithm: string; source: string }[];
    expect(caps.some((c) => c.source === "host")).toBe(true);
    expect(caps.some((c) => c.algorithm === "BIP32-Ed25519")).toBe(true);
  });

  it("runs the seed → root → account lifecycle and signs/verifies", async () => {
    // A single shared harness so the keychain persists across CLI invocations.
    const { deps, lines } = harness();

    const seedCode = await runCli(["generate", "seed", "--json"], deps);
    expect(seedCode).toBe(0);
    const { seedId, mnemonic } = JSON.parse(lines.at(-1) as string);
    expect(typeof seedId).toBe("string");
    expect(mnemonic.split(" ")).toHaveLength(24);

    const rootCode = await runCli(["generate", "root", "--seed", seedId, "--json"], deps);
    expect(rootCode).toBe(0);
    const { rootKeyId } = JSON.parse(lines.at(-1) as string);

    const acctCode = await runCli(
      ["generate", "account", "--root", rootKeyId, "--index", "0", "--json"],
      deps,
    );
    expect(acctCode).toBe(0);
    const { accountId } = JSON.parse(lines.at(-1) as string);

    const signCode = await runCli(["sign", accountId, "--message", "hello"], deps);
    expect(signCode).toBe(0);
    const signature = lines.at(-1) as string;
    expect(signature).toMatch(/^[0-9a-f]+$/);

    const verifyCode = await runCli(
      ["verify", accountId, "--message", "hello", "--signature", signature],
      deps,
    );
    expect(verifyCode).toBe(0);
    expect(lines.at(-1)).toBe("valid");

    const listCode = await runCli(["list", "--json"], deps);
    expect(listCode).toBe(0);
    const keys = JSON.parse(lines.at(-1) as string) as { id: string }[];
    expect(keys.map((k) => k.id)).toEqual(expect.arrayContaining([seedId, rootKeyId, accountId]));
  });

  it("fails verification of a tampered message with exit code 1", async () => {
    const { deps, lines } = harness();
    await runCli(["generate", "seed", "--json"], deps);
    const { seedId } = JSON.parse(lines.at(-1) as string);
    await runCli(["generate", "root", "--seed", seedId, "--json"], deps);
    const { rootKeyId } = JSON.parse(lines.at(-1) as string);
    await runCli(["generate", "account", "--root", rootKeyId, "--json"], deps);
    const { accountId } = JSON.parse(lines.at(-1) as string);
    await runCli(["sign", accountId, "--message", "hello"], deps);
    const signature = lines.at(-1) as string;

    const code = await runCli(
      ["verify", accountId, "--message", "tampered", "--signature", signature],
      deps,
    );
    expect(code).toBe(1);
    expect(lines.at(-1)).toBe("invalid");
  });

  it("returns an error for an unknown command", async () => {
    const { deps, errors } = harness();
    const code = await runCli(["frobnicate"], deps);
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("Unknown command: frobnicate");
  });
});

/**
 * The `bin` entry itself: package managers install it as a symlink (or a shim)
 * in `node_modules/.bin`, so the entry-point guard must still fire when the CLI
 * is invoked through that indirection — comparing `import.meta.url` against
 * `` `file://${process.argv[1]}` `` did not, which made the published binary a
 * silent no-op. Runs against the built `dist/cli.js` and is skipped when the
 * package has not been built.
 */
describe("keystore bin entry point", () => {
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

  it.skipIf(!existsSync(cli))("prints usage when invoked through a symlinked bin", () => {
    const dir = mkdtempSync(join(tmpdir(), "keystore-bin-"));
    const link = join(dir, "keystore");
    try {
      symlinkSync(cli, link);
      const result = spawnSync(process.execPath, [link, "--help"], { encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: keystore <command> [options]");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
