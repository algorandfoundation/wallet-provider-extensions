import type { ExtensionOptions } from "@algorandfoundation/wallet-provider";
import type { Store } from "@tanstack/store";
import type { HookCollection } from "before-after-hook";

import type { CredentialKeyValueStore } from "./engine.ts";
import type { HolderBinding } from "./holder.ts";
import type { JwsSigner } from "./utils/index.ts";

/**
 * The credential format as advertised by an OID4VCI issuer.
 *
 * The wallet is agnostic over the underlying envelope; we just keep the
 * raw payload (compact JWT, SD-JWT VC, JSON-LD VC, mdoc CBOR, ...) and
 * surface the format so renderers / verifiers can pick the right
 * codec.
 *
 * @example
 * ```typescript
 * const format: CredentialFormat = "vc+sd-jwt";
 * if (format === "vc+sd-jwt" || format === "dc+sd-jwt") parseSdJwtVc(raw);
 * ```
 */
export type CredentialFormat =
  | "jwt_vc_json"
  | "jwt_vc_json-ld"
  | "ldp_vc"
  | "vc+sd-jwt"
  | "mso_mdoc"
  | (string & {});

/**
 * A Verifiable Credential held by the wallet (holder side).
 *
 * Every credential is scoped to the {@link Identity} that holds it via
 * {@link Credential.identityAddress}. This pairs the on-device key
 * material (managed by the identities extension) with the credential
 * that binds to it (`cnf.kid` / `cnf.jwk`), enabling per-identity
 * lookups, multi-persona wallets, and cascade cleanup on identity
 * removal.
 *
 * This structure aligns with the Universal Wallet 2020 data model,
 * supporting standard metadata (name, description, image, tags)
 * and JSON-LD context for interoperability.
 *
 * @example
 * ```typescript
 * const credential: Credential = {
 *   "@context": ["https://w3id.org/wallet/v1"],
 *   id: "sha256:...",
 *   type: ["VerifiableCredential"],
 *   identityAddress: "did:key:z6Mk...",
 *   name: "Device Attestation",
 *   format: "vc+sd-jwt",
 *   raw: compactSdJwt,
 *   receivedAt: Date.now(),
 * };
 * ```
 */
export interface Credential {
  /** JSON-LD context for Universal Wallet 2020 alignment. */
  "@context"?: string | (string | Record<string, unknown>)[];
  /** Stable wallet-local identifier (e.g. hash of the raw credential). */
  id: string;
  /**
   * Universal Wallet 2020 item types.
   * SHOULD include 'VerifiableCredential'.
   */
  type: string[];
  /**
   * Address of the {@link Identity} that holds this credential, the
   * same value used in `provider.identity.store.getIdentity(address)`.
   * Typically the holder `did:key` URL.
   */
  identityAddress: string;
  /** Human-readable name surfaced in the UI (typ. from issuer display). */
  name: string;
  /** Optional human-readable description (Universal Wallet 2020). */
  description?: string;
  /** Optional image/logo URI (Universal Wallet 2020). */
  image?: string;
  /** Optional tags for organizing credentials (Universal Wallet 2020). */
  tags?: string[];
  /** OID4VCI credential configuration id this credential was issued from. */
  configurationId?: string;
  /** Credential format / envelope. */
  format: CredentialFormat;
  /** Raw credential payload as received from the issuer. */
  raw: string | Uint8Array;
  /** Parsed claims (best-effort, format-specific). */
  claims?: Record<string, unknown>;
  /** Issuer identifier (DID, https URL, ...). */
  issuer?: string;
  /** Holder binding (DID or key id). */
  holder?: string;
  /** ISO 8601 issuance timestamp from the credential. */
  issuedAt?: string;
  /** ISO 8601 expiration timestamp (if any). */
  expiresAt?: string;
  /** Optional revocation / status list reference. */
  status?: {
    type: string;
    id: string;
    index?: number;
  };
  /** Timestamp the credential was stored locally. */
  receivedAt: number;
  /** Optional renderer hints (logos, colors, ...) from the issuer. */
  display?: Record<string, unknown>;
  /** Extra metadata not modelled above. */
  metadata?: Record<string, unknown>;
}

/**
 * Local mirror of an OID4VCI issuance session owned by an external issuer.
 *
 * The wallet never drives issuance state itself: a backend bridge (e.g.
 * `@algorandfoundation/credentials-intermezzo-extension`) upserts these
 * mirrors through {@link CredentialStoreApi.upsertIssuanceSession} so the UI
 * can render issuer-side progress from the same reactive store. Sessions are
 * scoped to the holding {@link Identity} via
 * {@link IssuanceSession.identityAddress}, mirroring how the holder `did:key`
 * is pinned into the credential offer.
 *
 * @example
 * ```typescript
 * await provider.credential.store.upsertIssuanceSession({
 *   id: "offer-1",
 *   identityAddress: "did:key:z6Mk...",
 *   state: "OfferCreated",
 *   credentialConfigurationIds: ["device-attestation"],
 * });
 * ```
 */
export interface IssuanceSession {
  id: string;
  /** Address of the {@link Identity} the offer is pinned to. */
  identityAddress: string;
  state: string;
  credentialConfigurationIds: string[];
  credentialOfferUri?: string;
  holderDidKey?: string;
  createdAt?: number;
  updatedAt?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Local mirror of an OID4VP verification session owned by an external
 * verifier.
 *
 * Like {@link IssuanceSession}, these are upserted by a backend bridge (e.g.
 * the intermezzo extension) through
 * {@link CredentialStoreApi.upsertVerificationSession}; the store itself only
 * holds the mirror. Scoped to the {@link Identity} that will satisfy the
 * request (the holder of the credential to be presented).
 *
 * @example
 * ```typescript
 * await provider.credential.store.upsertVerificationSession({
 *   id: "request-1",
 *   identityAddress: "did:key:z6Mk...",
 *   state: "RequestCreated",
 *   authorizationRequest: "openid4vp://...",
 * });
 * ```
 */
export interface VerificationSession {
  id: string;
  /** Address of the {@link Identity} that will respond to this request. */
  identityAddress: string;
  state: string;
  authorizationRequest?: string;
  presentationDefinition?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
  metadata?: Record<string, unknown>;
}

/**
 * The state of the credential store.
 *
 * @example
 * ```typescript
 * const store = new Store<CredentialStoreState>({
 *   credentials: [],
 *   issuanceSessions: [],
 *   verificationSessions: [],
 * });
 * ```
 */
export interface CredentialStoreState {
  /** Credentials held by the wallet (the durable, persisted slice). */
  credentials: Credential[];
  /** Mirrored OID4VCI issuance sessions (transient). */
  issuanceSessions: IssuanceSession[];
  /** Mirrored OID4VP verification sessions (transient). */
  verificationSessions: VerificationSession[];
}

/**
 * The `example` payload of a Universal Wallet 2020 `QueryByExample` query:
 * a partial credential whose `type` narrows the result. Any other member is
 * carried through untouched (the store only matches on `type` today).
 *
 * @example
 * ```typescript
 * const example: QueryByExampleCredential = { type: "DeviceAttestationCredential" };
 * ```
 */
export interface QueryByExampleCredential {
  /** Credential type(s) every match must carry; a string is treated as a single-element list. */
  type?: string | string[];
  /** Further example members; ignored by the store's matcher. */
  [k: string]: unknown;
}

/**
 * A Universal Wallet 2020 `QueryByExample` query as understood by
 * {@link CredentialStoreApi.query}.
 *
 * Both the flat form (`{ example }`) and the nested form the Universal Wallet
 * spec derives from VC-API (`{ credentialQuery: { example } }`) are accepted;
 * when both are present the nested one wins.
 *
 * @example
 * ```typescript
 * const query: QueryByExample = {
 *   type: "QueryByExample",
 *   credentialQuery: { example: { type: ["VerifiableCredential", "DeviceAttestationCredential"] } },
 * };
 * ```
 */
export interface QueryByExample {
  /** The Universal Wallet 2020 query type discriminator. */
  type?: "QueryByExample";
  /** Flat form: the partial credential to match against. */
  example?: QueryByExampleCredential;
  /** Nested (VC-API) form: the partial credential to match against. */
  credentialQuery?: {
    example?: QueryByExampleCredential;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/**
 * A single query object accepted by {@link CredentialStoreApi.query}.
 *
 * Only {@link QueryByExample} narrows the result today; any other Universal
 * Wallet 2020 query shape (e.g. `QueryByFrame`) is accepted for forward
 * compatibility and matches every credential.
 *
 * @example
 * ```typescript
 * const queries: CredentialQuery[] = [
 *   { type: "QueryByExample", example: { type: "VerifiableCredential" } },
 *   { type: "QueryByFrame", frame: {} }, // unknown shape: matches everything
 * ];
 * const matches = await provider.credential.store.query(queries);
 * ```
 */
export type CredentialQuery = QueryByExample | { type: string; [k: string]: unknown };

/**
 * The extension surface contributed to the wallet provider.
 *
 * The credential store no longer hard-depends on the identities
 * extension: holder integration flows through the
 * {@link HolderBinding} seam, so a provider without identities (e.g. one
 * that will source holders from Digital Credentials API mDocs) can still
 * mount `WithCredentials`.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithCredentials]);
 * const provider = new MyProvider({ id: "wallet", name: "Wallet" }, {});
 * const held: Credential[] = provider.credentials; // reactive getter
 * await provider.credential.store.addCredential(credential);
 * ```
 */
export interface CredentialStoreExtension extends CredentialStoreState {
  /** The `credential` namespace on the provider. */
  credential: {
    /** The credential store API, see {@link CredentialStoreApi}. */
    store: CredentialStoreApi;
  };
}

/**
 * CRUD + session-mirroring API exposed by the credential store extension.
 *
 * @example
 * ```typescript
 * const api = provider.credential.store;
 * await api.ready;
 * await api.addCredential(credential);
 * const mine = await api.getCredentialsByIdentity("did:key:z6Mk...");
 * ```
 */
export interface CredentialStoreApi {
  /**
   * Resolves once the store is usable: the engine's hydration from its
   * persistence driver has completed, and, when mounted through a platform
   * `WithCredentials` extension, its optional connections bridge import has
   * settled. Never rejects. `getCredentials` and friends work before it
   * resolves (over the not-yet-hydrated state), so awaiting it matters
   * whenever the persisted snapshot must be visible, and before initiating
   * a connection so the first handshake exchanges records. Absent only on
   * hand-rolled {@link CredentialStoreApi} doubles.
   */
  ready?: Promise<void>;
  /** Adds (or replaces by id) a credential in the store. */
  addCredential: (credential: Credential) => Promise<Credential>;
  /** Removes a credential by id. */
  removeCredential: (id: string) => Promise<void>;
  /** Retrieves a credential by id. */
  getCredential: (id: string) => Promise<Credential | undefined>;
  /** Lists all credentials currently held by the wallet. */
  getCredentials: () => Promise<Credential[]>;
  /**
   * Generic query interface matching Universal Wallet 2020.
   *
   * Takes an array of {@link CredentialQuery} objects and returns the union
   * of their matches, de-duplicated by id. `QueryByExample` narrows by
   * credential `type`; unrecognized shapes match everything and an empty
   * list returns every credential.
   */
  query: (queries: CredentialQuery[]) => Promise<Credential[]>;
  /**
   * Lists credentials held by a specific {@link Identity}.
   *
   * @param address - The identity address (e.g. holder `did:key`).
   */
  getCredentialsByIdentity: (address: string) => Promise<Credential[]>;
  /**
   * Lists issuance sessions targeting a specific identity.
   */
  getIssuanceSessionsByIdentity: (address: string) => Promise<IssuanceSession[]>;
  /**
   * Lists verification sessions targeting a specific identity.
   */
  getVerificationSessionsByIdentity: (address: string) => Promise<VerificationSession[]>;
  /**
   * Removes every credential and every session attached to an identity.
   * Wired automatically as a cascade on `identity.store.removeIdentity`.
   */
  removeByIdentity: (address: string) => Promise<void>;
  /**
   * Builds a {@link JwsSigner} from an identity's `sign` callback.
   *
   * Returns `undefined` when the identity is unknown or does not
   * expose a signing primitive; callers should fall back to their
   * own keystore bridge in that case.
   */
  getSignerForIdentity: (address: string) => Promise<JwsSigner | undefined>;
  /** Upserts an issuance session mirror (driven by an external sync loop). */
  upsertIssuanceSession: (session: IssuanceSession) => Promise<IssuanceSession>;
  /** Removes an issuance session by id. */
  removeIssuanceSession: (id: string) => Promise<void>;
  /** Upserts a verification session mirror. */
  upsertVerificationSession: (session: VerificationSession) => Promise<VerificationSession>;
  /** Removes a verification session by id. */
  removeVerificationSession: (id: string) => Promise<void>;
  /** Clears all credentials and sessions. */
  clear: () => Promise<void>;
  /**
   * Hook collection guarding every store operation (`add`, `remove`, `get`,
   * `list`, `listByIdentity`, `query`, `removeByIdentity`,
   * `upsertIssuanceSession`, `removeIssuanceSession`,
   * `upsertVerificationSession`, `removeVerificationSession`, `clear`).
   * Powered by {@link https://github.com/gr2m/before-after-hook before-after-hook}.
   */
  hooks: HookCollection<any>;
}

/**
 * The `options.credentials` namespace the credentials extensions claim on the
 * shared {@link ExtensionOptions} registry.
 *
 * This is the platform-neutral half of the two-level registry: the platform
 * packages (`@algorandfoundation/credentials-node`,
 * `@algorandfoundation/credentials-web`,
 * `@algorandfoundation/react-native-credentials`) and bridges **augment** this
 * interface with their own seams (e.g. React Native's
 * `digitalCredentialsModule`), so a composition root gets one fully typed
 * `options.credentials` block whichever platform it installs.
 *
 * Everything is optional: the platform `WithCredentials` extensions fill in a
 * default reactive store, hook collection and (where the platform has one) a
 * default persistence driver, and auto-bind {@link HolderBinding} from
 * `provider.identity.store` when an identities extension is present.
 *
 * @example
 * ```typescript
 * declare module "@algorandfoundation/credentials-core" {
 *   interface CredentialsNamespace {
 *     databaseName?: string;
 *   }
 * }
 * ```
 */
export interface CredentialsNamespace {
  /** Reactive store backing the engine; created when not provided. */
  store?: Store<CredentialStoreState>;
  /** Hook collection guarding every store operation. */
  hooks?: HookCollection<any>;
  /** Persistence driver; platform default (or in-memory) when omitted. */
  driver?: CredentialKeyValueStore;
  /** Holder binding override; auto-derived from `provider.identity.store` when omitted. */
  binding?: HolderBinding;
  /** Storage key override; defaults to `DEFAULT_CREDENTIALS_KEY`. */
  storageKey?: string;
}

declare module "@algorandfoundation/wallet-provider" {
  interface ExtensionOptions {
    /** Credentials-specific settings, see {@link CredentialsNamespace}. */
    credentials?: CredentialsNamespace;
  }
}

/**
 * Options accepted by the platform `WithCredentials` extensions.
 *
 * Narrows the shared {@link ExtensionOptions} registry to the
 * `options.credentials` block, see {@link CredentialsNamespace}.
 *
 * @example
 * ```typescript
 * const MyProvider = Provider.withExtensions([WithCredentials]);
 * const provider = new MyProvider(
 *   { id: "wallet", name: "Wallet" },
 *   { credentials: { driver: memoryCredentialDriver(), storageKey: "creds" } },
 * );
 * ```
 */
export interface CredentialStoreOptions extends ExtensionOptions {
  /** Credentials-specific settings. */
  credentials?: CredentialsNamespace;
}
