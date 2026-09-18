/**
 * Shared test fixtures: the KNOWN SCENARIOS the tests stage the
 * provider context (`ctx`) with, instead of small per-test stubs. The
 * app code takes no injection seams beyond the ctx-first parameter (the
 * flows call the provider's own methods): ctx-taking flows receive a
 * context assembled from the fixtures below, and the adapter tests
 * substitute the `createProvider` slot of `provider.ts` with one; every
 * fixture is typed as a SLICE of the upstream
 * types (`WebConnectionApi`, the keystore extension's store) rather
 * than a redefined interface.
 *
 * Scenarios:
 *
 * - the wallet's two accounts (a named primary and a bare secondary),
 *   its deterministic `did:key` identity, both on the wire
 *   ({@link WALLET_IDENTITY}) and as the identity-store record the
 *   engine's remote mirror feeds it into ({@link walletRemoteIdentity}),
 *   and its passkey/credential inventory ({@link WALLET_PASSKEY},
 *   {@link WALLET_CREDENTIAL});
 * - the X25519 agreement between the wallet's key pair and the page's:
 *   {@link SHARED_SECRET} is what the keystore's `deriveSharedSecret`
 *   hands back in the browser;
 * - the sessions those arrive on: {@link accountsSession} (connect/sign),
 *   {@link identitySession} (encryption), {@link pendingSession}
 *   (peerless out-of-band request);
 * - the connection API those flows drive: {@link connectionApi}
 *   (connect/resume/sign/disconnect) and {@link messagingConnection}
 *   (secure messaging, with the registered channels recorded).
 */

import { vi } from "vitest";
import algosdk from "algosdk";
import { x25519 } from "@noble/curves/ed25519.js";
import {
  x25519KeyPairFromEd25519Seed,
  type ConnectionMessage,
  type ConnectionSession,
  type SecureMessagingConfig,
  type WebConnectionApi,
} from "@algorandfoundation/connections";
import type { KeyStoreExtension } from "@algorandfoundation/keystore";
import {
  generateDidDocument,
  generateDidKey,
  type IdentityRecord,
} from "@algorandfoundation/identities";
import type { CredentialRecord } from "@algorandfoundation/credentials";
import type { Passkey } from "@algorandfoundation/passkeys-core";
import type { RemoteIdentity } from "../lib/identities/types.ts";

// --- The wallet's accounts --------------------------------------------

/** The wallet's primary account (named "Main" over the handshake). */
export const WALLET_ADDRESS_A = algosdk.encodeAddress(new Uint8Array(32).fill(1));

/** The wallet's secondary account (transmitted bare, no name). */
export const WALLET_ADDRESS_B = algosdk.encodeAddress(new Uint8Array(32).fill(2));

// --- The wallet's did:key identity ------------------------------------

/**
 * The wallet's deterministic Ed25519 identity key. Any 32 bytes whose
 * `y` is a field element with an X25519 equivalent works for the
 * key-agreement derivation the encryption flows exercise.
 */
export const WALLET_PUBLIC_KEY = new Uint8Array(32).fill(7);

/** The wallet identity's `did:key` identifier. */
export const WALLET_DID = generateDidKey(WALLET_PUBLIC_KEY);

/** The wallet identity's DID document (`keyAgreement` section included). */
export const WALLET_DID_DOCUMENT = generateDidDocument(WALLET_DID, WALLET_PUBLIC_KEY);

/**
 * The identity record the wallet exposes over the connect handshake's
 * `identities` domain (the identity store's record minus `sign`).
 */
export const WALLET_IDENTITY: IdentityRecord = {
  address: WALLET_DID,
  did: WALLET_DID,
  didDocument: WALLET_DID_DOCUMENT,
  type: "did:key",
};

/**
 * The identity-store record the engine's remote mirror feeds
 * {@link WALLET_IDENTITY} into for the given session, which is what
 * identity-store-reading flows (e.g. `connectedWalletPeer`) receive.
 */
export function walletRemoteIdentity(
  sessionId: string,
  overrides: Partial<RemoteIdentity> = {},
): RemoteIdentity {
  return {
    address: WALLET_DID,
    did: WALLET_DID,
    didDocument: WALLET_DID_DOCUMENT,
    type: "did:key",
    ...overrides,
    metadata: { source: "connection", sessionId, ...overrides.metadata },
  };
}

// --- The wallet's passkey/credential inventory --------------------------

/** The passkey metadata the wallet exposes over the connect handshake. */
export const WALLET_PASSKEY: Passkey = {
  credentialId: "passkey-1",
  rpId: "wallet.example.com",
  userName: "main@example.com",
  createdAt: 1,
};

/** The credential metadata the wallet exposes over the connect handshake. */
export const WALLET_CREDENTIAL: CredentialRecord = {
  id: "credential-1",
  type: ["VerifiableCredential", "DemoAttestation"],
  name: "Demo Attestation",
  format: "vc+sd-jwt",
  issuer: "did:web:issuer.example.com",
  identityAddress: WALLET_DID,
};

// --- The X25519 agreement scenario -------------------------------------

/** The wallet identity's X25519 key-agreement pair. */
export const WALLET_KEY_PAIR = x25519KeyPairFromEd25519Seed(new Uint8Array(32).fill(11));

/**
 * A stand-in for the page's non-extractable keystore key. In the
 * browser the private half lives inside WebCrypto and only the shared
 * secret surfaces via the keystore's `deriveSharedSecret`.
 */
export const PAGE_KEY_PAIR = x25519KeyPairFromEd25519Seed(new Uint8Array(32).fill(22));

/** The ECDH output both halves derive, the secure channel's input. */
export const SHARED_SECRET = x25519.getSharedSecret(
  PAGE_KEY_PAIR.privateKey,
  WALLET_KEY_PAIR.publicKey,
);

// --- Session scenarios --------------------------------------------------

/**
 * The CONNECT/SIGN SCENARIO: a connected session whose wallet exposed
 * its two accounts over the handshake.
 */
export function accountsSession(overrides: Partial<ConnectionSession> = {}): ConnectionSession {
  return {
    id: "session-1",
    origin: "https://liquid.example.com",
    status: "connected",
    peer: {
      domains: {
        accounts: [{ address: WALLET_ADDRESS_A, name: "Main" }, { address: WALLET_ADDRESS_B }],
      },
      metadata: { name: "Test Wallet" },
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/**
 * The ENCRYPTION SCENARIO: a connected session whose wallet exposed its
 * `did:key` identity ({@link WALLET_IDENTITY}) over the handshake.
 */
export function identitySession(overrides: Partial<ConnectionSession> = {}): ConnectionSession {
  return {
    id: "session-1",
    origin: "https://liquid.example.com",
    status: "connected",
    peer: {
      domains: { accounts: [], identities: [WALLET_IDENTITY] },
      metadata: { name: "Test Wallet" },
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/**
 * The PENDING-REQUEST SCENARIO: the peerless session a connect parks in
 * the store while the out-of-band request waits to be scanned.
 */
export function pendingSession(overrides: Partial<ConnectionSession> = {}): ConnectionSession {
  return {
    id: "request-1",
    origin: "https://liquid.example.com",
    status: "pending",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

// --- The connection API -------------------------------------------------

/**
 * The `provider.connection` surface the connector drives: slices of the
 * upstream `WebConnectionApi`, nothing redefined.
 */
export type ConnectionApi = Pick<
  WebConnectionApi,
  "ready" | "connect" | "resume" | "signTransactions" | "disconnect"
> & {
  store: Pick<WebConnectionApi["store"], "getSessions" | "getSession">;
};

/**
 * A `provider.connection` fixture for the connect/sign scenarios:
 * connects resolve the {@link accountsSession}, resumes echo the
 * requested id back, signing returns unsigned slots, and nothing is
 * persisted. Override any entry point to stage a different scenario.
 */
export function connectionApi(overrides: Partial<ConnectionApi> = {}): ConnectionApi & {
  connect: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  signTransactions: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
} {
  return {
    ready: Promise.resolve(),
    store: {
      getSessions: async () => [],
      getSession: async () => undefined,
    },
    connect: vi.fn(async () => accountsSession()),
    resume: vi.fn(async (sessionId: string) => accountsSession({ id: sessionId })),
    signTransactions: vi.fn(async (_id: string, txns: string[]) => txns.map(() => null)),
    disconnect: vi.fn(async () => {}),
    ...overrides,
  } as ConnectionApi & {
    connect: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    signTransactions: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };
}

/**
 * A `provider.connection` fixture for the secure-messaging scenario:
 * records the channel each `enableSecureMessaging` registered (keyed by
 * session id) and delivers every `sendSecureMessage` as a known
 * `delivered` message.
 */
export function messagingConnection(): {
  connection: Pick<WebConnectionApi, "enableSecureMessaging" | "sendSecureMessage">;
  channels: Map<string, SecureMessagingConfig>;
} {
  const channels = new Map<string, SecureMessagingConfig>();
  const connection = {
    enableSecureMessaging: vi.fn((sessionId: string, config: SecureMessagingConfig) => {
      channels.set(sessionId, config);
    }),
    sendSecureMessage: vi.fn(
      async (sessionId: string, text: string): Promise<ConnectionMessage> => ({
        id: "m-1",
        sessionId,
        direction: "outgoing",
        text,
        status: "delivered",
        createdAt: 1,
        updatedAt: 2,
      }),
    ),
  } satisfies Pick<WebConnectionApi, "enableSecureMessaging" | "sendSecureMessage">;
  return { connection, channels };
}

// --- The keystore -------------------------------------------------------

/**
 * The `provider.key.store` slice the encryption flows drive: its
 * `deriveSharedSecret` hands back the scenario's precomputed
 * {@link SHARED_SECRET} (in the browser the X25519 ECDH runs inside
 * WebCrypto on the non-extractable agreement key).
 */
export function agreementKeystore(): Pick<
  KeyStoreExtension["key"]["store"],
  "deriveSharedSecret"
> & { deriveSharedSecret: ReturnType<typeof vi.fn> } {
  return { deriveSharedSecret: vi.fn(async () => SHARED_SECRET) };
}
