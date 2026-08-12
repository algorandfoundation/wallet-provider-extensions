import { createSecretScratch } from "@algorandfoundation/provider-migrations";
import type { MigrationUtils } from "@algorandfoundation/provider-migrations";
import { assertIdempotent } from "@algorandfoundation/provider-migrations/testing";
import { base64 } from "@scure/base";
import { describe, expect, it, vi } from "vitest";
import { memoryStorage, migrationContext } from "../storage/__fixtures__.ts";
import { openData, sealData } from "../storage/crypto.ts";
import { PASSKEY_MIGRATION_NEEDED } from "../storage/driver.ts";
import { encode } from "../storage/state.ts";
import { migration } from "./0002-adopt-flat-records.ts";

const subtle = globalThis.crypto.subtle;

const masterKey = Buffer.alloc(32, 5);
// Fresh copy per call, like the production `readMasterKey`: the pass zeroes
// the buffer it receives once it's done with it.
const masterKeyForRead = async () => Buffer.from(masterKey);

/** Runs the revision the way `applyMigrations` would, with a wiped scratch. */
async function runRevision(
  context: ReturnType<typeof migrationContext>,
  log?: MigrationUtils["log"],
): Promise<void> {
  const { scratch, wipeAll } = createSecretScratch();
  try {
    await migration.up(context, {
      revision: { module: "test", id: 2, name: "adopt-flat-records" },
      secrets: scratch,
      log,
    });
  } finally {
    wipeAll();
  }
}

describe("revision 0002 — adopt-flat-records", () => {
  it("is revision 2", () => {
    expect(migration.id).toBe(2);
    expect(migration.name).toBe("adopt-flat-records");
  });

  it("adopts a flat record into the split layout, keeping material openable", async () => {
    const storage = memoryStorage();
    storage.set(
      "legacy-1",
      await sealData(
        subtle,
        masterKey,
        encode({
          id: "legacy-1",
          type: "ed25519",
          algorithm: "EdDSA",
          extractable: false,
          keyUsages: ["sign", "verify"],
          privateKey: new Uint8Array([9, 8, 7]),
          version: 1,
        } as any),
      ),
    );

    await runRevision(migrationContext(storage, { masterKeyForRead }));

    expect(storage.getString("legacy-1")).toBeUndefined();
    expect(JSON.parse(storage.getString("k/legacy-1") as string).id).toBe("legacy-1");
    const opened = await openData(subtle, masterKey, storage.getString("m/legacy-1") as string);
    expect(base64.decode(opened)).toEqual(new Uint8Array([9, 8, 7]));
  });

  it("closes the 0001 gap: a legacy passkey that was still flat gets flagged after adoption", async () => {
    const storage = memoryStorage();
    // A pre-dp256-split passkey (no `scheme` in metadata) still stored flat —
    // invisible to revision 0001's `k/` scan when it ran.
    storage.set(
      "pk-flat",
      await sealData(
        subtle,
        masterKey,
        encode({
          id: "pk-flat",
          type: "hd-derived-p256",
          algorithm: "P256",
          extractable: false,
          keyUsages: ["sign", "verify"],
          privateKey: new Uint8Array([1, 2, 3]),
          metadata: { storage: "none", origin: "https://example.com", userHandle: "user-123" },
          version: 1,
        } as any),
      ),
    );

    await runRevision(migrationContext(storage, { masterKeyForRead }));

    const meta = JSON.parse(storage.getString("k/pk-flat") as string);
    expect(meta.metadata.migration).toBe(PASSKEY_MIGRATION_NEEDED);
    expect(meta.metadata.origin).toBe("https://example.com");
  });

  it("reports skipped records through the log without failing the revision", async () => {
    const storage = memoryStorage();
    storage.set("corrupt", "{not sealed}");
    const warn = vi.fn();

    await expect(
      runRevision(migrationContext(storage, { masterKeyForRead }), {
        info: vi.fn(),
        warn,
        error: vi.fn(),
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('"corrupt"');
    // The record is left untouched for a later pass or manual recovery.
    expect(storage.getString("corrupt")).toBe("{not sealed}");
  });

  it("is idempotent, including over records it must skip", async () => {
    await assertIdempotent({
      migration,
      context: async () => {
        const storage = memoryStorage();
        storage.set(
          "legacy-1",
          await sealData(
            subtle,
            masterKey,
            encode({
              id: "legacy-1",
              type: "seed",
              algorithm: "raw",
              extractable: false,
              keyUsages: ["deriveBits", "deriveKey"],
              seed: new Uint8Array([4, 4, 4]),
              version: 1,
            } as any),
          ),
        );
        storage.set("corrupt", "{not sealed}");
        return migrationContext(storage, { masterKeyForRead });
      },
      snapshot: (ctx) => (ctx.storage as ReturnType<typeof memoryStorage>).entries(),
    });
  });

  it("is a no-op on empty storage and never touches the master key", async () => {
    const masterKeySpy = vi.fn(masterKeyForRead);
    await assertIdempotent({
      migration,
      context: () => migrationContext(memoryStorage(), { masterKeyForRead: masterKeySpy }),
      snapshot: (ctx) => (ctx.storage as ReturnType<typeof memoryStorage>).entries(),
    });
    expect(masterKeySpy).not.toHaveBeenCalled();
  });
});
