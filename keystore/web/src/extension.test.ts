import "fake-indexeddb/auto";

import type { KeyStore, KeyStoreState } from "@algorandfoundation/keystore-core";
import { Store } from "@tanstack/store";
import Hook from "before-after-hook";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WithKeyStore, type WebKeystoreOptions } from "./extension.ts";

const message = new TextEncoder().encode("the quick brown fox");

let dbCounter = 0;

/**
 * Builds the browser extension over the shared engine, matching the
 * Provider/Extensions pattern: the state store and hooks arrive through
 * `options.keystore`. No `shims` are passed, so the engine enables the full
 * default set from core.
 */
function createTestSetup() {
  const store = new Store<KeyStoreState>({ keys: [], status: "idle" });
  const hooks = new Hook.Collection<any>();
  const options: WebKeystoreOptions = {
    keystore: { store, hooks, databaseName: `keystore-ext-${dbCounter++}` },
  };
  const provider = { log: { debug: vi.fn() } } as any;
  const extension = WithKeyStore(provider, options);
  return { store, hooks, extension };
}

describe("WithKeyStore Extension (web)", () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(async () => {
    setup = createTestSetup();
    await (setup.extension.key.store as unknown as KeyStore<void>).ready;
  });

  it("initializes reactive properties and exposes the engine + hooks", () => {
    const { extension, hooks } = setup;
    expect(extension.keys).toEqual([]);
    expect(extension.status).toBe("idle");
    expect(extension.key.store).toBeDefined();
    // The extension is the single source of the API and threads its hooks in.
    expect(extension.key.store.hooks).toBe(hooks);
  });

  it("runs the HD flow through the engine (default shims) and fires the hooks", async () => {
    const { extension, hooks } = setup;
    const generateBefore = vi.fn();
    const signBefore = vi.fn();
    hooks.before("generate", generateBefore);
    hooks.before("sign", signBefore);

    const seedId = await extension.key.store.importSeed!(new Uint8Array(32).fill(1));
    const rootId = await extension.key.store.generate({
      type: "hd-root-key",
      algorithm: "raw",
      extractable: false,
      keyUsages: ["sign"],
      params: { parentKeyId: seedId },
    });
    const acctId = await extension.key.store.deriveFromSeed!(rootId, "m/44'/283'/0'/0/0");

    const signature = await extension.key.store.sign(acctId, message);
    expect(await extension.key.store.verify(acctId, message, signature)).toBe(true);

    expect(generateBefore).toHaveBeenCalled();
    expect(signBefore).toHaveBeenCalled();
  });
});
