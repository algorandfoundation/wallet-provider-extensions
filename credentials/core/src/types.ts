import type { HookCollection } from "before-after-hook";
import type { JwsSigner } from "./utils/index.ts";

/**
 * The credential format as advertised by an OID4VCI issuer.
 *
 * The wallet is agnostic over the underlying envelope; we just keep the
 * raw payload (compact JWT, SD-JWT VC, JSON-LD VC, mdoc CBOR, ...) and
 * surface the format so renderers / verifiers can pick the right
 * codec.
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
 */
export interface Credential {
  /** JSON-LD context for Universal Wallet 2020 alignment. */
  "@context"?: string | (string | Record<string, any>)[];
  /** Stable wallet-local identifier (e.g. hash of the raw credential). */
  id: string;
  /**
   * Universal Wallet 2020 item types.
   * SHOULD include 'VerifiableCredential'.
   */
  type: string[];
  /**
   * Address of the {@link Identity} that holds this credential — the
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
 * Local mirror of an OID4VCI issuance session driven by intermezzo-fresh.
 *
 * Sessions are scoped to the holding {@link Identity} via
 * {@link IssuanceSession.identityAddress}, mirroring how
 * `holderDidKey` is pinned into the offer (SEQUENCE.md §4a).
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
 * Local mirror of an OID4VP verification session driven by intermezzo-fresh.
 *
 * Scoped to the {@link Identity} that will satisfy the request (the
 * holder of the credential to be presented).
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
 */
export interface CredentialStoreState {
  credentials: Credential[];
  issuanceSessions: IssuanceSession[];
  verificationSessions: VerificationSession[];
}

/**
 * The extension surface contributed to the wallet provider.
 *
 * The credential store no longer hard-depends on the identities
 * extension — holder integration flows through the
 * {@link import("./holder.ts").HolderBinding} seam, so a provider without
 * identities (e.g. one that will source holders from Digital Credentials
 * API mDocs) can still mount `WithCredentials`.
 */
export interface CredentialStoreExtension extends CredentialStoreState {
  credential: {
    store: CredentialStoreApi;
  };
}

/**
 * CRUD + session-mirroring API exposed by the credential store extension.
 */
export interface CredentialStoreApi {
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
   * Takes an array of query objects (e.g. `QueryByFrame`,
   * `QueryByExample`) and returns the matching credentials.
   */
  query: (queries: any[]) => Promise<Credential[]>;
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
   * expose a signing primitive — callers should fall back to their
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
  /** Hooks for credential store operations. */
  hooks: HookCollection<any>;
}
