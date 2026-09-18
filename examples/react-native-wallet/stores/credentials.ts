import { Store } from "@tanstack/store";
import type {
  CredentialKeyValueStore,
  CredentialStoreState,
} from "@algorandfoundation/credentials";
import { localStorage } from "./mmkv-local";

/**
 * The single source of truth for Verifiable Credentials in the application.
 *
 * Tracks the in-wallet credential records as well as ephemeral OID4VC
 * issuance / presentation session state. Hydration and persistence are
 * owned by the credential store engine, which reads/writes MMKV through
 * the {@link credentialsDriver} passed via provider options.
 */
export const credentialsStore = new Store<CredentialStoreState>({
  credentials: [],
  issuanceSessions: [],
  verificationSessions: [],
});

/**
 * Two-line MMKV adapter for the engine's `CredentialKeyValueStore`
 * persistence seam. The engine handles snapshot (de)serialisation,
 * including tagged `raw` handling so `Uint8Array` payloads round-trip.
 * Only the durable `credentials` slice is persisted; OID4VC sessions
 * are transient and intentionally not written.
 */
export const credentialsDriver: CredentialKeyValueStore = {
  get: (key) => localStorage.getString(key),
  set: (key, value) => localStorage.set(key, value),
};
