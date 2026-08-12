import { createSecretScratch } from "@algorandfoundation/provider-migrations";
import { assertIdempotent } from "@algorandfoundation/provider-migrations/testing";
import { describe, expect, it } from "vitest";
import { memoryStorage, seedLegacyPasskey } from "../storage/__fixtures__.ts";
import { PASSKEY_MIGRATION_NEEDED } from "../storage/driver.ts";
import { migration } from "./0001-flag-legacy-passkeys.ts";

describe("revision 0001 — flag-legacy-passkeys", () => {
  it("is revision 1", () => {
    expect(migration.id).toBe(1);
    expect(migration.name).toBe("flag-legacy-passkeys");
  });

  it("flags a legacy passkey in place", async () => {
    const storage = memoryStorage();
    seedLegacyPasskey(storage, "pk1");

    const { scratch, wipeAll } = createSecretScratch();
    try {
      await migration.up(storage, {
        revision: { module: "test", id: 1, name: "flag-legacy-passkeys" },
        secrets: scratch,
      });
    } finally {
      wipeAll();
    }

    const stored = JSON.parse(storage.getString("k/pk1") as string);
    expect(stored.metadata.migration).toBe(PASSKEY_MIGRATION_NEEDED);
    expect(stored.metadata.origin).toBe("https://example.com");
    expect(stored.metadata.userHandle).toBe("user-123");
    expect(storage.getString("k/pk1:needs-migration")).toBeUndefined();
  });

  it("is idempotent", async () => {
    await assertIdempotent({
      migration,
      context: () => {
        const storage = memoryStorage();
        seedLegacyPasskey(storage, "pk1");
        storage.set(
          "k/pk2",
          JSON.stringify({
            id: "pk2",
            type: "hd-derived-p256",
            algorithm: "P256",
            extractable: false,
            keyUsages: ["sign", "verify"],
            metadata: { storage: "none", scheme: "pbkdf2-p256", origin: "o", userHandle: "u" },
            version: 1,
          }),
        );
        return storage;
      },
      snapshot: (storage) => (storage as ReturnType<typeof memoryStorage>).entries(),
    });
  });

  it("is a no-op on empty storage", async () => {
    await assertIdempotent({
      migration,
      context: () => memoryStorage(),
      snapshot: (storage) => (storage as ReturnType<typeof memoryStorage>).entries(),
    });
  });
});
