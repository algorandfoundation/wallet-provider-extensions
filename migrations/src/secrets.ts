import { SecretNotFoundError, SecretScratchDisposedError } from "./errors.ts";
import type { SecretScratch } from "./types.ts";

/**
 * A {@link SecretScratch} paired with the wipe control the runner retains.
 *
 * The migration only ever receives `scratch`, so it cannot extend the lifetime
 * of the material it holds.
 */
export interface SecretScratchHandle {
  /** Handed to the migration as `utils.secrets`. */
  scratch: SecretScratch;
  /** Zeroes every entry and disposes the scratch. Idempotent. */
  wipeAll(): void;
}

/**
 * Creates a run-scoped, in-memory scratch for secret material.
 *
 * Material is held as raw `Uint8Array` — never strings, which are immutable,
 * cannot be zeroed, and leak into logs. Nothing is ever written to durable
 * storage. The runner creates one scratch per revision and wipes it in a
 * `finally`, so buffers are zeroed whether the revision succeeds or throws.
 *
 * @returns A {@link SecretScratchHandle}.
 *
 * @example
 * ```typescript
 * const { scratch, wipeAll } = createSecretScratch();
 * try {
 *   scratch.put("seed", await oldStore.read(id));
 *   await scratch.use("seed", (bytes) => newStore.write(id, bytes));
 * } finally {
 *   wipeAll();
 * }
 * ```
 */
export function createSecretScratch(): SecretScratchHandle {
  const entries = new Map<string, Uint8Array>();
  let disposed = false;

  function assertLive(): void {
    if (disposed) {
      throw new SecretScratchDisposedError();
    }
  }

  function read(label: string): Uint8Array {
    assertLive();
    const bytes = entries.get(label);
    if (bytes === undefined) {
      throw new SecretNotFoundError(label);
    }
    return bytes;
  }

  const scratch: SecretScratch = {
    put(label: string, bytes: Uint8Array): void {
      assertLive();
      const previous = entries.get(label);
      if (previous !== undefined) {
        previous.fill(0);
      }
      entries.set(label, bytes);
    },
    async use<T>(label: string, fn: (bytes: Uint8Array) => T | Promise<T>): Promise<T> {
      return fn(read(label));
    },
    has(label: string): boolean {
      assertLive();
      return entries.has(label);
    },
    wipe(label: string): void {
      assertLive();
      const bytes = entries.get(label);
      if (bytes === undefined) {
        return;
      }
      bytes.fill(0);
      entries.delete(label);
    },
    toJSON(): string {
      return "[SecretScratch]";
    },
  };

  // Node's inspector bypasses `toJSON`, so redact that path too. Non-enumerable
  // so it never shows up in a spread or `Object.keys`.
  Object.defineProperty(scratch, Symbol.for("nodejs.util.inspect.custom"), {
    value: (): string => "[SecretScratch]",
    enumerable: false,
  });

  return {
    scratch,
    wipeAll(): void {
      for (const bytes of entries.values()) {
        bytes.fill(0);
      }
      entries.clear();
      disposed = true;
    },
  };
}
