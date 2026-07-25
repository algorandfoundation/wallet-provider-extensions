/**
 * The OS-keychain binding the node keystore driver relies on.
 *
 * A {@link KeyringBinding} is a tiny `(account) -> secret` surface over an
 * operating-system secure store (macOS Keychain, Windows Credential Manager,
 * Linux Secret Service / libsecret). The driver is intentionally free of any
 * hard dependency on a specific native library: the binding is injected, so
 * `createNodeKeyStore` supplies the default {@link createNapiKeyring} (backed by
 * `@napi-rs/keyring`) while tests can inject an in-memory fake.
 *
 * @remarks
 * OS keychains have a small per-entry size cap on some platforms (Windows
 * Credential Manager limits a credential blob to ~2.5 KB). The node driver
 * handles this by chunking oversized secret material across numbered accounts,
 * so a binding only ever needs to store/return whatever opaque string it is
 * handed for a given account.
 */

import { createRequire } from "node:module";

/**
 * The minimal, synchronous OS-keychain surface the driver depends on. Each
 * `account` maps to a single opaque secret string; the driver composes richer
 * layouts (chunked material, a metadata master key) on top of it.
 */
export interface KeyringBinding {
  /** Reads the secret stored for `account`, or `null` when absent. */
  get(account: string): string | null;
  /** Stores (inserts or replaces) the secret for `account`. */
  set(account: string, secret: string): void;
  /** Removes the secret for `account`; returns whether an entry existed. */
  delete(account: string): boolean;
}

/** Options for {@link createNapiKeyring}. */
export interface NapiKeyringOptions {
  /**
   * The OS-keychain service (a.k.a. "server"/"target") every entry is filed
   * under. Defaults to `"algorand-keystore"`.
   */
  service?: string;
}

/** The subset of `@napi-rs/keyring`'s `Entry` the binding uses. */
interface NapiEntry {
  getPassword(): string;
  setPassword(password: string): void;
  deletePassword(): boolean;
}

/** The subset of the `@napi-rs/keyring` module the binding uses. */
interface NapiKeyringModule {
  Entry: new (service: string, account: string) => NapiEntry;
}

/**
 * Creates a {@link KeyringBinding} backed by `@napi-rs/keyring` — the modern,
 * maintained, prebuilt (macOS/Windows/Linux incl. musl/arm) OS-keychain binding.
 *
 * The native module is loaded lazily via `createRequire`, so importing this
 * module (or the engine) never eagerly pulls in the native addon; it is only
 * resolved the first time a real keyring entry is accessed. Consumers that
 * inject their own {@link KeyringBinding} therefore need not have the native
 * package installed.
 *
 * @param options - {@link NapiKeyringOptions}.
 * @returns A {@link KeyringBinding} over the OS keychain.
 */
export function createNapiKeyring(options?: NapiKeyringOptions): KeyringBinding {
  const service = options?.service ?? "algorand-keystore";
  const require = createRequire(import.meta.url);
  const { Entry } = require("@napi-rs/keyring") as NapiKeyringModule;
  const entry = (account: string): NapiEntry => new Entry(service, account);

  return {
    get(account: string): string | null {
      try {
        return entry(account).getPassword();
      } catch {
        // `@napi-rs/keyring` throws when no entry exists; treat that as absent.
        return null;
      }
    },
    set(account: string, secret: string): void {
      entry(account).setPassword(secret);
    },
    delete(account: string): boolean {
      try {
        return entry(account).deletePassword();
      } catch {
        return false;
      }
    },
  };
}
